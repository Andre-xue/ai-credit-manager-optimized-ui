// 内嵌浏览器自动领 Epic 免费游戏（v0.1.397，实验性质，成败不保证）。
// 背景：API 全自动领三条路已全堵——建设备授权 403 missing_permissions、
// Bearer 取结账页 302、Cookie 形态取页 302/403。本版试另一条路：桌面端用
// Tauri webview 窗口打开 396 的商店结账页直链，登录态靠 webview 自身的
// Cookie 持久化（macOS WKWebView 默认数据存储，跨重启保留），用户在窗口内
// 登录一次 Epic，以后打开结账页就是已登录态；Rust 注入 JS 尝试自动点领取按钮。
// 关键风险如实说明：Epic/Cloudflare 反自动化检测（Turnstile）可能拦住内嵌
// 浏览器，领取按钮也可能需要人工确认——做不成时干净回落到 396 的手动兜底
// （系统浏览器直开结账页 + 记录里「去浏览器领」），并把失败原因写进记录，
// 绝不静默失败。396 的手动兜底是当前唯一可靠的领法，本模块只在旁边加入口，
// 不动它。
// 回传通道：注入的 JS 把结果写进页面 URL 的 hash（#epic-claim=<结果>），
// Rust 轮询 webview.url() 读到后发事件给主窗口。故意不用远程 IPC：Tauri
// 默认拦截远程域 invoke，开 dangerousRemoteDomainIpcAccess 会让
// epicgames.com 的任意 JS 都能调命令。安卓没有等价 webview 方案，只桌面端做，
// 安卓保持 396 的手动兜底。

import { isDesktopApp } from './openExternal'
import { addRecord } from './freeGames'

export const EPIC_BROWSER_LABEL = 'epic-browser'
export const EPIC_BROWSER_EVENT = 'epic-browser-claim'
export const EPIC_BROWSER_STATUS_KEY = 'acm.epic.browserClaim.v1'

export type EpicBrowserOutcome =
  | 'clicked' // 已点领取按钮，等页面确认（中间态，不写记录）
  | 'claimed' // 页面出现领取成功标识
  | 'needs-manual' // 超时没找到领取按钮
  | 'challenge' // 遇到人机验证页
  | 'login' // 内嵌浏览器里没登录 Epic
  | 'timeout' // 轮询超时仍无结果

const OUTCOMES: EpicBrowserOutcome[] = ['clicked', 'claimed', 'needs-manual', 'challenge', 'login', 'timeout']

/** 从 URL（或 hash 片段）里解析 #epic-claim=<结果>，没有或不认识返回 null */
export function parseEpicBrowserOutcome(fragment: string | null | undefined): EpicBrowserOutcome | null {
  if (!fragment) return null
  const m = /(?:^|#|&)epic-claim=([a-z-]+)/.exec(fragment)
  if (!m) return null
  const v = m[1] as EpicBrowserOutcome
  return (OUTCOMES as string[]).includes(v) ? v : null
}

/** 每个结果对应的中文状态文案（显示在免费游戏页 + 写进领取记录） */
export function epicBrowserOutcomeText(outcome: string): string {
  switch (outcome) {
    case 'clicked': return '内嵌浏览器已点领取按钮，请在窗口内确认是否领取成功'
    case 'claimed': return '内嵌浏览器显示已领取成功，请以 Epic 库为准确认'
    case 'needs-manual': return '内嵌浏览器里没找到领取按钮，请在窗口内手动点一下领取'
    case 'challenge': return '内嵌浏览器遇到人机验证，请在窗口内完成验证后再手动点领取'
    case 'login': return '内嵌浏览器里还没登录 Epic，请在窗口内登录后再领'
    case 'timeout': return '内嵌浏览器里没等到领取结果，请在窗口内看一眼是否已领取'
    default: return '内嵌浏览器领取状态未知，请在窗口内确认'
  }
}

/** 内嵌浏览器只在桌面端可用（安卓保持 396 手动兜底） */
export function isEpicBrowserSupported(): boolean {
  return isDesktopApp()
}

/**
 * v0.1.404：自动领取失败时的第一落点——桌面端先走 App 内嵌浏览器，
 * 非桌面（安卓/网页）直接走系统浏览器。抽成纯函数，方便单测钉住分支。
 */
export function claimFailureFallback(): 'in-app' | 'external' {
  return isEpicBrowserSupported() ? 'in-app' : 'external'
}

/**
 * 打开内嵌浏览器窗口（Rust 命令 open_epic_browser 创建/聚焦窗口并注入脚本）。
 * 返回 'opened' | 'focused'；打不开时抛中文错误，调用方回落到系统浏览器。
 */
export async function openEpicBrowser(url: string, title: string): Promise<string> {
  if (!isEpicBrowserSupported()) throw new Error('内嵌浏览器只在桌面端可用，请点「去浏览器领」')
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('open_epic_browser', { url, title })
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : '打开内嵌浏览器失败')
  }
}

/** 监听 Rust 发来的内嵌浏览器领取结果事件，返回取消监听函数 */
export async function listenEpicBrowserClaim(
  cb: (payload: { outcome: string; title?: string; checkoutUrl?: string }) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<{ outcome: string; title?: string; checkoutUrl?: string }>(EPIC_BROWSER_EVENT, e => cb(e.payload))
}

/**
 * 终端结果写进领取记录（clicked 是中间态，不写）。失败记录带上 checkoutUrl，
 * 这样记录里「去浏览器领」按钮还在——内嵌浏览器领不成时手动兜底不断。
 * 返回 true 表示写了记录（调用方刷新记录列表）。
 */
export function recordEpicBrowserOutcome(outcome: string, title: string, checkoutUrl?: string): boolean {
  const at = Date.now()
  if (outcome === 'clicked') return false
  if (outcome === 'claimed') {
    addRecord({ at, platform: 'epic', title, outcome: 'claimed', message: '内嵌浏览器显示领取成功（页面已确认），请以 Epic 库为准' })
    return true
  }
  if (outcome === 'needs-manual' || outcome === 'challenge' || outcome === 'login' || outcome === 'timeout') {
    addRecord({
      at, platform: 'epic', title, outcome: 'error',
      message: `内嵌浏览器领取未完成：${epicBrowserOutcomeText(outcome)}，请点「去浏览器领」在系统浏览器里领`,
      ...(checkoutUrl ? { checkoutUrl } : {}),
    })
    return true
  }
  return false
}

export function loadEpicBrowserStatus(): string | null {
  try { return localStorage.getItem(EPIC_BROWSER_STATUS_KEY) } catch { return null }
}

export function saveEpicBrowserStatus(text: string): void {
  try { localStorage.setItem(EPIC_BROWSER_STATUS_KEY, text) } catch { /* 忽略 */ }
}
