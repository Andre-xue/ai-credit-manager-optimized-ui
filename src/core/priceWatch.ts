import { OFFICIAL_UNIT_PRICES } from './value'

/**
 * 价格变动订阅：官方参考单价表维护在仓库 public/prices.json（随 Pages/jsDelivr 分发），
 * 客户端定期拉取并与本地快照对比；某平台单价变化时记录提醒（用量页「价格动态」展示）。
 * 任何网络失败都静默回退，绝不影响主功能。
 */

export interface PriceChange {
  providerId: string
  oldPrice: number
  newPrice: number
  /** 检测到变化的时间 ISO */
  detectedAt: string
}

const SNAPSHOT_KEY = 'acm_price_snapshot_v1'
const ALERTS_KEY = 'acm_price_alerts_v1'
const CHECKED_KEY = 'acm_price_checked_at'
const THROTTLE_MS = 6 * 3600 * 1000

export const PRICE_SOURCES = [
  'https://cdn.jsdelivr.net/gh/Andre-xue/ai-credit-manager-optimized@main/public/prices.json',
  'https://andre-xue.github.io/ai-credit-manager-optimized/prices.json',
]

function validPrices(data: unknown): Record<string, number> | null {
  if (!data || typeof data !== 'object') return null
  const prices = (data as { prices?: unknown }).prices
  if (!prices || typeof prices !== 'object') return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(prices as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/** 本地快照（上次拉到的价格表）；从未拉过时用内置官方价表 */
export function loadPriceSnapshot(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (raw) {
      const parsed = validPrices(JSON.parse(raw))
      if (parsed) return parsed
    }
  } catch { /* 忽略 */ }
  return { ...OFFICIAL_UNIT_PRICES }
}

function savePriceSnapshot(prices: Record<string, number>): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ prices }))
    localStorage.setItem(CHECKED_KEY, new Date().toISOString())
  } catch { /* 忽略 */ }
}

export function lastPriceCheckAt(): string | null {
  try { return localStorage.getItem(CHECKED_KEY) } catch { return null }
}

export function loadPriceAlerts(): PriceChange[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as PriceChange[]
    return Array.isArray(arr) ? arr.filter(c => c && c.providerId && typeof c.newPrice === 'number') : []
  } catch { return [] }
}

export function savePriceAlerts(list: PriceChange[]): void {
  try { localStorage.setItem(ALERTS_KEY, JSON.stringify(list.slice(0, 30))) } catch { /* 忽略 */ }
}

/** 对比两张价格表：只报告「已有平台单价发生变化」（新增/移除平台不算调价） */
export function diffPrices(oldP: Record<string, number>, newP: Record<string, number>, now = new Date().toISOString()): PriceChange[] {
  const changes: PriceChange[] = []
  for (const [providerId, newPrice] of Object.entries(newP)) {
    const oldPrice = oldP[providerId]
    if (typeof oldPrice === 'number' && oldPrice > 0 && Math.abs(oldPrice - newPrice) / oldPrice > 0.0001) {
      changes.push({ providerId, oldPrice, newPrice, detectedAt: now })
    }
  }
  return changes
}

/** 拉取最新价格表并与快照对比；force=false 时 6 小时内不重复拉取 */
export async function checkPriceUpdates(force = false): Promise<{ ok: boolean; changes: PriceChange[]; error?: string }> {
  if (!force) {
    const last = lastPriceCheckAt()
    if (last && Date.now() - new Date(last).getTime() < THROTTLE_MS) {
      return { ok: true, changes: [] }
    }
  }
  let remote: Record<string, number> | null = null
  let lastError = '网络不可用'
  for (const src of PRICE_SOURCES) {
    try {
      const res = await fetch(`${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue }
      remote = validPrices(await res.json())
      if (remote) break
      lastError = '价格表格式无效'
    } catch (e) {
      lastError = e instanceof Error ? e.message : '网络不可用'
    }
  }
  if (!remote) return { ok: false, changes: [], error: lastError }
  const changes = diffPrices(loadPriceSnapshot(), remote)
  savePriceSnapshot(remote)
  return { ok: true, changes }
}
