import { useEffect, useRef, useState } from 'react'
import {
  Puzzle, Plus, Upload, Link2, Sparkles, Pencil, Play, Square, RefreshCw, X, Server, Wrench, ChevronDown, ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { t } from '../core/i18n'
import {
  loadPlugins, installPlugin, uninstallPlugin, setPluginEnabled, validatePluginPackage, pluginAccessExpansion,
  isDesktopShell, pluginProcessStart, pluginProcessStop, pluginProcessRunning, pluginProcessOutput,
  pluginHttpDesktop, pluginSettingsValues, savePluginSettings, PLUGINS_EVENT, EXAMPLE_PLUGINS,
  type InstalledPlugin, type PluginPackage, type PluginSettingField,
} from '../core/plugins'
import { mountPanelFrame } from '../core/pluginRuntime'
import {
  loadMcpServers, upsertMcpServer, removeMcpServer, newMcpServerId, getMcpConnection,
  connectMcpServer, disconnectMcpServer, callMcpTool, mcpServerLogs, MCP_EVENT, MCP_PRESETS,
  type McpServerConfig, type McpTool,
} from '../core/mcp'
import { isNativeApp } from '../core/openExternal'
import { HoldToConfirm } from './HoldToConfirm'

/** 与 App 内 Toggle 同款果冻开关（样式类全局共享） */
function JellyToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const [anim, setAnim] = useState<'on' | 'off' | null>(null)
  const prev = useRef(checked)
  useEffect(() => {
    if (prev.current !== checked) {
      setAnim(checked ? 'on' : 'off')
      prev.current = checked
      const timer = window.setTimeout(() => setAnim(null), 360)
      return () => window.clearTimeout(timer)
    }
  }, [checked])
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`jelly-toggle ${checked ? 'is-on' : ''}`} aria-label={checked ? t('关闭') : t('开启')}>
      <span className={`jelly-dot ${anim ? `anim-${anim}` : (checked ? 'static-on' : 'static-off')}`} />
    </button>
  )
}

const PERM_LABEL: Record<string, string> = { network: '网络', data: '读取数据', notify: '通知', storage: '私有存储', openUrl: '打开外链' }
const PROVIDE_LABEL: Record<string, string> = { panel: '面板', adapter: '余额适配器', process: '进程' }

interface Draft {
  editingId: string | null
  id: string; name: string; version: string; author: string; description: string
  provides: string[]; permissions: string[]; hosts: string; providers: string
  processCommand: string; processArgs: string; html: string; code: string
  settingsJson: string
}

const NEW_PLUGIN_CODE = `// 插件代码运行在沙箱中，可用全局对象 acm：
// acm.notify(msg) / acm.storage.get(k) / acm.storage.set(k, v)
// acm.http(url, { method, headers, body }) -> { status, text }（仅限清单 hosts 域名）
// acm.digest() -> 我的数据脱敏摘要（需 data 权限）
// acm.registerBalanceAdapter(providerId, async (ctx) => {...}) 注册余额适配器
document.body.insertAdjacentHTML('beforeend', '<div style="padding:10px;font-size:14px">你好，这是我的第一个插件面板</div>')
`

function draftFromPlugin(p: InstalledPlugin): Draft {
  return {
    editingId: p.manifest.id,
    id: p.manifest.id, name: p.manifest.name, version: p.manifest.version,
    author: p.manifest.author ?? '', description: p.manifest.description ?? '',
    provides: [...p.manifest.provides], permissions: [...p.manifest.permissions],
    hosts: (p.manifest.hosts ?? []).join(', '), providers: (p.manifest.providers ?? []).join(', '),
    processCommand: p.manifest.process?.command ?? '', processArgs: (p.manifest.process?.args ?? []).join(' '),
    html: p.html ?? '', code: p.code,
    settingsJson: p.manifest.settings ? JSON.stringify(p.manifest.settings, null, 2) : '',
  }
}

function emptyDraft(): Draft {
  return {
    editingId: null,
    id: `my-plugin-${Math.random().toString(36).slice(2, 7)}`, name: '', version: '1.0.0',
    author: '', description: '', provides: ['panel'], permissions: ['notify', 'storage'],
    hosts: '', providers: '', processCommand: '', processArgs: '', html: '', code: NEW_PLUGIN_CODE,
    settingsJson: '',
  }
}

async function fetchTextAny(url: string): Promise<string> {
  if (isDesktopShell()) {
    const r = await pluginHttpDesktop(url, 'GET', {})
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
    return r.text
  }
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method: 'GET', responseType: 'text' })
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

