import type { AppState, Account, QuotaSnapshot, CheckinRecord, UsageEvent, AccountMode, BenefitMark } from './types'

const STORAGE_KEY = 'acm.state.v1'

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyState(): AppState {
  return {
    version: 1,
    accounts: [],
    quotas: [],
    checkins: [],
    benefitMarks: [],
    usage: [],
    settings: {
      vaultInitialized: false, monthlyBudget: 200, checkinReminder: true, checkinProviders: [],
      alertDays: 7, defaultUnit: 'credit', backupReminder: true, backupReminderDays: 7,
      unlockMethod: 'password',
      uiStyle: 'claude', uiTheme: 'aurora', uiMotion: true,
      unitPrices: {},
      // 本地服务默认全开；8G 内存由工具函数在首次使用时收敛为仅开一个
      localServices: { ollama: true, comfyui: true, lmstudio: true },
    },
  }
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as AppState
    return {
      ...emptyState(),
      ...parsed,
      settings: { ...emptyState().settings, ...parsed.settings },
    }
  } catch {
    return emptyState()
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingState: AppState | null = null

/** 防抖持久化：频繁 setState 时避免每次都同步 JSON.stringify + 主线程 IO */
export function saveStateDebounced(state: AppState): void {
  pendingState = state
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (pendingState) saveState(pendingState)
    pendingState = null
    saveTimer = null
  }, 250)
}

/** 立即落盘（页面隐藏/卸载、关键操作后调用），避免防抖窗口内丢失 */
export function flushState(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  if (pendingState) { saveState(pendingState); pendingState = null }
}

/** 局部更新设置项 */
export function updateSettings(state: AppState, patch: Partial<AppState['settings']>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } }
}

