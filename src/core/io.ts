// 多格式导入导出：支持 JSON 完整备份 + 三类 CSV（账户/额度/用量）。
// 设计目标：导出什么格式就能导回什么格式；CSV 可被 Excel 直接打开。
// 纯函数、无浏览器依赖，便于单元测试。
import type { AppState, Account, AccountMode, CreditUnit, QuotaSnapshot } from './types'
import { isLocalProvider } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { exportState } from './store'
import { splitCsvLine, parseUsageCsv, type UsageEventInput } from './csv'

export type ExportFormat = 'json' | 'accounts-csv' | 'quotas-csv' | 'usage-csv'
export type CsvKind = 'accounts' | 'quotas' | 'usage'

/** CSV 单元格转义：含逗号/引号/换行时用双引号包裹；防公式注入（Excel 会以 = + - @ 开头当公式） */
export function csvCell(value: unknown): string {
  const raw = value === undefined || value === null ? '' : String(value)
  // 仅对字符串做公式注入防护；数值（含负数）保持原样，避免破坏数据类型
  const s = typeof value === 'number' ? raw : (/^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw)
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

/** 二维数组 → CSV 文本（CRLF 行尾，兼容 Excel） */
export function toCsv(rows: (string | number)[][]): string {
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}

/** JSON 完整备份（不含密钥） */
export function exportJson(state: AppState): string {
  return exportState(state)
}

/** 账户 CSV：不含任何密钥/指纹，仅元数据 */
export function exportAccountsCsv(state: AppState): string {
  const rows: (string | number)[][] = [
    ['providerId', 'label', 'mode', 'apiUrl', 'note'],
    ...state.accounts.map(a => [
      a.providerId, a.label, a.mode,
      a.apiUrl ?? PROVIDER_MAP[a.providerId]?.apiBaseUrl ?? '',
      a.note ?? '',
    ]),
  ]
  return toCsv(rows)
}

/** 额度 CSV：每个账户取最新快照 */
export function exportQuotasCsv(state: AppState, latestQuota: (quotas: QuotaSnapshot[], id: string) => QuotaSnapshot | undefined): string {
  const rows: (string | number)[][] = [['account', 'unit', 'total', 'used', 'resetAt', 'capturedAt']]
  for (const a of state.accounts) {
    const q = latestQuota(state.quotas, a.id)
    if (!q) continue
    rows.push([a.label, q.unit, q.total, q.used, q.resetAt ?? '', q.capturedAt])
  }
  return toCsv(rows)
}

/** 用量 CSV：与 parseUsageCsv 表头对称 */
export function exportUsageCsv(state: AppState): string {
  const labelOf = (id: string) => state.accounts.find(a => a.id === id)?.label ?? id
  const rows: (string | number)[][] = [['date', 'account', 'inputTokens', 'outputTokens', 'cost', 'model']]
  for (const u of [...state.usage].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([u.date, labelOf(u.accountId), u.inputTokens, u.outputTokens, u.estimatedCost, u.model ?? ''])
  }
  return toCsv(rows)
}

/** 按格式导出，返回 { content, mime, ext } */
export function exportByFormat(
  format: ExportFormat,
  state: AppState,
  latestQuota: (quotas: QuotaSnapshot[], id: string) => QuotaSnapshot | undefined,
): { content: string; mime: string; ext: string } {
  // 本地模型（Ollama/ComfyUI 等）不参与任何导出：路径含本机信息，无跨端意义
  const localIds = new Set(state.accounts.filter(a => isLocalProvider(a.providerId)).map(a => a.id))
  if (localIds.size) {
    state = {
      ...state,
      accounts: state.accounts.filter(a => !localIds.has(a.id)),
      quotas: state.quotas.filter(q => !localIds.has(q.accountId)),
      usage: state.usage.filter(u => !localIds.has(u.accountId)),
      checkins: state.checkins.filter(c => !c.accountId || !localIds.has(c.accountId)),
    }
  }
  switch (format) {
    case 'json': return { content: exportJson(state), mime: 'application/json', ext: 'json' }
    case 'accounts-csv': return { content: exportAccountsCsv(state), mime: 'text/csv', ext: 'csv' }
    case 'quotas-csv': return { content: exportQuotasCsv(state, latestQuota), mime: 'text/csv', ext: 'csv' }
    case 'usage-csv': return { content: exportUsageCsv(state), mime: 'text/csv', ext: 'csv' }
  }
}

/** 解析 CSV 表头（小写、去 BOM） */
function csvHeader(text: string): string[] {
  const cleaned = text.replace(/^\ufeff/, '').trim()
  const first = cleaned.split(/\r?\n/)[0] ?? ''
  return splitCsvLine(first).map(h => h.toLowerCase().trim())
}

/** 按表头自动识别 CSV 类型 */
export function detectCsvKind(text: string): CsvKind | null {
  const h = csvHeader(text)
  const has = (...names: string[]) => names.some(n => h.includes(n))
  // 用量：date + 任一 token/费用列
  if (has('date', '日期') && has('inputtokens', 'input tokens', '输入tokens', '输入', 'outputtokens', 'output tokens', '输出tokens', '输出', 'cost', 'estimatedcost', '费用', '成本')) return 'usage'
  // 额度：total + used
  if (has('total', '总额', '总额度') && has('used', '已用')) return 'quotas'
  // 账户：providerId + label
  if (has('providerid', 'provider', '平台', 'platform') && has('label', 'name', '名称', '账户名')) return 'accounts'
  return null
}

/** 从文件扩展名或内容判断是否为 JSON 备份 */
export function isJsonImport(name: string, text: string): boolean {
  if (/\.json$/i.test(name)) return true
  const t = text.trim()
  return t.startsWith('{') && t.includes('"accounts"')
}

export interface ParsedAccounts {
  accounts: Account[]
  /** 未识别的平台 id（原样保留，界面可提示） */
  unknownProviders: string[]
}

/** 解析账户 CSV，生成可直接追加的 Account 对象（不含密钥） */
export function parseAccountsCsv(text: string, now = new Date().toISOString()): ParsedAccounts {
  const cleaned = text.replace(/^\ufeff/, '').trim()
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim())
  const header = csvHeader(text)
  const idx = (names: string[]) => header.findIndex(h => names.includes(h))
  const iProvider = idx(['providerid', 'provider', 'platform', '平台'])
  const iLabel = idx(['label', 'name', '名称', '账户名', '账户'])
  const iMode = idx(['mode', '模式'])
  const iApi = idx(['apiurl', 'api', 'api地址', '链接地址'])
  const iNote = idx(['note', '备注', '用途'])
  if (iProvider < 0 || iLabel < 0) throw new Error('账户 CSV 缺少 providerId 或 label 列')
  const accounts: Account[] = []
  const unknownProviders: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const providerId = (cells[iProvider] ?? '').trim()
    const label = (cells[iLabel] ?? '').trim()
    if (!providerId || !label) continue
    if (!PROVIDER_MAP[providerId] && !unknownProviders.includes(providerId)) unknownProviders.push(providerId)
    const modeRaw = (iMode >= 0 ? cells[iMode] ?? '' : '').trim().toLowerCase()
    const mode: AccountMode = modeRaw === 'api' ? 'api' : modeRaw === 'subscription' ? 'subscription' : 'manual'
    accounts.push({
      id: `acc_imp_${i}_${Date.now()}`,
      providerId, label, mode,
      apiUrl: iApi >= 0 ? cells[iApi] || undefined : undefined,
      note: iNote >= 0 ? cells[iNote] || undefined : undefined,
      createdAt: now, updatedAt: now,
    })
  }
  return { accounts, unknownProviders }
}