const LIST_PAGE_SIZE = 6
function ListPager({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (n: number) => void }) {
  if (pageCount <= 1) return null
  return (
    <div className="fm-pager">
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <span>第 {page} / {pageCount} 页 · 共 {total} 个</span>
      <button className="btn sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  )
}
function loadFoldAll(key: string): boolean { try { return localStorage.getItem(key) === '1' } catch { return false } }
function saveFoldAll(key: string, v: boolean) { try { localStorage.setItem(key, v ? '1' : '0') } catch { /* 忽略 */ } }

export function PluginsView({ notify }: { notify: (msg: string) => void }) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>(() => loadPlugins())
  const [openPanelId, setOpenPanelId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftErr, setDraftErr] = useState('')
  const [pendingInstall, setPendingInstall] = useState<PluginPackage | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<InstalledPlugin | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelBoxRef = useRef<HTMLDivElement>(null)
  const desktop = isDesktopShell()
  // 横向标题页签（v0.1.402，同看剧 394 样式），切换状态记本机
  type PluginTab = 'plugins' | 'mcp'
  const [activeTab, setActiveTab] = useState<PluginTab>(() => {
    try { return localStorage.getItem('acm.plugins.tab') === 'mcp' ? 'mcp' : 'plugins' } catch { return 'plugins' }
  })
  const switchTab = (tab: PluginTab) => {
    setActiveTab(tab)
    try { localStorage.setItem('acm.plugins.tab', tab) } catch { /* ignore */ }
  }
  // MCP 服务器数量（页签计数用，与 McpSection 共用 MCP_EVENT）
  const [mcpCount, setMcpCount] = useState(() => loadMcpServers().length)
  useEffect(() => {
    const onMcp = () => setMcpCount(loadMcpServers().length)
    window.addEventListener(MCP_EVENT, onMcp)
    return () => window.removeEventListener(MCP_EVENT, onMcp)
  }, [])
  // 分区分页与「全部折叠」（v0.1.332 Ethan 要求：不要每卡一个折叠图标，一个按钮管全区；两区都分页）
  const [pluginsFolded, setPluginsFolded] = useState(() => loadFoldAll('acm.plugins.foldAll'))
  const [pluginPage, setPluginPage] = useState(1)
  const pluginPageCount = Math.max(1, Math.ceil(plugins.length / LIST_PAGE_SIZE))
  const safePluginPage = Math.min(pluginPage, pluginPageCount)
  const pagedPlugins = plugins.slice((safePluginPage - 1) * LIST_PAGE_SIZE, safePluginPage * LIST_PAGE_SIZE)

  useEffect(() => {
    const on = () => setPlugins(loadPlugins())
    window.addEventListener(PLUGINS_EVENT, on)
    return () => window.removeEventListener(PLUGINS_EVENT, on)
  }, [])

  const openPlugin = openPanelId ? plugins.find(p => p.manifest.id === openPanelId) : undefined
  useEffect(() => {
    if (!openPlugin || !panelBoxRef.current) return
    const box = panelBoxRef.current
    box.innerHTML = ''
    const destroy = mountPanelFrame(box, openPlugin)
    return () => { destroy(); box.innerHTML = '' }
  }, [openPlugin])

  const onFile = async (f: File) => {
    try {
      const pkg = JSON.parse(await f.text()) as PluginPackage
      const err = validatePluginPackage(pkg)
      if (err) { notify(t(err)); return }
      setPendingInstall(pkg)
    } catch { notify(t('插件包不是有效的 JSON 文件')) }
  }

  const onUrlInstall = async () => {
    const url = urlInput.trim()
    if (!url) return
    setUrlBusy(true)
    try {
      const pkg = JSON.parse(await fetchTextAny(url)) as PluginPackage
      const err = validatePluginPackage(pkg)
      if (err) { notify(t(err)); return }
      setPendingInstall(pkg)
    } catch (e) {
      notify(e instanceof Error ? e.message : t('从 URL 安装失败'))
    } finally { setUrlBusy(false) }
  }

  const saveDraft = () => {
    if (!draft) return
    const split = (s: string) => s.split(/[,\s]+/).map(x => x.trim()).filter(Boolean)
    let settings: PluginSettingField[] | undefined
    if (draft.settingsJson.trim()) {
      try { settings = JSON.parse(draft.settingsJson) as PluginSettingField[] } catch { setDraftErr('设置项 JSON 格式不对'); return }
    }
    const pkg: PluginPackage = {
      manifest: {
        id: draft.id.trim(), name: draft.name.trim(), version: draft.version.trim() || '1.0.0',
        author: draft.author.trim() || undefined, description: draft.description.trim() || undefined,
        provides: draft.provides as PluginPackage['manifest']['provides'],
        permissions: draft.permissions as PluginPackage['manifest']['permissions'],
        hosts: split(draft.hosts).length ? split(draft.hosts) : undefined,
        providers: split(draft.providers).length ? split(draft.providers) : undefined,
        process: draft.provides.includes('process') ? { command: draft.processCommand.trim(), args: split(draft.processArgs) } : undefined,
        settings,
      },
      code: draft.code,
      html: draft.html.trim() ? draft.html : undefined,
    }
    const err = validatePluginPackage(pkg)
    if (err) { setDraftErr(err); return }
    const existing = plugins.find(p => p.manifest.id === pkg.manifest.id)
    installPlugin(pkg, existing ? existing.source : 'editor')
    setDraft(null)
    notify(t('插件已保存：{name}', { name: pkg.manifest.name }))
  }

  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  return (
    <div className="plugins-view">
      {/* 横向标题页签（v0.1.402，同看剧 394：标题栏吸顶、数量标在标题上、手机端自动换行） */}
      <div className="wt-tabs" role="tablist">
        <button role="tab" aria-selected={activeTab === 'plugins'} className={`wt-tab${activeTab === 'plugins' ? ' on' : ''}`} onClick={() => switchTab('plugins')}>{t('第三方插件')}<span className="wt-tab-count">{plugins.length} 个</span></button>
        <button role="tab" aria-selected={activeTab === 'mcp'} className={`wt-tab${activeTab === 'mcp' ? ' on' : ''}`} onClick={() => switchTab('mcp')}>{t('MCP 服务器')}<span className="wt-tab-count">{mcpCount} 个</span></button>
      </div>

      {activeTab === 'plugins' && <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="wt-tab-sub" style={{ margin: 0 }}>{t('第三方插件仅保存在本设备，不云同步')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> {t('从文件安装')}</button>
          <button className="btn sm" onClick={() => { setDraftErr(''); setDraft(emptyDraft()) }}><Plus size={14} /> {t('新建插件')}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f) }} />
        </div>
      </div>

      <div className="plugin-note">
        <ShieldCheck size={15} style={{ flex: 'none', marginTop: 1 }} />
        <span>{t('插件在沙箱中运行，碰不到保险箱与你的密钥；网络请求只能发往插件清单声明的域名。余额适配器由宿主在解锁后传入单个账户的 Key 查询官方接口。进程插件仅桌面端可运行。')}</span>
      </div>

      <div className="plugin-url-row">
        <Link2 size={15} style={{ color: 'var(--text-3)', flex: 'none' }} />
        <input className="input" style={{ flex: 1 }} placeholder={t('粘贴插件包 JSON 的 URL，直接引用安装')}
          value={urlInput} onChange={e => setUrlInput(e.target.value)} />
        <button className="btn sm" disabled={urlBusy || !urlInput.trim()} onClick={() => void onUrlInstall()}>{urlBusy ? t('加载中…') : t('从 URL 安装')}</button>
      </div>

      <div className="plugin-examples">
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Sparkles size={14} /> {t('示例插件')}</span>
        {EXAMPLE_PLUGINS.map(pkg => {
          const installed = plugins.some(p => p.manifest.id === pkg.manifest.id)
          return (
            <button key={pkg.manifest.id} className="btn sm ghost" disabled={installed}
              onClick={() => {
                installPlugin(pkg, 'builtin')
                if (pkg.manifest.id === 'acm-template-adapter') setPluginEnabled(pkg.manifest.id, false)
                notify(t('示例插件已装入：{name}', { name: pkg.manifest.name }))
              }}>{installed ? t('已装入') : t('装入')} · {t(pkg.manifest.name)}</button>
          )
        })}
      </div>

      {plugins.length === 0 && <div className="plugin-empty">{t('还没有安装任何插件。可以从文件、URL 安装，或先装入示例插件体验。')}</div>}

      {plugins.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button className="btn sm ghost" onClick={() => { const v = !pluginsFolded; setPluginsFolded(v); saveFoldAll('acm.plugins.foldAll', v) }}>
            {pluginsFolded ? t('全部展开') : t('全部折叠')} <ChevronDown size={13} style={{ transform: pluginsFolded ? 'rotate(-90deg)' : undefined, transition: 'transform .2s' }} />
          </button>
        </div>
      )}
      <div className="plugin-list">
        {pagedPlugins.map(p => (
          <PluginCard key={p.manifest.id} plugin={p} notify={notify} desktop={desktop} folded={pluginsFolded}
            panelOpen={openPanelId === p.manifest.id}
            onTogglePanel={() => setOpenPanelId(openPanelId === p.manifest.id ? null : p.manifest.id)}
            onOpenSettings={() => setSettingsTarget(p)}
            onEdit={() => { setDraftErr(''); setDraft(draftFromPlugin(p)) }} />
        ))}
      </div>
      <ListPager page={safePluginPage} pageCount={pluginPageCount} total={plugins.length} onPage={setPluginPage} />

      {openPlugin && openPlugin.manifest.provides.includes('panel') && (
        <div className="plugin-panel-wrap">
          <div className="plugin-panel-head">
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{openPlugin.manifest.name}</span>
            <button className="icon-btn" onClick={() => setOpenPanelId(null)}><X size={15} /></button>
          </div>
          <div ref={panelBoxRef} className="plugin-panel-box" />
        </div>
      )}
      </>}

      {activeTab === 'mcp' && <McpSection notify={notify} desktop={desktop} />}

      {settingsTarget && (
        <PluginSettingsModal plugin={settingsTarget} notify={notify} onClose={() => setSettingsTarget(null)} />
      )}

      {pendingInstall && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setPendingInstall(null) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head"><h3 style={{ margin: 0 }}>{plugins.some(p => p.manifest.id === pendingInstall.manifest.id) ? t('确认更新插件') : t('确认安装插件')}</h3><button className="icon-btn" onClick={() => setPendingInstall(null)}><X size={18} /></button></div>
            <div className="modal-body">
              <div style={{ fontWeight: 600 }}>{pendingInstall.manifest.name} <span style={{ color: 'var(--text-3)', fontWeight: 400, fontSize: 12 }}>v{pendingInstall.manifest.version}{pendingInstall.manifest.author ? ` · ${pendingInstall.manifest.author}` : ''}</span></div>
              {pendingInstall.manifest.description && <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{pendingInstall.manifest.description}</p>}
              <div className="plugin-chips">
                {pendingInstall.manifest.provides.map(v => <span key={v} className="plugin-chip">{t(PROVIDE_LABEL[v])}</span>)}
                {pendingInstall.manifest.permissions.map(v => <span key={v} className="plugin-chip warn">{t('权限')} · {t(PERM_LABEL[v])}</span>)}
                {(pendingInstall.manifest.hosts ?? []).map(h => <span key={h} className="plugin-chip">{h}</span>)}
              </div>
              {pendingInstall.manifest.provides.includes('adapter') && (
                <p style={{ fontSize: 12.5, color: 'var(--red)', lineHeight: 1.6 }}>
                  {t('注意：这是余额适配器插件。启用后，App 会在保险箱解锁时把下列平台账户的明文 API Key 交给它查询余额（包括自动巡检）：{providers}', { providers: (pendingInstall.manifest.providers ?? []).join('、') || '—' })}
                </p>
              )}
              {pendingInstall.manifest.process && (
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                  {t('启动命令')}：<code>{pendingInstall.manifest.process.command} {(pendingInstall.manifest.process.args ?? []).join(' ')}</code>
                </p>
              )}
              {(() => {
                const old = plugins.find(p => p.manifest.id === pendingInstall.manifest.id)
                if (!old) return null
                const ex = pluginAccessExpansion(old.manifest, pendingInstall.manifest)
                if (!ex.permissions.length && !ex.hosts.length && !ex.providers.length && !ex.processAdded) return null
                return <p style={{ fontSize: 12.5, color: 'var(--red)', lineHeight: 1.6 }}>{t('本次更新扩大了访问范围（新增权限、域名或适配平台），安装后将默认停用，请核对后在列表里手动启用。')}</p>
              })()}
              <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6 }}>{t('请只安装来源可信的插件。插件代码会在沙箱中运行，但其声明域名内的数据请求由你授权。')}</p>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPendingInstall(null)}>{t('取消')}</button>
              <button className="btn primary" onClick={() => {
                installPlugin(pendingInstall, 'file')
                notify(t('插件已安装：{name}', { name: pendingInstall.manifest.name }))
                setPendingInstall(null)
              }}>{t('确认安装')}</button>
            </div>
          </div>
        </div>
      )}

      {draft && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDraft(null) }}>
          <div className="modal plugin-editor">
            <div className="modal-head"><h3 style={{ margin: 0 }}>{draft.editingId ? t('编辑插件') : t('新建插件')}</h3><button className="icon-btn" onClick={() => setDraft(null)}><X size={18} /></button></div>
            <div className="modal-body">
              <div className="plugin-form-grid">
                <label>{t('插件 ID')}<input className="input" value={draft.id} disabled={!!draft.editingId} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
                <label>{t('名称')}<input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
                <label>{t('版本')}<input className="input" value={draft.version} onChange={e => setDraft({ ...draft, version: e.target.value })} /></label>
                <label>{t('作者')}<input className="input" value={draft.author} onChange={e => setDraft({ ...draft, author: e.target.value })} /></label>
              </div>
              <label className="plugin-form-row">{t('简介')}<input className="input" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
              <div className="plugin-form-row">
                <span>{t('能力')}</span>
                <div className="row" style={{ gap: 12 }}>
                  {Object.keys(PROVIDE_LABEL).map(v => (
                    <label key={v} className="plugin-check"><input type="checkbox" checked={draft.provides.includes(v)} onChange={() => setDraft({ ...draft, provides: toggleIn(draft.provides, v) })} /> {t(PROVIDE_LABEL[v])}</label>
                  ))}
                </div>
              </div>
              <div className="plugin-form-row">
                <span>{t('权限')}</span>
                <div className="row" style={{ gap: 12 }}>
                  {Object.keys(PERM_LABEL).map(v => (
                    <label key={v} className="plugin-check"><input type="checkbox" checked={draft.permissions.includes(v)} onChange={() => setDraft({ ...draft, permissions: toggleIn(draft.permissions, v) })} /> {t(PERM_LABEL[v])}</label>
                  ))}
                </div>
              </div>
              <label className="plugin-form-row">{t('允许访问的域名（逗号分隔）')}<input className="input" value={draft.hosts} placeholder="api.example.com" onChange={e => setDraft({ ...draft, hosts: e.target.value })} /></label>
              {draft.provides.includes('adapter') && (
                <label className="plugin-form-row">{t('适配的平台 ID（逗号分隔）')}<input className="input" value={draft.providers} placeholder="groq, openai" onChange={e => setDraft({ ...draft, providers: e.target.value })} /></label>
              )}
              {draft.provides.includes('process') && (
                <div className="plugin-form-grid">
                  <label>{t('启动命令')}<input className="input" value={draft.processCommand} placeholder="node" onChange={e => setDraft({ ...draft, processCommand: e.target.value })} /></label>
                  <label>{t('参数（空格分隔）')}<input className="input" value={draft.processArgs} placeholder="server.js --port 3000" onChange={e => setDraft({ ...draft, processArgs: e.target.value })} /></label>
                </div>
              )}
              <label className="plugin-form-row">{t('设置项定义（JSON，可选）')}<textarea className="input plugin-code" rows={4} value={draft.settingsJson} placeholder={'[\n  { "key": "base", "label": "基准货币", "type": "select", "options": ["USD", "CNY"], "default": "USD" }\n]'} onChange={e => setDraft({ ...draft, settingsJson: e.target.value })} /></label>
              <label className="plugin-form-row">{t('面板 HTML（可选）')}<textarea className="input plugin-code" rows={4} value={draft.html} onChange={e => setDraft({ ...draft, html: e.target.value })} /></label>
              <label className="plugin-form-row">{t('插件代码（JavaScript）')}<textarea className="input plugin-code" rows={12} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} /></label>
              {draftErr && <div style={{ color: 'var(--red)', fontSize: 13 }}>{t(draftErr)}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>{t('取消')}</button>
              <button className="btn primary" onClick={saveDraft}>{t('保存插件')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PluginCard({ plugin, notify, desktop, panelOpen, onTogglePanel, onOpenSettings, onEdit, folded }: {
  plugin: InstalledPlugin
  notify: (msg: string) => void
  desktop: boolean
  panelOpen: boolean
  onTogglePanel: () => void
  onOpenSettings: () => void
  onEdit: () => void
  /** 分区「全部折叠」时为真：卡片只剩标题一行 */
  folded?: boolean
}) {
  const m = plugin.manifest
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const isProcess = m.provides.includes('process') && !!m.process

  useEffect(() => {
    if (isProcess && desktop) void pluginProcessRunning(m.id).then(setRunning)
  }, [isProcess, desktop, m.id])

  const refreshOutput = async () => setOutput(await pluginProcessOutput(m.id))

  return (
    <div className={`plugin-card ${plugin.enabled ? '' : 'disabled'}`}>
      <div className="plugin-card-head">
        <span className="plugin-logo"><Puzzle size={17} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="plugin-name">{m.name} <span>v{m.version}</span></div>
          <div className="plugin-sub">{m.author ?? ''}{m.author ? ' · ' : ''}{plugin.source === 'builtin' ? t('示例') : plugin.source === 'file' ? t('文件/URL 安装') : t('自建')}</div>
        </div>
        <JellyToggle checked={plugin.enabled} onChange={v => setPluginEnabled(m.id, v)} />
      </div>
      {!folded && (<>
      {m.description && <p className="plugin-desc">{m.description}</p>}
      <div className="plugin-chips">
        {m.provides.map(v => <span key={v} className="plugin-chip">{t(PROVIDE_LABEL[v])}</span>)}
        {m.permissions.map(v => <span key={v} className="plugin-chip warn">{t(PERM_LABEL[v])}</span>)}
        {(m.hosts ?? []).map(h => <span key={h} className="plugin-chip">{h}</span>)}
        {(m.providers ?? []).map(pv => <span key={pv} className="plugin-chip">{pv}</span>)}
      </div>
      {isProcess && (
        <div className="plugin-proc">
          {!desktop && <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{t('进程插件仅在桌面端可运行')}</span>}
          {desktop && <>
            <code className="plugin-cmd">{m.process!.command} {(m.process!.args ?? []).join(' ')}</code>
            <div className="row" style={{ gap: 6 }}>
              {!running
                ? <button className="btn sm" disabled={busy || !plugin.enabled} onClick={async () => {
                    setBusy(true)
                    try { await pluginProcessStart(plugin); setRunning(true); notify(t('插件进程已启动')) } catch (e) { notify(e instanceof Error ? e.message : t('启动失败')) }
                    finally { setBusy(false) }
                  }}><Play size={13} /> {t('启动')}</button>
                : <button className="btn sm" disabled={busy} onClick={async () => {
                    setBusy(true)
                    try { await pluginProcessStop(m.id); setRunning(false); notify(t('插件进程已停止')) } catch (e) { notify(e instanceof Error ? e.message : t('停止失败')) }
                    finally { setBusy(false) }
                  }}><Square size={13} /> {t('停止')}</button>}
              <button className="btn sm ghost" onClick={() => void refreshOutput()}><RefreshCw size={13} /> {t('查看输出')}</button>
              <span style={{ fontSize: 12, color: running ? 'var(--green, #16a34a)' : 'var(--text-3)' }}>{running ? t('运行中') : t('未运行')}</span>
            </div>
            {output && <pre className="plugin-output">{output}</pre>}
          </>}
        </div>
      )}
      <div className="plugin-card-actions">
        {m.provides.includes('panel') && <button className="btn sm" disabled={!plugin.enabled} onClick={onTogglePanel}>{panelOpen ? t('收起面板') : t('打开面板')}</button>}
        {(m.settings?.length ?? 0) > 0 && <button className="btn sm ghost" onClick={onOpenSettings}><SlidersHorizontal size={13} /> {t('设置')}</button>}
        <button className="btn sm ghost" onClick={onEdit}><Pencil size={13} /> {t('编辑')}</button>
        <HoldToConfirm title={t('卸载插件')} size={30} onConfirm={() => { uninstallPlugin(m.id); notify(t('插件已卸载：{name}', { name: m.name })) }} />
      </div>
      </>)}
    </div>
  )
}

/** 插件独立设置页：按清单声明的设置项渲染表单，值存插件私有存储，插件经 acm.getSettings() 读取 */
function PluginSettingsModal({ plugin, notify, onClose }: {
  plugin: InstalledPlugin
  notify: (msg: string) => void
  onClose: () => void
}) {
  const fields = plugin.manifest.settings ?? []
  const [values, setValues] = useState<Record<string, unknown>>(() => pluginSettingsValues(plugin))
  const set = (k: string, v: unknown) => setValues(prev => ({ ...prev, [k]: v }))

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>{t('插件设置')} · {plugin.manifest.name}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {fields.map(f => (
            <div key={f.key} className="plugin-form-row" style={{ marginBottom: 14 }}>
              {f.type === 'switch' ? (
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{t(f.label)}</span>
                  <JellyToggle checked={!!values[f.key]} onChange={v => set(f.key, v)} />
                </div>
              ) : (
                <>
                  <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{t(f.label)}</span>
                  {f.type === 'select' ? (
                    <select className="select" value={String(values[f.key] ?? '')} onChange={e => set(f.key, e.target.value)}>
                      {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea className="input" rows={4} value={String(values[f.key] ?? '')} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)} />
                  ) : f.type === 'number' ? (
                    <input className="input" type="number" value={values[f.key] === undefined ? '' : String(values[f.key])} placeholder={f.placeholder}
                      onChange={e => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))} />
                  ) : (
                    <input className="input" type={f.type === 'password' ? 'password' : 'text'} value={String(values[f.key] ?? '')} placeholder={f.placeholder}
                      onChange={e => set(f.key, e.target.value)} />
                  )}
                </>
              )}
              {f.help && <small style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{t(f.help)}</small>}
            </div>
          ))}
          {fields.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{t('该插件没有声明设置项')}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" onClick={() => {
            savePluginSettings(plugin.manifest.id, values)
            notify(t('设置已保存'))
            onClose()
          }}>{t('保存')}</button>
        </div>
      </div>
    </div>
  )
}

