// 声音克隆样本管理：录音或音频文件 → 本地 IndexedDB 保存 → 通过第三方 TTS 代理 /clone 克隆，
// 或 Qwen3-TTS 本地服务（桌面端本机 :18123）克隆。
// 当前内置免费云模型不提供声音克隆能力，因此克隆必须依赖用户在「第三方语音服务配置」里提供的代理端点，
// 或已安装的 Qwen3-TTS 本地服务。
// 支持保存多个克隆音色，可命名、切换、删除；每个音色在本机独立记录其云端 voiceId。
// Qwen 音色无云端 ID：voiceId 为 qwen-local: 前缀，参考音频存在本机 IndexedDB，合成时随请求带上。

import { getTtsConfig } from './voice-download'
import { isDirectMode, ttsCloneDirect, voicestudioClone } from './ttsDirect'
import { isNativeApp } from './openExternal'
import { qwenTtsSynthesize, saveQwenVoice, describeQwenCloneFailure } from './qwenTts'

const DB_NAME = 'acm-voice-sample-db'
const STORE = 'samples'
const SLOT_KEY = 'active-sample'
const CLONED_VOICE_KEY = 'acm.tts.clonedVoice'       // 当前激活的 voiceId（兼容旧版）
const CLONED_VOICES_KEY = 'acm.tts.clonedVoices.v2'  // 多音色列表

export interface VoiceSample {
  name: string
  mime: string
  dataUrl: string
  size: number
  createdAt: number
}

/** 一个已保存的克隆音色 */
export interface ClonedVoice {
  id: string
  /** 用户可见的名字 */
  name: string
  /** 云端真实的音色 ID（用于 /synthesize） */
  voiceId: string
  /** 克隆来源样本名 */
  sampleName?: string
  createdAt: number
}

export interface CloneResult {
  ok: boolean
  voiceId?: string
  error?: string
  /** Qwen 克隆试合成返回的音频（v0.1.428：克隆成功后直接播放，不再丢弃） */
  audioDataUrl?: string
}

/**
 * 克隆进度阶段（v0.1.415，Qwen 本地克隆专用）：转换参考音频 → 服务端合成 → 保存音色。
 * 阶段按真实执行顺序回调，调用方据此分阶段显示进度 + 已等待时间；合成是一次阻塞请求，
 * 阶段内不假造百分比。'done' 由调用方在成功后自行置位。
 */
export type CloneStage = 'convert' | 'synthesize' | 'save' | 'done'
export type CloneProgressCallback = (stage: CloneStage) => void

/** 读取已保存的克隆音色列表（含旧版单音色迁移） */
export function listClonedVoices(): ClonedVoice[] {
  try {
    const raw = localStorage.getItem(CLONED_VOICES_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter(v => v && v.voiceId)
    }
  } catch { /* 忽略 */ }
  // 兼容旧版：只有一个 voiceId 时迁移进来
  const legacy = getClonedVoiceId()
  if (legacy) {
    const item: ClonedVoice = { id: 'cv-legacy', name: '克隆音色', voiceId: legacy, createdAt: Date.now() }
    try { localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify([item])) } catch { /* 忽略 */ }
    return [item]
  }
  return []
}

function saveClonedVoices(list: ClonedVoice[]): void {
  try { localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify(list)) } catch { /* 忽略 */ }
}

