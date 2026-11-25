// 云端语音识别：百炼 qwen3-asr-flash 同步识别（短音频 base64 直传，无需先上传文件）。
// 复用「语音配置」直连模式的阿里百炼 Key（与克隆音色同一把，getTtsConfig 明文回读）。
// 用途：手机系统自带识别服务在部分国产 ROM 上不可用时（如 vivo 接受会话但永不返回结果），
// 聊天听写改走「原生录音 → 云端转写」，不依赖本机识别服务。

import { getTtsConfig } from './voice-download'
import { isNativeApp } from './openExternal'

/** 是否已配置可用的百炼 Key（云端听写的前提） */
export function cloudAsrConfigured(): boolean {
  const c = getTtsConfig()
  return c.mode === 'direct' && c.provider === 'aliyun' && !!c.apiKey?.trim()
}

/** 把一段录音（data URI）转成文字；识别不到内容时返回空串 */
export async function transcribeWithDashScope(audioDataUrl: string): Promise<string> {
  const cfg = getTtsConfig()
  const apiKey = cfg.apiKey?.trim()
  if (cfg.mode !== 'direct' || cfg.provider !== 'aliyun' || !apiKey) {
    throw new Error('未配置阿里百炼 Key：请先到「语音配置」填写并保存')
  }
  const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
  const body = {
    model: 'qwen3-asr-flash',
    input: { messages: [{ role: 'user', content: [{ audio: audioDataUrl }] }] },
    parameters: { asr_options: { language: 'zh', enable_itn: true } },
  }
  let json: any
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({
      url, method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      data: body, responseType: 'text', readTimeout: 60000, connectTimeout: 20000,
    })
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
    if (res.status < 200 || res.status >= 300) throw new Error(`识别接口返回 ${res.status}：${text.slice(0, 160)}`)
    json = JSON.parse(text)
  } else {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`识别接口返回 ${res.status}：${text.slice(0, 160)}`)
    json = JSON.parse(text)
  }
  // 防御式提取文本：content 可能是 [{text}] / 字符串 / {text}，不同版本返回略有差异
  const content = json?.output?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((c: any) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('').trim()
  if (content?.text) return String(content.text).trim()
  if (json?.output?.text) return String(json.output.text).trim()
  const apiErr = json?.message || json?.code
  if (apiErr) throw new Error(`识别失败：${apiErr}`)
  return ''
}
