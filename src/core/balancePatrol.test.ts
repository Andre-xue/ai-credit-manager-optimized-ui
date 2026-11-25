import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadPatrolHours, savePatrolHours, patrolDue, DEFAULT_PATROL_HOURS, refreshAllBalances } from './balancePatrol'
import type { Account } from './types'

vi.mock('./crypto', () => ({
  decryptSecret: async (enc: string) => enc.replace('enc:', ''),
}))
vi.mock('./pluginRuntime', () => ({
  getAdapterWithPlugins: (providerId: string) => {
    if (providerId === 'deepseek') return { supported: true, fetchUsage: async (k: string) => { if (k === 'bad') throw new Error('401'); return { used: 10, total: 90, unit: 'currency' as const } } }
    if (providerId === 'glm') return { supported: true, fetchUsage: async () => ({ used: 0, total: undefined, unit: 'token' as const }) }
    return { supported: false }
  },
}))

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

beforeEach(() => { (globalThis as any).localStorage.clear() })

describe('balancePatrol', () => {
  it('默认 6 小时；非法值回退默认', () => {
    expect(loadPatrolHours()).toBe(DEFAULT_PATROL_HOURS)
    savePatrolHours(99)
    expect(loadPatrolHours()).toBe(DEFAULT_PATROL_HOURS)
  })
  it('合法选项可存取，含关闭（0）', () => {
    savePatrolHours(1)
    expect(loadPatrolHours()).toBe(1)
    savePatrolHours(0)
    expect(loadPatrolHours()).toBe(0)
  })
  it('patrolDue：关闭恒 false；未到期 false；到期 true', () => {
    const now = 100 * 3600 * 1000
    expect(patrolDue(now, 0, 0)).toBe(false)
    expect(patrolDue(now, 6, now - 5 * 3600 * 1000)).toBe(false)
    expect(patrolDue(now, 6, now - 6 * 3600 * 1000)).toBe(true)
    expect(patrolDue(now, 1, 0)).toBe(true)
  })
})

describe('refreshAllBalances（全局刷新）', () => {
  const acc = (id: string, providerId: string, encryptedKey?: string): Account => ({
    id, providerId, label: id, mode: 'api', encryptedKey,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  })

  it('统计 supported/updated/failed；无总额度不算更新；不支持的平台跳过', async () => {
    const applied: string[] = []
    const res = await refreshAllBalances([
      acc('ok', 'deepseek', 'enc:good'),
      acc('bad', 'deepseek', 'enc:bad'),
      acc('nototal', 'glm', 'enc:x'),
      acc('unsupported', 'openai', 'enc:y'),
      acc('nokey', 'deepseek', undefined),
    ], 'pwd', (id) => applied.push(id))
    expect(res).toEqual({ supported: 3, updated: 1, failed: 1 })
    expect(applied).toEqual(['ok'])
  })
})
