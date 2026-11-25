// 阿里云百炼 TTS 直连封装：直调官方 API（免部署代理、规避 CORS）。
// 桌面端走 Rust 后端命令；手机原生端走 CapacitorHttp 原生网络层（同一套 DashScope 接口）；
// 网页端受 CORS 限制不可直连。VoiceStudio 是电脑本地服务，仅桌面端可用。

import { isDesktopApp, isNativeApp } from './openExternal'
import type { TtsProviderConfig } from './voice-download'
import { getCurrentVoiceApiKey, hasVoiceConfigAccount } from './voiceKey'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function getInvoke(): Invoke | null {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

/**
 * 是否为直连模式（桌面端或手机原生端 + 有可用 Key）。
 * Key 来源：语音配置账户（加密）优先，旧的 localStorage 配置兜底。
 */
export function isDirectMode(cfg: TtsProviderConfig): boolean {
  if (!getInvoke() && !isNativeApp()) return false
  if (cfg.mode === 'proxy') return false
  // 有语音配置账户，或旧配置直连模式且填了 Key
  if (hasVoiceConfigAccount()) return true
  return cfg.provider === 'aliyun' && !!cfg.apiKey?.trim()
}

/** 解析语音 API Key：优先加密账户（按当前服务商匹配），回退旧配置 */
async function resolveVoiceKey(cfg: TtsProviderConfig): Promise<string> {
  const fromAccount = await getCurrentVoiceApiKey(cfg.provider || undefined)
  if (fromAccount) return fromAccount
  return cfg.apiKey ?? ''
}

// ==================== DashScope（百炼 CosyVoice）TS 直连：手机原生端用 ====================
// 与桌面 Rust 命令一一对应：POST /customization（克隆/测试）、POST /SpeechSynthesizer（合成）。

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts'

async function httpPostJson(url: string, apiKey: string, body: unknown): Promise<Record<string, any>> {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  let status = 0
  let text = ''
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method: 'POST', headers, data: body, responseType: 'text' })
    status = res.status
    text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  } else {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    status = res.status
    text = await res.text()
  }
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}：${text.slice(0, 200)}`)
  try {
    return JSON.parse(text) as Record<string, any>
  } catch {
    throw new Error(`响应格式异常：${text.slice(0, 160)}`)
  }
}

async function httpGetDataUrl(url: string): Promise<string> {
  // 百炼合成结果是 OSS 的 http:// 明文地址：安卓默认拦截明文流量（Cleartext HTTP traffic
  // not permitted）、WebView 也拦混合内容，试听/朗读会直接失败。OSS 同主机支持 HTTPS，
  // 统一升级后再下载；升级失败才回退原地址（桌面 http 本地服务等场景不受影响）。
  const upgraded = url.startsWith('http://') ? `https://${url.slice(7)}` : url
  try {
    return await fetchDataUrl(upgraded)
  } catch (e) {
    if (upgraded !== url) return await fetchDataUrl(url)
    throw e
  }
}

