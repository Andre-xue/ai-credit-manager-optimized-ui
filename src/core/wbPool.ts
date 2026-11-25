import { encryptSecret, decryptSecret } from './crypto'
import {
  httpCall, parseJson, workbuddyRefresh, getWorkbuddyStatus, claimWorkbuddy,
  hasCheckinCred, loadCheckinCred, clearCheckinCred,
  type CheckinCred, type CheckinStatus, type CredBox,
} from './checkin'

/**
 * WorkBuddy 账号池（v0.1.359，一期）：多个 WorkBuddy 账号经 OAuth 授权入池，
 * 对外当一个模型来源用——对话请求按顺序轮换账号，限流/积分不足自动冷却并切换，
 * token 过期自动续期。做法参考开源项目 dsh-xdpool（MIT）的公开协议行为，独立实现。
 *
 * 凭据：每个账号的 token 用保险箱主密码单独加密，只存本机（不云同步——
 * refresh token 会轮换，多设备同时刷新会互相作废，池子天然是单设备概念）。
 * 池状态（停用/置顶/冷却/最近错误）是非秘密数据，明文存本机。
 */

const POOL_KEY = 'acm.wbpool.v1'
const STATE_KEY = 'acm.wbpool.state.v1'
const MODEL_KEY = 'acm.wbpool.model'

export interface PoolAccountMeta { id: string; label: string; uid: string }
interface PoolEntry extends PoolAccountMeta { cipher: string }
export interface PoolAccountState {
  disabled?: boolean
  pinned?: boolean
  cooldownUntil?: number
  lastError?: string
  lastUsedAt?: number
}

interface PoolFile { accounts: PoolEntry[] }

function readPoolFile(): PoolFile {
  try {
    const v = JSON.parse(localStorage.getItem(POOL_KEY) ?? '{}') as PoolFile
    return { accounts: Array.isArray(v.accounts) ? v.accounts : [] }
  } catch { return { accounts: [] } }
}

function writePoolFile(f: PoolFile): void {
  try { localStorage.setItem(POOL_KEY, JSON.stringify(f)) } catch { /* 忽略 */ }
}

export function listPoolMeta(): PoolAccountMeta[] {
  return readPoolFile().accounts.map(({ id, label, uid }) => ({ id, label, uid }))
}

export function hasPoolAccounts(): boolean {
  return readPoolFile().accounts.length > 0
}

export async function addPoolAccount(cred: CheckinCred, pwd: string): Promise<PoolAccountMeta> {
  const f = readPoolFile()
  const id = cred.uid || `wb-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  const meta: PoolAccountMeta = { id, label: cred.label || 'WorkBuddy 账号', uid: cred.uid }
  const cipher = await encryptSecret(JSON.stringify(cred), pwd)
  const existing = f.accounts.findIndex(a => a.id === id)
  if (existing >= 0) f.accounts[existing] = { ...meta, cipher }
  else f.accounts.push({ ...meta, cipher })
  writePoolFile(f)
  return meta
}

export function removePoolAccount(id: string): void {
  const f = readPoolFile()
  f.accounts = f.accounts.filter(a => a.id !== id)
  writePoolFile(f)
  const st = readPoolState()
  delete st[id]
  writePoolState(st)
}

export function poolCredBox(id: string, pwd: string): CredBox {
  return {
    load: async () => {
      const entry = readPoolFile().accounts.find(a => a.id === id)
      if (!entry) return null
      try {
        const cred = JSON.parse(await decryptSecret(entry.cipher, pwd)) as CheckinCred
        return cred && cred.accessToken ? cred : null
      } catch { return null }
    },
    save: async cred => {
      const f = readPoolFile()
      const entry = f.accounts.find(a => a.id === id)
      if (!entry) return
      entry.cipher = await encryptSecret(JSON.stringify(cred), pwd)
      if (cred.label) entry.label = cred.label
      if (cred.uid) entry.uid = cred.uid
      writePoolFile(f)
    },
  }
}

/** 把签到页时代的单个 WorkBuddy 凭据迁进池子（只迁一次，迁完删旧存储防分叉） */
export async function migrateLegacyWorkbuddyCred(pwd: string): Promise<boolean> {
  if (hasPoolAccounts() || !hasCheckinCred('workbuddy')) return false
  const cred = await loadCheckinCred('workbuddy', pwd)
  if (!cred) return false
  await addPoolAccount(cred, pwd)
  clearCheckinCred('workbuddy')
  return true
}

// ---------------- 池状态（非秘密） ----------------

type PoolStateMap = Record<string, PoolAccountState>

function readPoolState(): PoolStateMap {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as PoolStateMap } catch { return {} }
}

function writePoolState(st: PoolStateMap): void {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(st)) } catch { /* 忽略 */ }
}

export function getPoolState(): PoolStateMap { return readPoolState() }

export function patchPoolState(id: string, patch: PoolAccountState): void {
  const st = readPoolState()
  st[id] = { ...st[id], ...patch }
  writePoolState(st)
}

/** 候选顺序：置顶优先，其次最久未用；停用剔除，冷却中的排最后（全冷却时仍可兜底尝试） */
export function orderPoolCandidates(
  metas: PoolAccountMeta[], state: PoolStateMap, now: number,
): { ready: PoolAccountMeta[]; cooling: PoolAccountMeta[] } {
  const enabled = metas.filter(m => !state[m.id]?.disabled)
  const byPriority = (a: PoolAccountMeta, b: PoolAccountMeta) => {
    const pa = state[a.id]?.pinned ? 0 : 1
    const pb = state[b.id]?.pinned ? 0 : 1
    if (pa !== pb) return pa - pb
    return (state[a.id]?.lastUsedAt ?? 0) - (state[b.id]?.lastUsedAt ?? 0)
  }
  const ready = enabled.filter(m => (state[m.id]?.cooldownUntil ?? 0) <= now).sort(byPriority)
  const cooling = enabled.filter(m => (state[m.id]?.cooldownUntil ?? 0) > now)
    .sort((a, b) => (state[a.id]?.cooldownUntil ?? 0) - (state[b.id]?.cooldownUntil ?? 0))
  return { ready, cooling }
}

// ---------------- WorkBuddy 对话（池调用） ----------------

const CHAT_UA = 'CLI/2.63.2 CodeBuddy/2.63.2'

function chatBase(cred: CheckinCred): string {
  if (cred.domain && /codebuddy\.ai/i.test(cred.domain)) return 'https://www.codebuddy.ai'
  return 'https://copilot.tencent.com'
}

function billingBase(cred: CheckinCred): string {
  return cred.domain ? `https://${cred.domain}` : 'https://www.codebuddy.cn'
}

