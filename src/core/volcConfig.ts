// 火山引擎语音配置：端到端实时语音 + 声音复刻共用的凭据与音色设置。
// 说明：App 为本地优先架构，配置存本机 localStorage；Token 做简单混淆避免明文直读，
// 但它不是强加密（密钥仍在用户自己设备上，从不上传、不进云同步）。
// 两种能力都要求用户在火山引擎控制台开通对应服务并拿到 APP ID / Access Token。

const CONFIG_KEY = 'acm.volc.config.v1'

export interface VolcConfig {
  /** 火山 APP ID（旧版控制台叫 AppId） */
  appId: string
  /** 火山 Access Token */
  accessToken: string
  /** 端到端实时语音使用的音色（如 Vivi2.0 对应的 voice_type）；留空用火山默认 */
  realtimeVoice: string
  /** 声音复刻后拿到的 speaker_id（用于 TTS 合成） */
  clonedSpeakerId: string
  /** 端到端 WebSocket 资源 ID（默认 volc.speech.dialog，一般不用改） */
  resourceId: string
  /** 端到端 WS 地址 */
  wsUrl: string
}

export const DEFAULT_VOLC_CONFIG: VolcConfig = {
  appId: '', accessToken: '', realtimeVoice: '', clonedSpeakerId: '',
  resourceId: 'volc.speech.dialog',
  wsUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialog',
}

// 轻度混淆：异或固定盐 + base64。仅为避免 localStorage 里明文可见，不做安全承诺。
const SALT = 'acm-volc-2026'
function obfuscate(s: string): string {
  if (!s) return ''
  let out = ''
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length))
  return btoa(unescape(encodeURIComponent(out)))
}
function deobfuscate(s: string): string {
  if (!s) return ''
  try {
    const out = decodeURIComponent(escape(atob(s)))
    let res = ''
    for (let i = 0; i < out.length; i++) res += String.fromCharCode(out.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length))
    return res
  } catch { return '' }
}

export function getVolcConfig(): VolcConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return { ...DEFAULT_VOLC_CONFIG }
    const obj = JSON.parse(raw) as Partial<VolcConfig> & { accessTokenEnc?: string }
    return {
      ...DEFAULT_VOLC_CONFIG,
      appId: obj.appId ?? '',
      accessToken: obj.accessToken ?? deobfuscate(obj.accessTokenEnc ?? ''),
      realtimeVoice: obj.realtimeVoice ?? '',
      clonedSpeakerId: obj.clonedSpeakerId ?? '',
      resourceId: obj.resourceId || DEFAULT_VOLC_CONFIG.resourceId,
      wsUrl: obj.wsUrl || DEFAULT_VOLC_CONFIG.wsUrl,
    }
  } catch { return { ...DEFAULT_VOLC_CONFIG } }
}

export function saveVolcConfig(c: VolcConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      ...c,
      accessToken: undefined,
      accessTokenEnc: obfuscate(c.accessToken),
    }))
  } catch { /* 隐私模式写入失败忽略 */ }
}

export function clearVolcConfig(): void {
  try { localStorage.removeItem(CONFIG_KEY) } catch { /* ignore */ }
}

/** 端到端实时语音是否可配置（有 APP ID + Token） */
export function hasRealtimeConfig(): boolean {
  const c = getVolcConfig()
  return !!(c.appId.trim() && c.accessToken.trim())
}
