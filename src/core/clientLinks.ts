// 客户端直达链接（v0.1.413）：游戏链接直达桌面已装客户端，不走浏览器。
// Steam：官方 steam:// 协议——游戏本体 steam://store/<appid> 开商店页；合集包
//   没有 steam://store/<subid> 形态，改走 steam://openurl/<商店 sub 页>（Steam 商店
//   自己「在桌面端打开」按钮同款，实测多源确认）。
// Epic：com.epicgames.launcher://store/purchase?...——浏览器结账页只换 origin，
//   路径与参数原样保留；客户端内能不能直达结账页要真机实测，不行退回浏览器。
// 桌面端走新 Rust 命令 open_protocol_url（白名单 scheme + 字符校验；open_url 只放
//   http(s) 故不能复用）；网页/安卓没有客户端直达通道，直接走浏览器。
import { isDesktopApp, openExternal } from './openExternal'

export const STEAM_PROTOCOL = 'steam://'
export const EPIC_LAUNCHER_PROTOCOL = 'com.epicgames.launcher://'

/** open_protocol_url 放行的 scheme（白名单，其他一律拒绝；空白与控制字符也拒绝） */
export function isAllowedProtocolUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false
  if (/\s/.test(url) || /[\u0000-\u001f\u007f]/.test(url)) return false
  return url.startsWith(STEAM_PROTOCOL) || url.startsWith(EPIC_LAUNCHER_PROTOCOL)
}

/** Steam 游戏本体 → steam://store/<appid>；appid 非纯数字返回 null */
export function steamClientUrlOfApp(appid: string): string | null {
  const id = (appid ?? '').trim()
  if (!/^\d+$/.test(id)) return null
  return `${STEAM_PROTOCOL}store/${id}`
}

/**
 * Steam 降价卡片 → 客户端直达地址：本体用 steam://store/<appid>，合集包用
 * steam://openurl/<商店 sub 页>（openurl 后直接拼商店地址，Steam 官方同款写法，
 * 不做 encode——扩展与 Steam 自己按钮用的都是原样地址）。
 */
export function steamClientUrlOfDeal(deal: { kind: 'game' | 'package'; appid: string; url: string }): string | null {
  if (deal.kind === 'game') return steamClientUrlOfApp(deal.appid)
  const web = (deal.url ?? '').trim()
  if (!/^https:\/\/store\.steampowered\.com\/sub\/\d+\/?$/.test(web)) return null
  return `${STEAM_PROTOCOL}openurl/${web}`
}

const EPIC_WEB_ORIGIN = 'https://www.epicgames.com'

/**
 * Epic 浏览器结账页 → 客户端内同款结账页：只把 origin 换成
 * com.epicgames.launcher://，路径与参数原样保留。不是 Epic 结账页时返回 null。
 * （客户端内是否真能落到结账页要真机实测；落不到时调用方回落浏览器。）
 */
export function epicLauncherUrlOfCheckoutUrl(checkoutUrl: string): string | null {
  const u = (checkoutUrl ?? '').trim()
  if (!u.startsWith(`${EPIC_WEB_ORIGIN}/store/purchase`)) return null
  return `${EPIC_LAUNCHER_PROTOCOL}${u.slice(EPIC_WEB_ORIGIN.length + 1)}`
}

/**
 * 桌面端调 Rust open_protocol_url 打开协议链接。
 * 非桌面端没有客户端直达通道，直接返回失败（调用方回落浏览器）。
 * Rust 返回 false = 系统没有能打开该链接的客户端（可能未安装）；抛错 = 执行失败。
 */
export async function openProtocolUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!isAllowedProtocolUrl(url)) return { ok: false, error: '不支持的协议链接' }
  if (!isDesktopApp()) return { ok: false, error: '直达客户端只在桌面端可用' }
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } }
    const invoked = await w.__TAURI_INTERNALS__?.invoke?.('open_protocol_url', { url })
    if (invoked === true) return { ok: true }
    return { ok: false, error: '没有能打开该链接的客户端（可能未安装）' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '打开客户端失败' }
  }
}

/**
 * 优先直达客户端，失败/没装时回落浏览器并带上真实原因，绝不静默。
 * 返回 { via: 'client' } 或 { via: 'web', reason, browserOpened }。
 */
export async function openViaClient(protocolUrl: string, webUrl: string): Promise<{ via: 'client' | 'web'; reason?: string; browserOpened?: boolean }> {
  const r = await openProtocolUrl(protocolUrl)
  if (r.ok) return { via: 'client' }
  const browserOpened = await openExternal(webUrl)
  return { via: 'web', reason: r.error ?? '客户端直达失败', browserOpened }
}
