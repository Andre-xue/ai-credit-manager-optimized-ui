// ============================================================
// 第三方插件系统（v0.1.264）：设备本地安装，不云同步、不进备份（与界面语言同等待遇）。
// 插件包 = 清单 manifest + JS 代码（+ 可选面板 HTML）。代码在沙箱 iframe 中运行，
// 只能通过宿主 RPC 调用能力（网络走宿主代理且受清单 hosts 白名单约束）；
// 插件永远拿不到保险箱明文 Key——余额适配器由宿主在解锁后把单个账户的 Key 作为
// 调用参数传入，且其网络请求只能发往清单声明的域名。
// 桌面端额外支持进程插件：清单声明本地命令，由用户在本机启动/停止。
// ============================================================

export type PluginPermission = 'network' | 'data' | 'notify' | 'storage' | 'openUrl'
export const PLUGIN_PERMISSIONS: PluginPermission[] = ['network', 'data', 'notify', 'storage', 'openUrl']

/** 插件设置项声明：App 据此为每个插件生成独立设置页，值存插件私有存储，插件经 acm.getSettings() 读取 */
export type PluginSettingType = 'text' | 'password' | 'number' | 'switch' | 'select' | 'textarea'
export const PLUGIN_SETTING_TYPES: PluginSettingType[] = ['text', 'password', 'number', 'switch', 'select', 'textarea']
export interface PluginSettingField {
  key: string
  label: string
  type: PluginSettingType
  options?: string[]
  default?: string | number | boolean
  placeholder?: string
  help?: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** 声明的能力面：panel=有面板页；adapter=注册余额适配器；process=桌面进程插件 */
  provides: Array<'panel' | 'adapter' | 'process'>
  permissions: PluginPermission[]
  /** 网络白名单（域名；匹配该域名及其子域名）。permissions 含 network 时必填 */
  hosts?: string[]
  /** adapter 目标平台 id 列表（声明用；实际注册以代码调用 registerBalanceAdapter 为准） */
  providers?: string[]
  /** 进程插件（仅桌面端）：要启动的本地命令 */
  process?: { command: string; args?: string[] }
  /** 设置项声明（可选）：App 为该插件生成独立设置页 */
  settings?: PluginSettingField[]
}

export interface InstalledPlugin {
  manifest: PluginManifest
  code: string
  html?: string
  enabled: boolean
  installedAt: number
  source: 'builtin' | 'file' | 'editor'
}

export interface PluginPackage {
  manifest: PluginManifest
  code: string
  html?: string
}

const PLUGINS_KEY = 'acm.plugins.v1'
export const PLUGINS_EVENT = 'acm-plugins-changed'

function emitPluginsChanged(): void {
  try { window.dispatchEvent(new Event(PLUGINS_EVENT)) } catch { /* node 测试环境无 window 时忽略 */ }
}

