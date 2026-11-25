// 附件选择统一层：桌面（Tauri dialog）、手机（Capacitor Camera/Filesystem）、Web（input file）。
// 权限：手机端先 checkPermissions → requestPermissions，成功后才打开相机/相册/文件；
// 桌面端用系统对话框，用户选择即视为授权（无后台读取权限）。
// 所有附件统一转为 data URL，便于随对话发给支持图片的模型，也便于本地预览。

import { isDesktopApp } from './openExternal'

export type AttachmentKind = 'file' | 'photo' | 'video' | 'camera' | 'album'
export type PlatformKind = 'desktop' | 'mobile' | 'web'

export interface PickedAttachment {
  name: string
  mime: string
  size: number
  /** data:...;base64,... */
  dataUrl: string
  kind: AttachmentKind
  /** 去掉 data URL 前缀的纯 base64（发给多模态模型用） */
  base64: string
}

const MAX_BYTES = 8 * 1024 * 1024  // 8MB，避免超大文件撑爆 localStorage/请求

export function currentPlatform(): PlatformKind {
  // Capacitor 安卓环境
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  if (cap?.getPlatform?.() === 'android' || cap?.getPlatform?.() === 'ios') return 'mobile'
  if (isDesktopApp()) return 'desktop'
  return 'web'
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_BYTES) { reject(new Error(`文件过大（${(file.size / 1048576).toFixed(1)}MB），请选择 8MB 以内的文件`)); return }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/** 把一个 File 转为附件（预览对话框多选/拖拽时复用） */
export async function fileToAttachment(file: File, kind: AttachmentKind = 'file'): Promise<PickedAttachment> {
  return wrapFile(file, kind)
}

async function wrapFile(file: File, kind: AttachmentKind): Promise<PickedAttachment> {
  const dataUrl = await fileToDataUrl(file)
  return {
    name: file.name || '附件', mime: file.type || guessMime(file.name), size: file.size,
    dataUrl, base64: dataUrl.split(',')[1] ?? '', kind,
  }
}

/** Web 端兜底：<input type=file>。在 Tauri WebView 中同样可用，且无需 fs 权限。 */
function pickWeb(kind: AttachmentKind): Promise<PickedAttachment | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (kind === 'photo' || kind === 'album') input.accept = 'image/*'
    else if (kind === 'video') input.accept = 'video/*'
    else if (kind === 'camera') { input.accept = 'image/*'; input.setAttribute('capture', 'environment') }
    else input.accept = '*/*'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) { resolve(null); return }
      wrapFile(f, kind).then(resolve).catch(reject)
    }
    input.click()
  })
}

/** 桌面端：优先 Tauri dialog 系统对话框（用户选择即授权），任何读取失败都回退 Web input 兜底。 */
async function pickDesktop(kind: AttachmentKind): Promise<PickedAttachment | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const filters = kind === 'photo'
      ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
      : kind === 'video'
        ? [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }]
        : undefined
    const picked = await open({ multiple: false, directory: false, filters })
    if (!picked) return null
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(picked as string)
    if (bytes.length > MAX_BYTES) throw new Error(`文件过大（${(bytes.length / 1048576).toFixed(1)}MB），请选择 8MB 以内`)
    const mime = guessMime(picked as string)
    const b64 = uint8ToBase64(bytes)
    return {
      name: (picked as string).split(/[\\/]/).pop() ?? '附件',
      mime, size: bytes.length, dataUrl: `data:${mime};base64,${b64}`, base64: b64, kind,
    }
  } catch {
    // dialog/fs 读取失败（插件未配置、scope 未授权、路径读取异常等）统一回退 Web input。
    // WebView 的 <input type=file> + FileReader 无需任何 Tauri fs 权限，最稳妥。
    return pickWeb(kind)
  }
}

/** 手机端：Capacitor Camera（相机/相册）+ 文件 input；先请求权限 */
async function pickMobile(kind: AttachmentKind): Promise<PickedAttachment | null> {
  const { Camera, CameraSource } = await import('@capacitor/camera')

  // 相机/相册：显式权限流程
  if (kind === 'camera' || kind === 'album') {
    const status = await Camera.checkPermissions()
    const granted = kind === 'camera'
      ? (status.camera === 'granted' && status.photos === 'granted')
      : (status.photos === 'granted')
    if (!granted) {
      const asked = await Camera.requestPermissions(kind === 'camera'
        ? { permissions: ['camera', 'photos'] }
        : { permissions: ['photos'] })
      const ok = kind === 'camera'
        ? (asked.camera === 'granted' && asked.photos === 'granted')
        : (asked.photos === 'granted')
      if (!ok) throw new Error(kind === 'camera' ? '相机与照片权限被拒绝，请在系统设置中允许后重试' : '相册权限被拒绝，请在系统设置中允许后重试')
    }
    const photo = await Camera.getPhoto({
      quality: 85,
      resultType: 'base64' as never,
      source: kind === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      allowEditing: false,
    })
    if (!photo.base64String) throw new Error('未获取到图片')
    const mime = `image/${photo.format === 'JPEG' ? 'jpeg' : (photo.format || 'png').toLowerCase()}`
    return {
      name: `photo.${photo.format === 'JPEG' ? 'jpg' : 'png'}`,
      mime, size: Math.round(photo.base64String.length * 0.75),
      dataUrl: `data:${mime};base64,${photo.base64String}`,
      base64: photo.base64String, kind,
    }
  }
  // 文件：Web input（Android WebView 支持）；不做后台存储读取，避免额外权限
  return pickWeb(kind)
}

export async function pickAttachment(kind: AttachmentKind): Promise<PickedAttachment | null> {
  const platform = currentPlatform()
  if (platform === 'desktop') return pickDesktop(kind)
  if (platform === 'mobile') return pickMobile(kind)
  return pickWeb(kind)
}

/** 文本类附件：解码后随对话发给 AI，避免“只传了文件名、AI 看不到内容”。 */
export function isTextAttachment(a: PickedAttachment): boolean {
  return a.mime.startsWith('text/') || TEXT_EXTS.has(a.name.split('.').pop()?.toLowerCase() ?? '')
}

const TEXT_EXTS = new Set(['md', 'markdown', 'txt', 'json', 'csv', 'log', 'yaml', 'yml', 'toml', 'ini',
  'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'xml', 'sql', 'py', 'java', 'go', 'rs', 'sh', 'bat', 'vue', 'srt'])

/** base64 → UTF-8 文本（正确支持中文，避免 atob 的 latin1 乱码） */
export function decodeAttachmentText(a: PickedAttachment): string {
  try {
    const bin = atob(a.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

/** 人类可读的文件大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
    json: 'application/json', csv: 'text/csv', log: 'text/plain', html: 'text/html', css: 'text/css',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
  }
  return map[ext ?? ''] ?? (TEXT_EXTS.has(ext ?? '') ? 'text/plain' : 'application/octet-stream')
}

function uint8ToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
