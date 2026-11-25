// AI 图像/视频：多服务商协议适配 + 模型优缺点知识库。
// 目标：任何提供 OpenAI 兼容接口的账户都能用；专有协议（如硅基流动视频）自动识别并适配。
// 这里不依赖 UI，纯数据与请求描述，便于测试。

import type { Account } from './types'
import type { ImageOptions, VideoOptions } from './providerCall'

export type MediaKind = 'image' | 'video'
export type ProviderStyle = 'openai-compatible' | 'siliconflow-video' | 'volcengine-ark-video' | 'dashscope-video' | 'unknown-openai'

export interface MediaModelInfo {
  id: string
  /** 一句话定位 */
  tagline: string
  /** 优点 */
  pros: string[]
  /** 缺点/注意 */
  cons: string[]
  /** 适用场景 */
  best?: string
}

/** 按 API 地址识别服务商协议风格 */
export function detectMediaStyle(account: Account): ProviderStyle {
  const base = (account.apiUrl || '').toLowerCase()
  const id = (account.providerId || '').toLowerCase()
  const label = (account.label || '').toLowerCase()
  const note = (account.note || '').toLowerCase()
  const text = `${base} ${id} ${label} ${note}`
  if (/siliconflow|硅基流动|siliconcloud/.test(text)) return 'siliconflow-video'
  if (/volces\.com|volcengine|火山方舟|ark\.cn/.test(text)) return 'volcengine-ark-video'
  if (/dashscope|aliyuncs\.com|通义万相|百炼/.test(text)) return 'dashscope-video'
  // OpenAI 兼容（绝大多数平台：硅基/Ollama/LM Studio/DeepSeek 风格网关等）统一走默认实现
  return 'openai-compatible'
}

/** 生图请求描述：硅基流动等用 image_size，OpenAI 标准用 size */
export function buildImageRequest(style: ProviderStyle, model: string, prompt: string, opts?: ImageOptions): { path: string; body: Record<string, unknown> } {
  const size = opts?.size ?? '1024x1024'
  const body: Record<string, unknown> = { model, prompt, n: opts?.n ?? 1 }
  if (style === 'siliconflow-video') {
    // 硅基流动生图：image_size + num_inference_steps；返回 data[].url
    body.image_size = size
    body.num_inference_steps = 20
    if (opts?.style) body.negative_prompt = opts.style === 'natural' ? 'cartoon, anime' : ''
  } else {
    body.size = size
    body.response_format = 'url'
    if (opts?.quality) body.quality = opts.quality
    if (opts?.style) body.style = opts.style
  }
  return { path: '/images/generations', body }
}

/** 视频请求描述：硅基流动专用 /video/submit + 状态轮询；其他走 OpenAI 风格兼容端点 */
export function buildVideoRequest(style: ProviderStyle, model: string, prompt: string, opts?: VideoOptions): { submitPath: string; body: Record<string, unknown>; headers?: Record<string, string>; statusPath?: string; statusBody?: (id: string) => Record<string, unknown>; statusGetPath?: (id: string) => string } {
  if (style === 'siliconflow-video') {
    const body: Record<string, unknown> = {
      model, prompt,
      duration: Math.min(15, Math.max(5, opts?.duration ?? 5)),
      resolution: opts?.resolution ?? '768p',
      ratio: opts?.ratio ?? '16:9',
    }
    if (opts?.image) body.images = [{ url: opts.image, role: 'first_frame' }]
    return {
      submitPath: '/video/submit', body,
      statusPath: '/video/status', statusBody: (id: string) => ({ requestId: id }),
    }
  }
  if (style === 'volcengine-ark-video') {
    // 火山方舟（Seedance/即梦）：POST /contents/generations/tasks，content 数组承载文本与首尾帧
    const content: Record<string, unknown>[] = [{ type: 'text', text: prompt }]
    if (opts?.image) content.push({ type: 'image_url', image_url: { url: opts.image }, role: 'first_frame' })
    if (opts?.lastFrame) content.push({ type: 'image_url', image_url: { url: opts.lastFrame }, role: 'last_frame' })
    const body: Record<string, unknown> = {
      model, content,
      ratio: opts?.ratio ?? '16:9',
      duration: opts?.duration ?? 5,
    }
    if (opts?.resolution) body.resolution = opts.resolution
    return {
      submitPath: '/contents/generations/tasks', body,
      statusGetPath: (id: string) => `/contents/generations/tasks/${encodeURIComponent(id)}`,
    }
  }
  if (style === 'dashscope-video') {
    // 阿里百炼/通义万相：POST /api/v1/services/aigc/video-generation/video-synthesis（需异步头），GET /api/v1/tasks/{id}
    const input: Record<string, unknown> = { prompt }
    if (opts?.image) input.img_url = opts.image
    const parameters: Record<string, unknown> = { duration: opts?.duration ?? 5, prompt_extend: true }
    if (opts?.ratio) parameters.ratio = opts.ratio
    if (opts?.resolution) parameters.resolution = opts.resolution
    return {
      submitPath: '/api/v1/services/aigc/video-generation/video-synthesis',
      body: { model, input, parameters },
      headers: { 'X-DashScope-Async': 'enable' },
      statusGetPath: (id: string) => `/api/v1/tasks/${encodeURIComponent(id)}`,
    }
  }
  const body: Record<string, unknown> = { model, prompt, duration: opts?.duration ?? 5 }
  if (opts?.ratio) body.ratio = opts.ratio
  if (opts?.image) body.image = opts.image
  return { submitPath: '/videos/generations', body }
}

