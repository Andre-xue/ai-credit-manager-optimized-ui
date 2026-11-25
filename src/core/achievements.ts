// 签到成就：从签到记录算累计次数/天数/连续天数，对照徽章目标给出达成与进度。纯函数。

import type { AppState } from './types'
import { checkinStreak } from './calendar'
import { todayISO } from './store'

export interface Achievement {
  id: string
  title: string
  desc: string
  earned: boolean
  current: number
  target: number
}

export function checkinStats(state: AppState, today: string = todayISO()): { totalDone: number; totalDays: number; streak: number } {
  const done = state.checkins.filter((c) => c.done)
  return {
    totalDone: done.length,
    totalDays: new Set(done.map((c) => c.date)).size,
    streak: checkinStreak(state, today),
  }
}

const DEFS: Array<{ id: string; title: string; desc: string; metric: 'totalDone' | 'totalDays' | 'streak'; target: number }> = [
  { id: 'done-10', title: '初露锋芒', desc: '累计签到 10 次', metric: 'totalDone', target: 10 },
  { id: 'done-50', title: '坚持不懈', desc: '累计签到 50 次', metric: 'totalDone', target: 50 },
  { id: 'done-200', title: '签到达人', desc: '累计签到 200 次', metric: 'totalDone', target: 200 },
  { id: 'days-30', title: '月度常客', desc: '累计签到 30 天', metric: 'totalDays', target: 30 },
  { id: 'days-100', title: '百日常客', desc: '累计签到 100 天', metric: 'totalDays', target: 100 },
  { id: 'streak-7', title: '周周满勤', desc: '连续签到 7 天', metric: 'streak', target: 7 },
  { id: 'streak-30', title: '月度全勤王', desc: '连续签到 30 天', metric: 'streak', target: 30 },
  { id: 'streak-100', title: '百日筑基', desc: '连续签到 100 天', metric: 'streak', target: 100 },
]

export function buildAchievements(state: AppState, today: string = todayISO()): Achievement[] {
  const stats = checkinStats(state, today)
  return DEFS.map((d) => {
    const current = stats[d.metric]
    return { id: d.id, title: d.title, desc: d.desc, earned: current >= d.target, current: Math.min(current, d.target), target: d.target }
  })
}
