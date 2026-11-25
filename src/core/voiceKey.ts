// 语音配置(APP) Key 读取：从加密账户读取语音服务 API Key（生物识别/会话密码解密）。
// 该 Key 只服务语音配置模块；AI 聊天不会调用、不展示对应账户。
// 兼容：若用户未添加 voice-config 账户，回退到旧的 localStorage 语音配置。

import { decryptSecret, getBiometricPassword } from './crypto'
import type { Account } from './types'

let sessionPwd = ''
let allAccounts: Account[] = []              // App 同步进来的账户列表（供底层语音模块读取）
let cachedKey: string | null = null          // 本次会话已解密的 Key 缓存
let cachedAccountId: string | null = null    // 缓存对应的账户 id（账户变化时失效）

/** App 同步账户列表到语音模块（每次 accounts 变化时调用） */
export function syncVoiceAccounts(accounts: Account[]): void {
  allAccounts = accounts
  // 账户列表变化时清缓存，避免用到旧 Key
  cachedKey = null
  cachedAccountId = null
}

/** 设置语音模块会话密码（用户在语音设置页验证主密码后调用） */
export function setVoiceSessionPwd(pwd: string): void {
  sessionPwd = pwd
  cachedKey = null // 密码变化，清缓存
}

/** 清除会话凭据与缓存 */
export function clearVoiceCredential(): void {
  sessionPwd = ''
  cachedKey = null
  cachedAccountId = null
}

/** 是否已有可用凭据（生物识别或会话密码） */
export function hasVoiceCredential(): boolean {
  return !!(getBiometricPassword() || sessionPwd)
}

/** 找到语音配置账户；指定 provider 时匹配对应服务商，否则取第一个 */
export function findVoiceConfigAccount(accounts: Account[], provider?: string): Account | undefined {
  const list = accounts.filter(a => a.providerId === 'voice-config')
  if (provider) {
    const match = list.find(a => a.voiceProvider === provider)
    if (match) return match
  }
  return list[0]
}

/** 同步判断是否存在语音配置账户（供 isDirectMode 等同步逻辑使用） */
export function hasVoiceConfigAccount(): boolean {
  return allAccounts.some(a => a.providerId === 'voice-config')
}

/** 是否需要解锁才能使用语音 Key（有账户但无凭据） */
export function voiceNeedsUnlock(accounts: Account[], provider?: string): boolean {
  const acct = findVoiceConfigAccount(accounts, provider)
  return !!acct?.encryptedKey && !hasVoiceCredential()
}

/**
 * 读取语音 API Key。
 * @param accounts 账户列表（由 App 传入）
 * @returns Key 字符串；无账户/未解锁/解密失败返回 null
 */
/** 供底层语音模块调用：从已同步的账户列表读取 Key（可指定服务商） */
export async function getCurrentVoiceApiKey(provider?: string): Promise<string | null> {
  return getVoiceApiKey(allAccounts, provider)
}

export async function getVoiceApiKey(accounts: Account[], provider?: string): Promise<string | null> {
  const acct = findVoiceConfigAccount(accounts, provider)
  if (!acct?.encryptedKey) return null
  if (cachedKey && cachedAccountId === acct.id) return cachedKey
  const pwd = getBiometricPassword() || sessionPwd
  if (!pwd) return null
  try {
    const key = await decryptSecret(acct.encryptedKey, pwd)
    cachedKey = key
    cachedAccountId = acct.id
    return key
  } catch {
    return null
  }
}
