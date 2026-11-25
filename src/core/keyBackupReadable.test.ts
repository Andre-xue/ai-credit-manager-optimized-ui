import { describe, it, expect } from 'vitest'
import { buildReadableRows, serializeKeyBackupReadable, isReadableFormat, buildKeyBackupXlsxBase64, type KeyBackupFile } from './keyBackup'
import type { Account, QuotaSnapshot } from './types'

const account = (patch: Partial<Account>): Account => ({
  id: 'a1', providerId: 'deepseek', label: '我的 DeepSeek', mode: 'api',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', ...patch,
})
const quota = (patch: Partial<QuotaSnapshot>): QuotaSnapshot => ({
  id: 'q1', accountId: 'a1', unit: 'currency', total: 100, used: 30,
  capturedAt: '2026-01-02T00:00:00Z', source: 'api', ...patch,
})
const backup = (accounts: KeyBackupFile['accounts'], format: 'cipher' | 'plain' = 'plain'): KeyBackupFile => ({
  kind: 'acm-key-backup', version: 1, createdAt: '2026-01-03T10:00:00.000Z',
  backupId: 'bk_test', confirmationCode: '123456', format, accounts,
})

describe('备份清单格式（md/html/xlsx 共用行数据）', () => {
  it('字段一一对应：名称=平台名+（备注）、余额=最新快照剩余、链接=平台默认地址、Key、分组', () => {
    const b = backup([{
      account: account({ note: '主力号', group: '工作', encryptedKey: 'enc' }),
      quotas: [quota({ total: 100, used: 30 }), quota({ id: 'q0', total: 50, used: 0, capturedAt: '2026-01-01T00:00:00Z' })],
      usage: [], checkins: [], apiKey: 'sk-plain-1',
    }])
    const [row] = buildReadableRows(b)
    expect(row.name).toBe('DeepSeek（主力号）')
    expect(row.balance).toBe('70 元') // 取最新快照（100-30），不是旧快照
    expect(row.apiUrl).toBe('https://api.deepseek.com/v1') // 账户没填地址 → 平台默认地址
    expect(row.apiKey).toBe('sk-plain-1') // 明文备份给原文
    expect(row.group).toBe('工作')
  })

  it('无备注名称只有平台名；无额度快照余额为空；自填地址优先；未分组为空', () => {
    const b = backup([{
      account: account({ apiUrl: 'https://proxy.example.com/v1', encryptedKey: 'enc2' }),
      quotas: [], usage: [], checkins: [], apiKey: 'sk-x',
    }], 'cipher')
    const [row] = buildReadableRows(b)
    expect(row.name).toBe('DeepSeek')
    expect(row.balance).toBe('')
    expect(row.apiUrl).toBe('https://proxy.example.com/v1')
    expect(row.apiKey).toBe('enc2') // 密文备份给密文
    expect(row.group).toBe('')
  })

  it('md 表格含表头与数据行，竖线被转义', () => {
    const b = backup([{ account: account({ note: 'a|b' }), quotas: [quota({})], usage: [], checkins: [], apiKey: 'sk-1' }])
    const md = serializeKeyBackupReadable(b, 'md')
    expect(md).toContain('| 名称 | 余额 | 链接地址 | API Key | 分组 |')
    expect(md).toContain('DeepSeek（a\\|b）')
    expect(md).toContain('70 元')
  })

  it('html 为独立页面且转义 Key 中的特殊字符', () => {
    const b = backup([{ account: account({}), quotas: [], usage: [], checkins: [], apiKey: 'sk-<b>&"' }])
    const html = serializeKeyBackupReadable(b, 'html')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('sk-&lt;b&gt;&amp;&quot;')
    expect(html).not.toContain('sk-<b>')
  })

  it('xlsx 生成真实 Excel 文件（zip 文件头）且可回读出字段', async () => {
    const b = backup([{ account: account({ note: '主力号', group: '工作' }), quotas: [quota({})], usage: [], checkins: [], apiKey: 'sk-1' }])
    const b64 = await buildKeyBackupXlsxBase64(b)
    expect(b64.startsWith('UEsDB')).toBe(true) // PK zip 头
    const XLSX = await import('xlsx')
    const wb = XLSX.read(atob(b64), { type: 'binary' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws) as Record<string, string>[]
    expect(rows[0]['名称']).toBe('DeepSeek（主力号）')
    expect(rows[0]['余额']).toBe('70 元')
    expect(rows[0]['链接地址']).toBe('https://api.deepseek.com/v1')
    expect(rows[0]['API Key']).toBe('sk-1')
    expect(rows[0]['分组']).toBe('工作')
  })

  it('isReadableFormat 只认 md/html/xlsx', () => {
    expect(isReadableFormat('md')).toBe(true)
    expect(isReadableFormat('xlsx')).toBe(true)
    expect(isReadableFormat('json')).toBe(false)
    expect(isReadableFormat('txt')).toBe(false)
  })
})
