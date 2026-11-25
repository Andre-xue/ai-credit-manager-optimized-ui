import { describe, it, expect } from 'vitest'
import { splitCsvLine, parseUsageCsv } from './csv'
import type { AppState } from './types'

const accounts = (): AppState['accounts'] => [
  { id: 'a1', providerId: 'openai', label: '我的 OpenAI', mode: 'manual', createdAt: '', updatedAt: '' },
  { id: 'a2', providerId: 'deepseek', label: '我的 DeepSeek', mode: 'manual', createdAt: '', updatedAt: '' },
]


describe('splitCsvLine', () => {
  it('解析普通逗号分隔', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })
  it('解析带引号的字段（含逗号与转义引号）', () => {
    expect(splitCsvLine('"a,b","say ""hi"""')).toEqual(['a,b', 'say "hi"'])
  })
  it('处理空字段', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c'])
  })
})

describe('parseUsageCsv', () => {
  it('无账户时抛出错误', () => {
    expect(() => parseUsageCsv('date,account\n2026-01-01,x', [])).toThrow(/添加账户/)
  })

  it('仅有表头时返回空数组', () => {
    expect(parseUsageCsv('date,account,inputTokens,outputTokens,cost,model', accounts())).toEqual([])
  })

  it('解析英文表头并按账户 label 匹配', () => {
    const csv = [
      'date,account,inputTokens,outputTokens,cost,model',
      '2026-01-01,我的 OpenAI,1000,500,0.15,gpt-4o',
      '2026-01-02,我的 DeepSeek,200,100,0.02,deepseek-chat',
    ].join('\n')
    const r = parseUsageCsv(csv, accounts())
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ accountId: 'a1', date: '2026-01-01', inputTokens: 1000, outputTokens: 500, estimatedCost: 0.15, model: 'gpt-4o' })
    expect(r[1].accountId).toBe('a2')
  })

  it('兼容中文表头', () => {
    const csv = ['日期,账户,输入,输出,费用,模型', '2026-02-01,我的 OpenAI,10,20,0.5,glm'].join('\n')
    const r = parseUsageCsv(csv, accounts())
    expect(r[0]).toMatchObject({ accountId: 'a1', inputTokens: 10, outputTokens: 20, estimatedCost: 0.5, model: 'glm' })
  })

  it('跳过非法日期行，未匹配账户归入第一个账户', () => {
    const csv = ['date,account,inputTokens,outputTokens,cost', 'bad-date,x,1,1,1', '2026-03-01,未知用户,3,4,0.1'].join('\n')
    const r = parseUsageCsv(csv, accounts())
    expect(r).toHaveLength(1)
    expect(r[0].accountId).toBe('a1')
  })

  it('负数与非数字归零', () => {
    const csv = ['date,account,inputTokens,outputTokens,cost', '2026-04-01,我的 OpenAI,-5,abc,2'].join('\n')
    const r = parseUsageCsv(csv, accounts())
    expect(r[0].inputTokens).toBe(0)
    expect(r[0].outputTokens).toBe(0)
    expect(r[0].estimatedCost).toBe(2)
  })

  it('处理 BOM 与 CRLF', () => {
    const csv = '\ufeffdate,account,inputTokens,outputTokens,cost\r\n2026-05-01,我的 OpenAI,1,2,3\r\n'
    expect(parseUsageCsv(csv, accounts())).toHaveLength(1)
  })
})
