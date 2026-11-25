// 云服务客户端：全端共享一个实例（Web / 桌面 Tauri / 安卓 Capacitor WebView）。
// publicConfig 为面向客户端的公开配置（publishableKey 本身不含权限，服务端按来源域名校验）。
// 端点与 Key 只能来自开通云服务时返回的配置，切勿硬编码其他值。

import { createWorkBuddyCloud, type CloudUser } from '@tencent-ai/workbuddy-cloud-sdk'
import { isNativeApp } from './openExternal'

export const PUBLIC_CONFIG = {
  endpoint: 'https://wbapp-uxzyxkkqofad4mwe1lca5e.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_uxZyXKKqOfad4mWe1LCa5E_eay4EyhsGD7Qb3o46G1JqqvdU5VGfd7q',
}
/** 供桌面端 Rust 代理转发 LLM 请求（公开配置，非密钥） */
export const LLM_PROXY_CONFIG = {
  endpoint: PUBLIC_CONFIG.endpoint,
  publishableKey: PUBLIC_CONFIG.publishableKey,
}

/**
 * 稳定的本机设备标识（与同步层 clientId 同源，localStorage 持久化）。
 * 云网关按客户端区分会话：同一账号多端登录时，若请求不带设备标识，网关会把
 * 会话判为「issued for another client」并拒绝数据请求（实测：桌面端正常、
 * 安卓端登录成功但拉取/推送被拒）。网关的 CORS 允许头里明确包含 X-Device-Id，
 * 故所有云请求统一带上它，让每台设备拥有独立会话。
 */
export function getCloudDeviceId(): string {
  const KEY = 'acm.sync.clientId'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return 'unknown-device'
  }
}

/**
 * 安卓/iOS 原生端专用：云请求改走 CapacitorHttp 原生请求层，并显式带上 WebView 的
 * Origin（https://localhost，已在网关登记）。
 *
 * 背景：原生端 window.fetch 被 CapacitorHttp 接管后，请求以原生栈发出、不带 Origin，
 * 网关据此把会话判为「issued for another client」：登录能成功，但拉取/续期被拒
 * （桌面端 WebView 直连带 Origin 则正常；加 X-Device-Id、换登录方式、单网络均已排除）。
 * 这里把 Origin 与设备标识都写死进原生请求，让签发与后续请求的客户端特征完全一致。
 */
async function nativeCloudFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  if (!headers.has('X-Device-Id')) headers.set('X-Device-Id', getCloudDeviceId())
  if (!headers.has('Origin')) headers.set('Origin', 'https://localhost')
  const headerObj: Record<string, string> = {}
  headers.forEach((v, k) => { headerObj[k] = v })
  let body: unknown = init?.body
  if (body === undefined && input instanceof Request) {
    try { body = await (input as Request).clone().text() } catch { /* 无体请求 */ }
  }
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET') ?? 'GET').toUpperCase()
  const { CapacitorHttp } = await import('@capacitor/core')
  const res = await CapacitorHttp.request({
    url, method, headers: headerObj,
    data: body === undefined || body === null ? undefined : body,
    responseType: 'text',
  })
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  return new Response(text, { status: res.status, headers: res.headers as Record<string, string> })
}

/**
 * 直连云端接口（不走 SDK 的 cloudFetch）时必须手动补齐的客户端特征头：
 * 网关按 Origin + X-Device-Id 绑定会话，原生端缺了会被判为「另一客户端」而拒绝 token
 *（AI 免费模型列表/对话在手机端曾因此误报「请先登录」：同步走 SDK 没事，直连的 ai.ts 中招）。
 * 非原生端浏览器/WebView 会自带 Origin，只补设备 ID。
 */
export function cloudClientHeaders(): Record<string, string> {
  return isNativeApp()
    ? { Origin: 'https://localhost', 'X-Device-Id': getCloudDeviceId() }
    : { 'X-Device-Id': getCloudDeviceId() }
}

const cloudFetch: typeof fetch = (input, init) => {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url && url.startsWith(PUBLIC_CONFIG.endpoint)) {
      // 原生端走显式原生请求（带 Origin）；失败时回退到默认 fetch，不阻断登录。
      // 回退也必须补会话绑定头（Origin/X-Device-Id），否则网关会把会话判为另一客户端签发，
      // 把「原生层故障」伪装成「登录失效」误导排障（v0.1.285）。
      if (isNativeApp()) return nativeCloudFetch(input, init).catch(() => {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        for (const [k, v] of Object.entries(cloudClientHeaders())) if (!headers.has(k)) headers.set(k, v)
        if (input instanceof Request && !init) return fetch(new Request(input, { headers }))
        return fetch(input, { ...init, headers })
      })
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (!headers.has('X-Device-Id')) headers.set('X-Device-Id', getCloudDeviceId())
      if (input instanceof Request && !init) return fetch(new Request(input, { headers }))
      return fetch(input, { ...init, headers })
    }
  } catch { /* 标识注入失败不阻断请求 */ }
  return fetch(input, init)
}

export const cloud = createWorkBuddyCloud({
  endpoint: PUBLIC_CONFIG.endpoint,
  oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: PUBLIC_CONFIG.publishableKey,
  fetch: cloudFetch,
})

export type { CloudUser }
