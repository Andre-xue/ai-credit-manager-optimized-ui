// 用用户自己的 API Key 真正调用各平台（对话/生图/视频/本地）。
// 桌面端走 Tauri 命令代理绕过 CORS；Web/Docker 端直连（可能被 CORS 拦截，会给出提示）。
// 主流 OpenAI 兼容接口（DeepSeek/OpenAI/智谱/Moonshot/本地 Ollama 等）开箱可用；
// 生图走 /images/generations；视频为异步任务制，做尽力提交并给出去官方查询的引导。

import type { Account } from './types'
import type { ModelCategory } from './modelCategories'
import { isDesktopApp } from './openExternal'
import {
  detectMediaStyle, buildImageRequest, buildVideoRequest,
  extractTaskId, extractVideoUrl, videoTaskTerminal,
} from './mediaAdapters'

export interface ProviderCallResult {
  ok: boolean
  text: string
  /** 图片 URL（生图型） */
  images?: string[]
  error?: string
  /** 是否为 CORS 类错误（Web 端提示用桌面端） */
  cors?: boolean
}

interface InvokeWindow extends Window {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> }
}

async function invokeApi(url: string, apiKey: string, body: unknown, method: 'POST' | 'GET' = 'POST', headers?: Record<string, string>): Promise<string> {
  const w = window as unknown as InvokeWindow
  if (!w.__TAURI_INTERNALS__?.invoke) throw Object.assign(new Error('桌面代理不可用'), { cors: true })
  return w.__TAURI_INTERNALS__.invoke!('call_provider_api', {
    url, apiKey, bodyJson: body === undefined ? '{}' : JSON.stringify(body), method,
    headersJson: JSON.stringify(headers ?? {}),
  })
}

async function directFetch(url: string, apiKey: string, body: unknown, headers?: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`接口返回 ${res.status}：${text.slice(0, 160)}`)
  return text
}

/** 规范化 API base：确保以 /v1 结尾的对话端点可用 */
function chatUrl(account: Account): string {
  let base = (account.apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('该账户未填写 API 地址')
  if (base.includes('/chat/completions')) return base
  // DeepSeek 官方原生端点是 /chat/completions（不带 /v1）；用户若填了带 /v1 的地址，
  // 兼容层会对 Content-Type 敏感并返回 415，这里对 DeepSeek 强制去掉版本后缀。
  const pid = (account.providerId || '').toLowerCase()
  const isDeepSeek = pid.includes('deepseek') || /deepseek/i.test(base)
  if (isDeepSeek) {
    // 官方原生端点不带 /v1；去掉用户可能填的版本后缀，直接拼 /chat/completions
    base = base.replace(/\/v\d+$/, '')
    return `${base}/chat/completions`
  }
  if (!/\/v\d+/.test(base)) base += '/v1'
  return `${base}/chat/completions`
}

/** /v1/models 端点：拉取该 Key 实际可用的模型引擎 */
function modelsUrl(account: Account): string {
  let base = (account.apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('该账户未填写 API 地址')
  if (base.includes('/chat/completions')) base = base.replace(/\/chat\/completions$/, '')
  if (!/\/v\d+/.test(base)) base += '/v1'
  return `${base}/models`
}

/**
 * 动态拉取平台可用模型引擎（OpenAI 兼容 /v1/models）。
 * 返回模型 id 列表；失败时抛出异常，由 UI 回退到内置目录。
 */
export async function fetchProviderModels(account: Account, apiKey: string): Promise<string[]> {
  const url = modelsUrl(account)
  let raw: string
  if (isDesktopApp()) {
    raw = await invokeApi(url, apiKey, {}, 'GET')
  } else {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    })
    raw = await res.text()
    if (!res.ok) throw new Error(`接口返回 ${res.status}：${raw.slice(0, 120)}`)
  }
  const json = JSON.parse(raw)
  const list: unknown[] = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : [])
  const ids = list
    .map((m: any) => m?.id)
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) throw new Error('接口未返回任何模型')
  return ids
}

/**
 * Kimi 系列（含 K3 / K3.1）的采样参数在服务端固定：temperature 只能为 1，
 * 传 0.7 等自定义值会直接 400。这里统一"不传 temperature"，让服务端用默认值。
 * 同时兼容第三方中转平台返回的带前缀模型 id（如 moonshotai/kimi-k3.1-pro）。
 */
export function usesFixedSampling(account: Account, modelId: string): boolean {
  const id = modelId.toLowerCase()
  return account.providerId === 'kim'
    || /(^|[-_/])(kimi|moonshot)([-_/]|$)/.test(id)
    || /(^|[-_/])k3(\.1)?([-_/]|$)/.test(id)
}

