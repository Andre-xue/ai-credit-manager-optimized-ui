// 全端云同步：把整份本地数据（含加密密钥密文与保险箱材料）作为单个 JSON 载荷存云端。
// 每个用户一行（owner_id 唯一），RLS 保证只能读写自己的数据。
// 实时性：SDK 无 realtime 订阅，采用时间戳轮询——登录后定时检查云端 updated_at，
// 发现是其他端更新则自动拉取并刷新本地，实现「改完自动同步、另一端无需操作」。

import { cloud } from './cloud'
import type { AppState } from './types'
import { isLocalProvider } from './types'
import type { KeyBackupFile } from './keyBackup'
import { getVaultSyncMaterial, applyVaultSyncMaterial, type VaultSyncMaterial } from './crypto'
import { mergeAudit } from './auditLog'

const TABLE = 'user_data'
const LAST_SYNC_KEY = 'acm.sync.lastAt'
const REMOTE_VERSION_KEY = 'acm.sync.remoteVersion'
const MAX_CLOUD_BACKUPS = 20

/** 云端快照备份（v0.1.330）：整份状态的时间点副本，与同步镜像互补——同步防丢、快照防改错可回滚 */
export interface StateSnapshot {
  id: string
  createdAt: string
  /** 产生快照的设备标识 */
  clientId: string
  note?: string
  state: AppState
  vault: VaultSyncMaterial
}

export interface SyncPayload {
  appState: AppState
  vault: VaultSyncMaterial
  /** 删除 API Key 前的密文备份（自包含，可恢复） */
  keyBackups?: KeyBackupFile[]
  /** 云端快照备份列表（旧→新），普通同步只保留不改动，由 cloudSnapshots 专门维护 */
  stateSnapshots?: StateSnapshot[]
  /** 客户端写入时间戳 */
  clientAt: string
  /** 写入端标识，用于识别是不是自己刚推的，避免回环拉取 */
  clientId: string
}

export interface PullResult {
  ok: boolean
  payload: SyncPayload | null
  /** 服务端该行的 updated_at，作为同步基线 */
  remoteVersion: string | null
  error?: string
}

export interface PushResult {
  ok: boolean
  /** 服务端写回后的 updated_at */
  remoteVersion: string | null
  error?: string
}

export function errMsg(error: unknown): string {
  // 云 SDK 的错误结构不固定：可能是 Error、{message}、{error:{message}}、
  // 或 message 本身又是个对象。深度提取可读文本，避免显示 [object Object]。
  const seen = new Set<unknown>()
  const pick = (v: unknown, depth: number): string => {
    if (v == null || depth > 4 || seen.has(v)) return ''
    seen.add(v)
    if (typeof v === 'string') return v.trim()
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v instanceof Error) return pick(v.message, depth + 1) || v.name
    if (Array.isArray(v)) return v.map(x => pick(x, depth + 1)).filter(Boolean).join('; ')
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['message', 'msg', 'error_description', 'error', 'hint', 'details', 'detail', 'code']) {
        const s = pick(o[k], depth + 1)
        if (s && s !== '[object Object]') return s
      }
      // 兜底：安全序列化
      try {
        const s = JSON.stringify(o)
        if (s && s !== '{}') return s.slice(0, 200)
      } catch { /* ignore */ }
    }
    return ''
  }
  return pick(error, 0) || '未知错误（请检查网络或云同步登录状态）'
}

function dbAny() { return cloud.database as any }

/** 生成一个稳定的本机标识（同一浏览器/App 安装内不变） */
export function getClientId(): string {
  const KEY = 'acm.sync.clientId'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return `fallback-${Date.now()}`
  }
}

/** 只查云端版本号（updated_at），用于轮询，省去传输整份 payload */
export async function checkRemoteVersion(): Promise<{ ok: boolean; version: string | null; error?: string }> {
  try {
    const { data, error } = await dbAny().from(TABLE).select('updated_at').maybeSingle()
    if (error) return { ok: false, version: null, error: errMsg(error) }
    return { ok: true, version: data?.updated_at ?? null }
  } catch (e) {
    return { ok: false, version: null, error: errMsg(e) }
  }
}