// ---------------- MCP 服务器 ----------------

function McpSection({ notify, desktop }: { notify: (msg: string) => void; desktop: boolean }) {
  const [servers, setServers] = useState<McpServerConfig[]>(() => loadMcpServers())
  const [, setTick] = useState(0)
  const [form, setForm] = useState<{ editId?: string; name: string; transport: 'stdio' | 'http'; command: string; args: string; url: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [mcpFolded, setMcpFolded] = useState(() => loadFoldAll('acm.mcp.foldAll'))
  const [mcpPage, setMcpPage] = useState(1)
  const mcpPageCount = Math.max(1, Math.ceil(servers.length / LIST_PAGE_SIZE))
  const safeMcpPage = Math.min(mcpPage, mcpPageCount)
  const pagedServers = servers.slice((safeMcpPage - 1) * LIST_PAGE_SIZE, safeMcpPage * LIST_PAGE_SIZE)

  useEffect(() => {
    const on = () => { setServers(loadMcpServers()); setTick(x => x + 1) }
    window.addEventListener(MCP_EVENT, on)
    return () => window.removeEventListener(MCP_EVENT, on)
  }, [])

  const saveForm = () => {
    if (!form) return
    if (!form.name.trim()) { notify(t('请填写服务器名称')); return }
    if (form.transport === 'stdio' && !form.command.trim()) { notify(t('请填写启动命令')); return }
    if (form.transport === 'http' && !/^https?:\/\//i.test(form.url.trim())) { notify(t('请填写有效的服务器 URL')); return }
    const id = form.editId ?? newMcpServerId()
    if (form.editId) void disconnectMcpServer(id)
    upsertMcpServer({
      id, name: form.name.trim(), transport: form.transport,
      command: form.transport === 'stdio' ? form.command.trim() : undefined,
      args: form.transport === 'stdio' ? form.args.split(/\s+/).map(x => x.trim()).filter(Boolean) : undefined,
      url: form.transport === 'http' ? form.url.trim() : undefined,
    })
    setForm(null)
    notify(form.editId ? t('MCP 服务器已更新') : t('MCP 服务器已添加'))
  }

  return (
    <div className="mcp-section">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="wt-tab-sub" style={{ margin: 0 }}>{t('接入 MCP 生态的第三方工具服务：本地命令（桌面端）或远程 HTTP，连接后可直接调用它的工具')}</div>
        <button className="btn sm" onClick={() => setForm({ name: '', transport: desktop ? 'stdio' : 'http', command: '', args: '', url: '' })}><Plus size={14} /> {t('添加服务器')}</button>
      </div>

      <div className="plugin-examples">
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{t('常用预设')}</span>
        {MCP_PRESETS.map(p => (
          <button key={p.id} className="btn sm ghost" title={p.note}
            onClick={() => setForm({
              name: p.name, transport: p.transport,
              command: p.command ?? '', args: (p.args ?? []).join(' '), url: p.url ?? '',
            })}>{p.name}</button>
        ))}
      </div>

      {form && (
        <div className="plugin-mcp-form">
          <div className="plugin-form-grid">
            <label>{t('名称')}<input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label>{t('连接方式')}
              <select className="select" value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })}>
                <option value="stdio">{t('本地命令（stdio）')}</option>
                <option value="http">{t('远程 HTTP')}</option>
              </select>
            </label>
          </div>
          {form.transport === 'stdio' && (desktop ? (
            <div className="plugin-form-grid">
              <label>{t('启动命令')}<input className="input" value={form.command} placeholder="npx / uvx / node" onChange={e => setForm({ ...form, command: e.target.value })} /></label>
              <label>{t('参数（空格分隔）')}<input className="input" value={form.args} onChange={e => setForm({ ...form, args: e.target.value })} /></label>
            </div>
          ) : <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{t('本地命令型 MCP 只能在桌面端添加和运行，当前设备请使用远程 HTTP 类型')}</div>)}
          {form.transport === 'http' && (
            <label className="plugin-form-row">{t('服务器 URL')}<input className="input" value={form.url} placeholder="https://example.com/mcp" onChange={e => setForm({ ...form, url: e.target.value })} /></label>
          )}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn sm" onClick={() => setForm(null)}>{t('取消')}</button>
            <button className="btn sm primary" onClick={saveForm}>{form.editId ? t('保存') : t('添加')}</button>
          </div>
        </div>
      )}

      {servers.length === 0 && !form && <div className="plugin-empty">{t('还没有 MCP 服务器。点「添加服务器」或用上方预设接入第三方工具。')}</div>}

      {servers.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button className="btn sm ghost" onClick={() => { const v = !mcpFolded; setMcpFolded(v); saveFoldAll('acm.mcp.foldAll', v) }}>
            {mcpFolded ? t('全部展开') : t('全部折叠')} <ChevronDown size={13} style={{ transform: mcpFolded ? 'rotate(-90deg)' : undefined, transition: 'transform .2s' }} />
          </button>
        </div>
      )}
      <div className="plugin-list">
        {pagedServers.map(s => (
          <McpServerCard key={s.id} server={s} notify={notify} folded={mcpFolded}
            expanded={expanded === s.id} onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
            onEdit={() => setForm({ editId: s.id, name: s.name, transport: s.transport, command: s.command ?? '', args: (s.args ?? []).join(' '), url: s.url ?? '' })} />
        ))}
      </div>
      <ListPager page={safeMcpPage} pageCount={mcpPageCount} total={servers.length} onPage={setMcpPage} />
    </div>
  )
}

