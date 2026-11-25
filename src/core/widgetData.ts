// 安卓桌面小组件数据桥：把「剩余额度 / 待签到」摘要写进 Capacitor Preferences
// （即 SharedPreferences "CapacitorStorage"），CI 注入的原生小组件
// AcmWidgetProvider 读同一份数据渲染到手机桌面。仅安卓原生端有意义，其他端静默跳过。
// 待签到口径与迷你窗（MiniView）一致：CHECKIN_TOOLS 中今日未完成的个数。

import type { AppState } from './types'
import { todayISO } from './store'
import { CHECKIN_TOOLS } from '../data/agentTools'

export interface WidgetSummary {
  /** 货币额度剩余总额（无数据时为占位文案） */
  remainingText: string
  /** 今日待签到个数 */
  pendingCheckins: number
  /** 摘要更新时间 HH:mm */
  updatedLabel: string
}

export function buildWidgetSummary(state: AppState): WidgetSummary {
  let remaining = 0
  let hasCurrency = false
  for (const a of state.accounts) {
    const qs = state.quotas.filter((q) => q.accountId === a.id && q.unit === 'currency')
    if (!qs.length) continue
    const latest = qs.reduce((m, q) => (q.capturedAt > m.capturedAt ? q : m), qs[0])
    hasCurrency = true
    remaining += Math.max(0, latest.total - latest.used)
  }
  const today = todayISO()
  const pendingCheckins = CHECKIN_TOOLS.filter(
    (t) => !state.checkins.some((c) => c.providerId === t.id && c.date === today && c.done),
  ).length
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    remainingText: hasCurrency
      ? `¥${remaining.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
      : '暂无额度数据',
    pendingCheckins,
    updatedLabel: `${p(now.getHours())}:${p(now.getMinutes())}`,
  }
}

let widgetTimer: ReturnType<typeof setTimeout> | null = null

/** 防抖写入（状态频繁变化时合并），失败静默（非原生环境没有 Preferences 插件） */
export function syncWidgetData(state: AppState): void {
  if (widgetTimer !== null) clearTimeout(widgetTimer)
  widgetTimer = setTimeout(() => {
    widgetTimer = null
    void (async () => {
      try {
        const { Preferences } = await import('@capacitor/preferences')
        await Preferences.set({ key: 'acm_widget_summary', value: JSON.stringify(buildWidgetSummary(state)) })
      } catch { /* 非原生环境或插件不可用：忽略 */ }
    })()
  }, 800)
}
