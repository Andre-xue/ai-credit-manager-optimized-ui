// 用量 CSV 解析：供用量导入与单元测试复用，纯函数、无浏览器依赖。
import type { AppState } from './types'
import { PROVIDER_MAP } from '../data/providers'

export interface UsageEventInput {
  accountId: string
  date: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  model?: string
  project?: string
}

/** 解析单行 CSV（支持双引号包裹含逗号的字段） */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      cells.push(cur.trim()); cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

/**
 * 解析用量 CSV：支持中英文表头，按 account 名称或 label 匹配已有账户；未匹配的归入第一个账户。
 * 表头：date, account, inputTokens, outputTokens, cost, model
 */
export function parseUsageCsv(text: string, accounts: AppState['accounts']): UsageEventInput[] {
  if (accounts.length === 0) throw new Error('请先添加账户')
  const cleaned = text.replace(/^\ufeff/, '').trim()
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase())
  const idx = (names: string[]) => header.findIndex(h => names.includes(h))
  const iDate = idx(['date', '日期'])
  const iAcc = idx(['account', '账户', 'account label'])
  const iIn = idx(['inputtokens', 'input tokens', '输入tokens', '输入'])
  const iOut = idx(['outputtokens', 'output tokens', '输出tokens', '输出'])
  const iCost = idx(['cost', 'estimatedcost', '费用', '成本'])
  const iModel = idx(['model', '模型'])
  const fallback = accounts[0].id
  const events: UsageEventInput[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const date = iDate >= 0 ? cells[iDate] : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const accountName = iAcc >= 0 ? cells[iAcc] : ''
    const account = accounts.find(a => a.label === accountName)
      ?? accounts.find(a => PROVIDER_MAP[a.providerId]?.shortName === accountName)
    events.push({
      accountId: account?.id ?? fallback,
      date,
      inputTokens: Math.max(0, Number(iIn >= 0 ? cells[iIn] : 0) || 0),
      outputTokens: Math.max(0, Number(iOut >= 0 ? cells[iOut] : 0) || 0),
      estimatedCost: Math.max(0, Number(iCost >= 0 ? cells[iCost] : 0) || 0),
      model: iModel >= 0 ? cells[iModel] || undefined : undefined,
    })
  }
  return events
}