/**
 * 推理强度按平台归一化。
 * Kimi K3、智谱 GLM（含 GLM-5.x 始终思考系列）、DeepSeek 新模型只接受 low / high / max 三档；
 * 界面四档（minimal/low/medium/high）需映射过去，否则 medium 会被接口以 code 1210 拒绝。
 */
export function normalizeReasoningEffort(
  account: Account, modelId: string,
  effort?: 'minimal' | 'low' | 'medium' | 'high',
): 'minimal' | 'low' | 'medium' | 'high' | 'max' | undefined {
  const id = modelId.toLowerCase()
  const pid = (account.providerId || '').toLowerCase()
  const isK3 = /(^|[-_/])k3(\.1)?([-_/]|$)/.test(id) || /3\.1/.test(id)
  // GLM / DeepSeek 的始终思考模型同样只认 low / high / max
  const isLowHighMax = isK3
    || pid.includes('glm') || /\bglm([-_/]|$)/.test(id)
    || pid.includes('deepseek') || /\bdeepseek([-_/]|$)/.test(id)
  if (!effort) {
    // 始终思考模型不支持"关闭思考"：不传参数会被平台当作关闭而报 code 1210，
    // 因此对这类模型保底传最低档 low；普通模型（OpenAI 等）保持不传。
    return isLowHighMax ? 'low' : undefined
  }
  if (!isLowHighMax) return effort
  // 界面四档 → 三档（low 原样保留）
  switch (effort) {
    case 'minimal': return 'low'
    case 'medium': return 'high'
    case 'high': return 'max'
    default: return effort
  }
}

/** 识别服务端返回的"固定采样参数"类错误，用于自动重试一次 */
function isTemperatureError(e: unknown): boolean {
  const msg = ((e as Error)?.message ?? String(e ?? '')).toLowerCase()
  return msg.includes('invalid temperature') || msg.includes('invalid_temperature')
    || (/temperature/.test(msg) && /only\s+[\d.]+\s+is\s+allowed/.test(msg))
}

/** 415 Content-Type 错误（DeepSeek 账户地址带 /v1 时兼容层常报），换原生地址可解 */
function isContentTypeError(e: unknown): boolean {
  const msg = ((e as Error)?.message ?? String(e ?? '')).toLowerCase()
  return (/415/.test(msg) && /content-type/.test(msg)) || /expected request with.*content-type/.test(msg)
}

/** reasoning / thinking 参数不被接受（含 code 1210、400 参数错误） */
function isReasoningError(e: unknown): boolean {
  const msg = ((e as Error)?.message ?? String(e ?? '')).toLowerCase()
  return /1210/.test(msg)
    || (/reasoning/.test(msg) && /400|invalid|not support|不支持|无效/.test(msg))
    || (/思考/.test(msg) && /不支持|关闭/.test(msg))
}

/** 去掉 base 末尾的 /vN，得到原生根地址（DeepSeek 官方端点不带 /v1） */
function stripVersionSuffix(url: string): string {
  return url.replace(/\/v\d+(\/chat\/completions)?$/, '/chat/completions')
}