export function loadPlugins(): InstalledPlugin[] {
  try {
    const raw = localStorage.getItem(PLUGINS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(p => p && typeof p === 'object' && p.manifest && typeof p.code === 'string')
      // v0.1.326：下架的「余额适配器模板」示例是占位模板（hosts 仍为 api.example.com 即未改过的）
      // 对用户纯属不能用的摆设，加载时直接滤掉；已被改成真实域名的（真在用的适配器）保留
      .filter(p => !(p.manifest.id === 'acm-template-adapter' && (p.manifest.hosts ?? []).includes('api.example.com')))
  } catch { return [] }
}

function savePlugins(list: InstalledPlugin[]): void {
  try { localStorage.setItem(PLUGINS_KEY, JSON.stringify(list)) } catch { /* 存不下则忽略 */ }
  emitPluginsChanged()
}

/** 更新一个已装插件时，新版相对旧版扩大的访问面（新增权限 / 新增域名 / 新增适配平台 / 新增进程命令） */
export function pluginAccessExpansion(
  oldM: PluginManifest,
  newM: PluginManifest,
): { permissions: string[]; hosts: string[]; providers: string[]; processAdded: boolean } {
  const diff = (a: string[] | undefined, b: string[] | undefined) => (a ?? []).filter(x => !(b ?? []).includes(x))
  return {
    permissions: diff(newM.permissions, oldM.permissions),
    hosts: diff(newM.hosts, oldM.hosts),
    providers: diff(newM.providers, oldM.providers),
    processAdded: !!newM.process && !oldM.process,
  }
}

export function installPlugin(pkg: PluginPackage, source: InstalledPlugin['source']): InstalledPlugin {
  const list = loadPlugins()
  const existing = list.find(p => p.manifest.id === pkg.manifest.id)
  // 更新时若新版扩大了权限/域名/适配范围，默认停用，等用户核对后手动启用（v0.1.285）
  let enabled = existing ? existing.enabled : true
  if (existing) {
    const ex = pluginAccessExpansion(existing.manifest, pkg.manifest)
    if (ex.permissions.length || ex.hosts.length || ex.providers.length || ex.processAdded) enabled = false
  }
  const rec: InstalledPlugin = {
    manifest: pkg.manifest,
    code: pkg.code,
    html: pkg.html,
    enabled,
    installedAt: existing ? existing.installedAt : Date.now(),
    source,
  }
  const next = existing ? list.map(p => (p.manifest.id === pkg.manifest.id ? rec : p)) : [...list, rec]
  savePlugins(next)
  return rec
}

export function uninstallPlugin(id: string): void {
  savePlugins(loadPlugins().filter(p => p.manifest.id !== id))
  // 一并清掉该插件的私有存储
  try {
    const prefix = `acm.plugin.data.${id}.`
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) keys.push(k) }
    keys.forEach(k => localStorage.removeItem(k))
  } catch { /* 忽略 */ }
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  savePlugins(loadPlugins().map(p => (p.manifest.id === id ? { ...p, enabled } : p)))
}

/** 校验一个插件包（文件导入 / 编辑器保存共用）。返回错误文案或 null（通过）。 */
export function validatePluginPackage(pkg: unknown): string | null {
  if (!pkg || typeof pkg !== 'object') return '插件包不是有效的对象'
  const p = pkg as Partial<PluginPackage>
  const m = p.manifest as Partial<PluginManifest> | undefined
  if (!m || typeof m !== 'object') return '缺少 manifest 清单'
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(m.id)) return '插件 id 只能用小写字母、数字与连字符（2–49 位）'
  if (typeof m.name !== 'string' || !m.name.trim()) return '插件名称不能为空'
  if (typeof m.version !== 'string' || !m.version.trim()) return '插件版本号不能为空'
  if (!Array.isArray(m.provides) || m.provides.length === 0) return 'manifest.provides 至少声明一项能力（panel / adapter / process）'
  for (const v of m.provides) if (v !== 'panel' && v !== 'adapter' && v !== 'process') return `未知的 provides 值：${String(v)}`
  if (!Array.isArray(m.permissions)) return 'manifest.permissions 必须是数组'
  for (const v of m.permissions) if (!PLUGIN_PERMISSIONS.includes(v as PluginPermission)) return `未知的权限：${String(v)}`
  if (m.permissions.includes('network')) {
    if (!Array.isArray(m.hosts) || m.hosts.length === 0) return '声明了 network 权限就必须在 hosts 里列出允许访问的域名'
    for (const h of m.hosts) if (typeof h !== 'string' || !/^[a-z0-9.-]+$/i.test(h) || h.includes('..')) return `hosts 域名不合法：${String(h)}`
  }
  if (m.provides.includes('process')) {
    if (!m.process || typeof m.process.command !== 'string' || !m.process.command.trim()) return '进程插件必须在 manifest.process.command 里写明要启动的命令'
  }
  if (m.settings !== undefined) {
    if (!Array.isArray(m.settings)) return 'manifest.settings 必须是数组'
    const seenKeys = new Set<string>()
    for (const f of m.settings as Array<Partial<PluginSettingField>>) {
      if (!f || typeof f.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(f.key)) return '设置项 key 只能用字母开头、字母数字与下划线'
      if (seenKeys.has(f.key)) return `设置项 key 重复：${f.key}`
      seenKeys.add(f.key)
      if (typeof f.label !== 'string' || !f.label.trim()) return `设置项 ${f.key} 缺少 label`
      if (!PLUGIN_SETTING_TYPES.includes(f.type as PluginSettingType)) return `设置项 ${f.key} 的 type 不合法`
      if (f.type === 'select' && (!Array.isArray(f.options) || f.options.length === 0)) return `设置项 ${f.key} 是 select 类型，必须提供 options`
    }
  }
  if (typeof p.code !== 'string' || !p.code.trim()) return '插件代码不能为空'
  if (p.code.length > 512 * 1024) return '插件代码过大（上限 512KB）'
  if (p.html !== undefined && typeof p.html !== 'string') return 'html 必须是字符串'
  return null
}

