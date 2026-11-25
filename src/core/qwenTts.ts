// Qwen3-TTS 本地克隆音色（MLX 后端，仅桌面端 Apple 芯片 Mac）：
// 服务由 App 以本地服务开关管理（端口 18123，模型 mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit，
// 4-bit 量化权重约 1GB），合成走 Rust 后端调本机 /v1/audio/clone。
// 服务端无音色注册表：每次合成都要带参考音频，因此已保存的 Qwen 音色把参考音频存在本机 IndexedDB。
// 注意：PyTorch/MPS 路线在 8GB 机器上内存占用约 10GB 会狂换页，故默认走 MLX 路线；
// 首次安装需下载约 1GB 模型，服务启动后模型加载约 5~30 秒，均由 Rust 端明确报错、不静默兜底。

import { isDesktopApp } from './openExternal'
import { uid } from './store'
import { addClonedVoice, type ClonedVoice } from './voiceClone'

export const QWENTTS_PORT = 18123
export const QWENTTS_URL = 'http://127.0.0.1:18123'
/** MLX 量化版 Base 模型（官方 mlx-tts-server 支持表内 0.6B 克隆档；权重约 1GB） */
export const QWENTTS_MODEL_ID = 'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit'
/** Qwen 官方原版权重（与 MLX 版同源，供界面说明） */
export const QWENTTS_OFFICIAL_MODEL_ID = 'Qwen/Qwen3-TTS-12Hz-0.6B-Base'
export const QWEN_VOICE_PREFIX = 'qwen-local:'
/**
 * Rust 端 qwentts_synthesize 的请求超时（秒），须与 lib.rs 的 reqwest timeout 保持一致。
 * 首次克隆要加载约 1GB 模型，M1 8GB 上可能超过 3 分钟——旧 180 秒会在加载中途掐断请求
 * （Ethan 2026-11-24 18:43「等了很久才失败」即此），故放宽到 600 秒。
 */
export const QWENTTS_SYNTH_TIMEOUT_S = 600
/** 合成阶段超过这么多秒仍未完成时，界面提示“仍在加载模型、请继续等待” */
export const QWEN_CLONE_SLOW_HINT_S = 60

/** 克隆已等待时长文案（不假造百分比，只报真实秒数） */
export function formatCloneElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

export interface QwenTtsStatus {
  installed: boolean
  /** 找到的 Python 版本（如 '3.13.1'），未找到为空串 */
  python: string
  pythonOk: boolean
  modelCached: boolean
  running: boolean
  url: string | null
  /** 服务日志尾部（服务起不来时看原因），无日志为空串 */
  lastLog: string
}

