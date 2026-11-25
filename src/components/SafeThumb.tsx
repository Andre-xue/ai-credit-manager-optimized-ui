// 安全缩略图：优先显示本地 data URL；远程链接加载失败时显示「已过期」占位而非破图。
import { useState } from 'react'
import { ImageOff } from 'lucide-react'

export function SafeThumb({ src, fallbackSrc, className, onClick, title }: {
  src: string; fallbackSrc?: string; className?: string; onClick?: () => void; title?: string
}) {
  const [current, setCurrent] = useState(src)
  const [failed, setFailed] = useState(false)
  if (failed || !current) {
    return <span className={`safe-thumb-failed ${className ?? ''}`} title={title ?? '原图链接已过期，请重新生成'}><ImageOff size={14} /></span>
  }
  return <img src={current} className={className} alt="缩略图" title={title} onClick={onClick}
    onError={() => {
      // 先尝试回退到远程原 URL（本地缩略图损坏时），都失败才显示占位
      if (fallbackSrc && current !== fallbackSrc) { setCurrent(fallbackSrc); return }
      setFailed(true)
    }} />
}
