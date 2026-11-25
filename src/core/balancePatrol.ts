// 余额自动巡检间隔（v0.1.299）：设置 → 通用 →「余额自动刷新间隔」。
// 设备级偏好，只存本机 localStorage（与巡检时间戳同一待遇，不云同步）。
// 0 = 关闭自动刷新；其余为间隔小时数，默认 6。

import type { Account, CreditUnit } from './types'
import { decryptSecret } from './crypto'
import { getAdapterWithPlugins } from './pluginRuntime'

export interface FetchedBalance { used: number; total?: number; unit: CreditUnit }
export interface BalanceRefreshResult { supported: number; updated: number; failed: number }

/**
 * 全量刷新一遍可自动查余额平台的余额（自动巡检与手动「全局刷新」共用，v0.1.302）。
 * 逐账户解密 → 官方接口 → apply 回调落快照；单账户失败计数后继续，不中断整批；
 * 无总额度的结果（仅 label）不算更新。
 */
export async function refreshAllBalances(
  accounts: Account[],
  pwd: string,
  apply: (accountId: string, r: FetchedBalance) => void,
): Promise<BalanceRefreshResult> {
  let supported = 0, updated = 0, failed = 0
  for (const a of accounts) {
    if (!a.encryptedKey) continue
    const adapter = getAdapterWithPlugins(a.providerId)
    if (!adapter.supported) continue
    supported++
    try {
      const plain = await decryptSecret(a.encryptedKey, pwd)
      const r = await adapter.fetchUsage!(plain)
      if (r.total === undefined) continue
      updated++
      apply(a.id, { used: r.used, total: r.total, unit: r.unit })
    } catch { failed++ }
  }
  return { supported, updated, failed }
}

export const PATROL_HOURS_KEY = 'acm.balance.patrolHours'
export const PATROL_AT_KEY = 'acm_balance_patrol_at'
export const PATROL_HOUR_OPTIONS = [0, 1, 3, 6, 12, 24] as const
export const DEFAULT_PATROL_HOURS = 6

export function loadPatrolHours(): number {
  try {
    const raw = localStorage.getItem(PATROL_HOURS_KEY)
    if (raw === null || raw === '') return DEFAULT_PATROL_HOURS // 未设置过（Number(null) 会误读成 0=关闭）
    const v = Number(raw)
    return (PATROL_HOUR_OPTIONS as readonly number[]).includes(v) ? v : DEFAULT_PATROL_HOURS
  } catch {
    return DEFAULT_PATROL_HOURS
  }
}

export function savePatrolHours(hours: number): void {
  try { localStorage.setItem(PATROL_HOURS_KEY, String(hours)) } catch { /* ignore */ }
}

/** 距上次巡检是否已达到间隔（关闭时恒 false） */
export function patrolDue(now: number, hours: number, lastAt: number): boolean {
  if (hours <= 0) return false
  return now - lastAt >= hours * 3600 * 1000
}
