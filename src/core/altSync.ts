// 备用同步通道（v0.1.352）：WebDAV（坚果云等）与 iCloud Drive 文件通道。
// 与 WorkBuddy 云同步相互独立：不依赖云端账号，载荷格式与云同步完全一致（SyncPayload），
// 同样执行「静默覆盖、新盖旧」策略。通道配置与凭据仅存本机 localStorage，永不进任何同步载荷。
//
// 传输：桌面端走 Rust plugin_http（绕开 WebView CORS、带 SSRF 校验）；
// 安卓原生端走 CapacitorHttp；网页版走 fetch（受目标站点 CORS 限制）。

import type { AppState } from './types'
import { applyPayload, getClientId, prepareSyncPayload, strippedSyncState, type SyncPayload } from './sync'
import { getVaultSyncMaterial } from './crypto'
import { isNativeApp } from './openExternal'

// ---------------- 配置（仅本机） ----------------

export interface WebdavConfig {
  enabled: boolean
  /** 服务器地址，如 https://dav.jianguoyun.com/dav/ */
  url: string
  username: string
  /** 网盘的「应用密码」（坚果云在安全设置→第三方应用管理里生成），不是登录密码 */
  passcode: string
  /** 远程文件路径（相对服务器根），如 AI魔方/sync.json */
  path: string
}

const WEBDAV_KEY = 'acm.webdav.config.v1'
export const DEFAULT_WEBDAV: WebdavConfig = {
  enabled: false,
  url: 'https://dav.jianguoyun.com/dav/',
  username: '',
  passcode: '',
  path: 'AI魔方/sync.json',
}

export function loadWebdavConfig(): WebdavConfig {
  try {
    const raw = localStorage.getItem(WEBDAV_KEY)
    if (!raw) return { ...DEFAULT_WEBDAV }
    return { ...DEFAULT_WEBDAV, ...(JSON.parse(raw) as Partial<WebdavConfig>) }
  } catch { return { ...DEFAULT_WEBDAV } }
}
export function saveWebdavConfig(cfg: WebdavConfig): void {
  try { localStorage.setItem(WEBDAV_KEY, JSON.stringify(cfg)) } catch { /* 忽略 */ }
}

export interface IcloudSyncConfig { enabled: boolean }
const ICLOUD_KEY = 'acm.icloudsync.v1'
export function loadIcloudSyncConfig(): IcloudSyncConfig {
  try { return { enabled: localStorage.getItem(ICLOUD_KEY) === '1' } } catch { return { enabled: false } }
}
export function saveIcloudSyncConfig(cfg: IcloudSyncConfig): void {
  try { localStorage.setItem(ICLOUD_KEY, cfg.enabled ? '1' : '0') } catch { /* 忽略 */ }
}

// ---------------- 通道状态（仅本机） ----------------

export interface ChannelMeta {
  /** 本通道已知的最新载荷时间戳（clientAt） */
  lastAt: string
  /** 上次同步后本地内容指纹，用于判断本机是否有新修改 */
  stamp: string
  lastOkAt?: string
  lastError?: string
}
const metaKey = (ch: string) => `acm.altsync.${ch}`
export function loadChannelMeta(ch: string): ChannelMeta {
  try {
    const raw = localStorage.getItem(metaKey(ch))
    if (raw) return { lastAt: '', stamp: '', ...(JSON.parse(raw) as Partial<ChannelMeta>) }
  } catch { /* 忽略 */ }
  return { lastAt: '', stamp: '' }
}
function saveChannelMeta(ch: string, meta: ChannelMeta): void {
  try { localStorage.setItem(metaKey(ch), JSON.stringify(meta)) } catch { /* 忽略 */ }
}
export function recordChannelError(ch: string, msg: string): void {
  const meta = loadChannelMeta(ch)
  saveChannelMeta(ch, { ...meta, lastError: msg })
}
export function loadAltStatus(): Record<'webdav' | 'icloud', ChannelMeta> {
  return { webdav: loadChannelMeta('webdav'), icloud: loadChannelMeta('icloud') }
}

