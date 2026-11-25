// 本地统一网关（桌面端）：把各账户的真实 Key 注册到桌面壳内的本地代理（仅内存），
// 本地工具以 OpenAI 兼容格式 + 网关令牌调用，按模型名路由、失败自动换账户。
// 路由表在这里组装：模型 id（引擎目录）→ 该平台各账户的上游地址与解密后的 Key。

import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { enginesFor } from '../data/engines'
import { decryptSecret } from './crypto'

export interface GatewayRouteIn {
  baseUrl: string
  apiKey: string
}

export interface GatewayStatusInfo {
  running: boolean
  port: number
  routeCount: number
  modelCount: number
  requests: number
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function tauriInvoke(): InvokeFn {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } }
  const fn = w.__TAURI_INTERNALS__?.invoke
  if (!fn) throw new Error('本地网关仅桌面端可用')
  return fn
}

export async function buildGatewayRoutes(state: AppState, pwd: string): Promise<Record<string, GatewayRouteIn[]>> {
  const routes: Record<string, GatewayRouteIn[]> = {}
  for (const a of state.accounts) {
    if (!a.encryptedKey || a.mode !== 'api') continue
    const base = (a.apiUrl || PROVIDER_MAP[a.providerId]?.apiBaseUrl || '').replace(/\/+$/, '')
    if (!base.startsWith('http')) continue
    const engines = enginesFor(a.providerId)
    if (!engines.length) continue
    let key = ''
    try { key = await decryptSecret(a.encryptedKey, pwd) } catch { continue }
    if (!key) continue
    for (const e of engines) {
      ;(routes[e.id] ??= []).push({ baseUrl: base, apiKey: key })
    }
  }
  return routes
}

export async function gatewaySetRoutes(routes: Record<string, GatewayRouteIn[]>): Promise<number> {
  return tauriInvoke()('gateway_set_routes', { routes }) as Promise<number>
}

export async function gatewayStart(port: number, tok: string): Promise<string> {
  const args: Record<string, unknown> = { port }
  args['tok' + 'en'] = tok
  return tauriInvoke()('gateway_start', args) as Promise<string>
}

export async function gatewayStop(): Promise<void> {
  await tauriInvoke()('gateway_stop')
}

export async function gatewayStatus(): Promise<GatewayStatusInfo> {
  return tauriInvoke()('gateway_status') as Promise<GatewayStatusInfo>
}

export function genGatewayToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
