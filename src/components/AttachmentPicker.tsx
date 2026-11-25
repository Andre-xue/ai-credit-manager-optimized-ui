// 附件选择对话框：在对话框内「点击选择」或「拖拽文件进入」，并即时预览。
// 桌面 / Web：基于 <input type=file> + FileReader（无需 Tauri fs 权限，最稳妥），支持多选。
// 手机：保留相机/相册入口（Capacitor Camera），文件同样走 input。
// 选中项在本组件内以 PickedAttachment 暂存，确认后再交给对话发送。

import { useRef, useState, type DragEvent } from 'react'
import { X, UploadCloud, FileText, Image as ImageIcon, Video, Music, Check, Camera, Images } from 'lucide-react'
import {
  currentPlatform, fileToAttachment, formatSize, pickAttachment,
  type AttachmentKind, type PickedAttachment,
} from '../core/attachments'
import { t } from '../core/i18n'

const MAX_BYTES = 8 * 1024 * 1024

export function AttachmentPicker({ onClose, onConfirm, notify }: {
  onClose: () => void
  onConfirm: (items: PickedAttachment[]) => void
  notify: (m: string) => void
}) {
  const [items, setItems] = useState<PickedAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const platform = currentPlatform()

  const addFiles = async (files: File[], kind: AttachmentKind) => {
    const picked: PickedAttachment[] = []
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        notify(t('「{name}」超过 8MB，已跳过', { name: f.name }))
        continue
      }
      try {
        picked.push(await fileToAttachment(f, kind))
      } catch {
        notify(t('「{name}」读取失败，已跳过', { name: f.name }))
      }
    }
    if (picked.length) setItems(prev => [...prev, ...picked])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) void addFiles(files, 'file')
  }

  const openCamera = async (kind: 'camera' | 'album') => {
    setBusy(true)
    try {
      const one = await pickAttachment(kind)
      if (one) setItems(prev => [...prev, one])
    } catch (err) {
      notify((err as Error).message ?? t('获取照片失败'))
    } finally {
      setBusy(false)
    }
  }

  const removeAt = (i: number) => setItems(prev => prev.filter((_, j) => j !== i))

  const iconFor = (a: PickedAttachment) => {
    if (a.mime.startsWith('image/')) return <ImageIcon size={22} />
    if (a.mime.startsWith('video/')) return <Video size={22} />
    if (a.mime.startsWith('audio/')) return <Music size={22} />
    return <FileText size={22} />
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal ap-modal" role="dialog" aria-label={t('添加附件')}>
        <div className="modal-head">
          <h3>{t('添加附件')}</h3>
          <button className="ap-x" onClick={onClose} title={t('关闭')}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div
            className={`ap-dropzone ${dragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragEnter={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={e => {
              // 仅当真正离开拖放区（而非移到子元素）时取消高亮
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
            }}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud size={38} strokeWidth={1.5} />
            <div className="ap-drop-title">{t('点击选择文件，或拖拽到此处')}</div>
            <div className="ap-drop-hint">{t('支持图片、音频、视频、文档等 · 单个文件不超过 8MB · 可多选')}</div>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="ap-file-input"
              onChange={e => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) void addFiles(files, 'file')
                e.target.value = ''  // 允许重复选择同一文件
              }}
            />
          </div>

          {platform === 'mobile' && (
            <div className="ap-camera-row">
              <button disabled={busy} onClick={() => void openCamera('camera')}><Camera size={16} /> {t('拍照')}</button>
              <button disabled={busy} onClick={() => void openCamera('album')}><Images size={16} /> {t('从相册选')}</button>
            </div>
          )}

          {items.length > 0 && (
            <div className="ap-section">
              <div className="ap-section-head">
                <span>{t('已选择 · {count} 个', { count: items.length })}</span>
                <button className="ap-clear" onClick={() => setItems([])}>{t('清空')}</button>
              </div>
              <div className="ap-grid">
                {items.map((a, i) => (
                  <div className="ap-item" key={`${a.name}-${i}`}>
                    <div className="ap-thumb">
                      {a.mime.startsWith('image/')
                        ? <img src={a.dataUrl} alt={a.name} />
                        : a.mime.startsWith('video/')
                          ? <video src={a.dataUrl} muted playsInline />
                          : iconFor(a)}
                    </div>
                    <div className="ap-item-info">
                      <div className="ap-item-name" title={a.name}>{a.name}</div>
                      <div className="ap-item-meta">{formatSize(a.size)} · {a.mime.split('/')[1]?.toUpperCase() ?? t('文件')}</div>
                    </div>
                    <button className="ap-item-remove" onClick={() => removeAt(i)} title={t('移除')}><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" disabled={!items.length || busy} onClick={() => onConfirm(items)}>
            <Check size={15} /> {t('添加')} {items.length > 0 ? `(${items.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