export interface ParsedQuotas {
  quotas: QuotaSnapshot[]
  /** 未匹配到账户的行（账户名） */
  unmatched: string[]
}

/** 解析额度 CSV，按账户名（label）匹配现有账户 */
export function parseQuotasCsv(text: string, accounts: Account[], now = new Date().toISOString()): ParsedQuotas {
  const cleaned = text.replace(/^\ufeff/, '').trim()
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim())
  const header = csvHeader(text)
  const idx = (names: string[]) => header.findIndex(h => names.includes(h))
  const iAcc = idx(['account', 'label', '账户', '账户名', '名称'])
  const iUnit = idx(['unit', '单位'])
  const iTotal = idx(['total', '总额', '总额度'])
  const iUsed = idx(['used', '已用'])
  const iReset = idx(['resetat', '重置日期', '到期日'])
  const iCaptured = idx(['capturedat', '录入时间'])
  if (iAcc < 0 || iTotal < 0) throw new Error('额度 CSV 缺少 account 或 total 列')
  const validUnits: CreditUnit[] = ['credit', 'token', 'request', 'currency', 'day']
  const quotas: QuotaSnapshot[] = []
  const unmatched: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const label = (cells[iAcc] ?? '').trim()
    const account = accounts.find(a => a.label === label)
    if (!account) { if (label) unmatched.push(label); continue }
    const total = Number(iTotal >= 0 ? cells[iTotal] : 0)
    const used = Number(iUsed >= 0 ? cells[iUsed] : 0)
    if (!isFinite(total) || total < 0) continue
    const unitRaw = (iUnit >= 0 ? cells[iUnit] ?? '' : '').trim() as CreditUnit
    const unit = validUnits.includes(unitRaw) ? unitRaw : 'credit'
    quotas.push({
      id: `q_imp_${i}_${Date.now()}`,
      accountId: account.id, unit,
      total, used: isFinite(used) && used >= 0 ? used : 0,
      resetAt: iReset >= 0 ? cells[iReset] || undefined : undefined,
      capturedAt: iCaptured >= 0 && cells[iCaptured] ? cells[iCaptured] : now,
      source: 'import',
    })
  }
  return { quotas, unmatched }
}

