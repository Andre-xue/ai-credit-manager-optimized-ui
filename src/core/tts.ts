// 语音朗读核心：
// - 手机原生 App（Capacitor）：用 @capacitor-community/text-to-speech 调系统 TTS 引擎（可靠、支持中文）
// - Web / 桌面 WebView：用 Web Speech API（speechSynthesis）
// 方言音色（粤语/四川话等）需第三方 TTS，由 voice-download.ts 管理。

import { isNativeApp, isDesktopApp } from './openExternal'

export interface VoiceOption {
  uri: string
  name: string
  lang: string
  /** 归一化分组：mandarin / tw / cantonese / other */
  group: 'mandarin' | 'tw' | 'cantonese' | 'other' | 'dialect'
  /** 是否为系统内置（可直接用）；false 表示需第三方 TTS 下载 */
  system: boolean
}

const VOICE_KEY = 'acm.tts.voice'
const RATE_KEY = 'acm.tts.rate'

function groupOf(lang: string, name: string): VoiceOption['group'] {
  const l = lang.toLowerCase()
  if (l.startsWith('zh-hk') || l.startsWith('yue') || /cantonese|粤语|廣東話/i.test(name)) return 'cantonese'
  if (l === 'zh-tw' || l.startsWith('zh-hant') || /taiwan|台湾|臺灣/i.test(name)) return 'tw'
  if (l === 'zh-cn' || l === 'zh-hans' || l.startsWith('zh')) return 'mandarin'
  return 'other'
}

/** 列出系统可用音色（仅中文与常见外语，按使用频率排序） */
export function listSystemVoices(): VoiceOption[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  const raw = window.speechSynthesis.getVoices() || []
  return raw
    .filter(v => /^zh|^yue/i.test(v.lang) || /chinese|mandarin|中文|普通话/i.test(v.name))
    .sort((a, b) => {
      // 中文优先，普通话 > 台湾 > 粤语 > 其他
      const rank = (g: VoiceOption['group']) => ({ mandarin: 0, tw: 1, cantonese: 2, other: 3, dialect: 4 })[g]
      return rank(groupOf(a.lang, a.name)) - rank(groupOf(b.lang, b.name))
    })
    .map(v => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      group: groupOf(v.lang, v.name),
      system: true,
    }))
}

export interface PresetVoice {
  id: string
  name: string
  desc: string
  /** 实际映射到的系统音色 voiceURI；未找到时回退第一个中文音色 */
  uri?: string
  fallbackName: string
  /** 实际会使用的系统音色名（让界面如实显示，未匹配时标注回退） */
  matchedName?: string
  /** 是否命中了系统里真实存在的匹配音色 */
  matched: boolean
}

/** 豆包风格拟真音色预设：映射到系统已安装的中文语音包（不是云端克隆音色） */
export function listPresetVoices(): PresetVoice[] {
  const voices = listSystemVoices()
  const pick = (test: (v: VoiceOption) => boolean) => voices.find(test)
  const build = (id: string, name: string, desc: string, test: (v: VoiceOption) => boolean, fallbackName: string): PresetVoice => {
    const hit = pick(test)
    return {
      id, name, desc,
      uri: hit?.uri ?? voices[0]?.uri,
      fallbackName,
      matchedName: hit?.name ?? voices[0]?.name ?? '',
      matched: !!hit,
    }
  }
  return [
    build('warm', '暖阳', '温柔自然 · 女声', v => /female|女|xiaoxiao|huihui|tingting|meijia|tingting/i.test(v.name) && v.group === 'mandarin', '普通话女声'),
    build('clear', '清朗', '清晰干练 · 男声', v => /male|男|yunxi|kangkang|liang|yunjian/i.test(v.name) && v.group === 'mandarin', '普通话男声'),
    build('smart', '知性', '播音腔 · 女声', v => /female|女|news|播报|meijia/i.test(v.name) && v.group === 'mandarin', '普通话女声'),
    build('lively', '活力', '年轻明快 · 女声', v => /female|女|xiaoyi|xiaoxiao|tingting/i.test(v.name), '普通话女声'),
    build('steady', '沉稳', '成熟稳重 · 男声', v => /male|男|yunyang|kangkang|yunxi/i.test(v.name), '普通话男声'),
    build('bright', '元气', '明亮活泼 · 女声', v => /female|女|xiaoyi|xiaoxiao|bright|tingting/i.test(v.name), '普通话女声'),
    build('gentle', '温柔', '轻声细语 · 女声', v => /female|女|soft|gentle|柔|tingting/i.test(v.name), '普通话女声'),
    build('magnetic', '磁性', '低频质感 · 男声', v => /male|男|deep|磁|yunyang/i.test(v.name), '普通话男声'),
  ]
}