/** 网络白名单匹配：请求域名等于清单域名，或是其子域名。
 *  v0.1.285 起同时校验协议：只允许 https，明文 http 仅放行本机地址——
 *  防止适配器插件把账户 Key 经 http 明文发往白名单域名。 */
export function isHostAllowed(url: string, hosts: string[] | undefined): boolean {
  if (!hosts || hosts.length === 0) return false
  let u: URL
  try { u = new URL(url) } catch { return false }
  const host = u.hostname.toLowerCase()
  if (u.protocol === 'http:') {
    if (!(host === 'localhost' || host === '127.0.0.1' || host === '::1')) return false
  } else if (u.protocol !== 'https:') return false
  return hosts.some(h => {
    const d = h.toLowerCase()
    return host === d || host.endsWith('.' + d)
  })
}

/** 插件私有存储（localStorage 命名空间隔离） */
export function pluginStorageGet(pluginId: string, key: string): unknown {
  try {
    const raw = localStorage.getItem(`acm.plugin.data.${pluginId}.${key}`)
    return raw == null ? null : JSON.parse(raw)
  } catch { return null }
}
export function pluginStorageSet(pluginId: string, key: string, value: unknown): void {
  try { localStorage.setItem(`acm.plugin.data.${pluginId}.${key}`, JSON.stringify(value ?? null)) } catch { /* 忽略 */ }
}

/** 插件设置值在私有存储中的保留键 */
export const PLUGIN_SETTINGS_STORAGE_KEY = '__settings'

/** 读取插件当前设置值：清单声明的默认值打底，用户在设置页填的值覆盖 */
export function pluginSettingsValues(plugin: InstalledPlugin): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of plugin.manifest.settings ?? []) {
    if (f.default !== undefined) out[f.key] = f.default
  }
  const stored = pluginStorageGet(plugin.manifest.id, PLUGIN_SETTINGS_STORAGE_KEY)
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    Object.assign(out, stored as Record<string, unknown>)
  }
  return out
}

export function savePluginSettings(pluginId: string, values: Record<string, unknown>): void {
  pluginStorageSet(pluginId, PLUGIN_SETTINGS_STORAGE_KEY, values)
}

// ---------------- 桌面进程插件（Tauri 命令封装；非桌面端调用直接报错） ----------------

function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a: Record<string, unknown>) => Promise<T> } }
  if (!w.__TAURI_INTERNALS__?.invoke) return Promise.reject(new Error('仅桌面端可用'))
  return w.__TAURI_INTERNALS__.invoke(cmd, args)
}

