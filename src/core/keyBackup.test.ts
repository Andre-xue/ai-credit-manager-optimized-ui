import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from './types'

vi.mock('./crypto', () => ({
  decryptSecret: vi.fn(async (enc: string) => `plain:${enc}`),
  getVaultSyncMaterial: vi.fn(() => ({ salt: 's', verify: 'v', biometricPwd: null })),
}))

vi.mock('./sync', () => ({
  pushPayload: vi.fn(async () => ({ ok: true, remoteVersion: 'rv' })),
}))

import { backupToCloud, buildKeyBackup, parseKeyBackup, serializeKeyBackup } from './keyBackup'
import { pushPayload } from './sync'

function makeState(): AppState {
  return {
    version: 1,
    accounts: [
      { id: 'a1', providerId: 'kim', label: 'Kimi', mode: 'api', encryptedKey: 'enc1', keyFingerprint: 'f1', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'a2', providerId: 'openai', label: 'OpenAI', mode: 'api', encryptedKey: 'enc2', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      { id: 'a3', providerId: 'glm', label: '无密钥', mode: 'manual', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    ],
    quotas: [
      { id: 'q1', accountId: 'a1', unit: 'token', total: 100, used: 20, capturedAt: '2026-01-01', source: 'manual' },
      { id: 'q2', accountId: 'a2', unit: 'credit', total: 50, used: 5, capturedAt: '2026-01-01', source: 'manual' },
    ],
    usage: [{ id: 'u1', accountId: 'a1', date: '2026-01-01', inputTokens: 10, outputTokens: 20, estimatedCost: 0.1 }],
    checkins: [{ id: 'c1', providerId: 'kim', accountId: 'a1', date: '2026-01-01', done: true }],
    benefitMarks: [],
    settings: {
      vaultInitialized: true, monthlyBudget: 200, checkinReminder: true, checkinProviders: [],
      alertDays: 7, defaultUnit: 'credit', backupReminder: true, unlockMethod: 'password', unitPrices: {},
    },
  }
}

describe('删除前密钥备份', () => {
  beforeEach(() => vi.clearAllMocks())

  it('密文备份包含密文 Key、保险箱材料和关联数据，不包含明文', async () => {
    const backup = await buildKeyBackup(makeState(), ['a1', 'a2'], 'cipher')
    expect(backup.format).toBe('cipher')
    expect(backup.accounts.map(i => i.account.id)).toEqual(['a1', 'a2'])
    expect(backup.accounts[0].account.encryptedKey).toBe('enc1')
    expect(backup.accounts[0].apiKey).toBeUndefined()
    expect(backup.accounts[0].quotas).toHaveLength(1)
    expect(backup.accounts[0].usage).toHaveLength(1)
    expect(backup.accounts[0].checkins).toHaveLength(1)
    expect(backup.vault).toEqual({ salt: 's', verify: 'v', biometricPwd: null })
    expect(backup.confirmationCode).toMatch(/^\d{6}$/)
  })

  it('明文备份解密 Key 且不带保险箱材料', async () => {
    const backup = await buildKeyBackup(makeState(), ['a1'], 'plain', 'pwd')
    expect(backup.format).toBe('plain')
    expect(backup.accounts[0].apiKey).toBe('plain:enc1')
    expect(backup.vault).toBeUndefined()
  })

  it('明文备份缺少主密码时拒绝', async () => {
    await expect(buildKeyBackup(makeState(), ['a1'], 'plain')).rejects.toThrow('明文备份需要验证主密码')
  })

  it('云备份只接受密文并调用云端推送', async () => {
    const backup = await buildKeyBackup(makeState(), ['a1'], 'cipher')
    const r = await backupToCloud(backup, makeState())
    expect(r.ok).toBe(true)
    expect(pushPayload).toHaveBeenCalledOnce()
  })

  it('JSON / CSV / TXT 三种容器都能被重新识别并解析', async () => {
    const backup = await buildKeyBackup(makeState(), ['a1'], 'cipher')
    for (const f of ['json', 'csv', 'txt'] as const) {
      const text = serializeKeyBackup(backup, f)
      const parsed = parseKeyBackup(text)
      expect(parsed, f).not.toBeNull()
      expect(parsed!.accounts[0].account.id, f).toBe('a1')
      expect(parsed!.accounts[0].account.encryptedKey, f).toBe('enc1')
    }
  })
})

describe('桌面二进制写入参数名契约（v0.1.309 回归）', () => {
  it('所有 write_binary_to_dir 调用都传 contentBase64（驼峰），不传 content_base64', async () => {
    const { readFileSync } = await import('node:fs')
    const files = [
      'src/core/keyBackup.ts',
      'src/core/mediaGeneration.ts',
      'src/core/saveFile.ts',
      'src/components/TranslationView.tsx',
    ]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toContain('content_base64')
      if (src.includes('write_binary_to_dir')) expect(src, f).toContain('contentBase64')
    }
  })
})
