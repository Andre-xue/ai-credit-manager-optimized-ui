// Hold to Confirm：圆形删除按钮，长按 1 秒确认危险操作。
// 按住：外圈进度环顺时针走满 1s；中途松手进度环倒退归零；
// 走满：左右轻震 + 手机震动 + 变成对勾和「已删除」，随后触发 onConfirm。
// 手机端（真机或 ?preview=phone）启用长按；桌面端降级为普通点击删除。

import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Check } from 'lucide-react'
import { isNativeApp } from '../core/openExternal'
import { t } from '../core/i18n'

interface Props {
  onConfirm: () => void
  title?: string
  size?: number
  holdMs?: number
  className?: string
}

const RING = 15
const CIRC = 2 * Math.PI * RING

/** 是否处于手机端 UI（真机或预览） */
function isPhoneUI(): boolean {
  if (isNativeApp()) return true
  try { return new URLSearchParams(window.location.search).get('preview') === 'phone' } catch { return false }
}

export function HoldToConfirm({ onConfirm, title = '删除', size = 34, holdMs = 1000, className = '' }: Props) {
  const phone = useRef(isPhoneUI()).current
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'holding' | 'releasing' | 'done'>('idle')
  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const progressRef = useRef(0)
  const doneRef = useRef(false)

  const setProg = (p: number) => { progressRef.current = p; setProgress(p) }
  const stopRaf = () => { if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null } }

  // 震动：navigator.vibrate（移动 WebView 普遍支持），不支持时仅保留视觉抖动
  const buzz = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([30, 40, 30])
    } catch { /* 忽略：仅视觉反馈 */ }
  }, [])

  const complete = useCallback(() => {
    stopRaf()
    setProg(1)
    doneRef.current = true
    setPhase('done')
    buzz() // 走满立即震动 + 抖动 + 显示对勾「已删除」
    // 先让用户看到完成反馈，再执行真正的删除（否则组件随数据一起消失，看不到对勾）
    window.setTimeout(onConfirm, 700)
    window.setTimeout(() => {
      doneRef.current = false
      setProg(0)
      setPhase('idle')
    }, 1400)
  }, [buzz, onConfirm])

  const tickForward = useCallback(() => {
    const elapsed = performance.now() - startRef.current
    const p = Math.min(1, elapsed / holdMs)
    setProg(p)
    if (p >= 1) complete()
    else rafRef.current = requestAnimationFrame(tickForward)
  }, [complete, holdMs])

  const tickBack = useCallback(() => {
    const p = progressRef.current - 0.06
    if (p <= 0) { setProg(0); setPhase('idle'); rafRef.current = null }
    else { setProg(p); rafRef.current = requestAnimationFrame(tickBack) }
  }, [])

  const start = (e: React.PointerEvent) => {
    if (!phone || phase === 'done' || phase === 'holding') return
    e.preventDefault()
    stopRaf()
    setPhase('holding')
    startRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tickForward)
  }

  const cancel = () => {
    if (phase !== 'holding') return
    stopRaf()
    setPhase('releasing')
    rafRef.current = requestAnimationFrame(tickBack)
  }

  useEffect(() => () => stopRaf(), [])

  // 桌面端：普通点击删除
  if (!phone) {
    return <button className={`icon-btn danger ${className}`} title={t(title)} onClick={onConfirm}><Trash2 size={14} /></button>
  }

  const offset = CIRC * (1 - progress)
  return (
    <button
      className={`hold-confirm ${phase === 'done' ? 'done' : ''} ${phase === 'holding' ? 'holding' : ''} ${className}`}
      style={{ width: size, height: size }}
      title={t('长按 {sec} 秒{action}', { sec: holdMs / 1000, action: t(title) })}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}
    >
      <svg className="hold-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="hold-ring-track" cx={size / 2} cy={size / 2} r={RING} fill="none" strokeWidth="2.5" />
        <circle
          className="hold-ring-progress" cx={size / 2} cy={size / 2} r={RING} fill="none" strokeWidth="2.5"
          strokeDasharray={CIRC} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="hold-icon">{phase === 'done' ? <Check size={15} strokeWidth={2.6} /> : <Trash2 size={14} />}</span>
      {phase === 'done' && <span className="hold-done-label">{t('已删除')}</span>}
    </button>
  )
}