/** 清空业务数据（保留设置与保险箱状态） */
export function clearAllData(state: AppState): AppState {
  return { ...state, accounts: [], quotas: [], checkins: [], usage: [], benefitMarks: [] }
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function addAccount(
  state: AppState,
  input: { providerId: string; label: string; mode: AccountMode; encryptedKey?: string; keyFingerprint?: string; apiUrl?: string; note?: string },
): AppState {
  const now = new Date().toISOString()
  const account: Account = { id: uid('acc'), ...input, createdAt: now, updatedAt: now }
  // 新账户放到最前（API Key 管理页置顶显示）
  return { ...state, accounts: [account, ...state.accounts] }
}

/** 局部更新账户（编辑名称/API 地址/备注/密钥等） */
export function updateAccount(state: AppState, accountId: string, patch: Partial<Account>): AppState {
  return {
    ...state,
    accounts: state.accounts.map(a => a.id === accountId ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a),
  }
}

export function removeAccount(state: AppState, accountId: string): AppState {
  return {
    ...state,
    accounts: state.accounts.filter((a) => a.id !== accountId),
    quotas: state.quotas.filter((q) => q.accountId !== accountId),
    usage: state.usage.filter((u) => u.accountId !== accountId),
    checkins: state.checkins.filter((c) => c.accountId !== accountId),
  }
}

/** 每个账户保留的最近快照数量上限（用于用量速度预测） */
export const QUOTA_HISTORY_LIMIT = 90

/**
 * 追加一条额度快照。保留历史（上限 QUOTA_HISTORY_LIMIT），以便计算消耗速度。
 * 取当前额度请用 latestQuota()，不要用 quotas.find()。
 */
export function upsertQuota(state: AppState, quota: Omit<QuotaSnapshot, 'id' | 'capturedAt' | 'source'> & { source?: QuotaSnapshot['source'] }): AppState {
  const snapshot: QuotaSnapshot = {
    id: uid('q'),
    capturedAt: new Date().toISOString(),
    source: quota.source ?? 'manual',
    ...quota,
  }
  const history = [...state.quotas, snapshot].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  // 仅对该账户裁剪，保留其他账户历史
  const mine = history.filter((q) => q.accountId === quota.accountId)
  if (mine.length <= QUOTA_HISTORY_LIMIT) return { ...state, quotas: history }
  const trimmedIds = new Set(mine.slice(-QUOTA_HISTORY_LIMIT).map((q) => q.id))
  return { ...state, quotas: history.filter((q) => q.accountId !== quota.accountId || trimmedIds.has(q.id)) }
}

/** 取账户最新额度快照（按 capturedAt，时间相同时取数组中靠后的） */
export function latestQuota(quotas: QuotaSnapshot[], accountId: string): QuotaSnapshot | undefined {
  let latest: QuotaSnapshot | undefined
  let latestIdx = -1
  quotas.forEach((q, idx) => {
    if (q.accountId !== accountId) return
    if (!latest || q.capturedAt > latest.capturedAt || (q.capturedAt === latest.capturedAt && idx > latestIdx)) {
      latest = q
      latestIdx = idx
    }
  })
  return latest
}

export function toggleCheckin(state: AppState, providerId: string, accountId?: string): AppState {
  const date = todayISO()
  const existing = state.checkins.find(
    (c) => c.providerId === providerId && c.date === date && (accountId ? c.accountId === accountId : !c.accountId),
  )
  if (existing) {
    return {
      ...state,
      checkins: state.checkins.map((c) => (c.id === existing.id ? { ...c, done: !c.done } : c)),
    }
  }
  const record: CheckinRecord = { id: uid('ci'), providerId, accountId, date, done: true }
  return { ...state, checkins: [...state.checkins, record] }
}

/** 标记福利为"本人已处理"（daily 按当天记录，其他类型只记一次） */
export function markBenefit(state: AppState, benefitId: string, kind: 'daily' | 'other'): AppState {
  const date = todayISO()
  const exists = state.benefitMarks.some(m =>
    m.benefitId === benefitId && (kind === 'daily' ? m.date === date : true),
  )
  if (exists) return state
  return { ...state, benefitMarks: [...state.benefitMarks, { benefitId, date }] }
}

export function addUsageEvent(state: AppState, event: Omit<UsageEvent, 'id'>): AppState {
  return { ...state, usage: [...state.usage, { ...event, id: uid('u') }] }
}

export function exportState(state: AppState): string {
  // 导出不含加密密钥与校验位，避免保险箱被离线爆破
  const safe: AppState = {
    ...state,
    accounts: state.accounts.map(({ encryptedKey: _ek, keyFingerprint: _kf, ...rest }) => rest),
    // 密钥不随备份迁移，保险箱状态也必须重置，否则跨设备导入后 UI 矛盾
    settings: { ...state.settings, vaultInitialized: false },
  }
  return JSON.stringify(safe, null, 2)
}

export function importState(json: string): AppState {
  const parsed = JSON.parse(json) as Partial<AppState> | null
  if (!parsed || typeof parsed !== 'object' || !parsed.accounts || !Array.isArray(parsed.accounts)) {
    throw new Error('文件格式不正确')
  }
  // 兼容早期版本：确保所有数组字段存在
  return {
    version: parsed.version ?? 1,
    accounts: parsed.accounts,
    quotas: Array.isArray(parsed.quotas) ? parsed.quotas : [],
    checkins: Array.isArray(parsed.checkins) ? parsed.checkins : [],
    benefitMarks: Array.isArray((parsed as any).benefitMarks) ? (parsed as any).benefitMarks : [],
    usage: Array.isArray(parsed.usage) ? parsed.usage : [],
    settings: { ...emptyState().settings, ...(parsed.settings ?? {}) },
  }
}

/** 按 benefitId+date 去重合并福利标记 */
function mergeBenefitMarks(local: BenefitMark[], incoming: BenefitMark[]): BenefitMark[] {
  const key = (m: BenefitMark) => `${m.benefitId}@${m.date}`
  const seen = new Set(local.map(key))
  return [...local, ...incoming.filter(m => !seen.has(key(m)))]
}

/** 按 id 去重合并两份状态（导入用）：本地数据优先，追加导入中的新条目 */
export function mergeState(local: AppState, incoming: AppState): AppState {
  const byId = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const seen = new Set(a.map(x => x.id))
    return [...a, ...b.filter(x => !seen.has(x.id))]
  }
  const inSettings = incoming.settings ?? emptyState().settings
  return {
    version: Math.max(local.version ?? 1, incoming.version ?? 1),
    accounts: byId(local.accounts, incoming.accounts),
    quotas: byId(local.quotas, incoming.quotas),
    checkins: byId(local.checkins, incoming.checkins),
    usage: byId(local.usage, incoming.usage),
    benefitMarks: mergeBenefitMarks(local.benefitMarks ?? [], incoming.benefitMarks ?? []),
    settings: {
      ...inSettings,
      ...local.settings,
      // 单价校准表取并集，本地值优先
      unitPrices: { ...(inSettings.unitPrices ?? {}), ...(local.settings.unitPrices ?? {}) },
      monthlyBudget: Math.max(local.settings.monthlyBudget, inSettings.monthlyBudget),
    },
  }
}