/** 新增一个克隆音色并设为当前使用 */
export function addClonedVoice(name: string, voiceId: string, sampleName?: string): ClonedVoice {
  const list = listClonedVoices()
  const item: ClonedVoice = {
    id: `cv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || '克隆音色', voiceId, sampleName, createdAt: Date.now(),
  }
  saveClonedVoices([item, ...list])
  setActiveClonedVoice(item.voiceId)
  return item
}

/** 删除一个克隆音色（不删除云端音色，仅移除本机记录） */
export function removeClonedVoice(id: string): void {
  const list = listClonedVoices().filter(v => v.id !== id)
  saveClonedVoices(list)
  const active = getClonedVoiceId()
  const activeItem = list.find(v => v.voiceId === active)
  if (!activeItem) {
    // 当前激活的被删了，切到第一个或清空
    if (list.length) setActiveClonedVoice(list[0].voiceId)
    else clearClonedVoice()
  }
}

/** 切换当前使用的克隆音色 */
export function setActiveClonedVoice(voiceId: string): void {
  try { localStorage.setItem(CLONED_VOICE_KEY, voiceId) } catch { /* 忽略 */ }
}

/** 重命名一个克隆音色 */
export function renameClonedVoice(id: string, name: string): void {
  const list = listClonedVoices().map(v => v.id === id ? { ...v, name: name.trim() || v.name } : v)
  saveClonedVoices(list)
}

// 复用单个 IndexedDB 连接，避免每次操作 open 新连接造成资源累积（内存泄漏）
let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
    req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB 被其他标签页占用')) }
  })
  return dbPromise
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

/** 保存音频样本（单槽位，新样本自动替换旧样本） */
export async function saveVoiceSample(blob: Blob, name: string): Promise<VoiceSample> {
  const sample: VoiceSample = {
    name, mime: blob.type || 'audio/webm', dataUrl: await toDataUrl(blob),
    size: blob.size, createdAt: Date.now(),
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(sample, SLOT_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return sample
}

export async function loadVoiceSample(): Promise<VoiceSample | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(SLOT_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

export async function deleteVoiceSample(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(SLOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* 忽略 */ }
  // 只删除临时样本，不动已保存的克隆音色列表
}

/** 把任意浏览器可解码的音频 Blob 转成 16-bit PCM WAV（百炼稳定支持）。失败则返回 null 由调用方兜底。 */
export async function blobToWav(blob: Blob): Promise<Blob | null> {
  let ctx: AudioContext | null = null
  let off: OfflineAudioContext | null = null
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return null
    ctx = new Ctx()
    const buf = await blob.arrayBuffer()
    const decoded = await ctx.decodeAudioData(buf)
    // 单声道、16kHz 即可满足百炼 ≥16kHz 要求，体积更小
    const targetRate = 16000
    const ch = 1
    const len = Math.floor(decoded.duration * targetRate)
    // 用 OfflineAudioContext 重采样到 16k 单声道
    off = new OfflineAudioContext(ch, len, targetRate)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start(0)
    const rendered = await off.startRendering()
    return encodePcm16Wav([rendered.getChannelData(0)], targetRate)
  } catch { return null }
  finally {
    // 释放 AudioContext，避免反复转换后累积（浏览器有同时存活数量上限）。
    // OfflineAudioContext 渲染完即被回收，无需也无法在此 TS 版本下显式 close。
    try { void ctx?.close() } catch { /* ignore */ }
    off = null
  }
}

/** 多声道 Float32 音频帧 → 16-bit PCM WAV（交错声道，原采样率，原声道数，至多 2 声道）。 */
export function encodePcm16Wav(channels: Float32Array[], sampleRate: number): Blob {
  const ch = Math.max(1, Math.min(2, channels.length))
  const len = channels[0]?.length ?? 0
  const pcm = new Int16Array(len * ch)
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0))
      pcm[i * ch + c] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  const header = new ArrayBuffer(44)
  const dv = new DataView(header)
  const w = (o: number, str: string) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)) }
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE')
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true)
  dv.setUint16(22, ch, true); dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true)
  w(36, 'data'); dv.setUint32(40, pcm.byteLength, true)
  return new Blob([header, pcm], { type: 'audio/wav' })
}

/**
 * 把任意浏览器可解码的音频 Blob 转成 16-bit PCM WAV，但保留原采样率与声道数
 * （不像 blobToWav 那样重采样到 16k 单声道）。Qwen3-TTS 本地克隆专用：
 * 服务端只认 WAV 容器，采样率/声道由它自己处理，本地不降质。
 */
export async function blobToWavNative(blob: Blob): Promise<Blob | null> {
  let ctx: AudioContext | null = null
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return null
    ctx = new Ctx()
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    if (!decoded || !decoded.numberOfChannels || !decoded.sampleRate) return null
    const channels: Float32Array[] = []
    const n = Math.min(2, decoded.numberOfChannels)
    for (let c = 0; c < n; c++) channels.push(decoded.getChannelData(c))
    return encodePcm16Wav(channels, decoded.sampleRate)
  } catch { return null }
  finally {
    try { void ctx?.close() } catch { /* ignore */ }
  }
}

/** data URL 的 MIME 是否为 WAV（再验 RIFF 头，防止 mime 与内容不符的假 WAV）。 */
export function isWavDataUrl(dataUrl: string): boolean {
  const m = /^data:([^;,]+)?(;base64)?,/i.exec(dataUrl)
  const mime = (m?.[1] || '').toLowerCase()
  if (mime !== 'audio/wav' && mime !== 'audio/x-wav' && mime !== 'audio/wave') return false
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  try {
    return atob(b64.slice(0, 8)).slice(0, 4) === 'RIFF'
  } catch { return false }
}

/** base64 data URL → Blob（仅支持 App 内 FileReader 产出的 base64 形式）。 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' })
  } catch { return null }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

export type WavDataUrlResult =
  | { ok: true; dataUrl: string; converted: boolean }
  | { ok: false; error: string }

/**
 * Qwen3-TTS 参考音频归一化：保证交给服务端的一定是 WAV（v0.1.414）。
 * 旧版把 MP3/M4A 原样传给本机 mlx-tts-server，服务端要拿 ffmpeg 转格式，
 * 而 Ethan 的 Mac 没装 ffmpeg → HTTP 400（2026-11-24 实机）。现在浏览器内
 * 先转成 WAV 再上传，全程本地、不依赖本机 ffmpeg；已是 WAV 的直接放行；
 * 浏览器解不开的格式在这里就明确报错，不等合成失败才报英文原错。
 */
export async function ensureWavDataUrl(dataUrl: string): Promise<WavDataUrlResult> {
  if (isWavDataUrl(dataUrl)) return { ok: true, dataUrl, converted: false }
  const blob = dataUrlToBlob(dataUrl)
  if (!blob) return { ok: false, error: '该音频无法转换为 WAV：音频数据损坏或格式未知，请导入 WAV / MP3 / M4A 音频文件' }
  const wav = await blobToWavNative(blob)
  if (!wav) return { ok: false, error: '该音频无法转换为 WAV：浏览器解不开此格式，请导入 WAV / MP3 / M4A 音频文件' }
  return { ok: true, dataUrl: await blobToDataUrl(wav), converted: true }
}

/** 参考音频最长保留秒数（v0.1.428）：过长的参考音频会让服务端合成卡住，导入时只取前 15 秒。 */
export const MAX_REF_AUDIO_SECONDS = 15

export interface TrimAudioResult {
  /** 最终样本（未超长时即原 blob；超长时为截取后重编码的 WAV） */
  blob: Blob
  /** 是否被截取过 */
  trimmed: boolean
  /** 原音频时长（秒；解不开时为 0） */
  originalDurationS: number
  /** 最终音频时长（秒；解不开时为 0） */
  durationS: number
}

/** 用 <audio> 只读元数据探时长（不解码，毫秒级）；探不到返回 null（由调用方走解码确认）。 */
async function probeAudioDurationS(blob: Blob): Promise<number | null> {
  if (typeof Audio === 'undefined') return null
  return new Promise((resolve) => {
    let url = ''
    try {
      url = URL.createObjectURL(blob)
      const audio = new Audio()
      const done = (v: number | null) => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } resolve(v) }
      const timer = setTimeout(() => done(null), 5000)
      audio.onloadedmetadata = () => { clearTimeout(timer); done(Number.isFinite(audio.duration) ? audio.duration : null) }
      audio.onerror = () => { clearTimeout(timer); done(null) }
      audio.preload = 'metadata'
      audio.src = url
    } catch {
      try { if (url) URL.revokeObjectURL(url) } catch { /* ignore */ }
      resolve(null)
    }
  })
}

/**
 * 导入参考音频时限制时长：解码后若超过 maxSeconds，只取前 maxSeconds 重编码为 WAV。
 * 先探元数据时长：没超长直接返回原 blob（不解码）；超长或探不到时才解码确认/截取。
 * 解不开的格式返回原 blob（不阻断导入，下游 ensureWavDataUrl 会明确报错）；
 * 浏览器无 AudioContext 时同样返回原 blob。
 */
export async function trimAudioBlob(blob: Blob, maxSeconds: number = MAX_REF_AUDIO_SECONDS): Promise<TrimAudioResult> {
  const probed = await probeAudioDurationS(blob)
  if (probed !== null && probed <= maxSeconds) return { blob, trimmed: false, originalDurationS: probed, durationS: probed }
  let ctx: AudioContext | null = null
  try {
    const Ctx = (typeof window !== 'undefined' && (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) || null
    if (!Ctx) return { blob, trimmed: false, originalDurationS: probed ?? 0, durationS: probed ?? 0 }
    ctx = new Ctx()
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    if (!decoded || !decoded.duration) return { blob, trimmed: false, originalDurationS: probed ?? 0, durationS: probed ?? 0 }
    const originalDurationS = decoded.duration
    if (originalDurationS <= maxSeconds) return { blob, trimmed: false, originalDurationS, durationS: originalDurationS }
    const keep = Math.floor(maxSeconds * decoded.sampleRate)
    const channels: Float32Array[] = []
    const n = Math.min(2, decoded.numberOfChannels)
    for (let c = 0; c < n; c++) channels.push(decoded.getChannelData(c).slice(0, keep))
    return { blob: encodePcm16Wav(channels, decoded.sampleRate), trimmed: true, originalDurationS, durationS: maxSeconds }
  } catch {
    return { blob, trimmed: false, originalDurationS: probed ?? 0, durationS: probed ?? 0 }
  } finally {
    try { void ctx?.close() } catch { /* ignore */ }
  }
}

/** 挑选 MediaRecorder 支持的音频 MIME。
 *  安卓 WebView 通常只支持 webm/opus 或 mp4；优先 mp4（下游兼容性好），再 wav/webm。 */
export function pickRecordMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/mp4',
    'audio/wav',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m } catch { /* ignore */ }
  }
  return undefined
}

/**
 * 手机原生录音：走 capacitor-voice-recorder 原生层录制并由插件自己申请录音权限。
 * 不用 WebView 的 getUserMedia——部分国产 ROM（如 vivo）上系统权限明明已允许，
 * WebView 仍报 NotAllowedError（实测 2026-11-20），原生层没有这个问题。
 * 插件在安卓产出 AAC/MPEG-4 容器，类型标为 audio/mp4（即 M4A，百炼可接受）。
 */
async function recordVoiceSampleNative(seconds: number): Promise<Blob> {
  const { VoiceRecorder } = await import('capacitor-voice-recorder')
  const perm = await VoiceRecorder.requestAudioRecordingPermission().catch(() => ({ value: false }))
  if (!perm.value) throw new Error('麦克风权限被拒绝，请在系统设置中允许录音后重试')
  const can = await VoiceRecorder.canDeviceVoiceRecord().catch(() => ({ value: true }))
  if (!can.value) throw new Error('当前设备不支持录音，请选择音频文件导入')
  await VoiceRecorder.startRecording()
  await new Promise(r => setTimeout(r, seconds * 1000))
  const res = await VoiceRecorder.stopRecording()
  const b64 = res.value?.recordDataBase64
  if (!b64) throw new Error('录音失败，未取得音频数据')
  const mime = String(res.value?.mimeType ?? '')
  const type = /aac/i.test(mime) ? 'audio/mp4' : (mime || 'audio/mp4')
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return new Blob([bytes], { type })
}

/** 录音：桌面/Web 用 WebView 的 getUserMedia；手机原生走插件（见上方说明）。
 *  百炼只接受 WAV/MP3/M4A 且 ≥16kHz，AMR/3gpp 会被拒，因此这里显式挑选安全格式。 */
export function recordVoiceSample(seconds = 12): Promise<Blob> {
  if (isNativeApp()) return recordVoiceSampleNative(seconds)
  return new Promise(async (resolve, reject) => {
    const md = navigator.mediaDevices as MediaDevices | undefined
    if (!md?.getUserMedia || typeof MediaRecorder === 'undefined') {
      reject(new Error('当前环境不支持录音，请选择音频文件导入'))
      return
    }
    let stream: MediaStream
    try {
      stream = await md.getUserMedia({ audio: { channelCount: 1, sampleRate: 24000 } })
    } catch {
      try { stream = await md.getUserMedia({ audio: true }) }
      catch { reject(new Error('麦克风权限被拒绝，请授权后再录音')); return }
    }
    const mime = pickRecordMime()
    // amr/3gpp 浏览器通常也无法 decode，宁可拒绝也不要产出错样本
    if (!mime || /amr|3gpp/i.test(mime)) {
      stream.getTracks().forEach(t => t.stop())
      reject(new Error('当前设备录音格式不受支持，请改从「选择音频文件」导入 WAV/MP3/M4A'))
      return
    }
    const chunks: BlobPart[] = []
    let rec: MediaRecorder
    try { rec = new MediaRecorder(stream, { mimeType: mime }) }
    catch { rec = new MediaRecorder(stream) }
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType || mime })) }
    rec.onerror = () => { stream.getTracks().forEach(t => t.stop()); reject(new Error('录音失败')) }
    rec.start()
    window.setTimeout(() => { if (rec.state !== 'inactive') rec.stop() }, seconds * 1000)
  })
}

/** 调用第三方代理克隆声音；代理需实现 POST {endpoint}/clone，返回 { voiceId } */
/** 把云端/网络错误翻译成用户能看懂的中文，并给出可操作指引 */
export function friendlyCloneError(raw: string): string {
  if (/in debt|arrears|欠费|insufficient balance|balance.*low/i.test(raw)) {
    return '你的阿里云账号已欠费或余额不足，百炼拒绝创建音色。请到阿里云「费用中心」充值（充 1~2 元即可），或确认免费额度是否过期，然后重试。'
  }
  if (/quota|额度|exceed|limit|too many|音色.*上限/i.test(raw)) {
    return '音色数量或调用额度已达上限。请到百炼控制台删除不用的音色释放配额，或检查免费额度是否已用完。'
  }
  if (/invalidapikey|unauthorized|401|forbidden.*key|鉴权|api.?key/i.test(raw)) {
    return '语音服务的 API Key 无效或过期。请检查云函数环境变量 DASHSCOPE_API_KEY 是否填了完整正确的 Key。'
  }
  if (/format|unsupported|codec|invalid.*audio|不支持.*格式/i.test(raw)) {
    return '音频格式不被语音服务接受。请重新录一段 12 秒清晰人声，或导入 WAV / MP3 / M4A 文件。'
  }
  if (/load failed|failed to fetch|networkerror|timeout/i.test(raw)) {
    return '无法连接语音服务：请确认云函数已部署、端点地址正确，且网络正常。'
  }
  return raw.length > 160 ? raw.slice(0, 160) + '…' : raw
}

export async function cloneVoiceFromSample(sample: VoiceSample, name?: string, refText?: string, onProgress?: CloneProgressCallback): Promise<CloneResult> {
  const cfg = getTtsConfig()
  if (!cfg.provider) {
    return { ok: false, error: '请先在下方配置第三方语音服务' }
  }
  // Qwen3-TTS 本地克隆：桌面端直连本机 :18123，无需官方 Key；先用样本试合成一句验证链路，
  // 成功后再保存音色（参考音频存本机 IndexedDB）。参考音频原文可空，写上效果更好。
  // v0.1.414：服务端只认 WAV，先在浏览器内把样本转成 WAV 再上传（不依赖本机 ffmpeg）；
  // 存进 IndexedDB 的也是转好的 WAV，下次朗读直接用，不用再转。
  // v0.1.415：Qwen 分支按真实阶段回调 onProgress（转换 → 合成 → 保存），调用方据此
  // 分阶段显示进度 + 已等待时间；合成是一次阻塞请求，阶段内不假造百分比。
  if (cfg.provider === 'qwentts') {
    try {
      onProgress?.('convert')
      const wav = await ensureWavDataUrl(sample.dataUrl)
      if (!wav.ok) return { ok: false, error: wav.error }
      onProgress?.('synthesize')
      // 试合成的音频留下来（v0.1.428）：克隆成功后直接播放它，不再重新合成一次
      const previewAudio = await qwenTtsSynthesize(wav.dataUrl, refText ?? '', '你好，这是克隆音色的试听。')
      onProgress?.('save')
      const voice = await saveQwenVoice(name || sample.name.replace(/\.[^.]+$/, ''), wav.dataUrl, refText ?? '', sample.name)
      return { ok: true, voiceId: voice.voiceId, audioDataUrl: previewAudio }
    } catch (e) {
      const msg = `Qwen3-TTS 本地克隆失败：${describeQwenCloneFailure((e as Error)?.message ?? String(e))}`
      return { ok: false, error: msg.length > 200 ? msg.slice(0, 200) + '…' : msg }
    }
  }
  // VoiceStudio：桌面端直连本机 :3900，无需官方 Key
  if (cfg.provider === 'voicestudio') {
    try {
      const voiceId = await voicestudioClone(cfg, name || sample.name, sample.dataUrl)
      if (!voiceId) return { ok: false, error: 'VoiceStudio 未返回音色 ID' }
      addClonedVoice(name || sample.name.replace(/\.[^.]+$/, ''), voiceId, sample.name)
      return { ok: true, voiceId }
    } catch (e) {
      return { ok: false, error: friendlyCloneError(`VoiceStudio 克隆失败：${(e as Error)?.message ?? String(e)}`) }
    }
  }
  // 直连模式：桌面端调 Rust 后端直连官方 API，无需自建代理
  if (isDirectMode(cfg)) {
    try {
      const voiceId = await ttsCloneDirect(cfg, name || sample.name, sample.mime, sample.dataUrl)
      if (!voiceId) return { ok: false, error: '服务未返回 voiceId' }
      addClonedVoice(name || sample.name.replace(/\.[^.]+$/, ''), voiceId, sample.name)
      return { ok: true, voiceId }
    } catch (e) {
      return { ok: false, error: friendlyCloneError(`克隆失败：${(e as Error)?.message ?? String(e)}`) }
    }
  }
  if (!cfg.endpoint) {
    return { ok: false, error: '请先在下方配置第三方语音服务端点' }
  }
  try {
    const res = await fetch(`${cfg.endpoint.replace(/\/$/, '')}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: cfg.provider,
        name: name || sample.name,
        mime: sample.mime,
        audio: sample.dataUrl,
      }),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: friendlyCloneError(`克隆失败（HTTP ${res.status}）：${text.slice(0, 200)}`) }
    let voiceId = ''
    try { voiceId = JSON.parse(text)?.voiceId ?? '' } catch { voiceId = text.trim() }
    if (!voiceId) return { ok: false, error: friendlyCloneError('服务未返回 voiceId：' + text.slice(0, 200)) }
    addClonedVoice(name || sample.name.replace(/\.[^.]+$/, ''), voiceId, sample.name)
    return { ok: true, voiceId }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    return { ok: false, error: friendlyCloneError(`克隆请求失败：${msg}`) }
  }
}

export function getClonedVoiceId(): string | null {
  try { return localStorage.getItem(CLONED_VOICE_KEY) } catch { return null }
}

export function clearClonedVoice(): void {
  try { localStorage.removeItem(CLONED_VOICE_KEY) } catch { /* 忽略 */ }
}
