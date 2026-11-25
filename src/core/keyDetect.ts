// 智能粘贴：按 API Key 的格式特征猜测所属平台（前缀规则）。
// 只做格式识别，不联网验证；低置信度结果必须让用户在界面上确认/改选。

export interface KeyDetection {
  providerId: string
  confidence: 'high' | 'low'
  reason: string
}

interface Rule {
  test: (k: string) => boolean
  providerId: string
  confidence: 'high' | 'low'
  reason: string
}

const RULES: Rule[] = [
  { test: (k) => k.startsWith('sk-ant-'), providerId: 'anthropic', confidence: 'high', reason: 'sk-ant- 前缀是 Anthropic 官方 Key 格式' },
  { test: (k) => k.startsWith('sk-proj-'), providerId: 'openai', confidence: 'high', reason: 'sk-proj- 前缀是 OpenAI 项目 Key 格式' },
  { test: (k) => k.startsWith('gsk_'), providerId: 'groq', confidence: 'high', reason: 'gsk_ 前缀是 Groq 官方 Key 格式' },
  { test: (k) => k.startsWith('AIza'), providerId: 'gemini', confidence: 'high', reason: 'AIza 开头是 Google（Gemini）API Key 格式' },
  { test: (k) => k.startsWith('xai-'), providerId: 'xai', confidence: 'high', reason: 'xai- 前缀是 xAI（Grok）官方 Key 格式' },
  { test: (k) => k.startsWith('pplx-'), providerId: 'perplexity', confidence: 'high', reason: 'pplx- 前缀是 Perplexity 官方 Key 格式' },
  { test: (k) => k.startsWith('AKLT'), providerId: 'doubao', confidence: 'low', reason: 'AKLT 开头是火山引擎 AccessKey 特征（豆包/方舟），请确认' },
  { test: (k) => k.startsWith('sk-') && k.length >= 20, providerId: 'openai', confidence: 'low', reason: 'sk- 是通用格式（OpenAI 及众多兼容平台都用），请确认平台' },
]

/** 输入粘贴的原文（可能带空白/换行/说明文字），提取疑似 Key 并识别平台；识别不了返回 null */
export function detectProviderFromKey(raw: string): (KeyDetection & { key: string }) | null {
  const key = extractKey(raw)
  if (!key) return null
  for (const r of RULES) {
    if (r.test(key)) return { providerId: r.providerId, confidence: r.confidence, reason: r.reason, key }
  }
  return null
}

/** 从粘贴文本中提取第一段像 Key 的长串（去掉空白、引号与常见前缀说明） */
export function extractKey(raw: string): string {
  const cleaned = (raw ?? '').trim()
  if (!cleaned) return ''
  const token = cleaned.split(/\s+/).map((t) => t.replace(/^["'`]+|["'`,;]+$/g, '')).find((t) => t.length >= 16 && /^[A-Za-z0-9_\-.]+$/.test(t))
  return token ?? ''
}
