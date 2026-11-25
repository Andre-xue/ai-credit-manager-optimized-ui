// AI 图像 / AI 视频模块共用：生成历史（localStorage 持久化）+ 媒体保存（三端）。
// 历史只存 URL/文本与元信息，不存二进制；图片/视频本体由调用方按 URL 预览与下载。

import { isDesktopApp, isNativeApp } from './openExternal'
import { storageDir } from './storagePrefs'

export type MediaKind = 'image' | 'video'

export interface MediaHistoryItem {
  id: string
  kind: MediaKind
  prompt: string
  accountLabel: string
  model: string
  createdAt: number
  /** 结果 URL（http(s) 或 data URL）列表 */
  results: string[]
  /** 本地缩略图（data URL），避免远程临时链接过期导致历史看不到图 */
  thumbs?: string[]
  /** 生成参数摘要，如 "1024x1024 · HD · 2张" / "5秒 · 16:9" */
  params: string
  /** 任务说明/状态文本（视频异步提交时可能只有文本） */
  note?: string
}

const KEY_IMAGE = 'acm.gen.image.history'
const KEY_VIDEO = 'acm.gen.video.history'
const MAX_ITEMS = 40

function keyOf(kind: MediaKind): string { return kind === 'image' ? KEY_IMAGE : KEY_VIDEO }

export function loadHistory(kind: MediaKind): MediaHistoryItem[] {
  try {
    const raw = localStorage.getItem(keyOf(kind))
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(x => x && typeof x === 'object' && Array.isArray(x.results)) : []
  } catch { return [] }
}

export function saveHistory(kind: MediaKind, items: MediaHistoryItem[]): void {
  try { localStorage.setItem(keyOf(kind), JSON.stringify(items.slice(0, MAX_ITEMS))) } catch { /* 存储满时静默 */ }
}

export function addHistory(kind: MediaKind, item: MediaHistoryItem): MediaHistoryItem[] {
  const next = [item, ...loadHistory(kind)].slice(0, MAX_ITEMS)
  saveHistory(kind, next)
  return next
}

export function removeHistory(kind: MediaKind, id: string): MediaHistoryItem[] {
  const next = loadHistory(kind).filter(x => x.id !== id)
  saveHistory(kind, next)
  return next
}

export function clearHistory(kind: MediaKind): void {
  try { localStorage.removeItem(keyOf(kind)) } catch { /* noop */ }
}

/** 由 URL 推断文件扩展名（含 data URL mime） */
function extOf(url: string, kind: MediaKind): string {
  const mime = url.startsWith('data:') ? (url.slice(5, url.indexOf(';')) || '') : ''
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('jpeg')) return 'jpg'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('webm')) return 'webm'
  try {
    const path = new URL(url).pathname
    const m = path.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov)(?:$|\?)/i)
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg')
  } catch { /* data url 或相对路径 */ }
  return kind === 'image' ? 'png' : 'mp4'
}

/** 把 URL（http(s) 或 data URL）转成 Blob */
async function urlToBlob(url: string): Promise<{ blob: Blob; mime: string }> {
  if (url.startsWith('data:')) {
    const res = await fetch(url)
    const blob = await res.blob()
    return { blob, mime: blob.type || 'application/octet-stream' }
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const blob = await res.blob()
  return { blob, mime: blob.type || (blob.type.includes('video') ? 'video/mp4' : 'image/png') }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 生成完成后自动把结果存进「数据存储 · 图像/视频」文件夹（Ethan 要求）：
 * 仅桌面端且已配置该文件夹时执行；未配置静默跳过；单个失败不影响其余文件与生成流程。
 * 返回实际保存的完整路径列表。
 */
export async function autoSaveGeneratedMedia(urls: string[], kind: MediaKind): Promise<string[]> {
  const dir = storageDir('media')
  if (!dir || !isDesktopApp() || urls.length === 0) return []
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }
  const invoke = w.__TAURI_INTERNALS__?.invoke
  if (!invoke) return []
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `ai-${kind}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const saved: string[] = []
  for (let i = 0; i < urls.length; i++) {
    try {
      const { blob } = await urlToBlob(urls[i])
      const filename = `${base}-${i + 1}.${extOf(urls[i], kind)}`
      await invoke('write_binary_to_dir', { dir, filename, contentBase64: await toBase64(blob) })
      saved.push(`${dir}/${filename}`)
    } catch { /* 单个文件失败不阻断其余与生成结果 */ }
  }
  return saved
}

/**
 * 保存生成的图片/视频到本机：
 * - 桌面端：优先弹系统目录选择（沿用 choose_save_dir / write_binary_to_dir）
 * - 原生 App：写入 Documents 目录
 * - Web：浏览器下载
 * 返回保存位置描述，失败抛错。
 */
export async function saveMedia(url: string, kind: MediaKind, filenameBase: string): Promise<string> {
  const { blob } = await urlToBlob(url)
  const ext = extOf(url, kind)
  const filename = `${filenameBase}.${ext}`

  if (isDesktopApp()) {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) throw new Error('桌面接口不可用')
    // 数据存储已指定图像/视频文件夹时直接存入；否则让用户在系统对话框里选
    let dir: string | null = storageDir('media')
    if (!dir) {
      try { dir = await invoke('choose_save_dir') as string | null } catch { dir = null }
    }
    if (!dir) throw new Error('已取消保存')
    const base64 = await toBase64(blob)
    await invoke('write_binary_to_dir', { dir, filename, contentBase64: base64 })
    return `${dir}/${filename}`
  }

  if (isNativeApp()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Documents, recursive: true })
    return `Documents/${filename}`
  }

  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  return filename
}

/** 供 UI 用的轻量 id */
export function newMediaId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 安全提取任意抛出值的文本（兼容 Tauri 命令 reject 字符串 / 非标准对象） */
export function errTextSafe(e: unknown): string {
  if (e == null) return '未知错误'
  if (typeof e === 'string') return e
  if (typeof e === 'object' && e && typeof (e as { message?: unknown }).message === 'string') return String((e as { message: string }).message)
  try { return JSON.stringify(e) ?? String(e) } catch { return String(e) }
}

/**
 * 把结果 URL 转成本地缩略图 data URL（240px，JPEG 0.72），用于历史持久显示。
 * 生图接口常返回临时签名 URL，直接存 URL 会过期变破图；抓成 data URL 后永久可见。
 * 桌面端走 Tauri 代理抓取（绕 CORS），Web 端直接 fetch；失败则返回空串由调用方回退原 URL。
 */
export async function urlToThumb(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url
  try {
    const res = await fetch(url)
    if (!res.ok) return ''
    const blob = await res.blob()
    // 缩放到 240px 以内并压成 JPEG
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch { return '' }
}

/** 批量转缩略图，忽略单个失败 */
export async function urlsToThumbs(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(u => urlToThumb(u)))
}