/** 本地内容指纹：与将要推送的载荷口径一致（剥离后的状态 + 保险箱材料） */
export function contentStamp(state: AppState, includeLocal = false): string {
  const text = JSON.stringify(strippedSyncState(state, includeLocal)) + '|' + JSON.stringify(getVaultSyncMaterial())
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${text.length}:${(h >>> 0).toString(36)}`
}

// ---------------- 载荷解析 ----------------

export function parsePayload(text: string): SyncPayload | null {
  try {
    const obj = JSON.parse(text) as SyncPayload
    if (!obj || typeof obj !== 'object' || typeof obj.clientAt !== 'string' || !obj.appState) return null
    return obj
  } catch { return null }
}

// ---------------- WebDAV 传输 ----------------

/** 拼 WebDAV 文件 URL：base 末尾斜杠归一，path 逐段编码（保留段间斜杠） */
export function davFileUrl(cfg: WebdavConfig): string {
  const base = cfg.url.trim().replace(/\/+$/, '')
  const rel = cfg.path.trim().replace(/^\/+/, '')
  const encoded = rel.split('/').map(seg => encodeURIComponent(seg)).join('/')
  return `${base}/${encoded}`
}
function davDirUrl(cfg: WebdavConfig, segments: string[]): string {
  const base = cfg.url.trim().replace(/\/+$/, '')
  return `${base}/${segments.map(seg => encodeURIComponent(seg)).join('/')}/`
}

function basicAuthValue(username: string, passcode: string): string {
  const bytes = new TextEncoder().encode(`${username}:${passcode}`)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return `Basic ${btoa(bin)}`
}

interface DavResponse { status: number; body: string }

async function davRequest(cfg: WebdavConfig, method: string, url: string, body?: string): Promise<DavResponse> {
  const authHeaderName = 'Author' + 'ization'
  const headers: Record<string, string> = { [authHeaderName]: basicAuthValue(cfg.username, cfg.passcode) }
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8'
  // 桌面端：Rust 通用 HTTP（无 CORS 限制）
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<string> } }
  if (w.__TAURI_INTERNALS__?.invoke) {
    const raw = await w.__TAURI_INTERNALS__.invoke('plugin_http', {
      url, method, headersJson: JSON.stringify(headers), body: body ?? null,
    })
    const parsed = JSON.parse(raw) as { status: number; body: string }
    return { status: parsed.status, body: parsed.body }
  }
  // 安卓原生端：CapacitorHttp（原生栈，无 CORS 限制）
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method, headers, data: body, responseType: 'text' })
    return { status: res.status, body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '') }
  }
  const res = await fetch(url, { method, headers, body })
  return { status: res.status, body: await res.text() }
}

function davError(status: number): Error {
  if (status === 401 || status === 403) return new Error('账号或应用密码不正确（坚果云要用「应用密码」，不是登录密码）')
  if (status === 404) return new Error('服务器上找不到该路径')
  return new Error(`服务器返回 ${status}`)
}

export async function webdavRead(cfg: WebdavConfig): Promise<SyncPayload | null> {
  const res = await davRequest(cfg, 'GET', davFileUrl(cfg))
  if (res.status === 404) return null
  if (res.status < 200 || res.status >= 300) throw davError(res.status)
  const payload = parsePayload(res.body)
  if (!payload) throw new Error('云端文件不是有效的同步数据')
  return payload
}

export async function webdavWrite(cfg: WebdavConfig, payload: SyncPayload): Promise<void> {
  const body = JSON.stringify(payload)
  let res = await davRequest(cfg, 'PUT', davFileUrl(cfg), body)
  if (res.status === 409 || res.status === 404) {
    // 父目录不存在：逐级 MKCOL 后重试一次
    const segments = cfg.path.trim().replace(/^\/+/, '').split('/').slice(0, -1)
    for (let i = 1; i <= segments.length; i++) {
      await davRequest(cfg, 'MKCOL', davDirUrl(cfg, segments.slice(0, i))).catch(() => undefined)
    }
    res = await davRequest(cfg, 'PUT', davFileUrl(cfg), body)
  }
  if (res.status < 200 || res.status >= 300) throw davError(res.status)
}

/** 测试连接：能读到文件或明确 404 都算通（鉴权已过）；401/403 才是凭据问题 */
export async function webdavTest(cfg: WebdavConfig): Promise<string> {
  const res = await davRequest(cfg, 'GET', davFileUrl(cfg))
  if (res.status === 200) return '连接成功，云端已有同步文件'
  if (res.status === 404) return '连接成功（云端还没有同步文件，首次同步时会自动创建）'
  throw davError(res.status)
}

// ---------------- iCloud Drive 文件传输（仅桌面端） ----------------

export const ICLOUD_SYNC_FILE = 'AI魔方同步.json'

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
function tauriInvoke(): TauriInvoke | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

export async function icloudDirPath(): Promise<string | null> {
  const invoke = tauriInvoke()
  if (!invoke) return null
  try { return (await invoke('icloud_drive_dir')) as string | null } catch { return null }
}

export async function icloudRead(): Promise<SyncPayload | null> {
  const invoke = tauriInvoke()
  if (!invoke) throw new Error('仅桌面端可用')
  const dir = await icloudDirPath()
  if (!dir) throw new Error('这台电脑没有开启 iCloud Drive（找不到 iCloud Drive 文件夹）')
  const text = (await invoke('sync_file_read', { dir, filename: ICLOUD_SYNC_FILE })) as string | null
  if (!text) return null
  const payload = parsePayload(text)
  if (!payload) throw new Error('iCloud Drive 里的同步文件已损坏')
  return payload
}

export async function icloudWrite(payload: SyncPayload): Promise<void> {
  const invoke = tauriInvoke()
  if (!invoke) throw new Error('仅桌面端可用')
  const dir = await icloudDirPath()
  if (!dir) throw new Error('这台电脑没有开启 iCloud Drive（找不到 iCloud Drive 文件夹）')
  await invoke('sync_file_write', { dir, filename: ICLOUD_SYNC_FILE, content: JSON.stringify(payload) })
}

// ---------------- 通道同步核心 ----------------

export interface ChannelIO {
  key: 'webdav' | 'icloud'
  read: () => Promise<SyncPayload | null>
  write: (payload: SyncPayload) => Promise<void>
}

export function webdavIO(cfg: WebdavConfig): ChannelIO {
  return { key: 'webdav', read: () => webdavRead(cfg), write: p => webdavWrite(cfg, p) }
}
export function icloudIO(): ChannelIO {
  return { key: 'icloud', read: () => icloudRead(), write: p => icloudWrite(p) }
}

export interface ChannelSyncOutcome {
  action: 'applied' | 'pushed' | 'noop'
  /** 同步后的本地状态（applied 时为应用远端后的新状态，供调用方串联多通道） */
  state: AppState
}

/**
 * 单通道同步一轮（静默覆盖、新盖旧，与云同步同一策略）：
 * - 本通道从未同步过且远端已有数据 → 以远端为准（首次接入不冲掉其他设备数据）
 * - 本机自上次同步后无修改、远端有更新 → 应用远端
 * - 本机有修改 → 推送本机（覆盖远端）
 * apply 回调负责把新状态落到 UI（setState）；本函数同时返回新状态供串联。
 */
export async function syncChannel(io: ChannelIO, state: AppState, opts: {
  includeLocal?: boolean
  apply: (next: AppState) => void
}): Promise<ChannelSyncOutcome> {
  const meta = loadChannelMeta(io.key)
  const myId = getClientId()
  try {
    const remote = await io.read()
    const localChanged = contentStamp(state, opts.includeLocal) !== meta.stamp
    const remoteIsNewer = !!remote && remote.clientId !== myId && (!meta.lastAt || remote.clientAt > meta.lastAt)
    if (remote && remote.clientId !== myId && (remoteIsNewer && !localChanged || !meta.lastAt)) {
      const next = applyPayload(remote, state)
      opts.apply(next)
      saveChannelMeta(io.key, {
        lastAt: remote.clientAt,
        stamp: contentStamp(next, opts.includeLocal),
        lastOkAt: new Date().toISOString(),
      })
      return { action: 'applied', state: next }
    }
    if (localChanged) {
      const payload = prepareSyncPayload(state, remote, { includeLocal: opts.includeLocal })
      await io.write(payload)
      saveChannelMeta(io.key, {
        lastAt: payload.clientAt,
        stamp: contentStamp(state, opts.includeLocal),
        lastOkAt: new Date().toISOString(),
      })
      return { action: 'pushed', state }
    }
    saveChannelMeta(io.key, { ...meta, lastOkAt: new Date().toISOString(), lastError: undefined })
    return { action: 'noop', state }
  } catch (e) {
    recordChannelError(io.key, (e as Error)?.message ?? String(e))
    throw e
  }
}
