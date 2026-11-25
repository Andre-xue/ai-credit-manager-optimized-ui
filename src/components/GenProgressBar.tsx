// 生成进度条组件：云端/本地 × 图像/视频 四个生成页共用。
// 多数生图/生视频接口不返回真实百分比，故采用「阶段驱动」的模拟进度：
// 提交 → 排队/连接 → 生成中（按轮询次数/等待时间推进）→ 完成/失败。
// UI 明确标注为「预计进度」，避免误导用户以为是接口精确上报。

import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, AlertCircle } from 'lucide-react'
import { t } from '../core/i18n'
import type { GenPhase, GenProgress } from '../core/genTasks'

export type { GenPhase, GenProgress }

/** 进度条渲染组件 */
export function GenProgressBar({ progress, compact }: { progress: GenProgress; compact?: boolean }) {
  if (progress.phase === 'idle') return null
  const done = progress.phase === 'done'
  const error = progress.phase === 'error'
  return (
    <div className={`gen-progress ${compact ? 'compact' : ''} ${done ? 'is-done' : ''} ${error ? 'is-error' : ''}`}>
      <div className="gen-progress-top">
        <span className="gen-progress-status">
          {done ? <Check size={13} /> : error ? <AlertCircle size={13} /> : <Loader2 size={13} className="spin" />}
          {progress.label}
        </span>
        <span className="gen-progress-pct">{percentText(progress)}</span>
      </div>
      <div className="gen-progress-track"><div className="gen-progress-fill" style={{ width: `${progress.percent}%` }} /></div>
      {!compact && <div className="gen-progress-foot">{t('预计进度 · 实际耗时取决于服务商与本地算力')}</div>}
    </div>
  )
}

function percentText(p: GenProgress): string {
  if (p.phase === 'done') return '100%'
  if (p.phase === 'error') return '—'
  return `${Math.round(p.percent)}%`
}

/**
 * 进度状态管理 hook：按阶段推进百分比，生成中随时间缓慢递增（上限可设）。
 * 轮询型任务可调用 advance() 手动推进；同步任务靠定时器爬升。
 */
export function useGenProgress() {
  const [progress, setProgress] = useState<GenProgress>({ phase: 'idle', percent: 0, label: '' })
  const timer = useRef<number | null>(null)
  const ceiling = useRef(88)

  const clearTimer = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null } }

  const start = (label = t('正在连接…')) => {
    clearTimer()
    ceiling.current = 88
    setProgress({ phase: 'submitting', percent: 8, label })
    // 每 600ms 缓慢爬升，逼近 ceiling（模拟进度，上限 88% 留给用户完成阶段）
    timer.current = window.setInterval(() => {
      setProgress(prev => {
        if (prev.phase === 'done' || prev.phase === 'error') return prev
        const next = Math.min(ceiling.current, prev.percent + (88 - prev.percent) * 0.12 + 0.6)
        let phase = prev.phase
        if (prev.percent >= 25 && phase === 'submitting') phase = 'generating'
        return { ...prev, percent: next, phase, label: prev.label }
      })
    }, 600)
  }

  const setLabel = (label: string, phase?: GenPhase) => setProgress(prev => ({ ...prev, label, phase: phase ?? prev.phase }))

  /** 轮询推进：按任务状态给一个合理的进度值 */
  const advance = (percent: number, label: string, phase: GenPhase = 'generating') => {
    ceiling.current = Math.max(ceiling.current, percent)
    setProgress(prev => ({ phase, percent: Math.max(prev.percent, percent), label }))
  }

  const done = (label = t('生成完成')) => { clearTimer(); setProgress({ phase: 'done', percent: 100, label }) }
  const fail = (label: string) => { clearTimer(); setProgress(prev => ({ phase: 'error', percent: prev.percent, label })) }
  const reset = () => { clearTimer(); setProgress({ phase: 'idle', percent: 0, label: '' }) }

  useEffect(() => () => clearTimer(), [])

  return { progress, start, setLabel, advance, done, fail, reset }
}