export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function pluginProcessStart(p: InstalledPlugin): Promise<number> {
  const proc = p.manifest.process
  if (!proc) throw new Error('该插件没有声明进程命令')
  return tauriInvoke<number>('plugin_process_start', { id: p.manifest.id, command: proc.command, args: proc.args ?? [] })
}
export async function pluginProcessStop(id: string): Promise<void> {
  await tauriInvoke('plugin_process_stop', { id })
}
export async function pluginProcessRunning(id: string): Promise<boolean> {
  try { return await tauriInvoke<boolean>('plugin_process_running', { id }) } catch { return false }
}
export async function pluginProcessOutput(id: string): Promise<string> {
  try { return await tauriInvoke<string>('plugin_process_output', { id }) } catch { return '' }
}

/** 桌面端插件网络代理（绕 CORS + Rust 侧 SSRF 校验）；非桌面端由 runtime 用 fetch/CapacitorHttp 兜底 */
export async function pluginHttpDesktop(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string; headers: Record<string, string> }> {
  const raw = await tauriInvoke<string>('plugin_http', {
    url, method,
    headersJson: JSON.stringify(headers ?? {}),
    body: body ?? null,
  })
  const parsed = JSON.parse(raw) as { status: number; body: string; headers?: Record<string, string> }
  return { status: parsed.status, text: parsed.body, headers: parsed.headers ?? {} }
}

// ---------------- 内置示例插件（可一键装入，帮用户理解插件能做什么） ----------------

