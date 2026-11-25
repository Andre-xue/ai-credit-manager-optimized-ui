// 主流模型引擎目录（兜底参考数据）。
// 优先通过平台 /v1/models 接口动态拉取该 Key 实际可用的引擎；此目录仅在拉取失败时使用。
// 数据依据官方平台文档核对（2026-11）：Kimi K3.1/K3、DeepSeek V4.1、Qwen4/3.8、GLM4.6 等。
// 引擎 id 为该平台 OpenAI 兼容接口的 model 参数；multiplier 为相对参考倍率（用于排序，非实时价格）。
// 排序：倍率升序；同倍率按名称。

export interface Engine {
  /** 该平台 API 的 model 参数值 */
  id: string
  /** 展示名 */
  name: string
  /** 相对 token 消耗倍率（参考） */
  multiplier: number
  /** 是否支持推理等级 */
  reasoning?: boolean
  /** 标签：折扣/订阅优先等（仅展示，参考） */
  tag?: '夜间折扣' | '订阅优先' | '新模型' | '高性价比'
  /** 是否需要订阅才能用 */
  subscription?: boolean
  /** 是否为该平台当前旗舰（默认优先选中） */
  flagship?: boolean
}

/** 按 providerId 索引的引擎目录；未收录的平台返回空数组，UI 提示手动输入引擎名 */
export const ENGINE_CATALOG: Record<string, Engine[]> = {
  // Moonshot Kimi（依据 platform.moonshot.cn/docs/models，2026-11：
  // moonshot-v1 系列与 kimi-k2/k2.5 均已下线；当前主线为 K3.1 / K3）
  kim: [
    { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', multiplier: 1.20, reasoning: true, tag: '新模型', flagship: true },
    { id: 'kimi-k3.1-pro-highspeed', name: 'K3.1 Pro 高速版', multiplier: 1.60, reasoning: true, tag: '新模型' },
    { id: 'kimi-k3', name: 'Kimi K3', multiplier: 0.75, reasoning: true },
    // 以下为过渡期仍可用的旧模型（官方标注逐步下线，供存量用户迁移使用）
    { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', multiplier: 0.45, tag: '夜间折扣' },
    { id: 'kimi-k2.7-code-highspeed', name: 'K2.7 Code 高速版', multiplier: 0.90 },
    { id: 'kimi-k2.6', name: 'Kimi K2.6', multiplier: 0.55 },
  ],
  // 通义千问（qwen.ai：旧 qwen3-235b/qwen-plus 等已由 Qwen3.8/4 系列取代）
  qwen: [
    { id: 'qwen4-max', name: 'Qwen4 Max', multiplier: 1.30, reasoning: true, tag: '新模型', flagship: true },
    { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', multiplier: 0.18, reasoning: true, tag: '高性价比' },
    { id: 'qwen3.8-max', name: 'Qwen3.8 Max', multiplier: 1.00, reasoning: true },
    { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', multiplier: 0.45 },
    { id: 'qwen3-max', name: 'Qwen3 Max', multiplier: 0.80, reasoning: true },
    { id: 'qwen3-turbo', name: 'Qwen3 Turbo', multiplier: 0.12, tag: '高性价比' },
  ],
  // DeepSeek（api-docs.deepseek.com：deepseek-chat/reasoner 已于 2026-07-24 下线）
  deepseek: [
    { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', multiplier: 0.15, tag: '高性价比', flagship: true },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', multiplier: 0.66, reasoning: true },
  ],
  // OpenAI
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', multiplier: 0.15, tag: '高性价比' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', multiplier: 0.20 },
    { id: 'gpt-4o', name: 'GPT-4o', multiplier: 0.75 },
    { id: 'gpt-4.1', name: 'GPT-4.1', multiplier: 0.90, flagship: true },
    { id: 'o4-mini', name: 'o4-mini', multiplier: 0.60, reasoning: true },
    { id: 'o3', name: 'o3', multiplier: 1.50, reasoning: true },
  ],
  // 智谱 GLM（当前主线 4.6/4.5 系列）
  glm: [
    { id: 'glm-4.5-flash', name: 'GLM-4.5 Flash', multiplier: 0.08, tag: '高性价比' },
    { id: 'glm-4.5-air', name: 'GLM-4.5 Air', multiplier: 0.20 },
    { id: 'glm-4.6', name: 'GLM-4.6', multiplier: 0.85, reasoning: true, tag: '新模型', flagship: true },
    { id: 'glm-4.5', name: 'GLM-4.5', multiplier: 0.60, reasoning: true },
    { id: 'glm-4.5-x', name: 'GLM-4.5 X', multiplier: 0.95, reasoning: true, tag: '订阅优先' },
  ],
  // Anthropic Claude
  anthropic: [
    { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', multiplier: 0.25, tag: '高性价比' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', multiplier: 0.90, reasoning: true, flagship: true },
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', multiplier: 0.85, reasoning: true },
    { id: 'claude-opus-4', name: 'Claude Opus 4', multiplier: 1.50, reasoning: true },
  ],
  // Google Gemini
  gemini: [
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', multiplier: 0.06, tag: '高性价比' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', multiplier: 0.15, reasoning: true },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', multiplier: 0.80, reasoning: true, flagship: true },
  ],
  // MiniMax
  minimax: [
    { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', multiplier: 0.35 },
    { id: 'abab6.5s-chat', name: 'abab6.5s Chat', multiplier: 0.20 },
    { id: 'MiniMax-M1', name: 'MiniMax M1', multiplier: 0.60, reasoning: true, tag: '新模型' },
  ],
  // 阶跃星辰
  stepfun: [
    { id: 'step-3-mini', name: 'Step 3 Mini', multiplier: 0.12, tag: '高性价比' },
    { id: 'step-3', name: 'Step 3', multiplier: 0.55, reasoning: true },
    { id: 'step-2', name: 'Step 2', multiplier: 0.40 },
  ],
  // 百川
  baichuan: [
    { id: 'Baichuan4-Turbo', name: 'Baichuan4 Turbo', multiplier: 0.18, tag: '高性价比' },
    { id: 'Baichuan4', name: 'Baichuan4', multiplier: 0.45 },
    { id: 'Baichuan3-Turbo', name: 'Baichuan3 Turbo', multiplier: 0.10 },
  ],
  // 豆包 / 火山方舟
  doubao: [
    { id: 'doubao-lite', name: '豆包 Lite', multiplier: 0.08, tag: '高性价比' },
    { id: 'doubao-pro', name: '豆包 Pro', multiplier: 0.45 },
    { id: 'doubao-thinking', name: '豆包 Thinking', multiplier: 0.60, reasoning: true },
  ],
  // xAI Grok
  xai: [
    { id: 'grok-3-mini', name: 'Grok 3 Mini', multiplier: 0.20, reasoning: true },
    { id: 'grok-3', name: 'Grok 3', multiplier: 0.95, reasoning: true },
  ],
  // Mistral
  mistral: [
    { id: 'mistral-small', name: 'Mistral Small', multiplier: 0.10, tag: '高性价比' },
    { id: 'mistral-medium', name: 'Mistral Medium', multiplier: 0.40 },
    { id: 'mistral-large', name: 'Mistral Large', multiplier: 0.85, reasoning: true },
  ],
}

/** 取某平台的引擎（按倍率升序）。未收录返回空 */
export function enginesFor(providerId: string): Engine[] {
  const list = ENGINE_CATALOG[providerId] ?? []
  return [...list].sort((a, b) => a.multiplier - b.multiplier)
}

/**
 * 把动态拉取的模型 id 列表转为 Engine：
 * 内置目录有记录则复用其倍率/标签/推理标记；没有则给默认倍率 0.50 并标记新模型。
 * 始终按倍率升序——内置已知的在前（低倍率优先），未知模型在后。
 */
export function enginesFromRemote(providerId: string, ids: string[]): Engine[] {
  const known = new Map((ENGINE_CATALOG[providerId] ?? []).map(e => [e.id, e]))
  const result: Engine[] = ids.map(id => {
    const hit = known.get(id)
    if (hit) return hit
    // 从 id 推断展示名：k3.1-pro → K3.1 Pro
    const name = id
      .replace(/^(kimi|deepseek|qwen|glm|gpt|claude|gemini|moonshot)-?/i, m => m.toUpperCase().replace('-', ' '))
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
    return { id, name, multiplier: 0.50, tag: '新模型' }
  })
  return result.sort((a, b) => a.multiplier - b.multiplier || a.name.localeCompare(b.name))
}

/** 平台是否有内置引擎目录 */
export function hasCatalog(providerId: string): boolean {
  return (ENGINE_CATALOG[providerId]?.length ?? 0) > 0
}

/** 推理等级：界面四档 → SDK reasoning_effort */
export type ReasoningLevel = 'Off' | 'Low' | 'High' | 'Max'
export const REASONING_LEVELS: ReasoningLevel[] = ['Off', 'Low', 'High', 'Max']

/** 各等级的中文说明（悬停提示 / 手机点选提示） */
export const REASONING_DESC: Record<ReasoningLevel, string> = {
  Off: '关闭推理：直接作答，速度最快、消耗最低，适合简单问答',
  Low: '轻度推理：少量思考，速度与质量均衡，适合日常问题',
  High: '深度推理：充分思考，答案更严谨，适合复杂问题与代码',
  Max: '极限推理：最长时间思考，质量优先，消耗最高，适合高难度任务',
}
export function toReasoningEffort(level: ReasoningLevel): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  switch (level) {
    case 'Off': return undefined
    case 'Low': return 'minimal'
    case 'High': return 'medium'
    case 'Max': return 'high'
  }
}

/**
 * AI 思考模式全局映射（设置页开关 → 默认推理等级）。
 * 开启：默认 High（深度推理 medium），关闭：Off。
 * AI 聊天用此作为新对话默认值（仍可在输入框单独调整）；文档问答等无独立 UI 的模块直接用此 effort。
 */
export function defaultReasoningLevel(thinkingMode?: boolean): ReasoningLevel {
  return thinkingMode ? 'High' : 'Off'
}
export function globalReasoningEffort(thinkingMode?: boolean): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  return toReasoningEffort(defaultReasoningLevel(thinkingMode))
}
