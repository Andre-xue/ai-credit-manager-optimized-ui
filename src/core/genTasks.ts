// 云端生成任务管理器（v0.1.303）：AI 图像 / AI 视频的生成任务活在模块层，
// 不绑定任何页面组件——用户切换页面后任务继续在后台跑，完成时由执行体写好
// 历史（localStorage），页面回来时从这里读到进度/结果。
// 此前任务写在 View 组件里：视频轮询靠 aliveRef，组件一卸载就 return，
// 结果不落历史、页面上「没有任何数据」；且请求无超时，进度条爬到 88% 上限后
// 若请求一直不返回就永远卡在 88%（超时改在 providerCall 层加）。

import type { MediaKind } from './mediaGeneration'
import { errTextSafe } from './mediaGeneration'

export type GenPhase = 'idle' | 'submitting' | 'queued' | 'generating' | 'done' | 'error'

export interface GenProgress {
  phase: GenPhase
  percent: number
  label: string
}

export interface GenTaskOutcome {
  results: string[]
  /** 结果区状态文本（视频的任务状态、图片的返回说明等） */
  note: string
  /** 进度条完成文案，如「生成完成 · 耗时 12.3s」 */
  doneLabel?: string
}

export interface GenTaskState {
  kind: MediaKind
  status: 'idle' | 'running' | 'done' | 'error'
  progress: GenProgress
  results: string[]
  note: string
  prompt: string
  startedAt: number
}

export interface GenReporter {
  /** 推进进度（只增不减），同时更新结果区状态文本 */
  advance: (percent: number, label: string, phase?: GenPhase) => void
  setLabel: (label: string, phase?: GenPhase) => void
  /** 只更新结果区状态文本（如视频轮询的任务状态），不动进度条 */
  setNote: (note: string) => void
}

const idleState = (kind: MediaKind): GenTaskState => ({
  kind, status: 'idle',
  progress: { phase: 'idle', percent: 0, label: '' },
  results: [], note: '', prompt: '', startedAt: 0,
})

const states: Record<MediaKind, GenTaskState> = { image: idleState('image'), video: idleState('video') }
const listeners: Record<MediaKind, Set<() => void>> = { image: new Set(), video: new Set() }
const ceilings: Record<MediaKind, number> = { image: 88, video: 88 }
const crawlTimers: Record<MediaKind, ReturnType<typeof setInterval> | null> = { image: null, video: null }

function emit(kind: MediaKind): void {
  listeners[kind].forEach(fn => { try { fn() } catch { /* 订阅者异常不影响任务 */ } })
}

function patch(kind: MediaKind, p: Partial<GenTaskState>): void {
  states[kind] = { ...states[kind], ...p }
  emit(kind)
}

function patchProgress(kind: MediaKind, p: Partial<GenProgress>): void {
  states[kind] = { ...states[kind], progress: { ...states[kind].progress, ...p } }
  emit(kind)
}

export function getGenTask(kind: MediaKind): GenTaskState {
  return states[kind]
}

export function subscribeGenTask(kind: MediaKind, fn: () => void): () => void {
  listeners[kind].add(fn)
  return () => { listeners[kind].delete(fn) }
}

function stopCrawl(kind: MediaKind): void {
  if (crawlTimers[kind] !== null) { clearInterval(crawlTimers[kind]!); crawlTimers[kind] = null }
}

/** 模拟进度爬升（与原 useGenProgress 同算法）：600ms 一步，逼近上限 88% */
function startCrawl(kind: MediaKind): void {
  stopCrawl(kind)
  crawlTimers[kind] = setInterval(() => {
    const s = states[kind]
    if (s.status !== 'running') { stopCrawl(kind); return }
    const prev = s.progress
    const next = Math.min(ceilings[kind], prev.percent + (88 - prev.percent) * 0.12 + 0.6)
    const phase = prev.percent >= 25 && prev.phase === 'submitting' ? 'generating' : prev.phase
    patchProgress(kind, { percent: next, phase })
  }, 600)
}

/**
 * 启动一个生成任务。已有同类任务在跑时返回 false（不重复提交）。
 * run 执行体负责真正的调用与历史落盘（addHistory），管理器只管状态与进度，
 * 因此页面卸载后任务照常完成、结果照常保存。
 */
export function startGenTask(
  kind: MediaKind,
  prompt: string,
  run: (rep: GenReporter) => Promise<GenTaskOutcome>,
): boolean {
  if (states[kind].status === 'running') return false
  ceilings[kind] = 88
  patch(kind, {
    status: 'running', results: [], note: '', prompt, startedAt: Date.now(),
    progress: { phase: 'submitting', percent: 8, label: '' },
  })
  startCrawl(kind)
  const rep: GenReporter = {
    advance: (percent, label, phase = 'generating') => {
      ceilings[kind] = Math.max(ceilings[kind], percent)
      const cur = states[kind].progress
      patch(kind, {
        note: label,
        progress: { phase, percent: Math.max(cur.percent, percent), label },
      })
    },
    setLabel: (label, phase) => patchProgress(kind, { label, phase: phase ?? states[kind].progress.phase }),
    setNote: (note) => patch(kind, { note }),
  }
  void (async () => {
    try {
      const out = await run(rep)
      stopCrawl(kind)
      patch(kind, {
        status: 'done', results: out.results, note: out.note,
        progress: { phase: 'done', percent: 100, label: out.doneLabel ?? '生成完成' },
      })
    } catch (e) {
      stopCrawl(kind)
      const msg = errTextSafe(e)
      patch(kind, {
        status: 'error', note: msg,
        progress: { phase: 'error', percent: states[kind].progress.percent, label: msg },
      })
    }
  })()
  return true
}

/** 页面重新挂载时若任务已结束，可手动清回 idle（结果已在历史里） */
export function resetGenTask(kind: MediaKind): void {
  if (states[kind].status === 'running') return
  stopCrawl(kind)
  states[kind] = idleState(kind)
  emit(kind)
}
