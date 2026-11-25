/**
 * 内置免费模型通道：直连 OpenCode Zen 与 Kilo 两个公共网关（与 dsh-our-free-model 插件同款上游）。
 * - Zen：https://opencode.ai/inference/v1，匿名 Key 固定为 public；免费模型 = id 以 -free 结尾。
 * - Kilo：https://ai-gateway.kilo.ai/api/v1，完全免 Key；免费模型 = id 以 :free 结尾或官方免费路由器。
 * 模型清单跟随上游 /models 实时拉取（本地缓存 6 小时），不内置静态快照。
 * 传输：桌面走 Rust plugin_http（绕 CORS）、手机走 CapacitorHttp、网页走 fetch。
 */
import { isNativeApp } from './openExternal'
import { isDesktopShell, pluginHttpDesktop } from './plugins'

export type UpstreamSource = 'zen' | 'kilo'
export interface UpstreamModel {
  source: UpstreamSource
  id: string
  name: string
}

export const UPSTREAM_BASE: Record<UpstreamSource, string> = {
  zen: 'https://opencode.ai/inference/v1',
  kilo: 'https://ai-gateway.kilo.ai/api/v1',
}
export const UPSTREAM_LABEL: Record<UpstreamSource, string> = { zen: 'Zen', kilo: 'Kilo' }

/** Zen 免费档：模型 id 以 -free 结尾（如 deepseek-v4.1-flash-free） */
export function isZenFreeModel(id: string): boolean {
  return id.endsWith('-free')
}

/** Kilo 免费档：:free 后缀，或官方免费路由器 kilo-auto/free、openrouter/free */
export function isKiloFreeModel(id: string): boolean {
  return id.endsWith(':free') || id === 'kilo-auto/free' || id === 'openrouter/free'
}

/** 解析上游 /models 响应，只保留免费模型；name 缺失时用 id 兜底 */
export function parseUpstreamModels(source: UpstreamSource, json: unknown): UpstreamModel[] {
  const list: unknown[] = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: unknown[] }).data)
    : (Array.isArray(json) ? json : [])
  const keep = source === 'zen' ? isZenFreeModel : isKiloFreeModel
  const out: UpstreamModel[] = []
  for (const m of list) {
    const id = (m as { id?: unknown })?.id
    if (typeof id !== 'string' || !id || !keep(id)) continue
    const name = (m as { name?: unknown })?.name
    out.push({ source, id, name: typeof name === 'string' && name.trim() ? name.trim() : id })
  }
  return out
}

interface HttpResult { status: number; text: string }

async function httpAny(url: string, opts: { method: string; headers?: Record<string, string>; body?: string }): Promise<HttpResult> {
  const headers = opts.headers ?? {}
  if (isDesktopShell()) {
    const r = await pluginHttpDesktop(url, opts.method, headers, opts.body)
    return { status: r.status, text: r.text }
  }
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method: opts.method, headers, data: opts.body, responseType: 'text' })
    return { status: res.status, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '') }
  }
  const res = await fetch(url, { method: opts.method, headers, body: opts.body })
  return { status: res.status, text: await res.text() }
}

function sourceHeaders(source: UpstreamSource): Record<string, string> {
  // Zen 匿名档：官方约定的 public Key；Kilo 免 Key，仅带归因头（其自家客户端同样发送）
  return source === 'zen'
    ? { Authorization: 'Bearer public' }
    : { 'HTTP-Referer': 'https://andre-xue.github.io/ai-credit-manager-optimized/', 'X-Title': 'AI Credit Manager' }
}

const CACHE_KEY = 'acm.upstreamFree.v1'
const CACHE_TTL_MS = 6 * 3600_000

interface CacheShape { at: number; models: UpstreamModel[] }

function readCache(): UpstreamModel[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CacheShape
    if (!c || Date.now() - c.at > CACHE_TTL_MS || !Array.isArray(c.models)) return null
    return c.models
  } catch { return null }
}