/**
 * 自动朗读专用清洗：在 cleanForSpeech 基础上再去掉所有标点/符号，只保留文字与空白，
 * 避免 TTS 把表情、标点、项目符号念出来（用户要求"只读文字信息"）。
 */
export function cleanForAutoSpeech(text: string): string {
  return cleanForSpeech(text)
    // 去掉中英文标点、数学/货币/装饰符号，替换为空格
    .replace(/[，。！？；：、,，.!?;:()（）\[\]【】{}〈〉《》"'‘’“”\-—_/\\|~·•※→←↑↓$=+*#%&@^`<>]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 音色就绪监听（部分浏览器 voices 异步加载） */
export function onVoicesReady(cb: () => void): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {}
  const already = window.speechSynthesis.getVoices().length > 0
  if (already) { cb(); return () => {} }
  window.speechSynthesis.addEventListener('voiceschanged', cb)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', cb)
}

export function getSavedVoice(): string | null {
  try { return localStorage.getItem(VOICE_KEY) } catch { return null }
}
export function saveVoice(uri: string): void {
  try { localStorage.setItem(VOICE_KEY, uri) } catch { /* 忽略 */ }
}
export function getRate(): number {
  try { const r = Number(localStorage.getItem(RATE_KEY)); return r >= 0.5 && r <= 2 ? r : 1 } catch { return 1 }
}
export function saveRate(r: number): void {
  try { localStorage.setItem(RATE_KEY, String(r)) } catch { /* 忽略 */ }
}

let ttsUnlocked = false
let nativeSpeaking = false
let audioCtx: AudioContext | null = null

/** 获取（并按需恢复）Web Audio 上下文。用 AudioContext 播放克隆音可绕开 HTMLAudio 的自动播放限制。 */
function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
  } catch { return null }
}

/** 在用户手势里调用：解锁 Web Audio，确保后续 AI 回复的克隆音能自动播放 */
export function unlockAudio(): void {
  if (isNativeApp()) return
  getAudioCtx()
}

/**
 * 朗读前清洗文本：去掉 markdown 标记、emoji、代码块等，
 * 把长段落切成带标点的短句，让 TTS（尤其 CosyVoice）读得更自然、不呆板。
 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[|>—~_]/g, ' ')
    .replace(/\*+/g, '')
    .replace(/\r/g, '')
    .replace(/\n+/g, '，')
    .replace(/，{2,}/g, '，')
    .replace(/[ \t]{2,}/g, ' ')
    // 常见缩写转成口语，避免 TTS 逐字母念出 AI 感
    .replace(/\bAPI\s*Key\b/gi, '密钥')
    .replace(/\bAPI\b/gi, '接口')
    .replace(/\bAI\b/gi, '人工智能')
    .replace(/\bApp\b/gi, '应用')
    .replace(/\bURL\b/gi, '网址')
    .replace(/\bCPU\b/gi, '处理器')
    // 兜底：去掉模型偶尔带出的固定寒暄开头，避免每次都"你好/哈哈"
    .replace(/^(?:您好|你好|嗨|哈喽|嗨喽)[，,、！!\s]*/, '')
    .replace(/^哈哈+[，,、！!\s]*/, '')
    .replace(/^(?:嗯+|好的呀?|没问题)[，,、！!\s]*/, '')
    .trim()
}

