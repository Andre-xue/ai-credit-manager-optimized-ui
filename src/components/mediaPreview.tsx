// 生成结果的预览交互（v0.1.307，云端/本地生图生视频共用）：
// 1) 悬停浮窗放大：鼠标停在结果图/视频上稍候，旁边浮出大预览（视频为静音自动播放）；
// 2) 视频续播：内嵌视频播放中鼠标移开自动暂停并记住帧，移回从同一帧继续（不从头播）；
// 3) 空格放大：结果卡可聚焦（点选/Tab），按空格打开大图/大视频浮层（各 View 自行接线）。

import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'

export interface HoverItem {
  src: string
  kind: 'image' | 'video'
  rect: { top: number; left: number; width: number; height: number }
}

export function useHoverZoom(delay = 260) {
  const [hover, setHover] = useState<HoverItem | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const enter = (e: ReactMouseEvent, src: string, kind: 'image' | 'video') => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setHover({ src, kind, rect: { top: r.top, left: r.left, width: r.width, height: r.height } })
    }, delay)
  }
  const leave = () => {
    window.clearTimeout(timer.current)
    setHover(null)
  }
  return { hover, enter, leave }
}

export function HoverZoomOverlay({ hover }: { hover: HoverItem | null }) {
  if (!hover) return null
  const W = hover.kind === 'video' ? 560 : 500
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = hover.rect.left + hover.rect.width + 14
  if (left + W > vw - 10) left = Math.max(10, hover.rect.left - W - 14)
  const estH = hover.kind === 'video' ? W * 0.62 : Math.min(vh * 0.7, W)
  let top = hover.rect.top + hover.rect.height / 2 - estH / 2
  top = Math.max(10, Math.min(top, vh - estH - 10))
  return createPortal(
    <div className="hover-zoom" style={{ left, top, width: W }}>
      {hover.kind === 'image'
        ? <img src={hover.src} alt="" />
        : <video src={hover.src} autoPlay muted loop playsInline />}
    </div>,
    document.body,
  )
}

/** 内嵌结果视频的移开暂停/移回续播：暂停不重置 currentTime，回来从离开的那一帧继续 */
export const videoResumeProps = {
  onMouseLeave: (e: ReactMouseEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (!v.paused && !v.ended) {
      v.dataset.hoverResume = '1'
      v.pause()
    }
  },
  onMouseEnter: (e: ReactMouseEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (v.dataset.hoverResume === '1') {
      delete v.dataset.hoverResume
      void v.play().catch(() => { /* 浏览器策略拦截时静默，用户手动点播放即可 */ })
    }
  },
}

/** 结果卡空格/回车放大：焦点在卡片本身（不是内部按钮）时触发 */
export function spaceOpenProps(open: () => void) {
  return {
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if ((e.key === ' ' || e.key === 'Enter') && e.target === e.currentTarget) {
        e.preventDefault()
        open()
      }
    },
  }
}
