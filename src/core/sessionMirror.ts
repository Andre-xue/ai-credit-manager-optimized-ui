// 云会话镜像（v0.1.311）：修「账号莫名其妙自己退出」。
//
// 背景：WorkBuddy SDK 把会话（含每次续期都会轮换的 refresh 句柄）只存 WebView 的
// localStorage。手机端 WebView 存储被系统清理/回收、或写入配额不足时，会话键丢失，
// 下次启动 getSession() 取不到会话 → 表现为「自己退出了」（桌面端存储更稳定，故少见）。
// 做法：把 SDK 的 workbuddy-cloud.* 存储项镜像到更耐久的存储（安卓/iOS 用系统
// Preferences，桌面端用应用数据目录文件）；启动恢复会话前，若 localStorage 里
// 已无会话键，先从镜像还原再交给 SDK 续期。显式退出登录时同步清镜像，防「退了又回来」。

import { isDesktopApp, isNativeApp } from './openExternal'

const SDK_KEY_PREFIX = 'workbuddy-cloud.'
const SDK_SESSION_PREFIX = 'workbuddy-cloud.session.'
const PREF_KEY = 'acm.cloud.sessionMirror'
const MIRROR_FILE = 'cloud-session-mirror.json'

type Entries = Record<string, string>

interface LsLike {
  length: number
  key(i: number): string | null
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

/** 收集 SDK 写入 localStorage 的全部条目（会话 + PKCE 临时项） */
export function collectSdkEntries(ls: LsLike): Entries {
  const out: Entries = {}
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i)
    if (k && k.startsWith(SDK_KEY_PREFIX)) {
      const v = ls.getItem(k)
      if (v != null) out[k] = v
    }
  }
  return out
}

/** localStorage 里是否还有 SDK 会话键 */
export function hasSdkSession(ls: LsLike): boolean {
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i)
    if (k && k.startsWith(SDK_SESSION_PREFIX)) return true
  }
  return false
}

/** 把镜像条目写回 localStorage */
export function applySdkEntries(ls: LsLike, entries: Entries): void {
  for (const [k, v] of Object.entries(entries)) {
    if (k.startsWith(SDK_KEY_PREFIX)) ls.setItem(k, v)
  }
}

async function durableSave(text: string): Promise<void> {
  if (isNativeApp()) {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key: PREF_KEY, value: text })
    return
  }
  if (isDesktopApp()) {
    const [{ writeTextFile, mkdir, exists }, { appDataDir, join }] = await Promise.all([
      import('@tauri-apps/plugin-fs'), import('@tauri-apps/api/path'),
    ])
    const dir = await appDataDir()
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    await writeTextFile(await join(dir, MIRROR_FILE), text)
  }
}

async function durableLoad(): Promise<string | null> {
  if (isNativeApp()) {
    const { Preferences } = await import('@capacitor/preferences')
    const r = await Preferences.get({ key: PREF_KEY })
    return r.value
  }
  if (isDesktopApp()) {
    const [{ readTextFile, exists }, { appDataDir, join }] = await Promise.all([
      import('@tauri-apps/plugin-fs'), import('@tauri-apps/api/path'),
    ])
    const path = await join(await appDataDir(), MIRROR_FILE)
    if (!(await exists(path))) return null
    return await readTextFile(path)
  }
  return null
}

async function durableClear(): Promise<void> {
  if (isNativeApp()) {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.remove({ key: PREF_KEY })
    return
  }
  if (isDesktopApp()) {
    const [{ remove, exists }, { appDataDir, join }] = await Promise.all([
      import('@tauri-apps/plugin-fs'), import('@tauri-apps/api/path'),
    ])
    const path = await join(await appDataDir(), MIRROR_FILE)
    if (await exists(path)) await remove(path)
  }
}

/** 把当前 SDK 会话镜像到耐久存储（登录/续期后调用）；无会话则不动 */
export async function mirrorCloudSession(): Promise<void> {
  try {
    const entries = collectSdkEntries(localStorage)
    if (!Object.keys(entries).some(k => k.startsWith(SDK_SESSION_PREFIX))) return
    await durableSave(JSON.stringify(entries))
  } catch { /* 镜像失败不影响正常使用 */ }
}

/**
 * 强制还原（v0.1.316）：不看 localStorage 现状，把耐久镜像整份写回。
 * 用于启动时 getSession() 已失败之后——本地会话键还在但句柄已失效（被轮换/回滚）
 * 时，常规还原（仅在会话键缺失时触发）救不回来，而镜像里存的是最近一次成功
 * 登录/续期后的状态，写回后再重试 getSession 往往能续上。显式退出已清镜像，
 * 故这里读不到东西时返回 false、不会把退出过的账号带回来。
 */
export async function restoreCloudSessionMirrorForce(): Promise<boolean> {
  try {
    const text = await durableLoad()
    if (!text) return false
    const entries = JSON.parse(text) as Entries
    if (!entries || !Object.keys(entries).some(k => k.startsWith(SDK_SESSION_PREFIX))) return false
    applySdkEntries(localStorage, entries)
    return true
  } catch { return false }
}

/** 清除镜像（显式退出登录时调用，防止下次启动被镜像「复活」） */
export async function clearCloudSessionMirror(): Promise<void> {
  try { await durableClear() } catch { /* ignore */ }
}

/**
 * 启动恢复：localStorage 已无会话键时，从耐久镜像还原后返回 true。
 * 须在 cloud.auth.getSession() 之前调用。
 */
export async function restoreCloudSessionMirror(): Promise<boolean> {
  try {
    if (hasSdkSession(localStorage)) return false
    const text = await durableLoad()
    if (!text) return false
    const entries = JSON.parse(text) as Entries
    if (!entries || !Object.keys(entries).some(k => k.startsWith(SDK_SESSION_PREFIX))) return false
    applySdkEntries(localStorage, entries)
    return true
  } catch { return false }
}