/**
 * 拉取失败/为空时的重试节奏（v0.1.292）：第 attempt 次（0 起）失败后隔多久再试，
 * 返回 null 表示放弃。背景：旧版只拉一次且失败静默——App 启动瞬间网络/代理还没就绪
 * 时拉空，整个会话都不会再试，用户只看到「开关开了但免费模型没出现」（2026-11-21 实测）。
 */
export function upstreamRetryDelayMs(attempt: number): number | null {
  const delays = [4000, 12000, 30000]
  return attempt >= 0 && attempt < delays.length ? delays[attempt] : null
}

// 会话级缓存与在途去重：视图卸载/重挂时不必重拉，且先前在途的拉取结果不会被丢弃
let lastGoodModels: UpstreamModel[] | null = null
let inflightModels: Promise<UpstreamModel[]> | null = null

/** 拉取两个上游的免费模型清单（单个上游失败不影响另一个）；force 跳过缓存并重新拉取 */
export async function fetchUpstreamFreeModels(force = false): Promise<UpstreamModel[]> {
  if (!force) {
    if (lastGoodModels) return lastGoodModels
    const cached = readCache()
    if (cached) { lastGoodModels = cached; return cached }
    if (inflightModels) return inflightModels
  }
  const run = (async () => {
    const load = async (source: UpstreamSource): Promise<UpstreamModel[]> => {
      try {
        const r = await httpAny(`${UPSTREAM_BASE[source]}/models`, { method: 'GET', headers: sourceHeaders(source) })
        if (r.status < 200 || r.status >= 300) return []
        return parseUpstreamModels(source, JSON.parse(r.text))
      } catch { return [] }
    }
    const models = [...(await load('zen')), ...(await load('kilo'))]
    if (models.length) {
      lastGoodModels = models
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), models } satisfies CacheShape)) } catch { /* 忽略 */ }
    }
    return models
  })()
  inflightModels = run
  try { return await run } finally { if (inflightModels === run) inflightModels = null }
}

/** 组装对话请求体：思考强度映射为网关认的 reasoning_effort（minimal 并入 low） */
export function buildUpstreamChatBody(
  modelId: string,
  messages: { role: string; content: string }[],
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: modelId, messages, stream: false }
  if (reasoningEffort) body.reasoning_effort = reasoningEffort === 'minimal' ? 'low' : reasoningEffort
  return body
}

/** 解析对话响应：兼容 JSON 与 SSE 两种返回；正文为空时用 reasoning 兜底（部分免费推理模型只回 reasoning） */
export function parseUpstreamChatText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('data:')) {
    let out = ''
    for (const line of trimmed.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
        out += j.choices?.[0]?.delta?.content ?? ''
      } catch { /* 跳过坏帧 */ }
    }
    return out
  }
  const j = JSON.parse(trimmed) as {
    choices?: { message?: { content?: string | null; reasoning?: string | null }; text?: string }[]
    error?: { message?: string }
  }
  if (j.error?.message) throw new Error(j.error.message)
  const msg = j.choices?.[0]?.message
  return msg?.content || msg?.reasoning || j.choices?.[0]?.text || ''
}

/** 向上游免费通道发一轮对话（非流式）；失败抛错，错误文案带状态码与上游原文 */
export async function chatUpstream(
  source: UpstreamSource,
  modelId: string,
  messages: { role: string; content: string }[],
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
): Promise<string> {
  const r = await httpAny(`${UPSTREAM_BASE[source]}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sourceHeaders(source) },
    body: JSON.stringify(buildUpstreamChatBody(modelId, messages, reasoningEffort)),
  })
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`免费通道（${UPSTREAM_LABEL[source]}）返回 ${r.status}：${r.text.slice(0, 200)}`)
  }
  const text = parseUpstreamChatText(r.text)
  if (!text) throw new Error(`免费通道（${UPSTREAM_LABEL[source]}）未返回文本内容，请换个模型重试`)
  return text
}