function McpServerCard({ server, notify, expanded, onToggle, onEdit, folded }: {
  server: McpServerConfig
  notify: (msg: string) => void
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  /** 分区「全部折叠」时为真：卡片只剩标题一行 */
  folded?: boolean
}) {
  const conn = getMcpConnection(server.id)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState('')

  return (
    <div className="plugin-card">
      <div className="plugin-card-head">
        <span className="plugin-logo"><Server size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="plugin-name">{server.name}</div>
          <div className="plugin-sub">
            {server.transport === 'stdio' ? `${server.command ?? ''} ${(server.args ?? []).join(' ').replaceAll('@HOME@', '主目录')}` : server.url}
            {conn.serverInfo ? ` · ${conn.serverInfo}` : ''}
          </div>
        </div>
        <span className={`mcp-status ${conn.status}`}>
          {conn.status === 'ready' ? t('已连接') : conn.status === 'connecting' ? t('连接中…') : conn.status === 'error' ? t('连接失败') : t('未连接')}
        </span>
      </div>
      {!folded && conn.status === 'error' && conn.error && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{conn.error}</div>}
      {!folded && (<>
      <div className="plugin-card-actions">
        {conn.status !== 'ready'
          ? <button className="btn sm" disabled={busy || conn.status === 'connecting'} onClick={async () => {
              setBusy(true)
              await connectMcpServer(server)
              setBusy(false)
            }}><Play size={13} /> {t('连接')}</button>
          : <button className="btn sm" disabled={busy} onClick={async () => {
              setBusy(true)
              await disconnectMcpServer(server.id)
              setBusy(false)
            }}><Square size={13} /> {t('断开')}</button>}
        {conn.status === 'ready' && (
          <button className="btn sm ghost" onClick={onToggle}>
            <Wrench size={13} /> {t('工具（{n}）', { n: conn.tools.length })} <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
          </button>
        )}
        <button className="btn sm ghost" onClick={onEdit}><Pencil size={13} /> {t('编辑')}</button>
        {server.transport === 'stdio' && (
          <button className="btn sm ghost" onClick={async () => setLogs(await mcpServerLogs(server.id))}>{t('日志')}</button>
        )}
        <HoldToConfirm title={t('删除服务器')} size={30} onConfirm={() => { removeMcpServer(server.id); notify(t('MCP 服务器已删除')) }} />
      </div>
      {logs && <pre className="plugin-output">{logs}</pre>}
      {expanded && conn.status === 'ready' && (
        <div className="mcp-tools">
          {conn.tools.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{t('该服务器没有提供工具')}</div>}
          {conn.tools.map(tool => <McpToolRow key={tool.name} serverId={server.id} tool={tool} notify={notify} />)}
        </div>
      )}
      </>)}
    </div>
  )
}

