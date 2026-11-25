import { describe, expect, it } from 'vitest'
import { snapshotStateOf, trimSnapshots, cloudBackupDue, type CloudBackupPrefs } from './cloudSnapshots'
import type { AppState } from './types'

function mkState(patch: Partial<AppState> = {}): AppState {
  return {
    version: 1,
    accounts: [
      { id: 'a1', providerId: 'deepseek', name: 'DS', secretCipher: 'x', createdAt: '2026-01-01' },
      { id: 'l1', providerId: 'local-ollama', name: '本地', secretCipher: '', createdAt: '2026-01-01' },
    ],
    quotas: [{ accountId: 'l1', limit: 1, used: 0, period: 'monthly' }, { accountId: 'a1', limit: 1, used: 0, period: 'monthly' }],
    usage: [],
    checkins: [],
    benefitMarks: [],
    settings: { gatewayToken: 'tok', language: 'zh-CN' },
    audit: [],
    ...patch,
  } as unknown as AppState
}

describe('cloudSnapshots.snapshotStateOf 快照口径', () => {
  it('剥离网关令牌与界面语言', () => {
    const s = snapshotStateOf(mkState())
    expect(s.settings.gatewayToken).toBeUndefined()
    expect((s.settings as { language?: string }).language).toBeUndefined()
  })

  it('默认剔除本地模型账户及其额度', () => {
    const s = snapshotStateOf(mkState())
    expect(s.accounts.map(a => a.id)).toEqual(['a1'])
    expect(s.quotas.map(q => q.accountId)).toEqual(['a1'])
  })

  it('开启同步本地账户时保留本地账户', () => {
    const st = mkState()
    ;(st.settings as unknown as Record<string, unknown>).syncLocalProviders = true
    const s = snapshotStateOf(st)
    expect(s.accounts.map(a => a.id)).toEqual(['a1', 'l1'])
  })
})

describe('cloudSnapshots.trimSnapshots', () => {
  it('只保留最近 keep 份', () => {
    expect(trimSnapshots([1, 2, 3, 4, 5, 6], 3)).toEqual([4, 5, 6])
    expect(trimSnapshots([1, 2], 5)).toEqual([1, 2])
  })
})

describe('cloudSnapshots.cloudBackupDue', () => {
  const prefs: CloudBackupPrefs = { enabled: true, intervalHours: 24, keep: 5 }
  it('未开启不到期', () => {
    expect(cloudBackupDue({ ...prefs, enabled: false }, Date.now() + 10 * 86400000)).toBe(false)
  })
  it('从未备份过（lastAt=0）视为到期', () => {
    expect(cloudBackupDue(prefs, Date.now())).toBe(true)
  })
})
