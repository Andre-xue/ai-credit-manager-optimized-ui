// 阅览方式（v0.1.306，仅桌面端、本机偏好、不云同步）：
// AI 生成的视频/图片在结果区点「外部打开」时，用哪个本机软件打开；视频与图片两个选项互相独立。
// 取值：'internal' = 应用内（默认，不显示外部打开按钮）/ 'system' = 系统默认软件 / 其它 = 具体软件的 .app 路径。
// 本机软件清单由 Rust list_media_apps 按 Info.plist 声明的文档类型扫描分类，每次调用都重新扫，新装软件即会出现。

import { isDesktopApp } from './openExternal'
import { t } from './i18n'

export interface ViewerPrefs { video: string; image: string }
export interface MediaAppInfo { name: string; path: string; kinds: string[] }

const KEY = 'acm.viewer.prefs'
const DEFAULTS: ViewerPrefs = { video: 'internal', image: 'internal' }

export function loadViewerPrefs(): ViewerPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const v = JSON.parse(raw) as Partial<ViewerPrefs>
    return {
      video: typeof v.video === 'string' && v.video ? v.video : 'internal',
      image: typeof v.image === 'string' && v.image ? v.image : 'internal',
    }
  } catch { return { ...DEFAULTS } }
}

export function saveViewerPrefs(p: ViewerPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* 忽略 */ }
}

export function viewerChoice(kind: 'video' | 'image'): string {
  const p = loadViewerPrefs()
  return kind === 'video' ? p.video : p.image
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
function tauriInvoke(): InvokeFn | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

let appsCache: MediaAppInfo[] | null = null
let appsPromise: Promise<MediaAppInfo[]> | null = null

/** 扫描本机可打开视频/图片的软件（Rust 每次都重新扫描；本函数只做同会话内去重，force 时绕过缓存） */
export async function listMediaApps(force = false): Promise<MediaAppInfo[]> {
  if (!isDesktopApp()) return []
  if (!force && appsCache) return appsCache
  if (!force && appsPromise) return appsPromise
  const invoke = tauriInvoke()
  if (!invoke) return []
  appsPromise = (async () => {
    try {
      const list = (await invoke('list_media_apps')) as MediaAppInfo[]
      appsCache = Array.isArray(list) ? list : []
      return appsCache
    } catch {
      return appsCache ?? []
    } finally {
      appsPromise = null
    }
  })()
  return appsPromise
}

/** 结果区是否应显示「外部打开」按钮：选了系统默认或具体软件、且在桌面端时才显示 */
export function externalOpenEnabled(kind: 'video' | 'image'): boolean {
  return isDesktopApp() && viewerChoice(kind) !== 'internal'
}

/** 用阅览方式里选定的软件打开生成的媒体；成功返回 true，失败弹提示并返回 false */
export async function openWithViewer(src: string, kind: 'video' | 'image', notify: (m: string) => void): Promise<boolean> {
  const choice = viewerChoice(kind)
  if (choice === 'internal' || !isDesktopApp()) return false
  const invoke = tauriInvoke()
  if (!invoke) return false
  try {
    await invoke('open_media_external', { source: src, kind, appPath: choice === 'system' ? null : choice })
    return true
  } catch (e) {
    notify(t('用外部软件打开失败：{err}', { err: e instanceof Error ? e.message : String(e) }))
    return false
  }
}