/** 对话：OpenAI 兼容 chat completions（非流式，简化处理） */
export async function callChat(
  account: Account, apiKey: string, messages: { role: string; content: string }[],
  engineId?: string, reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
): Promise<ProviderCallResult> {
  try {
    const url = chatUrl(account)
    const model = engineId || account.label
    const body: Record<string, unknown> = { model, messages, stream: false }
    const pid = (account.providerId || '').toLowerCase()
    const isDeepSeek = pid.includes('deepseek') || /deepseek/i.test(model) || /deepseek/i.test(account.apiUrl || '')
    if (isDeepSeek) {
      // DeepSeek V4.x 始终思考：按官方文档用 thinking + reasoning_effort（low/high/max），
      // 不传 temperature（思考模式下被忽略，且兼容层可能因此报 415）。
      body.thinking = { type: 'enabled' }
      const effort = normalizeReasoningEffort(account, model, reasoningEffort)
      if (effort) body.reasoning_effort = effort
    } else {
      // Kimi K3 系列固定采样参数：不传 temperature，避免 400 invalid temperature
      if (!usesFixedSampling(account, model)) body.temperature = 0.7
      const effort = normalizeReasoningEffort(account, model, reasoningEffort)
      if (effort) body.reasoning_effort = effort
    }

    const request = (payload: Record<string, unknown>, reqUrl = url) =>
      isDesktopApp() ? invokeApi(reqUrl, apiKey, payload) : directFetch(reqUrl, apiKey, payload)

    let raw: string
    try {
      raw = await request(body)
    } catch (e) {
      const contentTypeErr = isContentTypeError(e)
      const reasoningErr = isReasoningError(e)
      const tempErr = isTemperatureError(e)
      const nativeUrl = stripVersionSuffix(url)
      const slim = (b: Record<string, unknown>): Record<string, unknown> | null => {
        const next = { ...b }
        let changed = false
        for (const k of ['reasoning_effort', 'thinking', 'temperature']) {
          if (k in next) { delete next[k]; changed = true }
        }
        return changed ? next : null
      }
      // 415 Content-Type：先换原生地址（去 /vN）重试
      if (contentTypeErr && nativeUrl !== url) {
        try { raw = await request(body, nativeUrl) }
        catch (e2) {
          const min = slim(body)
          if (min && (isContentTypeError(e2) || isReasoningError(e2))) raw = await request(min, nativeUrl)
          else throw e2
        }
      }
      // 415（地址本就原生）/ reasoning 报错：剥离可选参数用最简请求体重试
      else if ((contentTypeErr || reasoningErr)) {
        const min = slim(body)
        if (min) raw = await request(min)
        else throw e
      }
      // 固定采样限制：去掉 temperature 自动重试一次
      else if (tempErr && 'temperature' in body) {
        const retry = { ...body }
        delete retry.temperature
        raw = await request(retry)
      }
      // 其他 400：多半是某个可选参数被平台拒绝（如 GLM 对 reasoning_effort 的校验），
      // 错误文案不一定带可识别关键词，统一剥离可选参数用最简请求体重试一次
      else if (/\b400\b/.test((e as Error)?.message ?? String(e))) {
        const min = slim(body)
        if (min) raw = await request(min)
        else throw e
      } else throw e
    }
    const json = JSON.parse(raw)
    const text = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? ''
    if (!text) return { ok: false, text: '', error: '接口未返回文本内容，请检查模型名与账户配置' }
    return { ok: true, text }
  } catch (e) {
    return toError(e)
  }
}

export interface ToolCallRequest { id: string; name: string; arguments: string }
export interface ToolChatMessage {
  role: string
  content: string | null
  tool_calls?: unknown
  tool_call_id?: string
}
export interface ToolChatResult {
  ok: boolean
  text: string
  toolCalls?: ToolCallRequest[]
  /** 平台拒绝 tools 参数、已自动降级为无工具普通对话 */
  toolsUnsupported?: boolean
  error?: string
}

/**
 * 带工具定义的对话（v0.1.317，单轮）：在 callChat 的请求构造之上加 OpenAI 风格
 * tools 参数，返回模型请求调用的工具清单（不执行，执行与多轮循环在 core/toolChat）。
 * 平台明确拒绝 tools/函数调用时，自动剥离 tools 以普通对话重试一次并标注降级。
 */
