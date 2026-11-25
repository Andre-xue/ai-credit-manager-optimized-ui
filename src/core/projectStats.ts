// 按项目汇总用量：给每笔用量打项目标签后，看每个项目花了多少钱。纯函数。

import type { AppState } from './types'

export interface ProjectRow {
  project: string
  monthCost: number
  totalCost: number
  tokens: number
  count: number
}

export function summarizeByProject(state: AppState, month: string): ProjectRow[] {
  const map = new Map<string, ProjectRow>()
  for (const u of state.usage) {
    const key = (u.project ?? '').trim() || '未分类'
    let row = map.get(key)
    if (!row) {
      row = { project: key, monthCost: 0, totalCost: 0, tokens: 0, count: 0 }
      map.set(key, row)
    }
    row.totalCost += u.estimatedCost
    row.tokens += (u.inputTokens || 0) + (u.outputTokens || 0)
    row.count += 1
    if (u.date.startsWith(month)) row.monthCost += u.estimatedCost
  }
  return [...map.values()].sort((a, b) => b.totalCost - a.totalCost)
}

export function projectSuggestions(state: AppState): string[] {
  return [...new Set(state.usage.map((u) => (u.project ?? '').trim()).filter(Boolean))].sort()
}
