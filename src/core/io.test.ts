import { describe, it, expect } from 'vitest'
import type { AppState, Account, QuotaSnapshot } from './types'
import {
  csvCell, toCsv, detectCsvKind, isJsonImport,
  exportAccountsCsv, exportQuotasCsv, exportUsageCsv, exportJson,
  parseAccountsCsv, parseQuotasCsv, exportByFormat,
  isServiceList, parseServiceList, parseQuotaString, mapServiceProvider, noteCategory,
} from './io'

function latestQuota(quotas: QuotaSnapshot[], id: string): QuotaSnapshot | undefined {
  let latest: QuotaSnapshot | undefined
  for (const q of quotas) if (q.accountId === id && (!latest || q.capturedAt >= latest.capturedAt)) latest = q
  return latest
}

function sampleState(): AppState {
  const s: AppState = {
    version: 1, accounts: [], quotas: [], checkins: [], usage: [], benefitMarks: [],
    settings: {
      vaultInitialized: false, monthlyBudget: 200, checkinReminder: true, checkinProviders: [], alertDays: 7,
      defaultUnit: 'credit', backupReminder: true, unlockMethod: 'password', unitPrices: {},
    },
  }
  const acc: Account = {
    id: 'a1', providerId: 'openai', label: '工作号', mode: 'api',
    apiUrl: 'https://api.openai.com/v1', note: '[文本] 对话',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  s.accounts = [acc]
  s.quotas = [{
    id: 'q1', accountId: 'a1', unit: 'token', total: 1000, used: 250,
    capturedAt: '2026-01-05T00:00:00.000Z', source: 'manual',
  }]
  s.usage = [
    { id: 'u1', accountId: 'a1', date: '2026-01-03', inputTokens: 100, outputTokens: 50, estimatedCost: 1.5, model: 'gpt-4' },
  ]
  return s
}

describe('csvCell / toCsv', () => {
  it('转义含逗号、引号、换行的字段', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(123)).toBe('123')
    expect(csvCell(undefined)).toBe('')
  })

  it('csvCell 防止公式注入（= + - @ 开头加单引号），数值不受影响', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvCell('+cmd')).toBe("'+cmd")
    expect(csvCell('@SUM')).toBe("'@SUM")
    expect(csvCell('-1')).toBe("'-1")       // 字符串负号也防护
    expect(csvCell(-1)).toBe('-1')          // 数值负数保持原样
    expect(csvCell(0)).toBe('0')
  })

  it('toCsv 带 BOM 与 CRLF', () => {
    const out = toCsv([['h1', 'h2'], ['a', 'b']])
    expect(out.startsWith('\ufeff')).toBe(true)
    expect(out).toContain('h1,h2\r\na,b')
  })
})

describe('detectCsvKind', () => {
  it('识别用量 CSV（英文/中文表头）', () => {
    expect(detectCsvKind('date,account,inputTokens,outputTokens,cost,model\n2026-01-01,A,1,2,3,m')).toBe('usage')
    expect(detectCsvKind('日期,账户,输入,输出,费用\n2026-01-01,A,1,2,3')).toBe('usage')
  })
  it('识别额度 CSV', () => {
    expect(detectCsvKind('account,unit,total,used,resetAt\n工作号,token,100,20,')).toBe('quotas')
  })
  it('识别账户 CSV', () => {
    expect(detectCsvKind('providerId,label,mode,apiUrl,note\nopenai,工作号,api,,文本')).toBe('accounts')
  })
  it('未知格式返回 null', () => {
    expect(detectCsvKind('foo,bar\n1,2')).toBeNull()
  })
})

describe('isJsonImport', () => {
  it('按扩展名与内容识别 JSON', () => {
    expect(isJsonImport('backup.json', 'x')).toBe(true)
    expect(isJsonImport('a.txt', '{"accounts":[],"version":1}')).toBe(true)
    expect(isJsonImport('a.csv', 'date,account')).toBe(false)
  })
})

