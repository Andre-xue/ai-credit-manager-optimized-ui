// AI 工具目录的「实时抓取更新」层。
//
// 设计目标：使用量排名 / 签到规则会随时间变化，内置常量会过期。本模块：
// 1. 从可配置的数据源拉取最新目录（JSON），覆盖内置快照；
// 2. 拉取成功写入本地缓存（localStorage），下次启动先用缓存即时展示，再后台刷新；
// 3. 任何网络失败 / 数据源不可用，都回退到内置快照，功能永不中断；
// 4. 记录最后更新时间与来源，供 UI 展示「数据更新于 X」。
//
// 数据源优先级：
//   - 用户在设置里配置的自定义 URL（localStorage: acm_agent_catalog_url）
//   - 默认源：项目 GitHub Pages / jsDelivr CDN 上的 agent-catalog.json（公开、免鉴权、跨域允许）
// 内置快照作为兜底。应用本身生成的 catalog JSON 见 scripts/export-catalog.mjs。

import { AGENT_TOOLS, type AgentTool } from '../data/agentTools'

const CACHE_KEY = 'acm_agent_catalog_cache_v1'
const URL_KEY = 'acm_agent_catalog_url'
const UPDATED_KEY = 'acm_agent_catalog_updated'

/** 默认数据源：jsDelivr 代理 GitHub 仓库文件（公开 CDN，CORS 友好） */
export const DEFAULT_CATALOG_URL =
  'https://cdn.jsdelivr.net/gh/Andre-xue/ai-credit-manager@main/public/agent-catalog.json'

export interface CatalogSnapshot {
  version: number
  updatedAt: string
  source: string
  tools: AgentTool[]
}

/** 读取本地缓存（若有），无则返回 null */
export function loadCachedCatalog(): CatalogSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw) as CatalogSnapshot
    if (!Array.isArray(obj.tools) || obj.tools.length === 0) return null
    return obj
  } catch { return null }
}

export function getCatalogUpdatedAt(): string | null {
  try { return localStorage.getItem(UPDATED_KEY) } catch { return null }
}

export function getCatalogUrl(): string {
  try { return localStorage.getItem(URL_KEY) || DEFAULT_CATALOG_URL } catch { return DEFAULT_CATALOG_URL }
}

export function setCatalogUrl(url: string): void {
  try {
    const u = url.trim()
    if (u && /^https?:\/\//.test(u)) localStorage.setItem(URL_KEY, u)
    else localStorage.removeItem(URL_KEY)
  } catch { /* 忽略隐私模式写入失败 */ }
}

function validateTools(data: unknown): AgentTool[] | null {
  if (!data || typeof data !== 'object') return null
  const tools = (data as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return null
  const clean = tools.filter((t): t is AgentTool =>
    !!t && typeof t === 'object' && typeof t.id === 'string' && typeof t.name === 'string' &&
    typeof t.downloadUrl === 'string' && typeof t.usage === 'number' && Array.isArray(t.platforms))
  return clean.length > 0 ? clean : null
}

/** 从数据源拉取最新目录。成功写入缓存并返回；失败返回 null（调用方回退内置）。 */
export async function fetchCatalog(force = false): Promise<{ ok: boolean; snapshot?: CatalogSnapshot; error?: string }> {
  const url = getCatalogUrl()
  try {
    const cached = loadCachedCatalog()
    // 非强制时，15 分钟内不重复拉取（避免频繁请求）
    if (!force && cached) {
      const last = getCatalogUpdatedAt()
      if (last && Date.now() - new Date(last).getTime() < 15 * 60 * 1000) {
        return { ok: true, snapshot: cached }
      }
    }
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`数据源返回 ${resp.status}`)
    const tools = validateTools(await resp.json())
    if (!tools) throw new Error('数据格式无效')
    const snapshot: CatalogSnapshot = {
      version: Date.now(),
      updatedAt: new Date().toISOString(),
      source: url,
      tools,
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
      localStorage.setItem(UPDATED_KEY, snapshot.updatedAt)
    } catch { /* 缓存失败不影响本次使用 */ }
    return { ok: true, snapshot }
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? '网络不可用' }
  }
}

/** 取当前应展示的目录：优先缓存，否则内置快照 */
export function currentCatalog(): { tools: AgentTool[]; updatedAt: string | null; fromCache: boolean } {
  const cached = loadCachedCatalog()
  if (cached) return { tools: cached.tools, updatedAt: cached.updatedAt, fromCache: true }
  return { tools: AGENT_TOOLS, updatedAt: null, fromCache: false }
}

const SEEN_KEY = 'acm_agent_catalog_seen_v1'

/** 目录更新提醒：返回用户尚未见过的新工具。首次运行只登记不提醒，避免把全量目录当新闻。 */
export function getUnseenTools(tools: AgentTool[]): AgentTool[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) {
      localStorage.setItem(SEEN_KEY, JSON.stringify(tools.map(t => t.id)))
      return []
    }
    const seen = new Set(JSON.parse(raw) as string[])
    return tools.filter(t => !seen.has(t.id))
  } catch { return [] }
}

/** 用户已查看目录后登记全部工具 id，后续只提醒真正的新增。 */
export function markCatalogSeen(tools: AgentTool[]): void {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(tools.map(t => t.id))) } catch { /* 忽略 */ }
}
