// 音色文件下载管理器：本地同一时间只保留一个音色文件，避免存储空间过载。
// 切换音色时：删除旧文件 → 提示 → 下载新文件。文件存 IndexedDB（适合二进制 Blob）。
// 第三方 TTS 的密钥本地加密存储；未配置时下载入口禁用并说明。

import { ttsSynthesizeDirect } from './ttsDirect'

const DB_NAME = 'acm-voice-db'
const STORE = 'voices'
const SLOT_KEY = 'active-voice'
const CONFIG_KEY = 'acm.tts.provider.config'

export type VoiceDownloadState = 'idle' | 'downloading' | 'ready' | 'error'

export interface VoiceFile {
  id: string
  name: string
  blob: Blob
  downloadedAt: number
}

export interface TtsProviderConfig {
  /** 第三方 TTS 服务类型；未配置为空 */
  provider: '' | 'local' | 'voicestudio' | 'qwentts' | 'aliyun' | 'volcengine' | 'tencent' | 'minimax' | 'elevenlabs'
  /** 服务端点（自建代理模式使用） */
  endpoint: string
  /** 配置模式：direct=官方 API Key 直连(免部署,推荐)；proxy=自建服务端代理 */
  mode?: 'direct' | 'proxy'
  /** 官方 API Key（直连模式使用；存储时混淆，不落明文） */
  apiKey?: string
  secretId?: string
  secretKey?: string
}

const EMPTY_CONFIG: TtsProviderConfig = { provider: '', endpoint: '', mode: 'direct' }

// API Key 轻度混淆（异或固定盐 + base64），避免 localStorage 明文直读。
// 非强加密，密钥始终在用户本机，不上传、不进云同步。
const KEY_SALT = 'acm-tts-2026'
function obfuscateKey(s: string): string {
  if (!s) return ''
  let out = ''
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ KEY_SALT.charCodeAt(i % KEY_SALT.length))
  try { return btoa(unescape(encodeURIComponent(out))) } catch { return '' }
}
function deobfuscateKey(s: string): string {
  if (!s) return ''
  try {
    const out = decodeURIComponent(escape(atob(s)))
    let res = ''
    for (let i = 0; i < out.length; i++) res += String.fromCharCode(out.charCodeAt(i) ^ KEY_SALT.charCodeAt(i % KEY_SALT.length))
    return res
  } catch { return '' }
}

/** 切换音色时的标准提示（保留原意，措辞更自然） */
export const SWITCH_NOTICE = '为避免存储空间过载，已清理原下载的音色，正在下载新音色…'

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

/** 读取当前已下载的音色文件（只会有一个） */
export async function getActiveVoiceFile(): Promise<VoiceFile | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(SLOT_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

/** 删除当前已下载的音色文件（释放存储） */
export async function deleteActiveVoiceFile(): Promise<boolean> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(SLOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return true
  } catch { return false }
}

/** 是否已有下载的音色文件 */
export async function hasDownloadedVoice(): Promise<boolean> {
  return (await getActiveVoiceFile()) !== null
}

/** 获取 TTS 配置（明文返回给调用方用于发起请求，存储时 apiKey 不落明文） */
export function getTtsConfig(): TtsProviderConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return EMPTY_CONFIG
    const obj = JSON.parse(raw) as Partial<TtsProviderConfig> & { apiKeyEnc?: string }
    return {
      ...EMPTY_CONFIG,
      ...obj,
      mode: obj.mode ?? 'proxy', // 老配置无 mode，按代理模式兼容
      apiKey: obj.apiKey ?? deobfuscateKey(obj.apiKeyEnc ?? ''),
    }
  } catch { return EMPTY_CONFIG }
}

/** 是否已配置可用（直连模式需 provider+apiKey；代理模式需 provider+endpoint；Qwen3-TTS 本地服务无需 Key/端点） */
export function hasTtsConfig(): boolean {
  const c = getTtsConfig()
  if (!c.provider) return false
  if (c.provider === 'qwentts') return true
  return c.mode === 'direct' ? !!c.apiKey?.trim() : !!c.endpoint?.trim()
}

export function saveTtsConfig(c: TtsProviderConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      ...c,
      apiKey: undefined,
      apiKeyEnc: obfuscateKey(c.apiKey ?? ''),
    }))
  } catch { /* 忽略 */ }
}

export function clearTtsConfig(): void {
  try { localStorage.removeItem(CONFIG_KEY) } catch { /* 忽略 */ }
}

/**
 * 切换并下载音色：核心互斥逻辑。
 * 1) 若已有旧音色文件 → 删除 → 通过 onNotice 提示（优化文案）
 * 2) 通过配置的 TTS endpoint 下载新音色文件
 * 3) 成功后写入单槽位（天然保证同时只有一个）
 *
 * 未配置第三方 TTS 时返回 error，界面据此置灰方言项。
 */
export async function switchVoice(
  voiceId: string,
  voiceName: string,
  onState: (s: VoiceDownloadState) => void,
  onNotice?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; error?: string }> {
  const config = getTtsConfig()
  const direct = config.mode === 'direct' && config.provider === 'aliyun' && !!config.apiKey?.trim()
  if (!config.provider || (!direct && !config.endpoint)) {
    return { ok: false, error: '方言音色需先配置第三方语音服务（设置 → 语音朗读）' }
  }

  // 互斥：先删除旧文件并提示
  const old = await getActiveVoiceFile()
  if (old && old.id !== voiceId) {
    await deleteActiveVoiceFile()
    onNotice?.(SWITCH_NOTICE)
  }

  onState('downloading')
  try {
    let blob: Blob
    if (direct) {
      // 直连模式：用该音色合成一句样音作本地缓存（官方无独立"音色文件"下载端点）
      const dataUri = await ttsSynthesizeDirect(config, voiceId, '你好，这是音色试听。')
      const b64 = dataUri.split(',')[1] ?? ''
      if (!b64) throw new Error('音色样音为空')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      blob = new Blob([bytes], { type: 'audio/mp3' })
    } else {
      // 通过部署方的 TTS 代理端点换取音频；密钥在服务端持有，前端只传音色 id。
      const url = `${config.endpoint.replace(/\/$/, '')}/voice?provider=${encodeURIComponent(config.provider)}&voice=${encodeURIComponent(voiceId)}`
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
      blob = await res.blob()
    }
    if (blob.size === 0) throw new Error('下载的音色文件为空')

    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ id: voiceId, name: voiceName, blob, downloadedAt: Date.now() } satisfies VoiceFile, SLOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    onState('ready')
    return { ok: true }
  } catch (e) {
    onState('error')
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg.includes('abort') ? '已取消下载' : `音色下载失败：${msg.slice(0, 80)}` }
  }
}
