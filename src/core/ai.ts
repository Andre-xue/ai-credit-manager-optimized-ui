// AI 助手核心：基于云平台免密钥 LLM（stream: true 流式输出）。
// 对话历史仅存本机 localStorage，不纳入账单数据的云同步——聊天是私密且高频的内容，
// 与额度数据分离可避免同步载荷膨胀，也符合用户对对话隐私的预期。

import { LLM_PROXY_CONFIG, cloud, cloudClientHeaders, getCloudDeviceId } from './cloud'
import { isDesktopApp, isNativeApp } from './openExternal'
import type { ChatCompletionContentPart } from '@tencent-ai/workbuddy-cloud-sdk'

const HISTORY_KEY = 'acm.ai.history.v1'
const CONV_KEY = 'acm.ai.conversationId'
const MODEL_KEY = 'acm.ai.model'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: number
}

export interface AiModel {
  id: string
  name: string
  disabled?: boolean
}

/** 应用 Self-owned 系统提示：始终把助手绑定在「AI 魔方」的业务语境内。 */
export const SYSTEM_PROMPT = [
  '你是「AI 魔方」App 内置的智能助手。这个 App 帮助用户统一管理各家 AI 平台的积分、额度、用量和 API Key，并提供签到提醒、福利追踪、费用预估等功能。',
  '回答要求：简洁、准确、可执行；优先用中文；涉及操作步骤时给出清晰编号；不要编造具体产品的价格、规则或日期，不确定时明确说明并建议用户到官方渠道核实。',
  '如果用户询问额度管理、签到、API Key 安全、费用控制等话题，结合这个 App 的功能给出建议；与产品无关的问题也可以正常回答，但保持礼貌与克制。',
].join('\n')

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** 当前云登录的 access token（未登录/取不到时返回 undefined）。 */
async function cloudAccessToken(): Promise<string | undefined> {
  try { return await cloud.auth.getAccessToken() } catch { return undefined }
}

/**
 * 拉取可用模型列表（过滤 disabled），空列表交给 UI 处理。
 * 注意：网关现已要求登录（2026-11-20 实测：匿名请求返回 401 login_required），
 * 已登录时必须带上会话 Authorization，否则明明已登录也会报「请先登录」。
 * 这里直接向共享 cloud 实例取 token 后直连，不走 SDK 的自动 fetch。
 */
export async function listModels(): Promise<AiModel[]> {
  const url = `${LLM_PROXY_CONFIG.endpoint}/.cloud/llm/models`
  const token = await cloudAccessToken()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-wb-webapp-access-key': LLM_PROXY_CONFIG.publishableKey,
    ...cloudClientHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  let text: string
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method: 'GET', headers, responseType: 'text' })
    text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
    if (res.status < 200 || res.status >= 300) throw new Error(`模型列表请求失败（${res.status}）：${text.slice(0, 120)}`)
  } else {
    const res = await fetch(url, { method: 'GET', headers })
    text = await res.text()
    if (!res.ok) throw new Error(`模型列表请求失败（${res.status}）：${text.slice(0, 120)}`)
  }
  const json = JSON.parse(text)
  const raw: any[] = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : [])
  return raw
    .filter(m => m && typeof m.id === 'string' && m.disabled !== true)
    .map(m => ({ id: m.id, name: m.name ?? m.id }))
}

/** 统一解析云端 SSE：兼容 content 与 reasoning_content 两种内容字段 */
function parseSse(raw: string, onDelta?: (text: string) => void): string {
  let answer = ''
  let reasoning = ''
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const d = t.slice(5).trim()
    if (!d || d === '[DONE]') continue
    try {
      const j = JSON.parse(d)
      const delta = j?.choices?.[0]?.delta
      if (delta?.content) { answer += delta.content; onDelta?.(delta.content) }
      else if (delta?.reasoning_content) { reasoning += delta.reasoning_content; onDelta?.(delta.reasoning_content) }
    } catch { /* 忽略非 JSON 行 */ }
  }
  return answer || reasoning
}

export function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : []
  } catch { return [] }
}

export function saveHistory(messages: ChatMessage[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-100))) } catch { /* 忽略 */ }
}

/** 获取/新建会话 ID（应用自管，用于请求关联；不承诺服务端记忆历史） */
export function getConversationId(): string {
  try {
    let id = localStorage.getItem(CONV_KEY)
    if (!id) { id = uid(); localStorage.setItem(CONV_KEY, id) }
    return id
  } catch { return uid() }
}

export function rotateConversationId(): string {
  const id = uid()
  try { localStorage.setItem(CONV_KEY, id) } catch { /* 忽略 */ }
  return id
}

export function loadModel(): string | null {
  try { return localStorage.getItem(MODEL_KEY) } catch { return null }
}

export function saveModel(id: string): void {
  try { localStorage.setItem(MODEL_KEY, id) } catch { /* 忽略 */ }
}

