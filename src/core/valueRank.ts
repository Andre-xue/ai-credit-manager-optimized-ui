// 性价比榜：用已有的用量记录算各平台/模型的实际成本（¥ / 百万 token），
// 纯本地统计。样本太少（token 量低于阈值）的条目不纳入，避免一条记录定排名。

import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'

export interface ValueRankRow {
  key: string
  name: string
  tokens: number
  cost: number
  /** ¥ / 百万 token，越低越划算 */
  perMillion: number
  records: number
}

export const VALUE_RANK_MIN_TOKENS = 10_000

function aggregate(state: AppState, keyOf: (u: AppState['usage'][number]) => { key: string; name: string } | null, minTokens: number): ValueRankRow[] {
  const map = new Map<string, ValueRankRow>()
  for (const u of state.usage) {
    const k = keyOf(u)
    if (!k) continue
    const tokens = (u.inputTokens || 0) + (u.outputTokens || 0)
    const row = map.get(k.key) ?? { key: k.key, name: k.name, tokens: 0, cost: 0, perMillion: 0, records: 0 }
    row.tokens += tokens
    row.cost += u.estimatedCost || 0
    row.records += 1
    map.set(k.key, row)
  }
  return [...map.values()]
    .filter((r) => r.tokens >= minTokens)
    .map((r) => ({ ...r, perMillion: r.tokens > 0 ? (r.cost / r.tokens) * 1_000_000 : 0 }))
    .sort((a, b) => a.perMillion - b.perMillion)
}

export function rankProvidersByValue(state: AppState, minTokens: number = VALUE_RANK_MIN_TOKENS): ValueRankRow[] {
  const accountProvider = new Map(state.accounts.map((a) => [a.id, a.providerId]))
  return aggregate(state, (u) => {
    const pid = accountProvider.get(u.accountId)
    if (!pid) return null
    return { key: pid, name: PROVIDER_MAP[pid]?.shortName ?? pid }
  }, minTokens)
}

export function rankModelsByValue(state: AppState, minTokens: number = VALUE_RANK_MIN_TOKENS): ValueRankRow[] {
  return aggregate(state, (u) => (u.model ? { key: u.model, name: u.model } : null), minTokens)
}
