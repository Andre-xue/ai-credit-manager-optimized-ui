// AI 工坊共用对话通道：工具页不重复造模型选择，统一走「免费模型 / 自有账户」两条现成路线。
// 免费模型走 freeAi（云端免费需登录云账号；Zen/Kilo 免登录），自有账户走保险箱解密 + callChat。

import type { Account } from './types'
import { decryptSecret } from './crypto'
import { callChat, extractModelId } from './providerCall'
import { ENGINE_CATALOG } from '../data/engines'
import { categoryFromNote, isVoiceConfigAccount } from './modelCategories'
import { detectModelCapability, capabilityChatCapable } from './modelCapability'
import { loadFreeAiOptions, filterChatCapableFreeOptions, freeAiChat, type FreeAiOption } from './freeAi'

export type WorkshopRoute =
  | { kind: 'free'; key: string; label: string }
  | { kind: 'account'; key: string; label: string; accountId: string; engine?: string; modelId?: string }
  | { kind: 'wbpool'; key: string; label: string }

/** 某平台的首选对话模型：引擎目录的旗舰款，没有旗舰则取倍率最低的一款；未收录返回 undefined */
export function defaultChatEngine(providerId: string): string | undefined {
  const list = ENGINE_CATALOG[providerId]
  if (!list?.length) return undefined
  return list.find(e => e.flagship)?.id ?? [...list].sort((a, b) => a.multiplier - b.multiplier)[0]?.id
}

/**
 * 工坊自有账户实际要发的模型 id（v0.1.430：修「拿账户名当模型名发」）。
 * 优先级：路线自带的 modelId/engine → label 本身就是目录里的模型 id →
 * 平台首选模型（引擎目录旗舰款）→ 备注/标签里带 '/' 的明确模型 id → 账户名（旧行为兜底）。
 */
export function resolveWorkshopModel(acct: Account, route?: WorkshopRoute): string {
  if (route?.kind === 'account') {
    const explicit = route.modelId ?? route.engine
    if (explicit) return explicit
  }
  const label = (acct.label ?? '').trim()
  const catalog = ENGINE_CATALOG[acct.providerId] ?? []
  if (label && catalog.some(e => e.id === label)) return label
  const preferred = defaultChatEngine(acct.providerId)
  if (preferred) return preferred
  const extracted = extractModelId(acct)
  return extracted.includes('/') ? extracted : acct.label
}

export interface WorkshopRouteData {
  routes: WorkshopRoute[]
  freeOptions: FreeAiOption[]
}

/** 能用于工坊工具的自有账户：通用/对话分类、非本地、非语音配置、聊天能力达标（与文档问答同口径） */
export function workshopAccounts(accounts: Account[]): Account[] {
  return accounts.filter(a => {
    if (a.providerId?.startsWith('local-') || isVoiceConfigAccount(a.providerId, a.note)) return false
    const cat = categoryFromNote(a.note)
    if (cat !== '通用型' && cat !== '对话型') return false
    const cap = a.modelCapability ?? detectModelCapability(a.label).capability
    return capabilityChatCapable(cap)
  })
}

/** 组装可选路线：免费模型在前（免配置先可用），自有账户在后 */
export async function loadWorkshopRoutes(accounts: Account[]): Promise<WorkshopRouteData> {
  let freeOptions: FreeAiOption[] = []
  try { freeOptions = filterChatCapableFreeOptions(await loadFreeAiOptions()) } catch { freeOptions = [] }
  const routes: WorkshopRoute[] = [
    ...freeOptions.map(o => ({ kind: 'free' as const, key: `free:${o.key}`, label: `免费 · ${o.label}` })),
    ...workshopAccounts(accounts).map(a => ({ kind: 'account' as const, key: `acct:${a.id}`, label: a.label, accountId: a.id, engine: resolveWorkshopModel(a) })),
  ]
  try {
    const { hasPoolAccounts } = await import('./wbPool')
    if (hasPoolAccounts()) routes.push({ kind: 'wbpool', key: 'wbpool', label: 'WorkBuddy 账号池' })
  } catch { /* 池不可用时不加路线 */ }
  return { routes, freeOptions }
}

/** 跑一次单轮对话（system + user），返回纯文本 */
export async function runWorkshopChat(params: {
  route: WorkshopRoute
  freeOptions: FreeAiOption[]
  accounts: Account[]
  sessionPwd: string
  system: string
  user: string
}): Promise<string> {
  const { route, freeOptions, accounts, sessionPwd, system, user } = params
  if (route.kind === 'wbpool') {
    if (!sessionPwd) throw new Error('保险箱未解锁，无法使用账号池')
    const { poolChat } = await import('./wbPool')
    const r = await poolChat(sessionPwd, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ])
    return r.text
  }
  if (route.kind === 'free') {
    const opt = freeOptions.find(o => `free:${o.key}` === route.key)
    if (!opt) throw new Error('所选免费模型已不可用，请换一个')
    return await freeAiChat(opt, system, user)
  }
  const acct = accounts.find(a => a.id === route.accountId)
  if (!acct) throw new Error('所选账户不存在')
  if (!sessionPwd) throw new Error('保险箱未解锁，无法使用自有账户（可改用免费模型）')
  if (!acct.encryptedKey) throw new Error('该账户没有保存的密钥')
  const key = await decryptSecret(acct.encryptedKey, sessionPwd)
  const r = await callChat(acct, key, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], resolveWorkshopModel(acct, route))
  if (!r.ok) throw new Error(r.error || r.text || '调用失败')
  return r.text
}