/**
 * 流式发送消息。onDelta 增量回调用于实时渲染；返回完整回复文本。
 * 抛出的错误由 UI 捕获并按类型提示（未登录/额度不足/网络超时等）。
 */
export async function streamChat(
  model: string,
  history: ChatMessage[],
  userText: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  images?: string[],
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
  systemPrompt?: string,
  conversationIdOverride?: string,
): Promise<string> {
  // 仅把最近的对话作为上下文（系统消息始终在最前）：
  // 取最近 20 条，控制单次请求体积；conversationId 保持关联。
  const context = history.slice(-20).map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content,
  }))
  // 有图片时用多模态 content 格式（data URL 直接作为 image_url）
  const userContent: string | ChatCompletionContentPart[] = (images && images.length > 0)
    ? [
        { type: 'text', text: userText },
        ...images.map(u => ({ type: 'image_url', image_url: { url: u } } as ChatCompletionContentPart)),
      ]
    : userText
  const messages = [
    { role: 'system' as const, content: systemPrompt ?? SYSTEM_PROMPT },
    ...context,
    { role: 'user' as const, content: userContent },
  ]

  // 多模型对比等并行场景传独立 conversationId：同一 conversation 同时只能有一个生成流，共用会互相冲突被网关拒绝
  const conversationId = conversationIdOverride ?? getConversationId()
  const body: Record<string, unknown> = {
    model, messages, stream: true,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  }

  // 网关 LLM 能力现要求登录：已登录时把会话 token 一并带上（未登录则匿名调用，由网关 401 后给出登录提示）
  const accessToken = await cloudAccessToken()

  // 桌面端：WebView 直连云端 SSE 会被 CORS 拦截，改走 Rust 代理
  if (isDesktopApp()) {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> } }
    if (!w.__TAURI_INTERNALS__?.invoke) throw new Error('桌面代理不可用，请升级应用')
    const full = await w.__TAURI_INTERNALS__.invoke!('call_cloud_llm', {
      endpoint: LLM_PROXY_CONFIG.endpoint,
      publishableKey: LLM_PROXY_CONFIG.publishableKey,
      bodyJson: JSON.stringify(body),
      conversationId,
      accessToken: accessToken ?? null,
      // 网关按「设备 + Origin」绑定会话：Rust 代理必须带与 WebView 一致的客户端身份，
      // 否则网关判「session issued for another client」返回 401 invalid_grant（与手机端同根因）
      deviceId: getCloudDeviceId(),
      origin: 'tauri://localhost',
    })
    onDelta(full)
    return full
  }

  // 手机原生 App：WebView 直连同样受 CORS 限制，用 CapacitorHttp 走原生网络层绕过
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const url = `${LLM_PROXY_CONFIG.endpoint}/.cloud/llm/chat/completions`
    const res = await CapacitorHttp.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'x-wb-webapp-access-key': LLM_PROXY_CONFIG.publishableKey,
        ...cloudClientHeaders(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      data: { ...body, conversationId },
      responseType: 'text',
      readTimeout: 120000,
      connectTimeout: 20000,
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`云端请求失败（${res.status}），请检查网络`)
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
    const full = parseSse(raw, onDelta)
    return full
  }

  // Web：直连并显式带 publishableKey +（已登录时）会话 token
  const res = await fetch(`${LLM_PROXY_CONFIG.endpoint}/.cloud/llm/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'x-wb-webapp-access-key': LLM_PROXY_CONFIG.publishableKey,
      'X-Conversation-ID': conversationId,
      ...cloudClientHeaders(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ ...body, conversationId }),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`云端请求失败（${res.status}）：${text.slice(0, 160)}`)
  return parseSse(text, onDelta)
}

/** 把 SDK/网络错误转成用户可读的中文提示 */
export function friendlyAiError(error: unknown): string {
  const e = error as { name?: string; message?: string; code?: string; cors?: boolean }
  if (e?.name === 'AbortError') return '已停止生成'
  if (e?.cors) return '浏览器直连被跨域拦截，请在桌面客户端使用（走本地代理），或检查平台是否开放 API。'
  const msg = e?.message ?? String(error ?? '')
  const low = msg.toLowerCase()
  if (low.includes('quota') || low.includes('credit') || low.includes('额度')) return '模型额度不足，请稍后再试'
  if (low.includes('401') || low.includes('unauthorized') || low.includes('sign in')) return '请先登录后再使用 AI 助手'
  if (low.includes('timeout') || low.includes('timed out') || low.includes('network')) return '网络连接超时，请重试'
  if (low.includes('content_filter') || low.includes('blocked')) return '内容未通过安全检查，请换个说法'
  // 已带「调用失败：」前缀的不重复加；截断放宽到 300 字，确保平台返回的错误详情（如 GLM 的 code/message）能显示出来
  return msg.startsWith('调用失败') ? msg.slice(0, 300) : `调用失败：${msg.slice(0, 300)}`
}