/** 从视频提交响应里取任务 ID（覆盖各家字段） */
export function extractTaskId(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const o = json as Record<string, unknown>
  const d = (o.data ?? {}) as Record<string, unknown>
  const out = (o.output ?? {}) as Record<string, unknown>
  const v = o.requestId ?? o.id ?? o.task_id ?? d.id ?? d.task_id ?? out.task_id
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

/** 从视频状态响应里取结果 URL（覆盖硅基与 OpenAI 风格） */
export function extractVideoUrl(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const o = json as Record<string, unknown>
  const d = (o.data ?? {}) as Record<string, unknown>
  const results = (o.results ?? {}) as Record<string, unknown>
  const videos = results.videos
  const arr = Array.isArray(videos) ? videos : (Array.isArray(o.videos) ? o.videos : [])
  const first = arr.length ? (arr[0] as Record<string, unknown>) : null
  const candidates = [
    o.url, o.video_url, o.videoUrl,
    first?.url, d.url, d.video_url,
    results.url, (results.videos as Record<string, unknown> | undefined)?.url,
    (o.output as Record<string, unknown> | undefined)?.url,
    (o.output as Record<string, unknown> | undefined)?.video_url,
    (o.content as Record<string, unknown> | undefined)?.video_url,
  ]
  for (const c of candidates) if (typeof c === 'string' && c.startsWith('http')) return c
  return ''
}

/** 视频任务终态判断 */
export function videoTaskTerminal(json: unknown): { done: boolean; failed: boolean; status: string } {
  if (!json || typeof json !== 'object') return { done: false, failed: false, status: '' }
  const o = json as Record<string, unknown>
  const out = (o.output ?? {}) as Record<string, unknown>
  const s = String(o.status ?? out.task_status ?? '').toUpperCase()
  const failed = /FAIL|ERROR|REJECT|CANCEL|EXPIRED/.test(s)
  const done = /SUCCEED|COMPLETED|SUCCESS|FINISHED|DONE/.test(s)
  return { done, failed, status: s }
}

/** 按用途过滤模型列表：image=只留生图/图像编辑模型，video=只留视频生成模型（启发式，宁缺勿滥） */
export function filterMediaModels(ids: string[], kind: 'image' | 'video'): string[] {
  const imageHit = /image|img|kolors|flux|z-image|seedream|dreamina|draw|paint|dall|midjourney|stable-diffusion|sdxl|sd3|sd-?xl|ideogram|leonardo|imagen|photoreal|wanx2\.1-t2i|qwen-image|moss-image|art|vision-image|t2i|text-to-image/i
  const videoHit = /video|t2v|i2v|v2v|wan2|hunyuanvideo|minimax-h3|kling|sora|runway|pika|hailuo|svd|veo|anim|movie|cinema|text-to-video|image-to-video/i
  const exclude = /embed|rerank|bm25|ocr|whisper|asr|tts|speech|audio|voice|ttsd|moderation|safety|translation|chat|instruct|reasoner|thinking|coder|code-/i
  const hit = kind === 'image' ? imageHit : videoHit
  return ids.filter(id => {
    const s = String(id)
    if (exclude.test(s) && !hit.test(s)) return false
    return hit.test(s)
  })
}

/** 内置模型优缺点知识库（常见公开模型；其他服务商模型可在此基础上扩展） */
const MODEL_KB: MediaModelInfo[] = [
  // 生图
  { id: 'Kwai-Kolors/Kolors', tagline: '快手 Kolors 中文生图', pros: ['免费额度', '中文语义理解好', '写实与国风都不错'], cons: ['细节精度一般', '分辨率选择有限'], best: '中文海报、电商图、日常配图' },
  { id: 'black-forest-labs/FLUX.1-schnell', tagline: 'FLUX 快速版', pros: ['出图快', '英文提示词遵循好', '整体质感均衡'], cons: ['中文文字渲染弱', '细节弱于 dev 版'], best: '快速草图、概念探索' },
  { id: 'black-forest-labs/FLUX.1-dev', tagline: 'FLUX 高质量版', pros: ['画质细腻', '提示词遵循强', '风格多样'], cons: ['速度较慢', '成本较高'], best: '成品级插画、写实摄影' },
  { id: 'Qwen/Qwen-Image', tagline: '通义千问生图', pros: ['中文文字渲染优秀', '指令遵循稳定'], cons: ['速度中等', '价格偏高'], best: '中文海报、带字图片' },
  { id: 'Qwen/Qwen-Image-Edit', tagline: '通义图像编辑', pros: ['支持局部编辑', '中文指令'], cons: ['需提供原图', '非纯文生图'], best: '图片修改、加字换背景' },
  { id: 'Tongyi-MAI/Z-Image-Turbo', tagline: '造相极速版', pros: ['8 步极速出图', '中英双语文字', '消费级显卡可跑'], cons: ['复杂构图一般', '新模型生态尚小'], best: '批量出图、快速迭代' },
  { id: 'Tongyi-MAI/Z-Image', tagline: '造相完整版', pros: ['风格覆盖广', '支持负向提示词', '专业创作友好'], cons: ['比 Turbo 慢'], best: '专业创作、LoRA/ControlNet' },
  { id: 'OpenMOSS-Team/MOSS-Image', tagline: 'OpenMOSS 生图', pros: ['开源', '中英文文字渲染', '结构化布局'], cons: ['较新', '生态与资料少'], best: '海报、信息图、插画' },
  // 视频
  { id: 'MiniMaxAI/MiniMax-H3', tagline: 'MiniMax H3 视频', pros: ['支持首尾帧控制', '带原生立体声', '中文场景好'], cons: ['按秒计费', '生成需数分钟'], best: '广告、电商展示、创意短片' },
  { id: 'Wan-AI/Wan2.2-T2V-A14B', tagline: '通义万相文生视频', pros: ['开源模型', '运动自然', '画质稳定'], cons: ['速度较慢', '排队时间不定'], best: '文生视频、创意短片' },
  { id: 'Wan-AI/Wan2.2-I2V-A14B', tagline: '通义万相图生视频', pros: ['首帧可控', '画面延续性好'], cons: ['需提供首帧图', '比例受原图影响'], best: '图片动效、首尾帧动画' },
  { id: 'Wan-AI/Wan2.1-T2V-14B', tagline: '通义万相 2.1', pros: ['成熟稳定', '兼容好'], cons: ['较旧', '分辨率低于 2.2'], best: '通用文生视频' },
  { id: 'HunyuanVideo', tagline: '腾讯混元视频', pros: ['中文理解好', '画质细腻'], cons: ['生成慢', '接口多为异步私有'], best: '中文创意视频' },
]

/** 按模型 ID 精确/模糊匹配知识库条目 */
export function describeModel(id: string, kind: MediaKind): MediaModelInfo {
  const needle = id.toLowerCase()
  const exact = MODEL_KB.find(m => m.id.toLowerCase() === needle)
  if (exact) return exact
  // 去掉组织前缀后匹配（如 Flux.1-dev / wan2.2-t2v）
  const short = needle.split('/').pop() ?? needle
  const partial = MODEL_KB.find(m => {
    const k = m.id.toLowerCase().split('/').pop() ?? m.id.toLowerCase()
    return short.includes(k) || k.includes(short)
  })
  if (partial) return partial
  // 未知模型：按名称关键词给通用说明，不臆造具体能力
  const isImage = /image|img|kolors|flux|z-image|dream|paint|t2i/i.test(short)
  const isVideo = /video|t2v|i2v|h3|wan2|kling|sora|runway/i.test(short)
  if (kind === 'image' && (isImage || !isVideo)) {
    return { id, tagline: '图像生成模型（未收录详细说明）', pros: ['走服务商通用生图接口'], cons: ['具体能力/价格以服务商文档为准'], best: '建议先用短提示词测试效果' }
  }
  return { id, tagline: '视频生成模型（未收录详细说明）', pros: ['走服务商通用视频接口'], cons: ['生成耗时与计费以服务商为准'], best: '建议先用 5 秒短片测试' }
}

/** 给一组模型 ID 附上优缺点说明 */
export function describeModels(ids: string[], kind: MediaKind): MediaModelInfo[] {
  return ids.map(id => describeModel(id, kind))
}
