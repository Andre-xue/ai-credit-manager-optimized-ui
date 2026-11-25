import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadState, saveState, addAccount, removeAccount, upsertQuota,
  toggleCheckin, addUsageEvent, exportState, importState, mergeState,
  updateSettings, clearAllData,
} from './store'
import type { AppState } from './types'

// 内存版 localStorage polyfill
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

const fresh = (): AppState => ({
  version: 1, accounts: [], quotas: [], checkins: [], benefitMarks: [], usage: [],
  settings: { vaultInitialized: false, monthlyBudget: 200, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, unlockMethod: 'password', unitPrices: {} },
})

describe('store 持久化与基础操作', () => {
  beforeEach(() => { (localStorage as any).clear() })

  it('空状态加载', () => {
    expect(loadState().accounts).toEqual([])
  })

  it('保存后加载往返', () => {
    const s = fresh()
    const next = addAccount(s, { providerId: 'openai', label: '测试', mode: 'manual' })
    saveState(next)
    expect(loadState().accounts).toHaveLength(1)
  })

  it('添加账户生成唯一 id 与时间戳', () => {
    const a = addAccount(fresh(), { providerId: 'openai', label: 'A', mode: 'manual' })
    expect(a.accounts[0].id).toMatch(/^acc_/)
    expect(a.accounts[0].createdAt).toBeTruthy()
  })

  it('新账户置顶到列表最前', () => {
    let s = addAccount(fresh(), { providerId: 'openai', label: '旧的', mode: 'manual' })
    s = addAccount(s, { providerId: 'deepseek', label: '新的', mode: 'manual' })
    expect(s.accounts[0].label).toBe('新的')
    expect(s.accounts[1].label).toBe('旧的')
  })

  it('移除账户级联清理额度/用量/签到', () => {
    let s = addAccount(fresh(), { providerId: 'openai', label: 'A', mode: 'manual' })
    const id = s.accounts[0].id
    s = upsertQuota(s, { accountId: id, unit: 'credit', used: 5, total: 10 })
    s = addUsageEvent(s, { accountId: id, date: '2026-01-01', inputTokens: 1, outputTokens: 1, estimatedCost: 0.1 })
    s = toggleCheckin(s, 'openai', id)
    s = removeAccount(s, id)
    expect(s.accounts).toHaveLength(0)
    expect(s.quotas).toHaveLength(0)
    expect(s.usage).toHaveLength(0)
    expect(s.checkins).toHaveLength(0)
  })

  it('upsertQuota 保留历史快照，latestQuota 取最新', async () => {
    const { latestQuota } = await import('./store')
    let s = addAccount(fresh(), { providerId: 'openai', label: 'A', mode: 'manual' })
    const id = s.accounts[0].id
    s = upsertQuota(s, { accountId: id, unit: 'credit', used: 1, total: 10 })
    s = upsertQuota(s, { accountId: id, unit: 'credit', used: 8, total: 10 })
    expect(s.quotas).toHaveLength(2)
    expect(latestQuota(s.quotas, id)?.used).toBe(8)
  })

  it('toggleCheckin 同日切换完成状态', () => {
    let s = toggleCheckin(fresh(), 'openai')
    expect(s.checkins[0].done).toBe(true)
    s = toggleCheckin(s, 'openai')
    expect(s.checkins[0].done).toBe(false)
  })

  it('toggleCheckin 区分账户维度与全局记录，互不覆盖', () => {
    let s = toggleCheckin(fresh(), 'openai', 'acct-1') // 账户维度记录
    s = toggleCheckin(s, 'openai')                     // 全局记录
    expect(s.checkins).toHaveLength(2)
    expect(s.checkins.find(c => c.accountId === 'acct-1')?.done).toBe(true)
    expect(s.checkins.find(c => !c.accountId)?.done).toBe(true)
    s = toggleCheckin(s, 'openai')                     // 只切全局，不动账户记录
    expect(s.checkins.find(c => c.accountId === 'acct-1')?.done).toBe(true)
    expect(s.checkins.find(c => !c.accountId)?.done).toBe(false)
  })
})