describe('导出/导入往返', () => {
  it('账户 CSV 可解析回账户（不含密钥）', () => {
    const csv = exportAccountsCsv(sampleState())
    const parsed = parseAccountsCsv(csv)
    expect(parsed.accounts).toHaveLength(1)
    expect(parsed.accounts[0].providerId).toBe('openai')
    expect(parsed.accounts[0].label).toBe('工作号')
    expect(parsed.accounts[0].note).toBe('[文本] 对话')
    expect((parsed.accounts[0] as any).encryptedKey).toBeUndefined()
  })

  it('账户 CSV 解析含逗号/引号的备注', () => {
    const s = sampleState()
    s.accounts[0].note = '[文本] 对话, 翻译 "主力"'
    const parsed = parseAccountsCsv(exportAccountsCsv(s))
    expect(parsed.accounts[0].note).toBe('[文本] 对话, 翻译 "主力"')
  })

  it('额度 CSV 可解析回快照并按账户名匹配', () => {
    const s = sampleState()
    const csv = exportQuotasCsv(s, latestQuota)
    const parsed = parseQuotasCsv(csv, s.accounts)
    expect(parsed.quotas).toHaveLength(1)
    expect(parsed.quotas[0].accountId).toBe('a1')
    expect(parsed.quotas[0].total).toBe(1000)
    expect(parsed.quotas[0].used).toBe(250)
    expect(parsed.quotas[0].unit).toBe('token')
    expect(parsed.quotas[0].source).toBe('import')
  })

  it('额度 CSV 未匹配账户归入 unmatched', () => {
    const csv = 'account,unit,total,used\n不存在,token,100,10'
    const parsed = parseQuotasCsv(csv, sampleState().accounts)
    expect(parsed.quotas).toHaveLength(0)
    expect(parsed.unmatched).toContain('不存在')
  })

  it('用量 CSV 导出含正确表头与数据', () => {
    const csv = exportUsageCsv(sampleState())
    expect(csv).toContain('date,account,inputTokens,outputTokens,cost,model')
    expect(csv).toContain('2026-01-03,工作号,100,50,1.5,gpt-4')
  })

  it('exportByFormat 返回正确 mime 与扩展名', () => {
    const s = sampleState()
    expect(exportByFormat('json', s, latestQuota).ext).toBe('json')
    expect(exportByFormat('json', s, latestQuota).mime).toBe('application/json')
    expect(exportByFormat('accounts-csv', s, latestQuota).ext).toBe('csv')
    expect(exportByFormat('usage-csv', s, latestQuota).mime).toBe('text/csv')
  })

  it('JSON 导出不含密钥', () => {
    const s = sampleState()
    s.accounts[0].encryptedKey = 'SECRET_CIPHER'
    const json = exportJson(s)
    expect(json).not.toContain('SECRET_CIPHER')
    expect(json).toContain('工作号')
  })
})

