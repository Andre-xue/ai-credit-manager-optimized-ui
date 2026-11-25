// API Key 健康检查：用账户自己的 Key 轻量探测平台接口（GET /v1/models），
// 判断密钥是否可用、服务是否可达，并记录延迟。结果只存本地（不进云同步）。

import type { Account } from './types'
import { isLocalProvider } from './types'
import { fetchProviderModels, fetchLocalMediaModels } from './providerCall'

export type KeyHealthStatus = 'ok' | 'auth' | 'quota' | 'network' | 'error' | 'skipped'

export interface KeyHealthResult {
  status: KeyHealthStatus
  /** 探测耗时（毫秒）；未真正发请求时为 0 */
  latencyMs: number
  /** 探测到的可用模型数（成功时） */
  modelCount?: number
  /** 人话结论 / 失败原因（截断后的原文） */
  message: string
  checkedAt: number
}

const STORE_KEY = 'acm.keyHealth.v1'

/** 把任意错误归类为健康状态（纯函数，可测） */
export function classifyHealthError(e: unknown): { status: KeyHealthStatus; message: string } {
  const msg = (e instanceof Error ? e.message : String(e ?? '')).slice(0, 160)
  const lower = msg.toLowerCase()
  if (/401|403|unauthorized|forbidden|invalid api key|invalid_api_key|api key.*(无效|错误|过期)|密钥.*(无效|错误|过期)|authentication/.test(lower)) {
    return { status: 'auth', message: `密钥无效或无权限：${msg}` }
  }
  if (/402|429|quota|insufficient|balance|rate limit|额度不足|余额不足|欠费|超出.*额度/.test(lower)) {
    return { status: 'quota', message: `额度不足或被限流：${msg}` }
  }
  if (/failed to fetch|network|load failed|cors|代理不可用|econnrefused|enotfound|timeout|timed out|网络/.test(lower)) {
    return { status: 'network', message: `网络不通或被跨域拦截：${msg}` }
  }
  return { status: 'error', message: msg || '未知错误' }
}

/**
 * 探测单个账户的 Key 健康。
 * - 云端账户：需要明文 Key（未解锁时返回 skipped）；走 /v1/models。
 * - 本地服务（Ollama/ComfyUI 等）：不需要 Key，直接探测本机服务地址。
 */
export async function checkKeyHealth(account: Account, apiKey?: string): Promise<KeyHealthResult> {
  const started = Date.now()
  const done = (r: Omit<KeyHealthResult, 'checkedAt' | 'latencyMs'> & { latencyMs?: number }): KeyHealthResult => ({
    ...r, latencyMs: r.latencyMs ?? (Date.now() - started), checkedAt: Date.now(),
  })
  try {
    if (isLocalProvider(account.providerId)) {
      const base = (account.apiUrl || '').trim()
      if (!base) return done({ status: 'skipped', latencyMs: 0, message: '未填写本地服务地址' })
      try {
        const models = await fetchLocalMediaModels(base)
        return done({ status: 'ok', modelCount: models.length, message: `本地服务正常 · ${models.length} 个模型` })
      } catch (e) {
        // 服务有 HTTP 响应（如 ComfyUI 没有 /v1/models）也算可达，只是拿不到模型列表
        const msg = e instanceof Error ? e.message : String(e ?? '')
        if (/接口返回 \d+/.test(msg)) return done({ status: 'ok', message: '本地服务可达' })
        throw e
      }
    }
    if (!account.apiUrl?.trim()) return done({ status: 'skipped', latencyMs: 0, message: '未填写 API 地址' })
    if (!apiKey) return done({ status: 'skipped', latencyMs: 0, message: '保险箱未解锁，无法读取密钥' })
    const models = await fetchProviderModels(account, apiKey)
    return done({ status: 'ok', modelCount: models.length, message: `可用 · ${models.length} 个模型` })
  } catch (e) {
    const c = classifyHealthError(e)
    return done({ status: c.status, message: c.message })
  }
}

export function loadKeyHealth(): Record<string, KeyHealthResult> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, KeyHealthResult> : {}
  } catch { return {} }
}

export function saveKeyHealth(map: Record<string, KeyHealthResult>): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)) } catch { /* 忽略 */ }
}

export const HEALTH_LABEL: Record<KeyHealthStatus, string> = {
  ok: '正常', auth: '密钥失效', quota: '额度不足', network: '网络不通', error: '异常', skipped: '未检查',
}
