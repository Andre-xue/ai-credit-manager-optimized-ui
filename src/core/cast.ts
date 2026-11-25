// 投屏（v0.1.409）：DLNA 局域网投屏（桌面端，Rust）+ 系统投屏（Remote Playback API）。
// 协议定案（2026-11-24）：DLNA 与 Chromecast 二选一，选 DLNA——本机局域网就能落地，
// 不用 Google 账号、不用 Cast SDK 注册；Chromecast/AirPlay 走浏览器原生 Remote
// Playback API（Chrome 的 Cast、Safari 的 AirPlay），有就用、没有就明说。
// DLNA 只做最小集：SSDP 发现 / 播放 / 暂停 / 继续 / 停止；控制地址只允许 SSDP
// 回包里的局域网地址（Rust 侧 is_local_host 校验）。m3u8/flv 源多数电视播不了，
// 投之前给提示、不拦着试。

import { isDesktopApp } from './openExternal'

export interface DlnaDevice {
  name: string
  /** 设备描述地址（SSDP LOCATION） */
  location: string
  /** AVTransport 控制地址 */
  controlUrl: string
}

export function isDesktopCastAvailable(): boolean {
  return isDesktopApp()
}

/** 系统投屏（Remote Playback API）可用性：Chrome 的 Cast / Safari 的 AirPlay */
export function detectRemotePlayback(video: HTMLVideoElement | null): { cast: boolean; airplay: boolean } {
  if (!video) return { cast: false, airplay: false }
  const v = video as HTMLVideoElement & {
    remote?: { prompt?: () => Promise<void> }
    webkitShowPlaybackTargetPicker?: () => void
  }
  return {
    cast: !!v.remote && typeof v.remote.prompt === 'function',
    airplay: typeof v.webkitShowPlaybackTargetPicker === 'function',
  }
}

/** 打开系统投屏选择器（Chrome 选 Chromecast 设备，Safari 选 AirPlay 设备） */
export async function promptSystemCast(video: HTMLVideoElement | null): Promise<void> {
  if (!video) throw new Error('没有可投的播放器')
  const v = video as HTMLVideoElement & {
    remote?: { prompt?: () => Promise<void> }
    webkitShowPlaybackTargetPicker?: () => void
  }
  if (v.remote && typeof v.remote.prompt === 'function') {
    await v.remote.prompt()
    return
  }
  if (typeof v.webkitShowPlaybackTargetPicker === 'function') {
    v.webkitShowPlaybackTargetPicker()
    return
  }
  throw new Error('当前浏览器不支持系统投屏（Chrome 支持 Chromecast，Safari 支持 AirPlay）')
}

async function invokeDlna<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<T> } }
  if (!w.__TAURI_INTERNALS__?.invoke) throw new Error('不在桌面端，调不到 DLNA')
  return w.__TAURI_INTERNALS__.invoke(cmd, args)
}

/** SSDP 搜局域网里的 DLNA 电视/盒子（桌面端，约 3 秒） */
export async function discoverDlnaDevices(): Promise<DlnaDevice[]> {
  const raw = await invokeDlna<string>('dlna_discover', {})
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((d): d is DlnaDevice => {
      const o = d as Partial<DlnaDevice>
      return typeof o?.name === 'string' && typeof o?.controlUrl === 'string' && typeof o?.location === 'string'
    })
}

export async function dlnaPlay(device: DlnaDevice, mediaUrl: string, title: string): Promise<void> {
  await invokeDlna<string>('dlna_play', { controlUrl: device.controlUrl, mediaUrl, title })
}

export async function dlnaPause(device: DlnaDevice): Promise<void> {
  await invokeDlna<string>('dlna_pause', { controlUrl: device.controlUrl })
}

export async function dlnaResume(device: DlnaDevice): Promise<void> {
  await invokeDlna<string>('dlna_resume', { controlUrl: device.controlUrl })
}

export async function dlnaStop(device: DlnaDevice): Promise<void> {
  await invokeDlna<string>('dlna_stop', { controlUrl: device.controlUrl })
}

/** SSDP 回包里抠 LOCATION 头（大小写不敏感） */
export function parseSsdpLocation(text: string): string | null {
  for (const line of (text ?? '').split(/\r?\n/)) {
    const l = line.trim()
    if (l.length > 9 && l.slice(0, 9).toLowerCase() === 'location:') {
      const v = l.slice(9).trim()
      if (v) return v
    }
  }
  return null
}

function tagContent(xml: string, tag: string): string | null {
  const open = `<${tag}>`
  const close = `</${tag}>`
  const s = xml.indexOf(open)
  if (s < 0) return null
  const e = xml.indexOf(close, s + open.length)
  if (e < 0) return null
  return xml.slice(s + open.length, e).trim()
}

function resolveUrl(base: string, rel: string): string {
  if (/^https?:\/\//i.test(rel)) return rel
  try { return new URL(rel, base).toString() } catch { return rel }
}

/** 设备描述 XML 里找友好名 + AVTransport 控制地址（相对地址按 LOCATION 基址拼） */
export function parseDeviceDescription(xml: string, baseUrl: string): { name: string; controlUrl: string } | null {
  const name = tagContent(xml, 'friendlyName')
  if (!name) return null
  let rest = xml
  for (;;) {
    const s = rest.indexOf('<service>')
    if (s < 0) return null
    const e = rest.indexOf('</service>', s)
    if (e < 0) return null
    const block = rest.slice(s + '<service>'.length, e)
    const type = tagContent(block, 'serviceType') ?? ''
    if (type.includes('AVTransport')) {
      const ctrl = tagContent(block, 'controlURL')
      if (!ctrl) return null
      return { name, controlUrl: resolveUrl(baseUrl, ctrl) }
    }
    rest = rest.slice(e + '</service>'.length)
  }
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function soapEnvelope(action: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">${body}</u:${action}></s:Body></s:Envelope>`
}

function mimeOfUrl(url: string): string {
  const path = (url ?? '').split('?')[0].toLowerCase()
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (path.endsWith('.mkv')) return 'video/x-matroska'
  if (path.endsWith('.webm')) return 'video/webm'
  if (path.endsWith('.mov')) return 'video/quicktime'
  if (path.endsWith('.avi')) return 'video/x-msvideo'
  return 'video/mp4'
}

/** SetAVTransportURI 用的 DIDL-Lite 元数据（部分严格电视空元数据会拒） */
export function didlMetadata(mediaUrl: string, title: string): string {
  const mime = mimeOfUrl(mediaUrl)
  const inner = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="0" restricted="1"><dc:title>${escapeXml(title || 'AI 魔方')}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:${mime}:*">${escapeXml(mediaUrl)}</res></item></DIDL-Lite>`
  return inner
}

/** 当前源投屏前的提示：m3u8/flv 多数电视播不了，mp4 最稳；只提示、不拦 */
export function dlnaMediaNote(url: string): string | null {
  const path = (url ?? '').split('?')[0].toLowerCase()
  if (path.endsWith('.flv')) return '该源是 FLV，电视基本播不了，请切 mp4 线路再投'
  if (path.endsWith('.m3u8')) return '该源是 m3u8，多数电视播不了；mp4 线路投屏最稳'
  return null
}
