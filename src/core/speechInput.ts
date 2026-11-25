import { isDesktopApp, isNativeApp } from './openExternal'
import { cloudAsrConfigured, transcribeWithDashScope } from './asr'

/**
 * 语音输入（听写）：把说的话转成文字填进输入框。
 * 安卓原生优先「原生录音 + 百炼云端识别」（不依赖本机识别服务——vivo 等 ROM 的系统
 * 识别服务会接受会话却永不返回结果，实测 2026-11-20）；未配置百炼 Key 时退回系统
 * 语音识别插件，并带 6 秒无结果看门狗，把静默假死变成明确提示。
 * 桌面/Web 用浏览器 SpeechRecognition（系统语音识别服务，不需要额外模型）。
 */

export interface SpeechInputHandlers {
  /** 识别过程中的全文（临时结果会不断更新，停说后定稿） */
  onText: (text: string) => void
  /** 致命错误（权限/环境），会话随之结束 */
  onError: (message: string) => void
  /** 会话结束（手动停止或引擎自行结束） */
  onEnd: () => void
  /** 云端模式下录音已结束、正在转写时回调（用于给用户一个提示） */
  onProcessing?: () => void
}

export interface SpeechInputSession {
  stop: () => void
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function webCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechInputAvailable(): boolean {
  return isNativeApp() || !!webCtor()
}

function webErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return isDesktopApp()
      ? (code === 'service-not-allowed'
        ? '语音识别服务被系统拒绝：请在「系统设置 → 隐私与安全性 → 语音识别」中允许本应用（麦克风之外还需这一项）'
        : '麦克风权限被拒绝：请在「系统设置 → 隐私与安全性 → 麦克风」中允许本应用')
      : '语音识别/麦克风权限被拒绝，请在系统设置中允许后再试'
  }
  if (code === 'network') return '语音识别需要联网，当前网络不可用'
  return '语音识别在当前环境不可用'
}

/**
 * 安卓云端听写：原生录音（capacitor-voice-recorder）→ 百炼 qwen3-asr-flash 转写。
 * 点麦克风开始录音，再点一次（或满 60 秒）停止并转写，文字一次性填入输入框。
 */
async function startNativeCloud(h: SpeechInputHandlers): Promise<SpeechInputSession | null> {
  if (!cloudAsrConfigured()) return null
  try {
    const { VoiceRecorder } = await import('capacitor-voice-recorder')
    const perm = await VoiceRecorder.requestAudioRecordingPermission().catch(() => ({ value: false }))
    if (!perm.value) {
      h.onError('麦克风权限被拒绝，请在系统设置中允许后再试')
      return null
    }
    await VoiceRecorder.startRecording()
    let stopped = false
    const finish = async () => {
      if (stopped) return
      stopped = true
      window.clearTimeout(maxTimer)
      try {
        const res = await VoiceRecorder.stopRecording()
        const b64 = res.value?.recordDataBase64
        if (!b64) { h.onError('录音失败，请重试'); h.onEnd(); return }
        h.onProcessing?.()
        const rawMime = String(res.value?.mimeType ?? '')
        const mime = /aac/i.test(rawMime) ? 'audio/mp4' : (rawMime || 'audio/mp4')
        const text = await transcribeWithDashScope(`data:${mime};base64,${b64}`)
        if (text) h.onText(text)
        else h.onError('没有识别到语音内容，请靠近麦克风再说一次')
      } catch (e) {
        h.onError(`语音转写失败：${(e as Error)?.message ?? String(e)}`)
      }
      h.onEnd()
    }
    const maxTimer = window.setTimeout(() => { void finish() }, 60_000)
    return { stop: () => { void finish() } }
  } catch {
    return null
  }
}

/** 安卓系统识别（未配置百炼 Key 时的退路）：带 6 秒无结果看门狗，避免静默假死 */
async function startNative(h: SpeechInputHandlers): Promise<SpeechInputSession | null> {
  try {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    const availRes = (await SpeechRecognition.available()) as { available: boolean } | boolean
    const isAvail = typeof availRes === 'boolean' ? availRes : availRes?.available
    if (!isAvail) return null
    const perm = await SpeechRecognition.checkPermissions()
    if (perm.speechRecognition !== 'granted') {
      const asked = await SpeechRecognition.requestPermissions()
      if (asked.speechRecognition !== 'granted') {
        h.onError('语音识别权限被拒绝，请在系统设置中允许后再试')
        return null
      }
    }
    let stopped = false
    let gotResult = false
    const listener = await SpeechRecognition.addListener('partialResults', (data: { matches: string[] }) => {
      const text = data.matches?.[0] ?? ''
      if (text) { gotResult = true; h.onText(text) }
    })
    await SpeechRecognition.start({ language: 'zh-CN', partialResults: true, popup: false })
    const watchdog = window.setTimeout(() => {
      if (stopped || gotResult) return
      stopped = true
      void listener.remove().catch(() => {})
      void SpeechRecognition.stop().catch(() => {})
      h.onError('本机语音识别服务没有响应（部分国产手机的系统识别服务不可用）。到「语音配置」填好阿里百炼 Key 后，再点麦克风会改走云端识别，就不受本机服务影响了')
      h.onEnd()
    }, 6000)
    return {
      stop: () => {
        if (stopped) return
        stopped = true
        window.clearTimeout(watchdog)
        void listener.remove().catch(() => {})
        void SpeechRecognition.stop().catch(() => {})
        h.onEnd()
      },
    }
  } catch {
    return null
  }
}

function startWeb(h: SpeechInputHandlers): SpeechInputSession | null {
  const Ctor = webCtor()
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = 'zh-CN'
  r.continuous = true
  r.interimResults = true
  let committed = ''
  let stopped = false
  let failed = false
  r.onresult = (e: any) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal) committed += res[0]?.transcript ?? ''
      else interim += res[0]?.transcript ?? ''
    }
    h.onText(committed + interim)
  }
  r.onerror = (e: any) => {
    const code = e?.error ?? 'unknown'
    if (code === 'no-speech' || code === 'aborted') return // 引擎会自行 onend，必要时自动续听
    failed = true
    h.onError(webErrorMessage(code))
  }
  r.onend = () => {
    if (stopped || failed) { h.onEnd(); return }
    // 引擎因静默自行结束：听写未被手动停止时自动续听，保持按钮状态一致
    try { r.start() } catch { h.onEnd() }
  }
  try { r.start() } catch { return null }
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      try { r.stop() } catch { /* ignore */ }
      h.onEnd()
    },
  }
}

/** 开始一次听写会话；引擎不可用时回调 onError 并返回 null */
export async function startSpeechInput(h: SpeechInputHandlers): Promise<SpeechInputSession | null> {
  if (isNativeApp()) {
    const cloud = await startNativeCloud(h)
    if (cloud) return cloud
    const s = await startNative(h)
    if (s) return s
  }
  const s = startWeb(h)
  if (s) return s
  h.onError('当前环境不支持语音输入（需要系统语音识别服务）')
  return null
}
