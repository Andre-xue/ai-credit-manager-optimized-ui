import { describe, it, expect } from 'vitest'
import { buildBackup, parseBackup } from './backup'
import type { AppState } from './types'

const sampleState = {
  version: 1,
  accounts: [{ id: 'a1' }],
  quotas: [{ id: 'q1' }, { id: 'q2' }],
  checkins: [],
  benefitMarks: [],
  usage: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
  settings: { vaultInitialized: true, monthlyBudget: 200 },
} as unknown as AppState

describe('完整备份 buildBackup / parseBackup', () => {
  it('导出再导入 roundtrip 一致，摘要计数正确', () => {
    const text = buildBackup(sampleState, '0.1.215')
    const env = JSON.parse(text)
    expect(env.app).toBe('ai-credit-manager')
    expect(env.kind).toBe('full-backup')
    const r = parseBackup(text)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state.accounts).toHaveLength(1)
      expect(r.summary).toEqual({ accounts: 1, usage: 3, checkins: 0, quotas: 2 })
    }
  })

  it('接受裸 AppState JSON（无信封）', () => {
    const r = parseBackup(JSON.stringify(sampleState))
    expect(r.ok).toBe(true)
  })

  it('拒绝非 JSON 与结构不完整的文件', () => {
    expect(parseBackup('not json').ok).toBe(false)
    expect(parseBackup('{"accounts": []}').ok).toBe(false)
    expect(parseBackup('42').ok).toBe(false)
  })
})

describe('备份不含本机凭据', () => {
  it('buildBackup 剥离网关令牌', () => {
    const s = { ...sampleState, settings: { ...sampleState.settings, gatewayToken: 'gw-secret-token-123' } } as unknown as AppState
    const text = buildBackup(s, '0.1.228')
    expect(text).not.toContain('gw-secret-token-123')
    const back = parseBackup(text)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.state.settings.gatewayToken).toBeUndefined()
  })

  it('buildBackup 剥离界面语言（语言仅本机，不随备份走）', () => {
    const s = { ...sampleState, settings: { ...sampleState.settings, language: 'ko' } } as unknown as AppState
    const back = parseBackup(buildBackup(s, '0.1.263'))
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.state.settings.language).toBeUndefined()
  })
})