describe('导入导出与合并', () => {
  it('导出剔除密钥字段', () => {
    let s = addAccount(fresh(), { providerId: 'openai', label: 'A', mode: 'api', encryptedKey: 'SECRET', keyFingerprint: 'ab··cd' })
    const out = JSON.parse(exportState(s))
    expect(out.accounts[0].encryptedKey).toBeUndefined()
    expect(out.accounts[0].keyFingerprint).toBeUndefined()
    expect(out.accounts[0].label).toBe('A')
    expect(out.settings.vaultInitialized).toBe(false) // 密钥不迁移，保险箱状态也重置
  })

  it('addUsageEvent 自动 id 不被传入字段覆盖', () => {
    let s = fresh()
    s = addUsageEvent(s, { id: 'evil-id', accountId: 'a', date: '2026-01-01', inputTokens: 1, outputTokens: 1, estimatedCost: 0 } as any)
    expect(s.usage[0].id).toMatch(/^u_/)
    expect(s.usage[0].id).not.toBe('evil-id')
  })

  it('导入校验格式并补全缺省数组', () => {
    const json = JSON.stringify({ version: 1, accounts: [{ id: 'x', providerId: 'openai', label: 'X', mode: 'manual' }] })
    const s = importState(json)
    expect(s.accounts).toHaveLength(1)
    expect(s.quotas).toEqual([])
    expect(s.settings.monthlyBudget).toBe(200)
    expect(() => importState('{"nope":1}')).toThrow(/格式/)
    expect(() => importState('null')).toThrow(/格式/)
    expect(() => importState('123')).toThrow(/格式/)
    expect(() => importState('[]')).toThrow(/格式/)
  })

  it('合并按 id 去重，追加新条目', () => {
    const local = addAccount(fresh(), { providerId: 'openai', label: 'Local', mode: 'manual' })
    const incoming = addAccount(fresh(), { providerId: 'deepseek', label: 'Remote', mode: 'manual' })
    incoming.accounts.push({ ...local.accounts[0], id: 'dup' }) // 模拟远端也有本地某账户（不同 id 场景）
    const merged = mergeState(local, incoming)
    expect(merged.accounts.length).toBe(3)
    // 同 id 的不重复
    const merged2 = mergeState(local, local)
    expect(merged2.accounts).toHaveLength(1)
  })

  it('合并预算取较大值', () => {
    const a = fresh(); a.settings.monthlyBudget = 100
    const b = fresh(); b.settings.monthlyBudget = 300
    expect(mergeState(a, b).settings.monthlyBudget).toBe(300)
  })

  it('合并单价表取并集，本地优先', () => {
    const a = fresh(); a.settings.unitPrices = { openai: 0.5 }
    const b = fresh(); b.settings.unitPrices = { openai: 0.01, deepseek: 0.002 }
    const m = mergeState(a, b)
    expect(m.settings.unitPrices.openai).toBe(0.5)
    expect(m.settings.unitPrices.deepseek).toBe(0.002)
  })

  it('合并 tolerate 缺失 settings', () => {
    const a = fresh()
    const b = { ...fresh(), settings: undefined as any }
    expect(() => mergeState(a, b)).not.toThrow()
  })
})

describe('设置管理', () => {
  it('updateSettings 局部更新，不影响其他字段', () => {
    let s = fresh()
    s = updateSettings(s, { alertDays: 3 })
    expect(s.settings.alertDays).toBe(3)
    expect(s.settings.monthlyBudget).toBe(200)
    expect(s.settings.checkinReminder).toBe(true)
  })

  it('loadState 为新版本设置补全默认值', () => {
    ;(localStorage as any).clear()
    // 模拟旧版本存档：settings 只有 3 个字段
    localStorage.setItem('acm.state.v1', JSON.stringify({
      version: 1, accounts: [], quotas: [], checkins: [], benefitMarks: [], usage: [],
      settings: { vaultInitialized: false, monthlyBudget: 100, checkinReminder: false },
    }))
    const s = loadState()
    expect(s.settings.alertDays).toBe(7)
    expect(s.settings.defaultUnit).toBe('credit')
    expect(s.settings.backupReminder).toBe(true)
    expect(s.settings.monthlyBudget).toBe(100)
  })

  it('clearAllData 保留设置与保险箱状态', () => {
    let s = addAccount(fresh(), { providerId: 'openai', label: 'A', mode: 'manual' })
    s = updateSettings(s, { vaultInitialized: true, alertDays: 3 })
    const cleared = clearAllData(s)
    expect(cleared.accounts).toHaveLength(0)
    expect(cleared.settings.vaultInitialized).toBe(true)
    expect(cleared.settings.alertDays).toBe(3)
  })
})