function uuid(): string {
  try { return crypto.randomUUID() } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }
}

function chatHeaders(cred: CheckinCred): Record<string, string> {
  const origin = billingBase(cred)
  return {
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: origin,
    Referer: `${origin}/`,
    'User-Agent': CHAT_UA,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cred.accessToken}`,
    ...(cred.uid ? { 'X-User-Id': cred.uid } : { 'X-No-User-Id': '1' }),
    'X-No-Enterprise-Id': '1',
    ...(cred.domain ? { 'X-Domain': cred.domain } : { 'X-No-Department-Info': '1' }),
    'X-Product': 'SaaS',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Version': '5.5.6',
    'X-Conversation-ID': uuid(),
    'X-Conversation-Request-ID': uuid(),
    'X-Conversation-Message-ID': uuid(),
    'acp-connection-id': uuid(),
    'X-Request-ID': uuid(),
    'X-Agent-Intent': 'craft',
    'X-Agent-Purpose': 'conversation',
    'X-Private-Data': 'true',
    'x-codebuddy-request': '1',
  }
}

/** 从聊天响应里提正文：接口强制流式（SSE），也兼容普通 JSON */
export function extractCompletionText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{')) {
    const body = parseJson(trimmed)
    const choices = body?.choices as { message?: { content?: unknown } }[] | undefined
    const content = choices?.[0]?.message?.content
    if (typeof content === 'string') return content
  }
  let out = ''
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    const chunk = parseJson(payload)
    const choices = chunk?.choices as { delta?: { content?: unknown }; message?: { content?: unknown } }[] | undefined
    const delta = choices?.[0]?.delta?.content ?? choices?.[0]?.message?.content
    if (typeof delta === 'string') out += delta
  }
  return out
}

export type ChatErrorKind = 'auth' | 'rate' | 'quota' | 'other'

export function classifyChatError(status: number, text: string): ChatErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate'
  if (/积分不足|余额不足|quota|insufficient/i.test(text)) return 'quota'
  if (/限流|rate.?limit|too many/i.test(text)) return 'rate'
  return 'other'
}

export interface PoolChatResult { text: string; accountId: string; accountLabel: string; model: string }
export interface PoolChatMessage { role: string; content: unknown }

export function getPoolModelPref(): string {
  try { return localStorage.getItem(MODEL_KEY) ?? '' } catch { return '' }
}

export function setPoolModelPref(model: string): void {
  try { localStorage.setItem(MODEL_KEY, model) } catch { /* 忽略 */ }
}

export interface WbModel { id: string; name: string; credits: string }

let modelCache: { at: number; models: WbModel[] } | null = null

/** 池可用模型目录（取第一个可用账号的目录，缓存 5 分钟） */
export async function poolModels(pwd: string): Promise<WbModel[]> {
  if (modelCache && Date.now() - modelCache.at < 5 * 60 * 1000) return modelCache.models
  const metas = listPoolMeta()
  const { ready, cooling } = orderPoolCandidates(metas, readPoolState(), Date.now())
  for (const meta of [...ready, ...cooling]) {
    const cred = await poolCredBox(meta.id, pwd).load()
    if (!cred) continue
    try {
      const res = await httpCall('GET', `${billingBase(cred)}/console/enterprises/personal/models`, {
        Authorization: `Bearer ${cred.accessToken}`, accept: 'application/json',
        ...(cred.uid ? { 'X-User-Id': cred.uid } : {}),
        ...(cred.domain ? { 'X-Domain': cred.domain } : {}),
      })
      if (res.status >= 400) continue
      const body = parseJson(res.text)
      const payload = (body?.data && typeof body.data === 'object' ? body.data : body) as { models?: unknown } | null
      const raw = Array.isArray(payload?.models) ? payload.models : []
      const models: WbModel[] = raw.map(m => {
        const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
        return {
          id: typeof o.id === 'string' ? o.id : '',
          name: typeof o.name === 'string' && o.name ? o.name : (typeof o.id === 'string' ? o.id : ''),
          credits: typeof o.credits === 'string' ? o.credits : '',
        }
      }).filter(m => m.id)
      if (models.length) {
        modelCache = { at: Date.now(), models }
        return models
      }
    } catch { /* 换下一个账号试 */ }
  }
  return []
}

/** 池对话：轮换 + 失败切换 + 冷却。全部失败时抛错并汇总每个账号的失败原因 */
export async function poolChat(
  pwd: string,
  messages: PoolChatMessage[],
  opts?: { model?: string },
): Promise<PoolChatResult> {
  const metas = listPoolMeta()
  if (!metas.length) throw new Error('账号池是空的，先添加 WorkBuddy 账号')
  const state = readPoolState()
  const { ready, cooling } = orderPoolCandidates(metas, state, Date.now())
  const candidates = [...ready, ...cooling]
  if (!candidates.length) throw new Error('账号池里的账号都被停用了')
  let model = opts?.model || getPoolModelPref()
  if (!model) {
    const models = await poolModels(pwd).catch(() => [])
    model = models[0]?.id ?? ''
  }
  if (!model) throw new Error('拿不到 WorkBuddy 的模型目录（账号可能未登录或目录接口变更）')
  const body = JSON.stringify({
    model,
    messages: messages.map(m => ({ role: m.role === 'developer' ? 'system' : m.role, content: m.content })),
    stream: true,
  })
  const errors: string[] = []
  for (const meta of candidates) {
    const box = poolCredBox(meta.id, pwd)
    let cred = await box.load()
    if (!cred) { errors.push(`${meta.label}：凭据解密失败（保险箱密码不对？）`); continue }
    if (cred.refreshToken && cred.expiresAt > 0 && cred.expiresAt - Date.now() < 120_000) {
      try { cred = await workbuddyRefresh(cred); await box.save(cred) } catch { /* 用旧 token 试 */ }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await httpCall('POST', `${chatBase(cred)}/v2/chat/completions`, chatHeaders(cred), body)
      if (res.status === 200) {
        const text = extractCompletionText(res.text)
        if (text.trim()) {
          patchPoolState(meta.id, { lastUsedAt: Date.now(), lastError: undefined, cooldownUntil: undefined })
          return { text: text.trim(), accountId: meta.id, accountLabel: meta.label, model }
        }
        errors.push(`${meta.label}：接口返回空内容`)
        patchPoolState(meta.id, { lastError: '接口返回空内容' })
        break
      }
      const kind = classifyChatError(res.status, res.text)
      const brief = res.text.slice(0, 120).replace(/\s+/g, ' ')
      if (kind === 'auth' && attempt === 0 && cred.refreshToken) {
        try {
          cred = await workbuddyRefresh(cred)
          await box.save(cred)
          continue
        } catch { /* 刷新失败，走下面的失败记录 */ }
      }
      if (kind === 'rate') patchPoolState(meta.id, { cooldownUntil: Date.now() + 10 * 60 * 1000, lastError: `限流（HTTP ${res.status}）` })
      else if (kind === 'quota') patchPoolState(meta.id, { cooldownUntil: Date.now() + 30 * 60 * 1000, lastError: '积分不足' })
      else patchPoolState(meta.id, { lastError: `HTTP ${res.status} ${brief}` })
      errors.push(`${meta.label}：HTTP ${res.status} ${brief}`)
      break
    }
  }
  throw new Error(`账号池全部账号调用失败——${errors.join('；')}`)
}

// ---------------- 池与签到的联动 ----------------

export interface PoolAccountStatus { meta: PoolAccountMeta; status?: CheckinStatus; error?: string }

export async function poolAccountStatuses(pwd: string): Promise<PoolAccountStatus[]> {
  const out: PoolAccountStatus[] = []
  for (const meta of listPoolMeta()) {
    try {
      const status = await getWorkbuddyStatus(poolCredBox(meta.id, pwd))
      out.push({ meta, status })
    } catch (e) {
      out.push({ meta, error: e instanceof Error ? e.message : '查询失败' })
    }
  }
  return out
}

export async function poolClaimOne(pwd: string, id: string): Promise<{ message: string; points: number }> {
  return claimWorkbuddy(poolCredBox(id, pwd))
}