export async function callChatWithTools(
  account: Account, apiKey: string,
  messages: ToolChatMessage[],
  tools: Record<string, unknown>[],
  engineId?: string, reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
): Promise<ToolChatResult> {
  try {
    const url = chatUrl(account)
    const model = engineId || account.label
    const build = (withTools: boolean): Record<string, unknown> => {
      const body: Record<string, unknown> = { model, messages, stream: false }
      const pid = (account.providerId || '').toLowerCase()
      const isDeepSeek = pid.includes('deepseek') || /deepseek/i.test(model) || /deepseek/i.test(account.apiUrl || '')
      if (isDeepSeek) {
        body.thinking = { type: 'enabled' }
        const effort = normalizeReasoningEffort(account, model, reasoningEffort)
        if (effort) body.reasoning_effort = effort
      } else {
        if (!usesFixedSampling(account, model)) body.temperature = 0.7
        const effort = normalizeReasoningEffort(account, model, reasoningEffort)
        if (effort) body.reasoning_effort = effort
      }
      if (withTools && tools.length) { body.tools = tools; body.tool_choice = 'auto' }
      return body
    }
    const request = (payload: Record<string, unknown>) =>
      isDesktopApp() ? invokeApi(url, apiKey, payload) : directFetch(url, apiKey, payload)
    let raw: string
    let unsupported = false
    try {
      raw = await request(build(true))
    } catch (e) {
      const msg = ((e as Error)?.message ?? String(e)).toLowerCase()
      if (/tool|function/.test(msg) && /400|invalid|not support|unsupported|不支持|无效/.test(msg)) {
        raw = await request(build(false))
        unsupported = true
      } else throw e
    }
    const json = JSON.parse(raw)
    const msgObj = (json.choices?.[0]?.message ?? {}) as { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }
    const toolCalls = Array.isArray(msgObj.tool_calls)
      ? msgObj.tool_calls
          .map(tc => ({ id: tc.id ?? '', name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' }))
          .filter(tc => tc.name)
      : []
    return { ok: true, text: msgObj.content ?? '', toolCalls: toolCalls.length ? toolCalls : undefined, toolsUnsupported: unsupported }
  } catch (e) {
    const err = toError(e)
    return { ok: false, text: '', error: err.error }
  }
}

/**
 * 从账户备注/名称中提取真实模型 ID。
 * 生图/生视频接口要求 model 是平台模型 ID（如 Kwai-Kolors/Kolors、black-forest-labs/FLUX.1-schnell），
 * 而用户填写的 label / note 常混入分类前缀与中文说明。约定：含 '/' 的 token 视为模型 ID。
 */
export function extractModelId(account: Account): string {
  const candidates: string[] = []
  // note 形如 "[生图型] Kwai-Kolors/Kolors" → 取分类前缀之后的部分
  if (account.note) {
    const cleaned = account.note.replace(/^\[[^\]]+\]\s*/, '')
    cleaned.split(/[\s,，;；]+/).forEach(tok => { if (tok) candidates.push(tok) })
  }
  if (account.label) account.label.split(/[\s,，;；]+/).forEach(tok => { if (tok) candidates.push(tok) })
  // 含 '/' 的最可能是模型 ID（Kolors/Kolors、FLUX.1、Qwen/...）
  const withSlash = candidates.find(t => t.includes('/'))
  return withSlash ?? candidates[0] ?? account.label ?? ''
}

/** 生图可选参数（AI 图像模块用；不传则保持原有默认行为） */
export interface ImageOptions {
  size?: string           // 如 '1024x1024' / '1536x1024' / '1792x1024'
  n?: number              // 生成张数
  quality?: string        // 'standard' | 'hd'（部分平台支持）
  style?: string          // 'vivid' | 'natural'（部分平台支持）
  model?: string          // 显式指定模型 ID（从平台拉取并筛选后选择；不传则从账户备注提取）
  // SD / ComfyUI 风格扩展参数（本地服务支持则生效）
  negativePrompt?: string
  steps?: number
  cfgScale?: number
  seed?: number
  sampler?: string
  width?: number
  height?: number
  sourceImage?: string    // img2img 源图（data URL）
  strength?: number       // img2img 重绘幅度 0-1
}
/** 生视频可选参数（AI 视频模块用） */
export interface VideoOptions {
  duration?: number       // 秒
  ratio?: string          // '16:9' | '9:16' | '1:1'
  resolution?: string     // '480p' | '768p' 等（硅基/ComfyUI 风格）
  image?: string          // 图生视频的首帧图（URL 或 data URL）
  model?: string          // 显式指定模型 ID（从平台拉取并筛选后选择）
  // SD / ComfyUI 风格扩展参数（本地服务支持则生效）
  negativePrompt?: string
  steps?: number
  cfgScale?: number
  seed?: number
  fps?: number
  motionStrength?: number
  lastFrame?: string      // 尾帧图（首尾帧生视频）
}

/**
 * 给 Promise 套超时（v0.1.303）：云端生成接口此前无任何超时，服务商不返回时
 * 前端进度条爬到 88% 上限后永远卡住。超时后以明确文案 reject，底层请求
 * （桌面 Rust 另有 120s 上限）如何收尾不影响界面解脱。
 */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${what}超时（${Math.round(ms / 1000)} 秒无响应），请检查网络或稍后重试`)), ms)
    }),
  ])
}

/** 生图：按服务商协议风格自动生成请求（OpenAI 标准 / 硅基 image_size 等） */
export async function callImage(
  account: Account, apiKey: string, prompt: string, opts?: ImageOptions,
): Promise<ProviderCallResult> {
  try {
    let base = (account.apiUrl || '').trim().replace(/\/+$/, '')
    if (!base) throw new Error('该账户未填写 API 地址')
    if (!/\/v\d+/.test(base)) base += '/v1'
    const style = detectMediaStyle(account)
    const model = opts?.model || extractModelId(account)
    const req = buildImageRequest(style, model, prompt, opts)
    const raw = await withTimeout(
      isDesktopApp() ? invokeApi(`${base}${req.path}`, apiKey, req.body) : directFetch(`${base}${req.path}`, apiKey, req.body),
      150_000, '生图请求')
    const json = JSON.parse(raw)
    const images: string[] = (json.data ?? []).map((d: { url?: string; b64_json?: string; image_url?: string }) => d.url ?? d.image_url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : '')).filter(Boolean)
    if (images.length === 0) {
      return { ok: false, text: '', error: `接口未返回图片（模型：${model}）。请确认所选模型支持生图、且该 Key 有对应权限；可在「拉取」里查看该 Key 实际可用的生图模型。` }
    }
    return { ok: true, text: `已生成 ${images.length} 张图片`, images }
  } catch (e) {
    return toError(e)
  }
}

/** 视频：按服务商协议风格提交任务（硅基专用 /video/submit，其余 OpenAI 风格兼容） */
export async function callVideo(
  account: Account, apiKey: string, prompt: string, opts?: VideoOptions,
): Promise<ProviderCallResult> {
  const base = (account.apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) return { ok: false, text: '', error: '该账户未填写 API 地址' }
  const style = detectMediaStyle(account)
  const model = opts?.model || extractModelId(account)
  const req = buildVideoRequest(style, model, prompt, opts)

  // 百炼地址常带 /api/v1 后缀，而提交路径已含该段，先归一化避免拼重
  const cleanBase = style === 'dashscope-video' ? base.replace(/\/api\/v\d+$/, '') : base
  const urls = (style === 'siliconflow-video' || style === 'volcengine-ark-video' || style === 'dashscope-video')
    ? [`${cleanBase}${req.submitPath}`]
    : [`${base}${req.submitPath}`, `${base}/video/generations`, `${base.replace(/\/v\d+$/, '')}/videos/generations`]
  let lastErr = ''
  for (const url of urls) {
    try {
      const raw = await withTimeout(
        isDesktopApp() ? invokeApi(url, apiKey, req.body, 'POST', req.headers) : directFetch(url, apiKey, req.body, req.headers),
        90_000, '视频任务提交')
      const json = JSON.parse(raw)
      const videoUrl = extractVideoUrl(json)
      if (videoUrl) return { ok: true, text: '视频已生成', images: [videoUrl] }
      const id = extractTaskId(json)
      if (id) return { ok: true, text: `视频任务已提交（ID: ${String(id).slice(0, 20)}）。生成需数分钟，正在查询进度。` }
      lastErr = '接口已响应但未返回任务信息'
    } catch (e) { lastErr = errText(e) }
  }
  return {
    ok: false, text: '',
    error: `${account.label} 的视频接口暂未能自动调用（${lastErr.slice(0, 120)}）。若该平台为私有协议，建议到官方页面生成后在此记录。`,
  }
}

/**
 * 查询视频生成任务状态：硅基走 POST /video/status + requestId；
 * 其余平台走 GET /v1/videos/{id}。拿到视频 URL 即返回。
 */
export async function queryVideoTask(
  account: Account, apiKey: string, taskId: string,
): Promise<ProviderCallResult> {
  let base = (account.apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) return { ok: false, text: '', error: '该账户未填写 API 地址' }
  if (!/\/v\d+/.test(base)) base += '/v1'
  const style = detectMediaStyle(account)
  // 百炼状态路径自带 /api/v1 段，归一化避免与上面补的 /v1 拼重
  if (style === 'dashscope-video') base = base.replace(/\/api\/v\d+$/, '').replace(/\/v\d+$/, '')
  const reqDesc = buildVideoRequest(style, '', '')
  try {
    let raw: string
    if (style === 'siliconflow-video') {
      const body = { requestId: taskId }
      raw = await withTimeout(
        isDesktopApp() ? invokeApi(`${base}/video/status`, apiKey, body) : directFetch(`${base}/video/status`, apiKey, body),
        30_000, '视频进度查询')
    } else if (reqDesc.statusGetPath) {
      const url = `${base}${reqDesc.statusGetPath(taskId)}`
      raw = await withTimeout(isDesktopApp()
        ? invokeApi(url, apiKey, undefined, 'GET')
        : (async () => {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
          const text = await res.text()
          if (!res.ok) throw new Error(`接口返回 ${res.status}：${text.slice(0, 120)}`)
          return text
        })(), 30_000, '视频进度查询')
    } else {
      raw = await withTimeout(isDesktopApp()
        ? invokeApi(`${base}/videos/${encodeURIComponent(taskId)}`, apiKey, undefined, 'GET')
        : (async () => {
          const res = await fetch(`${base}/videos/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` } })
          const text = await res.text()
          if (!res.ok) throw new Error(`接口返回 ${res.status}：${text.slice(0, 120)}`)
          return text
        })(), 30_000, '视频进度查询')
    }
    const json = JSON.parse(raw)
    const videoUrl = extractVideoUrl(json)
    if (videoUrl) return { ok: true, text: '视频已生成', images: [videoUrl] }
    const term = videoTaskTerminal(json)
    if (term.failed) return { ok: false, text: '', error: `视频生成失败（状态：${term.status}${json.reason ? `：${String(json.reason).slice(0, 80)}` : ''}）` }
    return { ok: true, text: term.status ? `任务状态：${term.status}` : '任务处理中' }
  } catch (e) {
    return toError(e)
  }
}

/** 统一入口：按分类调用 */
export async function callByCategory(
  account: Account, apiKey: string, category: ModelCategory,
  messages: { role: string; content: string }[],
  engineId?: string, reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
): Promise<ProviderCallResult> {
  const userText = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  switch (category) {
    case '生图型': return callImage(account, apiKey, userText)
    case '视频型': return callVideo(account, apiKey, userText)
    default: return callChat(account, apiKey, messages, engineId, reasoningEffort)
  }
}

export { filterMediaModels } from './mediaAdapters'

/**
 * 本地模型调用（Ollama / ComfyUI / LM Studio 等本机 OpenAI 兼容服务）。
 * 本地服务无需真实 Key；桌面端仍走 invokeApi 让 Tauri 代理 bypass CORS（localhost 通常也可直连）。
 * base 为本地服务地址（如 http://127.0.0.1:11434），自动补 /v1。
 */
function localBase(base: string): string {
  let b = base.trim().replace(/\/+$/, '')
  if (!b) throw new Error('未填写本地服务地址')
  if (!/\/v\d+/.test(b)) b += '/v1'
  return b
}

/** 拉取本地服务的模型列表（GET {base}/models） */
export async function fetchLocalMediaModels(base: string): Promise<string[]> {
  const url = `${localBase(base)}/models`
  const raw = isDesktopApp()
    ? await invokeApi(url, 'local', undefined, 'GET')
    : await (async () => {
      const res = await fetch(url)
      const text = await res.text()
      if (!res.ok) throw new Error(`接口返回 ${res.status}：${text.slice(0, 120)}`)
      return text
    })()
  const json = JSON.parse(raw)
  const list: unknown[] = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.models) ? json.models : (Array.isArray(json) ? json : []))
  const ids = list.map((m: unknown): string => {
    if (typeof m === 'string') return m
    const o = m as { id?: unknown; name?: unknown }
    return typeof o?.id === 'string' ? o.id : (typeof o?.name === 'string' ? o.name : '')
  }).filter(Boolean)
  if (ids.length === 0) throw new Error('本地服务未返回模型')
  return ids
}

/** 本地模型名是否「看起来」像纯文本对话模型（翻译用：排除视觉/嵌入/生图/视频/语音系列） */
export function isChatCapableLocalModel(id: string): boolean {
  const exclude = /(embed|vision|\bvl[-_]?|image|draw|diffusion|sd[-_]|flux|tts|whisper|asr|audio|video|ocr|rerank|clip|gemma3|gemma4|llava|bakllava|moondream|pixtral|smolvlm|internvl|llama4|paligemma|qwen3\.5)/i
  return !exclude.test(id.replace(/\s/g, ''))
}

/** 是否为「翻译专用」本地模型（这类模型只有 completion 能力，但不应出现在 AI 助手/文档问答的回答列表） */
export function isTranslationLocalModel(id: string): boolean {
  return /(hy-mt|nllb|opus-mt|m2m100|argos|translator|translate|madlad|flan-t5|mt5)/i.test(id.replace(/\s/g, ''))
}

/** 本地模型名是否「看起来」可用于 AI 助手对话（保留视觉模型，只排除嵌入/生图/视频/语音/重排/翻译专用） */
export function isAssistantCapableLocalModel(id: string): boolean {
  const exclude = /(embed|embedding|image|draw|diffusion|sd[-_]|flux|tts|whisper|asr|audio|video|rerank|clip|nomic-embed|bge-)/i
  const name = id.replace(/\s/g, '')
  return !exclude.test(name) && !isTranslationLocalModel(name)
}

/** 去掉 /v1 后缀，得到服务根地址（Ollama 原生 /api/show 不带 /v1） */
function rootBase(base: string): string {
  return base.trim().replace(/\/+$/, '').replace(/\/v\d+$/, '')
}

/** 向本地服务查询某模型的能力列表（Ollama /api/show）；失败返回 null */
export async function queryLocalModelCapabilities(base: string, model: string): Promise<string[] | null> {
  const url = `${rootBase(base)}/api/show`
  try {
    const raw = isDesktopApp()
      ? await invokeApi(url, 'local', { name: model })
      : await (async () => {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: model }) })
        if (!res.ok) throw new Error(String(res.status))
        return res.text()
      })()
    const json = JSON.parse(raw)
    return Array.isArray(json?.capabilities) ? json.capabilities.map((c: unknown) => String(c).toLowerCase()) : null
  } catch { return null }
}

/**
 * 拉取本地服务中「可用于对话/翻译」的文本模型列表。
 * 优先用 Ollama /api/show 的 capabilities 精确判断（有 vision 即排除）；
 * 非 Ollama 服务或查询失败时回退到模型名黑名单。
 */
export async function fetchLocalChatModels(base: string): Promise<string[]> {
  const all = await fetchLocalMediaModels(base)
  const chat: string[] = []
  await Promise.all(all.map(async id => {
    const caps = await queryLocalModelCapabilities(base, id)
    // 有能力信息时：必须有 completion 且无 vision；查询失败则回退名字黑名单
    const capable = caps === null
      ? isChatCapableLocalModel(id)
      : caps.includes('completion') && !caps.some(c => c.includes('vision'))
    if (capable) chat.push(id)
  }))
  if (chat.length === 0) throw new Error('本地服务中未找到可用于翻译的文本模型')
  // 保持原顺序
  return all.filter(id => chat.includes(id))
}

/**
 * 拉取本地服务中「可用于 AI 助手」的模型列表：保留文本 + 视觉多模态模型（AI 助手支持图片），
 * 只排除嵌入/生图/视频/语音/重排类。Ollama 有能力信息时要求含 completion（视觉模型 gemma3 也含 completion）。
 */
export async function fetchLocalAssistantModels(base: string): Promise<string[]> {
  const all = await fetchLocalMediaModels(base)
  const capable: string[] = []
  await Promise.all(all.map(async id => {
    const caps = await queryLocalModelCapabilities(base, id)
    // 有能力信息：必须有 completion（vision+completion 的视觉模型保留）；翻译专用模型名也排除；否则回退名字判断
    const ok = caps === null
      ? isAssistantCapableLocalModel(id)
      : caps.includes('completion') && !caps.some(c => /embed|rerank|tts|whisper|asr|audio|image|video|diffusion/.test(c)) && !isTranslationLocalModel(id)
    if (ok) capable.push(id)
  }))
  return all.filter(id => capable.includes(id))
}

/**
 * 从给定的 Ollama 模型名列表里筛出「可用于 AI 助手/文档问答」的：保留文本+视觉，排除嵌入/生图/视频/语音。
 * 与 fetchLocalAssistantModels 的区别：模型名列表由调用方提供（可来自 fetch_local_models 直连命令），
 * 避免依赖 /v1/models 代理，供文档问答等已拿到名字列表的场景使用。
 */
export async function filterAssistantModelNames(base: string, names: string[]): Promise<string[]> {
  const capable: string[] = []
  await Promise.all(names.map(async id => {
    const caps = await queryLocalModelCapabilities(base, id)
    const ok = caps === null
      ? isAssistantCapableLocalModel(id)
      : caps.includes('completion') && !caps.some(c => /embed|rerank|tts|whisper|asr|audio|image|video|diffusion/.test(c)) && !isTranslationLocalModel(id)
    if (ok) capable.push(id)
  }))
  return names.filter(id => capable.includes(id))
}

/** 本地对话调用（OpenAI 兼容 /chat/completions，无需账户 Key；images 为 data URL 数组时以多模态发送） */
export async function callLocalChat(
  base: string, model: string, messages: { role: string; content: string }[], images?: string[],
): Promise<ProviderCallResult> {
  try {
    const url = `${localBase(base)}/chat/completions`
    // 有图片时，把最后一条 user 消息的 content 改成多模态数组（OpenAI 兼容格式）
    let outMessages: unknown = messages
    if (images?.length) {
      const idx = [...messages].map(m => m.role).lastIndexOf('user')
      if (idx >= 0) {
        outMessages = messages.map((m, i) => i === idx ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...images.map(u => ({ type: 'image_url', image_url: { url: u } })),
          ],
        } : m)
      }
    }
    const body = { model, messages: outMessages, stream: false, temperature: 0.3 }
    const raw = isDesktopApp() ? await invokeApi(url, 'local', body) : await directFetch(url, 'local', body)
    const json = JSON.parse(raw)
    const text = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? ''
    if (!text) return { ok: false, text: '', error: `本地模型 ${model} 未返回文本，请确认模型支持对话` }
    return { ok: true, text: String(text).trim() }
  } catch (e) { return toError(e) }
}

/** 本地生图：POST {base}/images/generations */
export async function callLocalImage(base: string, model: string, prompt: string, opts?: ImageOptions): Promise<ProviderCallResult> {
  try {
    const url = `${localBase(base)}/images/generations`
    const body: Record<string, unknown> = {
      model, prompt, n: opts?.n ?? 1, size: opts?.size ?? '1024x1024', response_format: 'url',
    }
    if (opts?.quality) body.quality = opts.quality
    if (opts?.style) body.style = opts.style
    // SD / ComfyUI 风格参数：本地服务支持则生效
    if (opts?.negativePrompt) body.negative_prompt = opts.negativePrompt
    if (opts?.steps !== undefined) body.steps = opts.steps
    if (opts?.cfgScale !== undefined) body.cfg_scale = opts.cfgScale
    if (opts?.seed !== undefined) body.seed = opts.seed
    if (opts?.sampler) body.sampler = opts.sampler
    if (opts?.width !== undefined) body.width = opts.width
    if (opts?.height !== undefined) body.height = opts.height
    if (opts?.sourceImage) { body.image = opts.sourceImage; body.strength = opts.strength ?? 0.7 }
    const raw = isDesktopApp() ? await invokeApi(url, 'local', body) : await directFetch(url, 'local', body)
    const json = JSON.parse(raw)
    const images: string[] = (json.data ?? []).map((d: { url?: string; b64_json?: string }) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : '')).filter(Boolean)
    if (images.length === 0) return { ok: false, text: '', error: '本地服务未返回图片。请确认模型支持文生图（如 ComfyUI 生图工作流 / LocalAI 图像模型）。' }
    return { ok: true, text: `本地生成 ${images.length} 张图片`, images }
  } catch (e) { return toError(e) }
}

/** 本地生视频：POST {base}/videos/generations（尽力而为） */
export async function callLocalVideo(base: string, model: string, prompt: string, opts?: VideoOptions): Promise<ProviderCallResult> {
  try {
    const url = `${localBase(base)}/videos/generations`
    const body: Record<string, unknown> = { model, prompt, duration: opts?.duration ?? 5 }
    if (opts?.ratio) body.ratio = opts.ratio
    if (opts?.resolution) body.resolution = opts.resolution
    if (opts?.image) {
      body.image = opts.image
      // 兼容硅基风格 images[] 数组（首帧/尾帧）
      const frames: { url: string; role: string }[] = [{ url: opts.image, role: 'first_frame' }]
      if (opts.lastFrame) frames.push({ url: opts.lastFrame, role: 'last_frame' })
      body.images = frames
    }
    // SD / ComfyUI 风格参数
    if (opts?.negativePrompt) body.negative_prompt = opts.negativePrompt
    if (opts?.steps !== undefined) body.steps = opts.steps
    if (opts?.cfgScale !== undefined) body.cfg_scale = opts.cfgScale
    if (opts?.seed !== undefined) body.seed = opts.seed
    if (opts?.fps !== undefined) body.fps = opts.fps
    if (opts?.motionStrength !== undefined) body.motion_strength = opts.motionStrength
    const raw = isDesktopApp() ? await invokeApi(url, 'local', body) : await directFetch(url, 'local', body)
    const json = JSON.parse(raw)
    const videoUrl = json.url ?? json.data?.url ?? json.output?.url ?? json.data?.[0]?.url
    if (videoUrl) return { ok: true, text: '本地视频已生成', images: [videoUrl] }
    const id = json.id ?? json.task_id ?? json.data?.id
    if (id) return { ok: true, text: `本地视频任务已提交（ID: ${String(id).slice(0, 20)}）` }
    return { ok: false, text: '', error: '本地服务已响应但未返回视频地址，请确认该服务支持视频生成接口。' }
  } catch (e) { return toError(e) }
}

/** 本地视频任务查询：GET {base}/videos/{id} */
export async function queryLocalVideoTask(base: string, taskId: string): Promise<ProviderCallResult> {
  const url = `${localBase(base)}/videos/${encodeURIComponent(taskId)}`
  try {
    const raw = isDesktopApp()
      ? await invokeApi(url, 'local', undefined, 'GET')
      : await (async () => { const res = await fetch(url); const text = await res.text(); if (!res.ok) throw new Error(`接口返回 ${res.status}`); return text })()
    const json = JSON.parse(raw)
    const videoUrl = json.url ?? json.video_url ?? json.output?.url ?? json.data?.url
    if (videoUrl) return { ok: true, text: '视频已生成', images: [videoUrl] }
    return { ok: true, text: json.status ? `任务状态：${json.status}` : '任务处理中' }
  } catch (e) { return toError(e) }
}

/** 安全提取任意抛出值（Error / 字符串 / Tauri 命令 reject 的非标准对象）的文本 */
function errText(e: unknown): string {
  if (e == null) return '未知错误'
  if (typeof e === 'string') return e
  if (typeof e === 'object') {
    const o = e as { message?: unknown }
    if (typeof o.message === 'string' && o.message) return o.message
    try { return JSON.stringify(e) } catch { return '未知错误' }
  }
  return String(e)
}

function toError(e: unknown): ProviderCallResult {
  const cors = typeof e === 'object' && e != null && (e as { cors?: boolean }).cors === true
  const msg = errText(e)
  return {
    ok: false, text: '',
    cors: cors || /cors|failed to fetch|networkerror/i.test(msg),
    error: cors || /cors|failed to fetch|networkerror/i.test(msg)
      ? '浏览器直连被跨域策略拦截。请在桌面客户端使用（桌面端走本地代理），或检查平台是否开放 API。'
      : `调用失败：${msg.slice(0, 300)}`,
  }
}