const EMPTY_STATUS: QwenTtsStatus = {
  installed: false, python: '', pythonOk: false, modelCached: false, running: false, url: null, lastLog: '',
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function getInvoke(): Invoke | null {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

/** 是否为本机 Qwen 克隆音色（voiceId 前缀判定） */
export function isQwenVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === 'string' && voiceId.startsWith(QWEN_VOICE_PREFIX)
}

export function newQwenVoiceId(): string {
  return `${QWEN_VOICE_PREFIX}${uid('qw')}`
}

/** 安装/运行状态（未安装、Python 版本、模型是否已下载、服务是否在跑） */
export async function qwenTtsStatus(): Promise<QwenTtsStatus> {
  const invoke = getInvoke()
  if (!invoke) return { ...EMPTY_STATUS, lastLog: '仅桌面端支持 Qwen3-TTS 本地服务' }
  try {
    const raw = (await invoke('qwentts_status')) as string
    const j = JSON.parse(raw) as Partial<QwenTtsStatus>
    return { ...EMPTY_STATUS, ...j }
  } catch (e) {
    return { ...EMPTY_STATUS, lastLog: `状态查询失败：${(e as Error)?.message ?? String(e)}` }
  }
}

/**
 * 首次安装准备（同步长任务，几分钟）：建 venv → pip 安装 mlx-tts-server → 预下载约 1GB 模型。
 * 失败时返回 Rust 端带出的真实原因（Python 版本、网络、磁盘等），不静默。
 */
export async function qwenTtsSetup(): Promise<{ ok: boolean; message: string }> {
  const invoke = getInvoke()
  if (!invoke) return { ok: false, message: '仅桌面端支持 Qwen3-TTS 本地服务' }
  try {
    const message = (await invoke('qwentts_setup')) as string
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/** 测试本机服务连接（GET /health） */
export async function qwenTtsTest(): Promise<{ ok: boolean; message: string }> {
  const invoke = getInvoke()
  if (!invoke) return { ok: false, message: '仅桌面端支持 Qwen3-TTS 本地服务' }
  try {
    const message = (await invoke('qwentts_test')) as string
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/**
 * 用参考音频克隆合成一段语音（走本机 /v1/audio/clone，language=auto 由服务端按文本自动识别）。
 * 返回音频 data URI（wav）。服务未运行、参考音频无效、合成失败时抛错，调用方显示原因。
 * 调用前请先用 ensureWavDataUrl 把参考音频归一化成 WAV：服务端只认 WAV，
 * 非 WAV 会走 ffmpeg 转格式，本机没装 ffmpeg 就报 HTTP 400（v0.1.414 实机 bug）。
 */
export async function qwenTtsSynthesize(refAudioDataUrl: string, refText: string, text: string): Promise<string> {
  const invoke = getInvoke()
  if (!invoke) throw new Error('仅桌面端支持 Qwen3-TTS 本地服务')
  return (await invoke('qwentts_synthesize', {
    audioDataUrl: refAudioDataUrl,
    refText: refText ?? '',
    text,
  })) as string
}

/**
 * 取消一次正在进行的 Qwen 合成（v0.1.428）：前端「取消」按钮调用，Rust 端丢弃请求。
 * 调用失败也不抛错（服务已停/无请求时本就无事可做）。
 */
export async function qwenTtsCancelSynthesize(): Promise<void> {
  const invoke = getInvoke()
  if (!invoke) return
  try { await invoke('qwentts_cancel_synthesize') } catch { /* 忽略 */ }
}

/** 用户取消合成的哨兵（speakAsync 内部用，调用方无需匹配字符串） */
export const QWEN_SYNTH_CANCELLED = '__acm_qwen_cancelled__'

/**
 * 合成失败是否因为服务没在跑（连接被拒/连不上/连接被重置）。
 * 与超时区分开：超时是服务在、只是慢；连接不上才是服务没开。
 */
export function isQwenServiceOffError(raw: string): boolean {
  return /connection refused|failed to connect|connection reset|ECONNREFUSED|network error|合成请求失败/i.test(raw)
    && !/timed?\s*out|timeout/i.test(raw)
}

/**
 * Qwen 服务端报错翻译成中文指引（v0.1.414 兜底：正常流程下参考音频已在本地转成 WAV，
 * 这条错只会在旧版存量非 WAV 参考音频、或转换被绕过时出现）。
 * v0.1.428：超时也给明确原因（此前只在克隆路径 describeQwenCloneFailure 里处理，
 * 试听/朗读路径走这里会直接透出英文原错）。
 */
export function friendlyQwenError(raw: string): string {
  if (/timed?\s*out|timeout/i.test(raw)) {
    return `合成超时（等待超过 ${QWENTTS_SYNTH_TIMEOUT_S / 60} 分钟仍未完成）：模型首次加载较慢或服务卡住。请确认服务仍在运行，稍后重试`
  }
  if (/ffmpeg/i.test(raw) || /ref_audio is not WAV/i.test(raw)) {
    return '参考音频不是 WAV 且本机未装 ffmpeg，请改用 WAV 音频或安装 ffmpeg（终端运行 brew install ffmpeg）'
  }
  return raw
}

/**
 * 克隆失败原因再加工（v0.1.415）：超时（Rust 端 QWENTTS_SYNTH_TIMEOUT_S 秒仍未完成，
 * reqwest 报错含 timed out）给明确提示 + 重试指引；其余走 414 的中文翻译。
 * friendlyQwenError 本身一字未动。
 */
export function describeQwenCloneFailure(raw: string): string {
  if (/timed?\s*out|timeout/i.test(raw)) {
    return `克隆超时（等待超过 ${QWENTTS_SYNTH_TIMEOUT_S / 60} 分钟仍未完成）：模型首次加载较慢或服务卡住。请点「刷新状态」确认服务仍在运行，再点「重新克隆」`
  }
  return friendlyQwenError(raw)
}

/** 预热用静音 WAV（0.5 秒、16kHz 单声道 16-bit PCM）：只为触发服务端首次加载模型，结果丢弃 */
export function buildSilentWavDataUrl(seconds = 0.5): string {
  const sampleRate = 16000
  const frames = Math.max(1, Math.floor(sampleRate * seconds))
  const buf = new ArrayBuffer(44 + frames * 2)
  const v = new DataView(buf)
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  wstr(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); wstr(8, 'WAVE'); wstr(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); wstr(36, 'data'); v.setUint32(40, frames * 2, true)
  // 采样点默认全 0（静音），无需再写
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:audio/wav;base64,${btoa(bin)}`
}

/** 预热失败是否值得立刻重试一次：仅连接不上时（服务刚起、端口已通但 HTTP 还没就绪） */
export function shouldRetryQwenWarmup(raw: string): boolean {
  return /合成请求失败|连接失败|connection refused|failed to connect|connection reset|network error/i.test(raw)
}

export type QwenWarmupState = 'idle' | 'warming' | 'ready' | 'failed'

let warmupState: QwenWarmupState = 'idle'
let warmupPromise: Promise<{ ok: boolean; message: string }> | null = null

export function getQwenWarmupState(): QwenWarmupState {
  return warmupState
}

/** 服务停掉后复位预热状态（下次启动重新预热）；页面重载时模块状态本身即 idle */
export function resetQwenWarmup(): void {
  warmupState = 'idle'
  warmupPromise = null
}

/**
 * 服务启动后预热模型（v0.1.415）：用一段静音参考音频做一次空合成，触发服务端首次加载
 * 约 1GB 模型并等它加载完，之后第一次真正的克隆就不再等加载。调用方在服务确认运行后
 * 后台触发一次即可（fire-and-forget，不阻塞开关）；已预热则直接返回，不重复合成。
 * 预热失败不抛错、不静默：返回真实原因，界面可手动再点「预热模型」重试。
 */
export async function qwenTtsWarmup(): Promise<{ ok: boolean; message: string }> {
  if (warmupState === 'ready') return { ok: true, message: '模型已预热' }
  if (warmupPromise) return warmupPromise
  warmupState = 'warming'
  warmupPromise = (async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const st = await qwenTtsStatus()
      if (!st.running) {
        warmupState = 'failed'
        return { ok: false, message: 'Qwen3-TTS 服务未运行，无法预热模型' }
      }
      try {
        await qwenTtsSynthesize(buildSilentWavDataUrl(), '', '你好')
      } catch (e) {
        // 服务刚起、端口已通但 HTTP 还没就绪：等 5 秒再试一次
        const raw = (e as Error)?.message ?? String(e)
        if (!shouldRetryQwenWarmup(raw)) throw e
        await new Promise(r => setTimeout(r, 5000))
        await qwenTtsSynthesize(buildSilentWavDataUrl(), '', '你好')
      }
      warmupState = 'ready'
      return { ok: true, message: '模型已预热，首次克隆会快很多' }
    } catch (e) {
      warmupState = 'failed'
      return { ok: false, message: `预热失败：${friendlyQwenError((e as Error)?.message ?? String(e))}` }
    } finally {
      warmupPromise = null
    }
  })()
  return warmupPromise
}

// ==================== 已保存 Qwen 音色的参考音频（本机 IndexedDB） ====================

const DB_NAME = 'acm-qwen-tts-db'
const STORE = 'refs'

export interface QwenVoiceRef {
  voiceId: string
  name: string
  /** 参考音频 data URI（与克隆样本一致） */
  dataUrl: string
  /** 参考音频的原文（可为空；写上合成效果更好） */
  refText: string
  createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'voiceId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/** 保存一个 Qwen 克隆音色：建 voiceId、存参考音频、写入克隆音色列表 */
export async function saveQwenVoice(name: string, dataUrl: string, refText: string, sampleName?: string): Promise<ClonedVoice> {
  const voiceId = newQwenVoiceId()
  const ref: QwenVoiceRef = { voiceId, name, dataUrl, refText: refText ?? '', createdAt: Date.now() }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(ref)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return addClonedVoice(name, voiceId, sampleName)
}

/** 取出某 Qwen 音色的参考音频；不存在返回 null */
export async function loadQwenVoiceRef(voiceId: string): Promise<QwenVoiceRef | null> {
  try {
    const db = await openDb()
    return await new Promise<QwenVoiceRef | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(voiceId)
      req.onsuccess = () => resolve((req.result as QwenVoiceRef | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/** 删除某 Qwen 音色的参考音频（删除音色记录时调用） */
export async function deleteQwenVoiceRef(voiceId: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(voiceId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* 忽略 */ }
}