describe('本地模型不参与导出', () => {
  it('JSON / 账户 CSV 导出都会排除 local- 本地模型账户及其数据', () => {
    const s = sampleState()
    const localAcc: Account = {
      id: 'loc1', providerId: 'local-ollama', label: 'llama3', mode: 'api',
      apiUrl: 'http://127.0.0.1:11434', note: '本地',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    s.accounts.push(localAcc)
    s.quotas = [...s.quotas, { id: 'q2', accountId: 'loc1', unit: 'token', total: 0, used: 0, capturedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }]
    const json = exportByFormat('json', s, latestQuota).content
    expect(json).not.toContain('local-ollama')
    expect(json).not.toContain('loc1')
    const csv = exportByFormat('accounts-csv', s, latestQuota).content
    expect(csv).not.toContain('local-ollama')
    expect(csv).not.toContain('llama3')
    // 普通账户仍在
    expect(csv).toContain('openai')
  })
})

describe('noteCategory 备注分类', () => {
  it('识别 [分类] 格式', () => {
    expect(noteCategory('[文本] 日常对话')).toBe('文本')
    expect(noteCategory('[图片] 生成')).toBe('图片')
  })
  it('识别冒号格式', () => {
    expect(noteCategory('文本: 日常对话')).toBe('文本')
    expect(noteCategory('图片：生成图')).toBe('图片')
  })
  it('识别斜杠/顿号/逗号分隔（如 文本/图片）', () => {
    expect(noteCategory('文本/图片')).toBe('文本')
    expect(noteCategory('图片、视频')).toBe('图片')
    expect(noteCategory('语音, 转写')).toBe('语音')
  })
  it('纯文字备注整体作为分类', () => {
    expect(noteCategory('通用对话')).toBe('通用对话')
    expect(noteCategory('翻译')).toBe('翻译')
  })
  it('空备注归为未分类', () => {
    expect(noteCategory()).toBe('未分类')
    expect(noteCategory('   ')).toBe('未分类')
  })
})

describe('第三方服务清单', () => {
  const sample = JSON.stringify([
    { name: 'DeepSeek 深度求索', note: '翻译/对话', apiBase: 'https://api.deepseek.com/v1', api: 'sk-test-1', model: 'deepseek-v3', endpoint: 'https://platform.deepseek.com/api_keys', modelCategory: 'text', quota: '7.51 CNY', kid: 'K1' },
    { name: '智谱 GLM', note: '通用对话', apiBase: 'https://open.bigmodel.cn/api/paas/v4', api: 'test-key-2', model: 'glm-4', endpoint: 'https://bigmodel.cn/usercenter/apikeys', modelCategory: 'text', quota: '暂不支持自动查询', kid: 'K2' },
    { name: 'SiliconFlow 硅基流动', note: '图片', apiBase: 'https://api.siliconflow.cn/v1', api: 'sk-test-3', model: 'Qwen/Image', modelCategory: 'image', quota: '¥24.88', kid: 'K3' },
    { name: 'SiliconFlow 硅基流动', note: '视频', apiBase: 'https://api.siliconflow.cn/v1', api: 'sk-test-3', model: 'Wan2.2', modelCategory: 'video', quota: '', kid: 'K4' },
    { name: 'ComfyUI 本地', note: '本地 SD', apiBase: 'http://127.0.0.1:8188', api: 'none', model: 'v1-5', modelCategory: 'image', quota: '', kid: 'K5', localOnly: true },
  ])

  it('识别服务清单数组', () => {
    expect(isServiceList(sample)).toBe(true)
    expect(isServiceList('{"accounts":[]}')).toBe(false)
    expect(isServiceList('[]')).toBe(false)
    expect(isServiceList('not json')).toBe(false)
  })

  it('解析额度字符串', () => {
    expect(parseQuotaString('7.51 CNY')).toEqual({ total: 7.51, unit: 'currency' })
    expect(parseQuotaString('¥24.88713')).toEqual({ total: 24.88713, unit: 'currency' })
    expect(parseQuotaString('1,000.5 tokens')).toEqual({ total: 1000.5, unit: 'currency' })
    expect(parseQuotaString('暂不支持自动查询')).toBeNull()
    expect(parseQuotaString('')).toBeNull()
  })

  it('平台名称映射', () => {
    expect(mapServiceProvider('DeepSeek 深度求索')).toBe('deepseek')
    expect(mapServiceProvider('智谱 GLM')).toBe('glm')
    expect(mapServiceProvider('SiliconFlow 硅基流动')).toBe('siliconflow')
    expect(mapServiceProvider('Moonshot Kimi')).toBe('kim')
    expect(mapServiceProvider('ComfyUI 本地')).toBe('comfyui')
    expect(mapServiceProvider('Ollama 本地')).toBe('ollama')
    expect(mapServiceProvider('未知服务 Foo')).toMatch(/^custom-/)
  })

  it('解析服务清单条目并归一化分类', () => {
    const entries = parseServiceList(sample)
    expect(entries).toHaveLength(5)
    expect(entries[0].providerId).toBe('deepseek')
    expect(entries[0].plainKey).toBe('sk-test-1')
    expect(entries[0].quota?.total).toBe(7.51)
    expect(entries[0].note).toBe('[文本] 翻译/对话')
    expect(entries[1].quota).toBeNull() // 暂不支持自动查询
    expect(entries[2].note).toBe('[图片] 图片')
    expect(entries[4].localOnly).toBe(true)
  })

  it('同名多用途生成区分 label', () => {
    const entries = parseServiceList(sample)
    const sf = entries.filter(e => e.name.includes('SiliconFlow'))
    expect(sf).toHaveLength(2)
    expect(sf[0].label).toContain('图片')
    expect(sf[1].label).toContain('视频')
    expect(sf[0].label).not.toBe(sf[1].label)
  })
})
