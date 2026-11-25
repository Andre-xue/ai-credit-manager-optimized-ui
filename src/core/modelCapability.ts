// 模型能力识别：根据模型名自动判断用途分类（对话/翻译/嵌入/图像等）。
// 新加入的模型会被自动归类，用于 AI 聊天下拉过滤（嵌入模型不参与聊天）。
// 规则驱动、可扩展：已知模型精确表 + 关键词回退。

export type ModelCapability = 'chat' | 'translation' | 'embedding' | 'image' | 'audio' | 'video' | 'unknown'

export interface CapabilityInfo {
  capability: ModelCapability
  /** 中文标注 */
  label: string
  /** 识别依据，便于用户理解与纠正 */
  reason: string
  /** 是否适合 AI 聊天 */
  chatCapable: boolean
}

export const CAPABILITY_LABEL: Record<ModelCapability, string> = {
  chat: '对话',
  translation: '翻译',
  embedding: '嵌入',
  image: '图像',
  audio: '音频',
  video: '视频',
  unknown: '未知',
}

/**
 * 是否为 AnimateDiff 运动模块（如 mm_sd_v15_v2.ckpt）。
 * 这类文件不是底模：不能单独出图/对话，必须在 ComfyUI 的 AnimateDiff 工作流中
 * 搭配一个 SD1.5 checkpoint 才能生成视频。识别特征：位于 animatediff 目录、
 * mm_ 前缀的 ckpt/safetensors 文件名、或名称含 motion module。
 */
export function isMotionModule(modelName: string): boolean {
  const lower = (modelName || '').trim().toLowerCase()
  const baseName = lower.split(/[\\/]/).pop() ?? lower
  return lower.includes('animatediff')
    || /^mm_[^/\\]*\.(ckpt|safetensors)$/.test(baseName)
    || /motion[-_ ]?module/.test(lower)
}

/** 已知模型的精确识别表（小写名 → 能力） */
const KNOWN_MODELS: Record<string, ModelCapability> = {
  // 嵌入模型（不能聊天）
  'nomic-embed-text': 'embedding',
  'nomic-embed-text:latest': 'embedding',
  'mxbai-embed-large': 'embedding',
  'all-minilm': 'embedding',
  'bge-m3': 'embedding',
  'bge-large': 'embedding',
  'snowflake-arctic-embed': 'embedding',
  'text-embedding-ada-002': 'embedding',
  'text-embedding-3-small': 'embedding',
  'text-embedding-3-large': 'embedding',
  // 翻译模型（走 chat 接口但专用翻译）
  'hy-mt2': 'translation',
  'hy-mt2:1.8b': 'translation',
  'hy-mt1.5': 'translation',
  // 图像/音频（对话型多模态）
  'llava': 'image',
  'bakllava': 'image',
  'llava-phi3': 'image',
  'whisper': 'audio',
  'whisper-large-v3': 'audio',
  // ComfyUI / Stable Diffusion 绘图模型（精确名，去掉目录前缀后的文件名）
  // 注：mm_sd_v15_v2.ckpt 是 AnimateDiff 运动模块，不在此表——由 isMotionModule 前置识别为 video
  'anythingv5v3_v5prtre.safetensors': 'image',
  'realistic_vision_v6.0_nv_b1.safetensors': 'image',
  'v1-5-pruned-emaonly-fp16.safetensors': 'image',
}

/** 关键词回退规则：按顺序匹配，命中即返回（嵌入/翻译优先于绘图，避免误判） */
const KEYWORD_RULES: { pattern: RegExp; capability: ModelCapability }[] = [
  { pattern: /embed|embedding|bge-|e5-|gte-|minilm/i, capability: 'embedding' },
  { pattern: /translate|translation|\bmt[2-9]?\b|hy-mt|nllb|opus-mt/i, capability: 'translation' },
  // 图像：对话型多模态 + ComfyUI/SD 绘图模型特征。
  // 目录特征（checkpoints/ 等）与绘图扩展名强相关；绘图模型名关键词兜底。
  {
    pattern: /llava|vision|vl\b|image|pixtral|checkpoints\/|loras\/|vae\/|controlnet\/|\.safetensors$|\.ckpt$|(^|\/)v1[-_]?5|anything|realistic|dreamshaper|chilloutmix|majicmix|sd[_ -]?xl|sd[_ -]?1[._-]?5|flux/i,
    capability: 'image',
  },
  { pattern: /whisper|asr|speech|tts|audio/i, capability: 'audio' },
  // 通用对话模型关键词（明确标注，便于识别）
  { pattern: /llama|qwen|deepseek|chatgpt|gpt-|claude|gemini|mistral|phi|gemma|kimi|glm|yi:|\byi\b|command|dolphin|vicuna|orca|stablelm|falcon/i, capability: 'chat' },
]

/**
 * 识别模型能力。优先精确表，再关键词回退。
 * 模型名含标签（如 llama3.2:3b），同时尝试去掉标签后的基础名。
 */
export function detectModelCapability(modelName: string): CapabilityInfo {
  const raw = (modelName || '').trim()
  const lower = raw.toLowerCase()
  // 运动模块前置识别：它既不是图像底模也不能对话，单独归类为视频·运动模块
  if (isMotionModule(raw)) {
    return { capability: 'video', label: '视频·运动模块', reason: 'AnimateDiff 运动模块', chatCapable: false }
  }
  const base = lower.split(':')[0]                       // 去掉 :tag 标签
  const baseName = base.split(/[\\/]/).pop() ?? base     // 去掉目录前缀，取文件名

  if (KNOWN_MODELS[lower]) {
    const cap = KNOWN_MODELS[lower]
    return { capability: cap, label: CAPABILITY_LABEL[cap], reason: '已知模型', chatCapable: cap === 'chat' || cap === 'translation' }
  }
  if (KNOWN_MODELS[base] || KNOWN_MODELS[baseName]) {
    const cap = KNOWN_MODELS[base] ?? KNOWN_MODELS[baseName]
    return { capability: cap, label: CAPABILITY_LABEL[cap], reason: '已知模型（含标签/目录）', chatCapable: cap === 'chat' || cap === 'translation' }
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(lower) || rule.pattern.test(base)) {
      const cap = rule.capability
      return { capability: cap, label: CAPABILITY_LABEL[cap], reason: '名称关键词', chatCapable: cap === 'chat' || cap === 'translation' }
    }
  }
  return { capability: 'unknown', label: '未知', reason: '未匹配已知规则', chatCapable: true }
}

/** 能力类型是否支持聊天（对话/翻译/未知可聊；嵌入/图像/音频/视频不可） */
export function capabilityChatCapable(cap: ModelCapability): boolean {
  return cap !== 'embedding' && cap !== 'image' && cap !== 'audio' && cap !== 'video'
}

/** 是否应从 AI 聊天下拉中隐藏（嵌入/图像/音频模型不能聊天） */
export function shouldHideFromChat(info: CapabilityInfo): boolean {
  return !capabilityChatCapable(info.capability)
}