async function fetchDataUrl(url: string): Promise<string> {
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method: 'GET', responseType: 'blob' })
    const b64 = typeof res.data === 'string' ? res.data : ''
    if (res.status < 200 || res.status >= 300 || !b64) throw new Error(`下载音频失败（HTTP ${res.status}）`)
    return `data:audio/mp3;base64,${b64}`
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载音频失败（HTTP ${res.status}）`)
  const blob = await res.blob()
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('音频读取失败'))
    r.readAsDataURL(blob)
  })
}

async function dashscopeTest(apiKey: string): Promise<string> {
  const json = await httpPostJson(`${DASHSCOPE_BASE}/customization`, apiKey, {
    model: 'voice-enrollment',
    input: { action: 'list_voice', page_size: 1, page_index: 0 },
  })
  if (!json.request_id) throw new Error('服务未返回 request_id，Key 可能无效')
  return '连接成功，API Key 有效'
}

async function dashscopeClone(apiKey: string, name: string, audioDataUrl: string): Promise<string> {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
  const prefix = cleaned || 'voice'
  const json = await httpPostJson(`${DASHSCOPE_BASE}/customization`, apiKey, {
    model: 'voice-enrollment',
    input: {
      action: 'create_voice',
      target_model: 'cosyvoice-v2',
      prefix,
      audio: audioDataUrl,
      language_hints: ['zh'],
    },
  })
  const voiceId = json.output?.voice_id
  if (!voiceId) throw new Error(`服务未返回 voice_id：${JSON.stringify(json).slice(0, 200)}`)
  return String(voiceId)
}

async function dashscopeSynthesize(apiKey: string, voice: string, text: string): Promise<string> {
  const json = await httpPostJson(`${DASHSCOPE_BASE}/SpeechSynthesizer`, apiKey, {
    model: 'cosyvoice-v2',
    input: { text, voice, format: 'mp3', sample_rate: 24000 },
  })
  const audioUrl = json.output?.audio?.url
  if (!audioUrl) throw new Error(`合成未返回音频地址：${JSON.stringify(json).slice(0, 200)}`)
  return await httpGetDataUrl(String(audioUrl))
}

/** 校验 API Key（账户 Key 优先；传入值兜底） */
export async function ttsTestDirect(fallbackKey: string, provider?: string): Promise<{ ok: boolean; message: string }> {
  const invoke = getInvoke()
  if (!invoke && !isNativeApp()) return { ok: false, message: '网页端受跨域限制无法直连测试，请用桌面或手机客户端' }
  const fromAccount = await getCurrentVoiceApiKey(provider)
  const apiKey = fromAccount || fallbackKey
  if (!apiKey.trim()) return { ok: false, message: '请先在「添加账户 → 语音配置(APP)」保存 Key，或在下方输入' }
  try {
    const message = invoke
      ? await invoke('tts_test_direct', { apiKey }) as string
      : await dashscopeTest(apiKey)
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/** 直连克隆：返回 voiceId */
export async function ttsCloneDirect(cfg: TtsProviderConfig, name: string, mime: string, audioDataUrl: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke && !isNativeApp()) throw new Error('网页端受跨域限制无法直连克隆，请用桌面或手机客户端')
  const apiKey = await resolveVoiceKey(cfg)
  if (!apiKey) throw new Error('语音配置 Key 未解锁，请在语音配置页验证主密码')
  if (invoke) {
    return await invoke('tts_clone_direct', {
      apiKey, name, mime, audioDataUrl,
    }) as string
  }
  return await dashscopeClone(apiKey, name, audioDataUrl)
}

/** 直连合成：返回音频 data URI（data:audio/mp3;base64,...） */
export async function ttsSynthesizeDirect(cfg: TtsProviderConfig, voice: string, text: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke && !isNativeApp()) throw new Error('网页端受跨域限制无法直连合成，请用桌面或手机客户端')
  const apiKey = await resolveVoiceKey(cfg)
  if (!apiKey) throw new Error('语音配置 Key 未解锁，请在语音配置页验证主密码')
  if (invoke) {
    return await invoke('tts_synthesize_direct', {
      apiKey, voice, text,
    }) as string
  }
  return await dashscopeSynthesize(apiKey, voice, text)
}

// ==================== VoiceStudio 本地服务 ====================
// 通过 Rust 后端直连本机 VoiceStudio(:3900)，绕过浏览器 CORS。
// endpoint 即 VoiceStudio 地址（默认 http://127.0.0.1:3900），apiKey 为其可选 Bearer 密钥。

function vsArgs(cfg: TtsProviderConfig): { endpoint: string; apiKey: string } {
  return { endpoint: cfg.endpoint?.trim() || 'http://127.0.0.1:3900', apiKey: cfg.apiKey?.trim() || '' }
}

export async function voicestudioTest(cfg: TtsProviderConfig): Promise<{ ok: boolean; message: string }> {
  const invoke = getInvoke()
  if (!invoke) return { ok: false, message: 'VoiceStudio 是运行在电脑上的本地服务（127.0.0.1:3900），手机端连不到；手机上请改用阿里百炼，或在桌面端操作' }
  try {
    const message = await invoke('voicestudio_test', vsArgs(cfg)) as string
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

export interface VoiceStudioProfile { id: string; name: string; [key: string]: unknown }

export async function voicestudioList(cfg: TtsProviderConfig): Promise<VoiceStudioProfile[]> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('VoiceStudio 是电脑本地服务，手机端无法连接；请在桌面端查看，或改用阿里百炼')
  const arr = await invoke('voicestudio_list', vsArgs(cfg)) as Array<Record<string, unknown>>
  return arr.map(p => ({
    ...p,
    id: String(p.id ?? p.profile_id ?? ''),
    name: String(p.name ?? p.id ?? '未命名音色'),
  })).filter(p => p.id)
}

export async function voicestudioClone(cfg: TtsProviderConfig, name: string, audioDataUrl: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('VoiceStudio 是电脑本地服务，手机端无法克隆；请在桌面端克隆，或改用阿里百炼在手机上克隆')
  return await invoke('voicestudio_clone', { ...vsArgs(cfg), name, audioDataUrl }) as string
}

export async function voicestudioSynthesize(cfg: TtsProviderConfig, voice: string, text: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('VoiceStudio 是电脑本地服务，手机端无法合成；已自动回退系统音色')
  return await invoke('voicestudio_synthesize', { ...vsArgs(cfg), voice, text }) as string
}