/**
 * 从备注提取分类（用于 API Key 管理页下拉筛选）：
 * - [分类] 说明 → 分类
 * - 分类: 说明 / 分类：说明 → 分类（冒号前的部分）
 * - 文本/图片、图片、生成 → 按 / 、 , 空格 分隔取第一段
 * - 纯文字备注 → 整个备注作为分类
 */
export function noteCategory(note?: string): string {
  if (!note) return '未分类'
  const s = note.trim()
  if (!s) return '未分类'
  const bracket = s.match(/^\[([^\]]+)\]/)
  if (bracket) return bracket[1].trim()
  const colon = s.split(/[:：]/)[0].trim()
  if (colon && colon !== s) return colon
  const first = s.split(/[\/、,，\s]/)[0].trim()
  return first || s
}

/** 解析用量 CSV（复用既有解析器） */
export function parseUsage(text: string, accounts: Account[]): UsageEventInput[] {
  return parseUsageCsv(text, accounts)
}

// ==================== 第三方「API 服务清单」格式 ====================
// 形如 [{ name, note, apiBase, api, model, endpoint, modelCategory, quota, kid }]
// 注意：api 为明文密钥，仅用于导入时即时加密，绝不写入导出/日志。

export interface ServiceEntry {
  kid: string
  /** 清单中的原始服务名 */
  name: string
  /** 映射后的平台 id（可能是新平台） */
  providerId: string
  /** 账户显示名：服务名 · 用途（同名多用途时区分） */
  label: string
  /** 用途备注（已归一化为 [分类] 用途 格式） */
  note: string
  apiBase: string
  endpoint: string
  model: string
  modelCategory: string
  /** 明文 API Key —— 仅内存，导入时立即加密 */
  plainKey: string
  /** 解析出的额度（total + currency 单位），无法解析则为 null */
  quota: { total: number; unit: 'currency' } | null
  localOnly: boolean
}