function McpToolRow({ serverId, tool, notify }: { serverId: string; tool: McpTool; notify: (msg: string) => void }) {
  const [argsText, setArgsText] = useState(() => {
    const props = (tool.inputSchema?.properties ?? {}) as Record<string, { type?: string }>
    const obj: Record<string, unknown> = {}
    for (const k of Object.keys(props)) obj[k] = props[k].type === 'number' || props[k].type === 'integer' ? 0 : props[k].type === 'boolean' ? false : ''
    return JSON.stringify(obj, null, 2)
  })
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className="mcp-tool">
      <div className="mcp-tool-head">
        <code>{tool.name}</code>
        <button className="btn sm" disabled={busy} onClick={async () => {
          let args: Record<string, unknown>
          try { args = JSON.parse(argsText || '{}') as Record<string, unknown> } catch { notify(t('参数不是有效的 JSON')); return }
          setBusy(true)
          try {
            const r = await callMcpTool(serverId, tool.name, args)
            setResult(r.text)
            if (r.isError) notify(t('工具返回了错误结果'))
          } catch (e) { notify(e instanceof Error ? e.message : t('调用失败')) }
          finally { setBusy(false) }
        }}>{busy ? t('调用中…') : t('调用')}</button>
      </div>
      {tool.description && <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>{tool.description}</div>}
      <textarea className="input plugin-code" rows={3} value={argsText} onChange={e => setArgsText(e.target.value)} aria-label={t('参数（JSON）')} />
      {result && <pre className="plugin-output">{result}</pre>}
    </div>
  )
}