/** 读取当前登录用户的完整数据行 */
export async function pullPayload(): Promise<PullResult> {
  try {
    const { data, error } = await dbAny()
      .from(TABLE)
      .select('payload, updated_at, owner_name')
      .maybeSingle()
    if (error) return { ok: false, payload: null, remoteVersion: null, error: errMsg(error) }
    const version = data?.updated_at ?? null
    if (!data?.payload) return { ok: true, payload: null, remoteVersion: version }
    return { ok: true, payload: data.payload as SyncPayload, remoteVersion: version }
  } catch (e) {
    return { ok: false, payload: null, remoteVersion: null, error: errMsg(e) }
  }
}

/** 把本地数据与保险箱材料推送到云端（每用户一行，存在则更新、不存在则插入） */
export async function pushPayload(appState: AppState, newBackups?: KeyBackupFile[], opts?: { includeLocal?: boolean; snapshots?: StateSnapshot[] }): Promise<PushResult> {
  try {
    // 先查是否已有行：既决定 insert/update，也保留云端已有的删除前备份
    const db = dbAny()
    const { data: existing, error: qerr } = await db.from(TABLE).select('id, payload').maybeSingle()
    if (qerr) return { ok: false, remoteVersion: null, error: errMsg(qerr) }

    const remotePrev = existing?.payload as SyncPayload | undefined
    const backups = [...(remotePrev?.keyBackups ?? []), ...(newBackups ?? [])].slice(-MAX_CLOUD_BACKUPS)
    // 本地模型（Ollama/ComfyUI 等）默认不进云同步；用户在设置里开启后一并同步
    const localIds = new Set(opts?.includeLocal ? [] : appState.accounts.filter(a => isLocalProvider(a.providerId)).map(a => a.id))
    // 网关令牌是本机凭据（可调用本机网关代理全部 Key），永不离开本机：推送前剥离；
    // 界面语言是本机偏好（每台设备各自设置），同样不进云同步
    const noTokenState: AppState = { ...appState, settings: { ...appState.settings, gatewayToken: undefined, language: undefined } }
    const syncState: AppState = localIds.size ? {
      ...noTokenState,
      accounts: noTokenState.accounts.filter(a => !localIds.has(a.id)),
      quotas: noTokenState.quotas.filter(q => !localIds.has(q.accountId)),
      usage: noTokenState.usage.filter(u => !localIds.has(u.accountId)),
      checkins: noTokenState.checkins.filter(c => !c.accountId || !localIds.has(c.accountId)),
    } : noTokenState
    const payload: SyncPayload = {
      appState: syncState,
      vault: getVaultSyncMaterial(),
      keyBackups: backups,
      // 快照列表：调用方显式给出则以其为准，否则原样保留云端已有的（普通同步不许把快照冲掉）
      stateSnapshots: opts?.snapshots ?? remotePrev?.stateSnapshots ?? [],
      clientAt: new Date().toISOString(),
      clientId: getClientId(),
    }
    const now = payload.clientAt
    // owner_id 由服务端 auth.uid() 填充，不可手写
    if (existing?.id) {
      const { data, error } = await db
        .from(TABLE)
        .update({ payload, updated_at: now })
        .eq('id', existing.id)
        .select('updated_at')
        .maybeSingle()
      if (error) return { ok: false, remoteVersion: null, error: errMsg(error) }
      setBaseline(data?.updated_at ?? now)
    } else {
      const { data, error } = await db
        .from(TABLE)
        .insert({ payload, owner_name: null })
        .select('updated_at')
        .maybeSingle()
      if (error) return { ok: false, remoteVersion: null, error: errMsg(error) }
      setBaseline(data?.updated_at ?? now)
    }
    try { localStorage.setItem(LAST_SYNC_KEY, payload.clientAt) } catch { /* 忽略 */ }
    return { ok: true, remoteVersion: getRemoteVersion() }
  } catch (e) {
    return { ok: false, remoteVersion: null, error: errMsg(e) }
  }
}