/** 手机原生平台：调用系统 TTS 引擎。返回是否成功发起（是否真正出声取决于系统语音包）。 */
async function nativeSpeak(text: string, onState?: (s: 'start' | 'end' | 'error') => void): Promise<boolean> {
  try {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech')
    await TextToSpeech.stop()
    nativeSpeaking = true
    onState?.('start')
    // lang 用中文；rate 取自用户设置。原生插件在朗读完成后 resolve。
    await TextToSpeech.speak({ text, lang: 'zh-CN', rate: getRate(), volume: 1 })
    nativeSpeaking = false
    onState?.('end')
    return true
  } catch {
    nativeSpeaking = false
    onState?.('error')
    return false
  }
}

/**
 * 在用户手势（点麦克风/发送）中预热系统 TTS。
 * Android WebView 常要求先有用户手势才允许后续 speechSynthesis 发声。
 */
export function unlockTts(): void {
  if (ttsUnlocked || typeof window === 'undefined') return
  // 原生平台走系统 TTS，无需 WebView 的手势解锁
  if (isNativeApp()) { ttsUnlocked = true; return }
  // 解锁 Web Audio：克隆音用 AudioContext 播放，必须在用户手势里先 resume
  getAudioCtx()
  if (!('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.lang = 'zh-CN'
    window.speechSynthesis.speak(u)
    ttsUnlocked = true
  } catch { /* 忽略：部分 WebView 不支持朗读空文本 */ }
}

import { getTtsConfig } from './voice-download'
import { getClonedVoiceId, listClonedVoices, ensureWavDataUrl } from './voiceClone'
import { isDirectMode, ttsSynthesizeDirect, voicestudioSynthesize } from './ttsDirect'
import { getSpeakPref, getEdgeVoiceId, synthesizeEdgeMp3 } from './edgeTts'
import { isQwenVoiceId, loadQwenVoiceRef, qwenTtsSynthesize, qwenTtsStatus, qwenTtsCancelSynthesize, isQwenServiceOffError, QWEN_SYNTH_CANCELLED, friendlyQwenError } from './qwenTts'

/** 是否使用本机 VoiceStudio 作为语音服务 */
function isVoiceStudio(cfg: ReturnType<typeof getTtsConfig>): boolean {
  return cfg.provider === 'voicestudio'
}

let activeCallback: ((state: 'start' | 'end' | 'error') => void) | null = null

/** 当前 AI 朗读会走哪种音色：clone=克隆音色，system=系统音色。界面标识与 speakAsync 行为共用此判断。 */
export function getSpeakSource(): 'clone' | 'system' | 'edge' {
  if (getSpeakPref() === 'edge') return 'edge'
  const cfg = getTtsConfig()
  const active = getClonedVoiceId()
  // 本地 Qwen 音色：无需第三方配置，服务在跑即可用
  if (active && isQwenVoiceId(active)) return 'clone'
  return active && (isDirectMode(cfg) || isVoiceStudio(cfg) || !!cfg.endpoint) ? 'clone' : 'system'
}

export function isSpeaking(): boolean {
  if (isNativeApp()) return nativeSpeaking
  return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking
}

/** 朗读文本。onState 回调播放开始/结束/错误。 */
export function speak(text: string, voiceURI: string | null, onState?: (s: 'start' | 'end' | 'error') => void): boolean {
  if (isNativeApp()) {
    // 原生系统 TTS：异步发起，立即返回 true；状态通过回调传递
    void nativeSpeak(text, onState)
    return true
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  const synth = window.speechSynthesis
  synth.cancel()
  activeCallback = onState ?? null

  const u = new SpeechSynthesisUtterance(cleanForSpeech(text))
  const voices = synth.getVoices()
  const picked = voiceURI ? voices.find(v => v.voiceURI === voiceURI) : undefined
  // 未指定或找不到时优先中文音色
  const fallback = voices.find(v => /^zh|^yue/i.test(v.lang)) ?? voices[0]
  if (picked || fallback) u.voice = (picked ?? fallback)!
  u.lang = (picked ?? fallback)?.lang ?? 'zh-CN'
  u.rate = getRate()
  u.onstart = () => activeCallback?.('start')
  u.onend = () => { activeCallback?.('end'); activeCallback = null }
  u.onerror = () => { activeCallback?.('error'); activeCallback = null }
  synth.speak(u)
  return true
}

async function playMp3Buffer(arrayBuf: ArrayBuffer, onState?: (s: 'start' | 'end' | 'error') => void): Promise<void> {
  const ctx = getAudioCtx()
  if (!ctx) throw new Error('当前环境不支持音频解码')
  const decoded = await ctx.decodeAudioData(arrayBuf)
  try { (window as any).__acmCloneSrc?.stop() } catch { /* ignore */ }
  const src = ctx.createBufferSource()
  src.buffer = decoded
  src.connect(ctx.destination)
  ;(window as any).__acmCloneSrc = src
  activeCallback = onState ?? null
  let ended = false
  src.onended = () => {
    if (ended) return
    ended = true
    activeCallback?.('end'); activeCallback = null
    if ((window as any).__acmCloneSrc === src) (window as any).__acmCloneSrc = null
  }
  src.start()
  activeCallback?.('start')
}

/** 供测试与 UI 复用：根据指定的 voiceURI 与克隆音色列表，解析本次朗读要用的克隆音色 ID。 */
export function resolveCloneVoiceId(
  voiceURI: string | null,
  clonedVoices: { id: string; voiceId: string }[],
  globalCloneId: string | null,
): string | null {
  if (voiceURI) {
    const hit = clonedVoices.find(v => v.voiceId === voiceURI || v.id === voiceURI)
    if (hit) return hit.voiceId
  }
  return globalCloneId
}

/** 播放一段已合成好的音频 data URI（克隆成功后直接播试听音频，不再重新合成）。 */
export async function playAudioDataUrl(dataUrl: string, onState?: (s: 'start' | 'end' | 'error') => void): Promise<void> {
  const b64 = dataUrl.split(',')[1] ?? ''
  if (!b64) throw new Error('合成音频为空')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  await playMp3Buffer(bytes.buffer, onState)
}

/**
 * 异步朗读：若已克隆声音且配置了第三方代理，优先走代理合成；失败回退系统 TTS。
 * 克隆声音只有代理端实现 /synthesize 后才会真正生效，系统音色不应伪装成克隆效果。
 */
export interface SpeakOptions {
  /** Qwen 合成进行中回调：每秒上报已等待秒数（界面据此显示「合成中…已等待 X 秒」） */
  onSynthProgress?: (elapsedS: number) => void
  /** 取消令牌：调用方把 cancelled 置 true 后，本次 Qwen 合成会被中断（桌面端 Rust 侧丢弃请求） */
  cancelToken?: { cancelled: boolean }
  /** 本次需要 Qwen 服务、但服务没在跑时调用（不再悄悄回落系统音色）；收到提示文本 */
  onQwenServiceOff?: (message: string) => void
}

export async function speakAsync(
  text: string,
  voiceURI: string | null,
  onState?: (s: 'start' | 'end' | 'error') => void,
  onFallback?: (reason: string) => void,
  opts?: SpeakOptions,
): Promise<boolean> {
  // Edge 免费音色优先：用户在语音配置里选了 Edge 音色时，全局朗读走微软云端合成
  if (getSpeakPref() === 'edge') {
    try {
      stopSpeak()
      const speakText = cleanForSpeech(text)
      if (!speakText) throw new Error('朗读内容为空')
      const buf = await synthesizeEdgeMp3(speakText, getEdgeVoiceId())
      await playMp3Buffer(buf, onState)
      return true
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      onFallback?.(`Edge 免费音色播放失败（${msg.slice(0, 60)}），已临时改用系统音色`)
    }
    return speak(text, voiceURI, onState)
  }
  // 判断本次朗读要用哪个克隆音色：
  // 1) 若 voiceURI 命中用户保存的某个克隆音色 → 用它（AI 助手"说话音色"可独立指定）
  // 2) 否则若全局音源是 clone → 用全局激活的克隆音色
  const clonedVoices = listClonedVoices()
  const cloned = resolveCloneVoiceId(
    voiceURI, clonedVoices, getSpeakSource() === 'clone' ? getClonedVoiceId() : null,
  )
  // Qwen3-TTS 本地克隆音色：参考音频存本机，每次合成随请求带上；无需第三方配置。
  // v0.1.428：服务没开时不再悄悄回落系统音色——先查状态，没开就明确告知并交给
  // 调用方处理（语音页给一键开启入口）；合成进行中有进度回调、可取消。
  if (cloned && isQwenVoiceId(cloned)) {
    const serviceOffMessage = isDesktopApp()
      ? 'Qwen3-TTS 服务没开：请先在语音配置页打开 Qwen3-TTS 服务开关'
      : 'Qwen3-TTS 本地服务仅桌面端支持，手机上无法使用克隆音色朗读'
    const reportServiceOff = () => {
      if (opts?.onQwenServiceOff) opts.onQwenServiceOff(serviceOffMessage)
      else onFallback?.(serviceOffMessage)
    }
    // 先查状态：服务没在跑就直接告知，不调合成、不播系统音色
    const st = await qwenTtsStatus().catch(() => null)
    if (!st?.running) {
      reportServiceOff()
      return false
    }
    const t0 = Date.now()
    const progressTimer = (opts?.onSynthProgress || opts?.cancelToken)
      ? setInterval(() => { opts?.onSynthProgress?.(Math.floor((Date.now() - t0) / 1000)) }, 1000)
      : null
    if (progressTimer) opts?.onSynthProgress?.(0)
    let cancelWatcher: ReturnType<typeof setInterval> | null = null
    const cancelPromise = opts?.cancelToken ? new Promise<never>((_, reject) => {
      cancelWatcher = setInterval(() => {
        if (opts.cancelToken?.cancelled) {
          if (cancelWatcher) clearInterval(cancelWatcher)
          void qwenTtsCancelSynthesize()
          reject(new Error(QWEN_SYNTH_CANCELLED))
        }
      }, 200)
    }) : null
    try {
      stopSpeak()
      const speakText = cleanForSpeech(text)
      if (!speakText) throw new Error('朗读内容为空')
      const ref = await loadQwenVoiceRef(cloned)
      if (!ref) throw new Error('找不到该音色的参考音频，请在语音配置里重新克隆')
      // v0.1.414：400 版存的参考音频可能是 MP3/M4A 原样，服务端只认 WAV 且本机
      // 没装 ffmpeg 会报 400；朗读前同样在浏览器内转成 WAV 再传。
      const wav = await ensureWavDataUrl(ref.dataUrl)
      if (!wav.ok) throw new Error(wav.error)
      const dataUri = cancelPromise
        ? await Promise.race([qwenTtsSynthesize(wav.dataUrl, ref.refText, speakText), cancelPromise])
        : await qwenTtsSynthesize(wav.dataUrl, ref.refText, speakText)
      const b64 = dataUri.split(',')[1] ?? ''
      if (!b64) throw new Error('合成音频为空')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      await playMp3Buffer(bytes.buffer, onState)
      return true
    } catch (e) {
      const raw = (e as Error)?.message ?? String(e)
      // 用户主动取消：静默结束，不弹回落提示、不播系统音色
      if (raw === QWEN_SYNTH_CANCELLED) return false
      // 合成中途服务挂了：按服务没开处理，同样不回落系统音色
      if (isQwenServiceOffError(raw)) {
        reportServiceOff()
        return false
      }
      const lastErr = friendlyQwenError(raw)
      onFallback?.(`Qwen3-TTS 本地克隆音色播放失败（${lastErr.slice(0, 60)}），已临时改用系统音色`)
      return speak(text, voiceURI, onState)
    } finally {
      if (progressTimer) clearInterval(progressTimer)
      if (cancelWatcher) clearInterval(cancelWatcher)
    }
  }
  const cfg = getTtsConfig()
  const direct = isDirectMode(cfg)
  const voiceStudio = isVoiceStudio(cfg)
  if (cloned && (direct || voiceStudio || cfg.endpoint)) {
    let lastErr = ''
    try {
      stopSpeak()
      const speakText = cleanForSpeech(text)
      if (!speakText) throw new Error('朗读内容为空')
      let arrayBuf: ArrayBuffer
      if (voiceStudio) {
        // VoiceStudio：Rust 后端直连本机 :3900 返回音频 data URI
        const dataUri = await voicestudioSynthesize(cfg, cloned, speakText)
        const b64 = dataUri.split(',')[1] ?? ''
        if (!b64) throw new Error('VoiceStudio 合成音频为空')
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        arrayBuf = bytes.buffer
      } else if (direct) {
        // 直连模式：Rust 后端调官方 API 返回音频 data URI
        const dataUri = await ttsSynthesizeDirect(cfg, cloned, speakText)
        const b64 = dataUri.split(',')[1] ?? ''
        if (!b64) throw new Error('合成音频为空')
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        arrayBuf = bytes.buffer
      } else {
        const url = `${cfg.endpoint.replace(/\/$/, '')}/synthesize?provider=${encodeURIComponent(cfg.provider)}&voice=${encodeURIComponent(cloned)}&text=${encodeURIComponent(speakText)}`
        const res = await fetch(url)
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status} ${detail.slice(0, 80)}`)
        }
        const blob = await res.blob()
        if (!blob.size) throw new Error('合成音频为空')
        arrayBuf = await blob.arrayBuffer()
      }
      const ctx = getAudioCtx()
      if (!ctx) throw new Error('当前环境不支持音频解码')
      const decoded = await ctx.decodeAudioData(arrayBuf)
      // 先停掉上一段，避免多段重叠导致"一个字一个字蹦"
      try { (window as any).__acmCloneSrc?.stop() } catch { /* ignore */ }
      const src = ctx.createBufferSource()
      src.buffer = decoded
      src.connect(ctx.destination)
      ;(window as any).__acmCloneSrc = src
      activeCallback = onState ?? null
      let ended = false
      src.onended = () => {
        if (ended) return
        ended = true
        activeCallback?.('end'); activeCallback = null
        if ((window as any).__acmCloneSrc === src) (window as any).__acmCloneSrc = null
      }
      src.start()
      activeCallback?.('start')
      return true
    } catch (e) {
      lastErr = (e as Error)?.message ?? String(e)
      // 克隆音色合成/播放失败：明确告知，不再静默回退，避免误以为克隆没生效
      onFallback?.(`克隆音色播放失败（${lastErr.slice(0, 60)}），已临时改用系统音色`)
    }
  }
  return speak(text, voiceURI, onState)
}

export function stopSpeak(): void {
  activeCallback = null
  // 停止正在播放的克隆音（AudioContext），避免与新朗读重叠
  if (typeof window !== 'undefined') {
    try { (window as unknown as { __acmCloneSrc?: { stop?: () => void } }).__acmCloneSrc?.stop?.() } catch { /* ignore */ }
    try { if ((window as unknown as { __acmCloneSrc?: unknown }).__acmCloneSrc) (window as unknown as { __acmCloneSrc?: unknown }).__acmCloneSrc = null } catch { /* ignore */ }
  }
  if (isNativeApp()) {
    nativeSpeaking = false
    void import('@capacitor-community/text-to-speech').then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => {})
    return
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
}

export function pauseSpeak(): void {
  if (isNativeApp()) { void import('@capacitor-community/text-to-speech').then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => {}); return }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.pause()
}
export function resumeSpeak(): void {
  // 原生 TTS 无暂停/续播，忽略（继续保持当前行为）
  if (isNativeApp()) return
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.resume()
}

/** 试听一句示例 */
export function previewVoice(voiceURI: string | null): boolean {
  return speak('你好，我是 AI 魔方的语音助手，很高兴为你服务。', voiceURI)
}