export const EXAMPLE_PLUGINS: PluginPackage[] = [
  {
    manifest: {
      id: 'acm-example-fx',
      name: '汇率助手（示例）',
      version: '1.0.0',
      description: '面板插件示例：经宿主网络代理拉取公开汇率接口，展示美元/欧元/英镑/日元对人民币汇率，结果缓存在插件私有存储里。',
      author: 'AI 魔方',
      provides: ['panel'],
      permissions: ['network', 'storage', 'notify'],
      hosts: ['open.er-api.com'],
      settings: [
        { key: 'base', label: '基准货币', type: 'select', options: ['USD', 'EUR', 'GBP', 'CNY', 'JPY'], default: 'USD', help: '汇率接口的基准货币，在插件设置页修改' },
      ],
    },
    html: '<div style="font-family:inherit;padding:6px 2px"><div style="display:flex;gap:8px;align-items:center"><button id="fx-go" style="padding:6px 14px;border-radius:8px;border:0;background:#6d28d9;color:#fff;cursor:pointer">获取最新汇率</button><span id="fx-at" style="font-size:12px;opacity:.65"></span></div><div id="fx-out" style="margin-top:10px;font-size:14px;line-height:1.9"></div></div>',
    code: `
const out = document.getElementById('fx-out')
const at = document.getElementById('fx-at')
function render(d) {
  if (!d || !d.rates) { out.textContent = '暂无数据，点上方按钮获取'; return }
  const r = d.rates // 基准 USD：r.CNY = 1 美元的人民币价；1 单位 X 的人民币价 = r.CNY / r[X]
  const row = (c) => '<div>1 ' + c + ' ≈ <b>' + (r.CNY / r[c]).toFixed(4) + '</b> CNY</div>'
  out.innerHTML = ['USD', 'EUR', 'GBP', 'JPY'].map(row).join('')
  at.textContent = d.at ? ('更新于 ' + new Date(d.at).toLocaleString()) : ''
}
;(async () => { render(await acm.storage.get('last')) })()
document.getElementById('fx-go').addEventListener('click', async () => {
  out.textContent = '加载中…'
  try {
    const s = await acm.getSettings()
    const base = s.base || 'USD'
    const res = await acm.http('https://open.er-api.com/v6/latest/' + base)
    const j = JSON.parse(res.text)
    if (!j || !j.rates) throw new Error('接口返回异常')
    const d = { rates: j.rates, at: Date.now() }
    await acm.storage.set('last', d)
    render(d)
    acm.notify('汇率已更新')
  } catch (e) { out.textContent = '获取失败：' + (e && e.message ? e.message : e) }
})
`,
  },
  {
    manifest: {
      id: 'acm-example-digest',
      name: '数据速览（示例）',
      version: '1.1.0',
      description: '面板插件示例：读取与 AI 助手「引用我的数据」相同的脱敏摘要（不含任何密钥），展示在面板里。',
      author: 'AI 魔方',
      provides: ['panel'],
      permissions: ['data', 'notify'],
    },
    html: '<div style="font-family:inherit;padding:6px 2px;color:#26282e"><div style="display:flex;gap:8px;align-items:center"><button id="dg-go" style="padding:6px 14px;border-radius:8px;border:0;background:#6d28d9;color:#fff;cursor:pointer">读取我的数据摘要</button><span id="dg-at" style="font-size:12px;color:#9a9ea8"></span></div><div id="dg-out" style="margin-top:10px"></div></div>',
    code: `
var out = document.getElementById('dg-out')
var atEl = document.getElementById('dg-at')
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function num(s) { return parseFloat(String(s).replace(/,/g, '')) || 0 }
function bar(pct, color) {
  var p = Math.max(0, Math.min(100, pct))
  return '<div style="height:6px;border-radius:3px;background:#ececf1;margin-top:6px"><div style="height:6px;border-radius:3px;background:' + color + ';width:' + p + '%"></div></div>'
}
function render(text) {
  var lines = String(text).split('\\n')
  var head = null, accounts = [], low = '', spend = null, models = '', budget = null, checkin = null, soon = ''
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i], m
    if ((m = L.match(/^账户共 (\\d+) 个（(\\d+) 个已配置 API Key）；货币额度剩余合计 ¥([\\d,.]+)/))) head = { n: m[1], k: m[2], total: m[3] }
    else if ((m = L.match(/^- (.+)（(.+)）：剩 ¥([\\d,.]+) \\/ 共 ¥([\\d,.]+)(?:，额度重置\\/到期 (\\d{4}-\\d{2}-\\d{2}))?/))) accounts.push({ label: m[1], platform: m[2], rem: m[3], tot: m[4], reset: m[5] || '' })
    else if (L.indexOf('低余额账户') === 0) low = L.replace(/^低余额账户（[^）]*）：/, '').replace(/。$/, '')
    else if ((m = L.match(/^本月（[\\d-]+）消费：共 ¥([\\d,.]+)，(\\d+) 笔记录；花费最高的平台：(.+?)。?$/))) spend = { cost: m[1], count: m[2], top: m[3] }
    else if ((m = L.match(/^本月（[\\d-]+）暂无消费记录/))) spend = { none: true }
    else if ((m = L.match(/^本月最常用模型：(.+?)。?$/))) models = m[1]
    else if ((m = L.match(/^本月总预算 ¥([\\d,.]+)，已用 (\\d+)%/))) budget = { total: m[1], pct: parseInt(m[2], 10) }
    else if ((m = L.match(/今日签到已全部完成；已连续签到 (\\d+) 天/))) checkin = { done: true, streak: m[1] }
    else if ((m = L.match(/今日待签到 (\\d+) 个：(.+?)；已连续签到 (\\d+) 天/))) checkin = { done: false, pending: m[1], names: m[2], streak: m[3] }
    else if ((m = L.match(/^7 天内额度到期\\/重置：(.+?)。?$/))) soon = m[1]
  }
  if (!head) { out.innerHTML = '<pre style="white-space:pre-wrap;font-size:12.5px;line-height:1.7;margin:0">' + esc(text) + '</pre>'; return }
  var h = ''
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap">'
  h += '<div style="flex:1;min-width:150px;background:#f6f4ff;border:1px solid #e4defc;border-radius:12px;padding:12px 14px"><div style="font-size:12px;color:#7a7590">货币额度剩余合计</div><div style="font-size:26px;font-weight:700;color:#4c1d95;margin-top:2px">¥' + esc(head.total) + '</div></div>'
  h += '<div style="flex:1;min-width:150px;background:#f8f8fa;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px"><div style="font-size:12px;color:#8a8f98">账户</div><div style="font-size:26px;font-weight:700;margin-top:2px">' + esc(head.n) + ' <span style="font-size:13px;font-weight:400;color:#8a8f98">个 · ' + esc(head.k) + ' 个已配 Key</span></div></div>'
  h += '</div>'
  if (accounts.length) {
    h += '<div style="font-size:12.5px;font-weight:600;color:#55565e;margin:14px 0 4px">各账户剩余额度</div>'
    for (var j = 0; j < accounts.length; j++) {
      var a = accounts[j], rem = num(a.rem), tot = num(a.tot), pct = tot > 0 ? (rem / tot * 100) : 0, danger = rem < 10
      h += '<div style="padding:8px 2px;border-bottom:1px solid #f0f0f3">'
      h += '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><span style="font-size:13.5px;font-weight:600">' + esc(a.label) + ' <span style="font-weight:400;color:#9a9ea8;font-size:12px">' + esc(a.platform) + '</span></span><span style="font-size:13px;color:' + (danger ? '#dc2626' : '#333') + ';font-weight:' + (danger ? '700' : '400') + '">剩 ¥' + esc(a.rem) + ' <span style="color:#9a9ea8;font-size:12px">/ 共 ¥' + esc(a.tot) + '</span></span></div>'
      h += bar(pct, danger ? '#dc2626' : '#6d28d9')
      if (a.reset) h += '<div style="font-size:11.5px;color:#9a9ea8;margin-top:4px">额度重置/到期 ' + esc(a.reset) + '</div>'
      h += '</div>'
    }
  }
  if (low) h += '<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:10px;padding:9px 12px;font-size:12.5px;margin-top:12px">⚠ 低余额账户：' + esc(low) + '</div>'
  if (spend) {
    h += '<div style="background:#f8f8fa;border:1px solid #e5e7eb;border-radius:12px;padding:11px 14px;margin-top:12px;font-size:13px">'
    if (spend.none) h += '<span style="color:#8a8f98">本月暂无消费记录</span>'
    else h += '本月消费 <b>¥' + esc(spend.cost) + '</b> <span style="color:#8a8f98">（' + esc(spend.count) + ' 笔）</span><div style="font-size:12px;color:#8a8f98;margin-top:3px">花费最高：' + esc(spend.top) + '</div>'
    if (models) h += '<div style="font-size:12px;color:#8a8f98;margin-top:3px">最常用模型：' + esc(models) + '</div>'
    h += '</div>'
  }
  if (budget) {
    var bc = budget.pct >= 100 ? '#dc2626' : budget.pct >= 80 ? '#d97706' : '#6d28d9'
    h += '<div style="margin-top:12px;font-size:13px"><div style="display:flex;justify-content:space-between"><span>本月预算 ¥' + esc(budget.total) + '</span><span style="color:' + bc + ';font-weight:600">已用 ' + budget.pct + '%</span></div>' + bar(budget.pct, bc) + '</div>'
  }
  if (checkin) {
    if (checkin.done) h += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:10px;padding:9px 12px;font-size:12.5px;margin-top:12px">✓ 今日签到已全部完成 · 已连续签到 ' + esc(checkin.streak) + ' 天</div>'
    else h += '<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:9px 12px;font-size:12.5px;margin-top:12px">今日待签到 ' + esc(checkin.pending) + ' 个：' + esc(checkin.names) + ' · 已连续签到 ' + esc(checkin.streak) + ' 天</div>'
  }
  if (soon) h += '<div style="font-size:12px;color:#8a8f98;margin-top:10px">7 天内到期/重置：' + esc(soon) + '</div>'
  out.innerHTML = h
}
document.getElementById('dg-go').addEventListener('click', async () => {
  out.innerHTML = '<div style="color:#8a8f98;font-size:13px;padding:8px 0">加载中…</div>'
  try {
    render(await acm.digest())
    atEl.textContent = '更新于 ' + new Date().toLocaleTimeString()
  } catch (e) { out.textContent = '读取失败：' + (e && e.message ? e.message : e) }
})
`,
  },
]
