// 统一导出保存：让用户自定义导出文件的位置（全 App 导出入口都走这里）。
// - 桌面端：弹系统目录选择框（choose_save_dir），写入所选目录（文本 write_file_to_dir / 二进制 write_binary_to_dir）
// - 网页端：优先 File System Access「另存为」对话框（showSaveFilePicker，可任选位置），不支持时退回浏览器下载
// - 安卓端：系统不向应用开放通用另存为对话框，写入公共「文档/AI积分管家」目录并返回路径（失败退到应用专属目录）
import { isDesktopApp, isNativeApp } from './openExternal'
import { storageDir, type StorageKind } from './storagePrefs'

export interface SaveResult {
  ok: boolean
  /** 实际保存位置（路径或说明） */
  where?: string
  /** 用户在选择框里取消了 */
  cancelled?: boolean
  error?: string
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function tauriInvoke(): Invoke | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  return btoa(bin)
}

function anchorDownload(filename: string, blob: Blob): SaveResult {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { ok: true, where: '浏览器下载' }
}

export async function saveExportFile(filename: string, data: string | Blob, kind?: Extract<StorageKind, 'ai' | 'media'>): Promise<SaveResult> {
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain;charset=utf-8' }) : data

  if (isDesktopApp()) {
    const invoke = tauriInvoke()
    if (invoke) {
      try {
        // 数据存储已为该类文件指定文件夹时直接写入，不再弹选择框
        const dir = (kind ? storageDir(kind) : null) ?? (await invoke('choose_save_dir')) as string | null
        if (!dir) return { ok: false, cancelled: true }
        if (typeof data === 'string') {
          const path = (await invoke('write_file_to_dir', { dir, filename, content: data })) as string
          return { ok: true, where: path }
        }
        const base64 = await blobToBase64(blob)
        const path = (await invoke('write_binary_to_dir', { dir, filename, contentBase64: base64 })) as string
        return { ok: true, where: path }
      } catch (e) {
        return { ok: false, error: (e as Error)?.message ?? String(e) }
      }
    }
  }

  if (isNativeApp()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      const base64 = await blobToBase64(blob)
      try {
        await Filesystem.writeFile({ path: `AI积分管家/${filename}`, directory: Directory.Documents, data: base64, recursive: true })
        return { ok: true, where: `文档/AI积分管家/${filename}` }
      } catch {
        await Filesystem.writeFile({ path: `AI积分管家/${filename}`, directory: Directory.External, data: base64, recursive: true })
        return { ok: true, where: `应用文件/AI积分管家/${filename}` }
      }
    } catch { /* 落到浏览器下载兜底 */ }
    return anchorDownload(filename, blob)
  }

  const w = window as unknown as {
    showSaveFilePicker?: (opts: { suggestedName: string }) => Promise<{
      name?: string
      createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>
    }>
  }
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: filename })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { ok: true, where: handle.name ?? filename }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { ok: false, cancelled: true }
      return anchorDownload(filename, blob)
    }
  }
  return anchorDownload(filename, blob)
}
