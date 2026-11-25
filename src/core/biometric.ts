// 指纹/面容登录（仅安卓/iOS 原生端）：把云账号的账号+密码存进系统钥匙串
// （Android Keystore / iOS Keychain），读取时必须先通过生物识别验证。
// 密码不经过 localStorage、不进云同步；桌面/Web 端全部函数安全地返回不可用。

import { isNativeApp } from './openExternal'

const SERVER = 'acm.cloud.account'
const BOUND_KEY = 'acm.biometric.bound'

async function plugin() {
  const mod = await import('@capgo/capacitor-native-biometric')
  return mod.NativeBiometric
}

/** 本机是否支持生物识别（指纹/面容） */
export async function biometricAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    const r = await (await plugin()).isAvailable()
    return !!r.isAvailable
  } catch { return false }
}

/** 是否已绑定过指纹登录（本地标记；真正的凭据在系统钥匙串里） */
export function biometricBound(): boolean {
  try { return localStorage.getItem(BOUND_KEY) === '1' } catch { return false }
}

/** 把账号密码存入系统钥匙串（密码登录成功后调用，静默绑定/刷新） */
export async function bindBiometricCredentials(username: string, password: string): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    await (await plugin()).setCredentials({ username, password, server: SERVER })
    try { localStorage.setItem(BOUND_KEY, '1') } catch { /* 忽略 */ }
    return true
  } catch { return false }
}

/** 弹生物识别验证并取回钥匙串里的账号密码；用户取消/失败返回 null */
export async function readBiometricCredentials(): Promise<{ username: string; password: string } | null> {
  if (!isNativeApp()) return null
  try {
    const c = await (await plugin()).getCredentials({ server: SERVER })
    if (c?.username && c?.password) return { username: c.username, password: c.password }
    return null
  } catch { return null }
}

/** 解除绑定（保存的密码失效时调用） */
export async function unbindBiometric(): Promise<void> {
  try { localStorage.removeItem(BOUND_KEY) } catch { /* 忽略 */ }
  if (!isNativeApp()) return
  try { await (await plugin()).deleteCredentials({ server: SERVER }) } catch { /* 忽略 */ }
}

// ===== 保险箱主密码（原生端）：存系统钥匙串，读取必须先过生物验证 =====
// 取代原生端「localStorage 混淆存储」：密码只在系统钥匙串里，读出即代表刚通过指纹/人脸。
const VAULT_SERVER = 'acm.vault.master'
const VAULT_BOUND_KEY = 'acm.vault.bioNative'

/** 把保险箱主密码存入系统钥匙串（开启指纹解锁/改密/解锁成功时刷新） */
export async function bindVaultPasswordNative(password: string): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    await (await plugin()).setCredentials({ username: 'master', password, server: VAULT_SERVER })
    try { localStorage.setItem(VAULT_BOUND_KEY, '1') } catch { /* 忽略 */ }
    return true
  } catch { return false }
}

/** 本机是否已把保险箱密码存入钥匙串 */
export function vaultPasswordNativeBound(): boolean {
  try { return localStorage.getItem(VAULT_BOUND_KEY) === '1' } catch { return false }
}

/** 弹生物验证并从钥匙串取回保险箱主密码；取消/失败返回 null */
export async function readVaultPasswordNative(): Promise<string | null> {
  if (!isNativeApp() || !vaultPasswordNativeBound()) return null
  try {
    const c = await (await plugin()).getCredentials({ server: VAULT_SERVER })
    return c?.password || null
  } catch { return null }
}

/** 解除钥匙串绑定（切换回密码解锁/重置保险箱时调用） */
export async function unbindVaultPasswordNative(): Promise<void> {
  try { localStorage.removeItem(VAULT_BOUND_KEY) } catch { /* 忽略 */ }
  if (!isNativeApp()) return
  try { await (await plugin()).deleteCredentials({ server: VAULT_SERVER }) } catch { /* 忽略 */ }
}

/**
 * 生物解锁保险箱的统一取密：
 * 原生端优先钥匙串（读出即已验证）；桌面/Web 走系统生物验证 + 本地混淆存储。
 * 返回 null 表示未通过验证或没有已保存的凭据。
 */
export async function resolveBiometricVaultPassword(reason: string): Promise<string | null> {
  const nativePwd = await readVaultPasswordNative()
  if (nativePwd) return nativePwd
  const { biometricAuth } = await import('./openExternal')
  const { getBiometricPassword } = await import('./crypto')
  if (!(await biometricAuth(reason))) return null
  return getBiometricPassword()
}