/** 把云端载荷应用到本地：先应用保险箱材料，再以云端数据为准整体覆盖本地。 */
export function applyPayload(payload: SyncPayload, local: AppState): AppState {
  if (payload.vault) applyVaultSyncMaterial(payload.vault)
  try { localStorage.setItem(LAST_SYNC_KEY, payload.clientAt) } catch { /* 忽略 */ }
  // 审计日志跨端合并（不能被覆盖丢失）：先把本地与云端按 id 并集，后面统一挂回结果
  const audit = mergeAudit(local.audit, payload.appState.audit)
  payload = { ...payload, appState: { ...payload.appState, audit } }
  // 云端默认不含本地模型：把本机已有的本地模型账户与其关联数据保留下来；
  // 若云端已包含同一账户（用户开启了「同步本地模型账户」），以云端为准，不重复保留
  const remoteIds = new Set(payload.appState.accounts.map(a => a.id))
  const localAccounts = local.accounts.filter(a => isLocalProvider(a.providerId) && !remoteIds.has(a.id))
  // 网关令牌与界面语言只认本机的：远端（已剥离）不覆盖本机值
  const withLocalToken = (s: AppState): AppState => ({
    ...s,
    settings: { ...s.settings, gatewayToken: local.settings.gatewayToken, language: local.settings.language },
  })
  if (!localAccounts.length) return withLocalToken(payload.appState)
  const localIds = new Set(localAccounts.map(a => a.id))
  return withLocalToken({
    ...payload.appState,
    accounts: [...payload.appState.accounts, ...localAccounts],
    quotas: [...payload.appState.quotas, ...local.quotas.filter(q => localIds.has(q.accountId))],
    usage: [...payload.appState.usage, ...local.usage.filter(u => localIds.has(u.accountId))],
    checkins: [...payload.appState.checkins, ...local.checkins.filter(c => !!c.accountId && localIds.has(c.accountId))],
  })
}

/** 为同步剥离本机专属内容（云端与文件通道共用口径）：网关令牌永不离开本机、
 * 界面语言仅本机；本地模型账户默认不进同步（includeLocal 时才带上） */
export function strippedSyncState(appState: AppState, includeLocal = false): AppState {
  const localIds = new Set(includeLocal ? [] : appState.accounts.filter(a => isLocalProvider(a.providerId)).map(a => a.id))
  const noTokenState: AppState = { ...appState, settings: { ...appState.settings, gatewayToken: undefined, language: undefined } }
  if (!localIds.size) return noTokenState
  return {
    ...noTokenState,
    accounts: noTokenState.accounts.filter(a => !localIds.has(a.id)),
    quotas: noTokenState.quotas.filter(q => !localIds.has(q.accountId)),
    usage: noTokenState.usage.filter(u => !localIds.has(u.accountId)),
    checkins: noTokenState.checkins.filter(c => !c.accountId || !localIds.has(c.accountId)),
  }
}

/** 纯函数构建同步载荷（不落库）：WebDAV / iCloud Drive 文件通道用（v0.1.352）。
 * keyBackups 与云端快照与远端已有内容合并保留，普通通道同步不许把它们冲掉 */
export function prepareSyncPayload(appState: AppState, remotePrev: SyncPayload | null | undefined, opts?: { includeLocal?: boolean; newBackups?: KeyBackupFile[] }): SyncPayload {
  const backups = [...(remotePrev?.keyBackups ?? []), ...(opts?.newBackups ?? [])].slice(-MAX_CLOUD_BACKUPS)
  return {
    appState: strippedSyncState(appState, opts?.includeLocal),
    vault: getVaultSyncMaterial(),
    keyBackups: backups,
    stateSnapshots: remotePrev?.stateSnapshots ?? [],
    clientAt: new Date().toISOString(),
    clientId: getClientId(),
  }
}

export function getLastSyncAt(): string | null {
  try { return localStorage.getItem(LAST_SYNC_KEY) } catch { return null }
}

/** 同步基线：最后一次我们已知的服务端 updated_at。轮询时只有它变化才拉取。 */
export function setBaseline(version: string | null): void {
  try { if (version) localStorage.setItem(REMOTE_VERSION_KEY, version) } catch { /* 忽略 */ }
}
export function getRemoteVersion(): string | null {
  try { return localStorage.getItem(REMOTE_VERSION_KEY) } catch { return null }
}