/** 服务名 → 平台 id 映射（含中文别名） */
const SERVICE_NAME_MAP: Record<string, string> = {
  'deepseek': 'deepseek', '深度求索': 'deepseek',
  'glm': 'glm', '智谱': 'glm', 'bigmodel': 'glm',
  'siliconflow': 'siliconflow', '硅基流动': 'siliconflow',
  'kimi': 'kim', 'moonshot': 'kim',
  'comfyui': 'comfyui', 'ollama': 'ollama',
  'openai': 'openai', 'claude': 'anthropic', 'anthropic': 'anthropic',
  'gemini': 'gemini', 'qwen': 'qwen', '通义': 'qwen', 'doubao': 'doubao', '豆包': 'doubao',
}

/** modelCategory → [分类] 标签 */
const CATEGORY_TAG: Record<string, string> = {
  text: '文本', image: '图片', video: '视频', speech: '语音',
  vision: '视觉', edit: '编辑', design: '设计', other: '其他',
}

/** 判断是否为第三方服务清单（JSON 数组，元素含 name/apiBase/api 等） */
export function isServiceList(text: string): boolean {
  const t = text.trim()
  if (!t.startsWith('[')) return false
  try {
    const arr = JSON.parse(t)
    if (!Array.isArray(arr) || arr.length === 0) return false
    const valid = arr.filter((x: any) => x && typeof x === 'object' &&
      (typeof x.name === 'string') && (typeof x.apiBase === 'string' || typeof x.api === 'string'))
    // 过半元素符合即视为服务清单（容忍混入的异常条目）
    return valid.length >= Math.ceil(arr.length / 2)
  } catch { return false }
}

/** 解析 "7.51 CNY" / "¥24.88713" / "100 积分" 等额度字符串 */
export function parseQuotaString(s: string): { total: number; unit: 'currency' } | null {
  if (!s || typeof s !== 'string') return null
  const m = s.match(/([\d,]+(?:\.\d+)?)/)
  if (!m) return null
  const total = Number(m[1].replace(/,/g, ''))
  if (!isFinite(total) || total < 0) return null
  if (/暂不支持|不支持|未知|无/.test(s) && total === 0) return null
  return { total, unit: 'currency' }
}

/** 映射服务名到平台 id：先精确匹配中文/英文关键词，再返回 'custom-<slug>' */
export function mapServiceProvider(name: string): string {
  const lower = name.toLowerCase()
  for (const [key, id] of Object.entries(SERVICE_NAME_MAP)) {
    if (lower.includes(key)) return id
  }
  // 兜底：生成一个稳定 id（平台目录未知，界面按原始 name 显示）
  return 'custom-' + lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
}

/** 解析第三方服务清单，返回可预览的条目（含明文 Key，调用方须立即加密） */
export function parseServiceList(text: string): ServiceEntry[] {
  const raw = JSON.parse(text) as any[]
  const arr = raw.filter((x: any) => x && typeof x === 'object' && typeof x.name === 'string'
    && (typeof x.apiBase === 'string' || typeof x.api === 'string'))
  return arr.map((x, i) => {
    const name = String(x.name ?? `服务 ${i + 1}`)
    const rawNote = String(x.note ?? '').trim()
    const category = String(x.modelCategory ?? '').toLowerCase()
    const tag = CATEGORY_TAG[category] ?? (category ? category : '其他')
    const note = `[${tag}] ${rawNote || category || '未分类'}`
    // 同名多用途：label 追加用途以区分
    const sameName = arr.filter((y: any) => (y.name ?? '') === name).length > 1
    const label = sameName && rawNote ? `${name} · ${rawNote}` : name
    return {
      kid: String(x.kid ?? `svc_${i}`),
      name,
      providerId: mapServiceProvider(name),
      label,
      note,
      apiBase: String(x.apiBase ?? ''),
      endpoint: String(x.endpoint ?? ''),
      model: String(x.model ?? ''),
      modelCategory: category,
      plainKey: String(x.api ?? ''),
      quota: parseQuotaString(String(x.quota ?? '')),
      localOnly: x.localOnly === true,
    }
  })
}
