import { useCallback, useEffect, useMemo, useRef, useState, memo, lazy, Suspense, Fragment } from 'react'
import { SESSIONS_EVENT, TOGGLE_HISTORY_EVENT, loadSessionList, loadArchivedList, setSessionArchived, clearSessionsData, requestOpenSession, requestNewSession, updateSessionTitle, deleteStoredSession } from './core/chatSessions'
import { saveArchivedSessionToFolder } from './core/archiveExport'
import { loadStoragePrefs, saveStoragePrefs, storageDir, type StoragePrefs } from './core/storagePrefs'
import { loadPatrolHours, savePatrolHours, patrolDue, refreshAllBalances, PATROL_AT_KEY, PATROL_HOUR_OPTIONS } from './core/balancePatrol'
import { loadToolCallingEnabled, saveToolCallingEnabled } from './core/toolChat'
import { loadViewerPrefs, saveViewerPrefs, listMediaApps, type ViewerPrefs, type MediaAppInfo } from './core/viewerPrefs'
import { writeApiKeyStorageFile } from './core/apiKeyStorage'
import { t, useLang, setLang, getLang, locale, type Lang } from './core/i18n'
import { getKeyPageUrl, refreshKeyUrls, KEYURLS_EVENT, VOICE_KEY_PROVIDER } from './core/keyUrls'
import {
  LayoutDashboard, CalendarCheck2, CalendarDays, KeyRound, BarChart3, Plus, ShieldCheck,
  ExternalLink, Trash2, RefreshCw, AlertTriangle, Info, Check,
  Wallet, Clock, TrendingUp, Lock, Unlock, Download, X, Copy, CircleHelp,
  Code2, Sparkles, Search, Image, Mic, PenTool, Settings, Eye, EyeOff, Pencil, Fingerprint,
  Film, Layers, Monitor, Network, PanelLeftClose, PanelLeftOpen,
  Cloud, Database, Volume2, HardDrive, Palette, RotateCcw, Menu, Globe, HeartPulse, Loader2,
  Bell, CloudOff, Activity, ClipboardList, Upload, ClipboardPaste, Wrench, History, ChevronDown, ChevronRight, ChevronUp,
  Archive, ArchiveRestore, Puzzle, Folder,
  ArrowLeft,
} from 'lucide-react'
import type { AppState, AccountView, ProviderDefinition, CreditUnit, AccountMode, QuotaSnapshot, AppSettings } from './core/types'
import { isLocalProvider, mergeToolbarOrder } from './core/types'
import { detectLocalServices, getSystemMemoryGb, checkLocalService, startLocalService, stopLocalService, stopServiceByPort, isServiceAppManaged, fetchLocalModels, chooseModelFile, comfyScanDesktopEnabled, setComfyScanDesktop, comfyLaunchDesktopEnabled, setComfyLaunchDesktop, type LocalService } from './core/localServices'
import { buildReminders, filterUnsent, markSent, notifyPrefsOf } from './core/reminders'
import { getNotificationPermission, requestNotificationPermission, showNotification, scheduleDailyCheckin, cancelDailyCheckin, type NotificationPermissionState } from './core/notifications'
import { syncVoiceAccounts, setVoiceSessionPwd } from './core/voiceKey'
import { saveTtsConfig } from './core/voice-download'
import { detectModelCapability, shouldHideFromChat, isMotionModule } from './core/modelCapability'
import { VOICE_PROVIDERS } from './core/voiceProviders'
import {
  LOCAL_SERVICE_KEYS, LOCAL_SERVICE_CHANGED_EVENT, memoryToTier, tierAdvice, maxServicesForTier,
  isServiceEnabled, planServiceToggle, notifyLocalServiceChanged, initServicesForTier,
} from './core/localServicesSettings'
import type { LocalServiceKey, MemoryTier } from './core/types'
import { PROVIDERS, PROVIDER_MAP, CATEGORY_LABEL, CATEGORY_ORDER } from './data/providers'
import {
  loadState, saveStateDebounced, flushState, uid, updateAccount, removeAccount, upsertQuota, latestQuota, toggleCheckin,
  importState, mergeState, addUsageEvent, updateSettings, clearAllData,
} from './core/store'
import { HoldToConfirm } from './components/HoldToConfirm'
import {
  AGENT_TOOLS, CHECKIN_TOOLS, CATEGORY_TAGS, PLATFORM_TAGS,
  type AgentTool,
} from './data/agentTools'
import { currentCatalog, fetchCatalog, getUnseenTools, markCatalogSeen } from './core/agentCatalog'
import { checkPriceUpdates, loadPriceAlerts, savePriceAlerts, lastPriceCheckAt, type PriceChange } from './core/priceWatch'
import { detectSpendAnomalies } from './core/anomaly'
import { buildMonthlyReport, prevMonthKey } from './core/monthlyReport'
import { detectProviderFromKey, extractKey } from './core/keyDetect'
import { rankProvidersByValue, rankModelsByValue } from './core/valueRank'
import { summarizeSubscriptions } from './core/subscriptions'
import { scoreAccounts } from './core/healthScore'
import { summarizeByProject, projectSuggestions } from './core/projectStats'
import { forecastMonthSpend } from './core/spendForecast'
import { buildGatewayRoutes, gatewaySetRoutes, gatewayStart, gatewayStop, gatewayStatus, genGatewayToken, type GatewayStatusInfo } from './core/gateway'
import { bindVaultPasswordNative, resolveBiometricVaultPassword, unbindVaultPasswordNative } from './core/biometric'
import { copyKeyWithAutoClear } from './core/clipboard'
import { buildBackup, parseBackup, type ParseBackupResult } from './core/backup'
import { saveExportFile } from './core/saveFile'
import { syncWidgetData } from './core/widgetData'
import { buildEnvExport, buildJsonExport, type ToolExportItem } from './core/toolExport'
import { totalPortfolioValue, monthlySpendByPlatform, DEFAULT_UNIT_PRICES, OFFICIAL_PRICES_AS_OF, officialUnitPrice, priceDrifted } from './core/value'
import { predictExhaustion, forecastText } from './core/forecast'
import { todayISO } from './core/store'
import {
  isVaultInitialized, initVault, verifyVault, encryptSecret, decryptSecret, fingerprint, resetVault,
  changeMasterPassword, saveBiometricPassword, getBiometricPassword, clearBiometricPassword,
} from './core/crypto'
import { formatUsageBalance, errorText } from './core/adapters'
import { PLUGINS_EVENT } from './core/plugins'
import { getAdapterWithPlugins, setPluginHostHandlers } from './core/pluginRuntime'
import { parseUsageCsv, type UsageEventInput } from './core/csv'
import {
  type ExportFormat, type ServiceEntry, exportByFormat, detectCsvKind, isJsonImport,
  parseAccountsCsv, parseQuotasCsv, isServiceList, parseServiceList, noteCategory,
} from './core/io'
import { openExternal, openTool, isDesktopApp, isNativeApp, isAppInstalled, biometricAvailable, biometricAuth, biometricLabel } from './core/openExternal'
import { cloud, type CloudUser } from './core/cloud'
import { mirrorCloudSession, clearCloudSessionMirror, restoreCloudSessionMirror, restoreCloudSessionMirrorForce } from './core/sessionMirror'
import { UpdateModal } from './components/UpdateModal'
import { APP_VERSION, currentPlatform } from './core/updater'
import { NOTE_CATEGORIES, buildNote, categoryFromNote, type NoteCategory } from './core/modelCategories'
import { pullPayload, pushPayload, applyPayload, getLastSyncAt, getClientId, checkRemoteVersion, setBaseline, getRemoteVersion, type PullResult } from './core/sync'
import { loadWebdavConfig, saveWebdavConfig, loadIcloudSyncConfig, saveIcloudSyncConfig, webdavIO, icloudIO, syncChannel, loadAltStatus, webdavTest, type ChannelIO } from './core/altSync'
import { loadCloudBackupPrefs, saveCloudBackupPrefs, cloudBackupDue, cloudBackupLastAt, createCloudSnapshot, listCloudSnapshots, deleteCloudSnapshot, getCloudSnapshot, saveBackupToIcloudDrive, type CloudBackupPrefs, type SnapshotMeta } from './core/cloudSnapshots'
import { autoCheckinTick, resolveAutoCheckinPassword } from './core/checkinRun'
import { freeGamesCheckDue, runFreeGamesCheck, summarizeCheckResult } from './core/freeGames'
import { useServiceController, type ServiceController } from './core/useServiceController'
import { ServiceSwitch } from './components/ServiceSwitch'
import { applyUiTheme, UI_THEMES } from './uiThemes'
import { CloudLoginModal } from './components/CloudLogin'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
// 性能优化：标签页级代码分割 —— 重型视图按需加载，减小首屏解析与内存占用（本地资源加载近乎瞬时）
const ChatTranslateView = lazy(() => import('./components/ChatTranslateView').then(m => ({ default: m.ChatTranslateView })))
const LocalImageView = lazy(() => import('./components/LocalImageView').then(m => ({ default: m.LocalImageView })))
const LocalVideoView = lazy(() => import('./components/LocalVideoView').then(m => ({ default: m.LocalVideoView })))
const WorkshopView = lazy(() => import('./components/WorkshopView').then(m => ({ default: m.WorkshopView })))
const AIView = lazy(() => import('./components/AIView').then(m => ({ default: m.AIView })))
const VoiceSettings = lazy(() => import('./components/VoiceSettings').then(m => ({ default: m.VoiceSettings })))
const CalendarView = lazy(() => import('./components/CalendarView').then(m => ({ default: m.CalendarView })))
const ReportView = lazy(() => import('./components/ReportView').then(m => ({ default: m.ReportView })))
const PluginsView = lazy(() => import('./components/PluginsView').then(m => ({ default: m.PluginsView })))
import { appendAudit, makeAuditEntry } from './core/auditLog'
import { loadDevices, touchCurrentDevice, type DeviceRecord } from './core/accountDevices'
import { checkKeyHealth, loadKeyHealth, saveKeyHealth, HEALTH_LABEL, type KeyHealthResult } from './core/healthCheck'
import {
  buildKeyBackup, backupToCloud, backupToLocalFile, backupToNotes, chooseBackupFolder, importKeyBackup, parseKeyBackup, isReadableFormat,
  type KeyBackupMode, type KeyBackupFormat, type KeyBackupFile, type BackupFileFormat,
} from './core/keyBackup'

/** CSV 导入预览：解析后的数据按类型区分 */
type CsvImportPreview =
  | { kind: 'accounts'; accounts: ReturnType<typeof parseAccountsCsv> }
  | { kind: 'quotas'; quotas: ReturnType<typeof parseQuotasCsv> }
  | { kind: 'usage'; events: UsageEventInput[] }

type Tab = 'ai' | 'dashboard' | 'checkin' | 'chat-translate' | 'local-image' | 'local-video' | 'keys' | 'usage' | 'calendar' | 'report' | 'voice' | 'settings' | 'plugins' | 'workshop'

const UNIT_LABEL: Record<CreditUnit, string> = {
  credit: '积分', token: 'Tokens', request: '次', currency: '元', day: '天',
}

const MODE_LABEL: Record<AccountMode, string> = {
  api: '官方 API', manual: '手动录入', subscription: '订阅制',
}

const CATEGORY_ICON: Record<ProviderDefinition['category'], typeof Code2> = {
  llm: Sparkles, code: Code2, image: Image, video: Film, voice: Mic,
  search: Search, design: PenTool, embedding: Layers, local: HardDrive, 'voice-config': Volume2, other: CircleHelp,
}

/** 左侧边栏「历史会话」区：挂在 AI 助手导航项下方，默认隐藏，点「展示更多」展开（新→旧排序）。
 *  数据来自 AI 助手的会话存储（localStorage），点击某条整页打开该会话并可继续聊。 */
function SidebarHistory({ open, onToggle, onNavigate }: { open: boolean; onToggle: () => void; onNavigate: () => void }) {
  const [list, setList] = useState(loadSessionList)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  // 左滑删除（手机端）：swipe=已滑开的会话 id；drag=拖动中的实时位移
  const [swipe, setSwipe] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null)
  const touchRef = useRef<{ id: string; startX: number; base: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef<string | null>(null)
  const swipeOffset = (id: string) => (drag?.id === id ? drag.dx : swipe === id ? -64 : 0)
  const onSwipeStart = (e: React.TouchEvent, id: string) => {
    if (swipe && swipe !== id) setSwipe(null)
    touchRef.current = { id, startX: e.touches[0].clientX, base: swipe === id ? -64 : 0, moved: false }
  }
  const onSwipeMove = (e: React.TouchEvent, id: string) => {
    const t = touchRef.current
    if (!t || t.id !== id) return
    const delta = e.touches[0].clientX - t.startX
    if (Math.abs(delta) > 6) t.moved = true
    setDrag({ id, dx: Math.max(-64, Math.min(0, t.base + delta)) })
  }
  const onSwipeEnd = (id: string) => {
    const t = touchRef.current
    touchRef.current = null
    if (!t) return
    const cur = drag?.id === id ? drag.dx : t.base
    setDrag(null)
    setSwipe(cur < -32 ? id : null)
    if (t.moved) suppressClickRef.current = id
  }
  const [archivedList, setArchivedList] = useState(loadArchivedList)
  const [archOpen, setArchOpen] = useState(false)
  useEffect(() => {
    const refresh = () => { setList(loadSessionList()); setArchivedList(loadArchivedList()) }
    window.addEventListener(SESSIONS_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(SESSIONS_EVENT, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  useEffect(() => { if (open) { setList(loadSessionList()); setArchivedList(loadArchivedList()) } }, [open ])
  // 只剩一个空会话时视为「暂无历史」：删掉最后一个空会话后存储会自动补一个空会话占位，列表里不再假装它还在
  const visibleSessions = list.sessions.filter(s => !(list.sessions.length === 1 && s.count === 0))
  // 历史会话分页：每页 5 条，避免长列表全量堆在小滚动框里
  const HIST_PAGE_SIZE = 5
  const [histPage, setHistPage] = useState(1)
  const histPages = Math.max(1, Math.ceil(visibleSessions.length / HIST_PAGE_SIZE))
  const histCur = Math.min(histPage, histPages)
  const pageSessions = visibleSessions.slice((histCur - 1) * HIST_PAGE_SIZE, histCur * HIST_PAGE_SIZE)
  const fmtTime = (ts: number) => {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return (
    <div className="side-history">
      <button className="side-history-head" onClick={onToggle} title={t('AI 助手的历史会话')}>
        <History size={13} />
        <span>{t('历史会话')}</span>
        <span className="side-history-more">{open ? t('收起') : t('展示更多')}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="side-history-list">
          <button className="side-history-new" onClick={() => { onNavigate(); requestNewSession() }}>
            <Plus size={13} /> {t('新建会话')}
          </button>
          {visibleSessions.length === 0 && <div className="side-history-empty">{t('暂无历史会话')}</div>}
          {pageSessions.map(s => (
            <div key={s.id} className="side-history-swipe">
              <button className="side-history-del" tabIndex={swipe === s.id ? 0 : -1} onClick={() => { setSwipe(null); deleteStoredSession(s.id) }}>{t('删除')}</button>
              <div className={`side-history-item ${s.id === list.activeId ? 'active' : ''} ${drag?.id === s.id ? 'dragging' : ''}`}
                style={{ transform: `translateX(${swipeOffset(s.id)}px)` }}
                onTouchStart={e => onSwipeStart(e, s.id)} onTouchMove={e => onSwipeMove(e, s.id)} onTouchEnd={() => onSwipeEnd(s.id)} onTouchCancel={() => onSwipeEnd(s.id)}>
                {renaming === s.id ? (
                  <input className="input side-history-rename" autoFocus value={renameText} onChange={e => setRenameText(e.target.value)}
                    onBlur={() => { if (renameText.trim()) updateSessionTitle(s.id, renameText.trim()); setRenaming(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }} />
                ) : (
                  <button className="side-history-main" title={s.title} onClick={() => {
                    if (suppressClickRef.current === s.id) { suppressClickRef.current = null; return }
                    if (swipe === s.id) { setSwipe(null); return }
                    onNavigate(); requestOpenSession(s.id)
                  }}>
                    <b>{s.title}</b>
                    <span>{t('{count} 条 · {time}', { count: s.count, time: fmtTime(s.updatedAt) })}</span>
                  </button>
                )}
                <button className="icon-btn side-history-act" title={t('重命名')} onClick={() => { setRenaming(s.id); setRenameText(s.title) }}><Pencil size={12} /></button>
                <button className="icon-btn side-history-act" title={t('归档')} onClick={() => { setSessionArchived(s.id, true); void saveArchivedSessionToFolder(s.id) }}><Archive size={12} /></button>
                <button className="icon-btn side-history-act" title={t('删除会话')} onClick={() => deleteStoredSession(s.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {histPages > 1 && (
            <div className="side-history-pager">
              <button disabled={histCur <= 1} onClick={() => setHistPage(histCur - 1)}>{t('上一页')}</button>
              <span>{t('第 {cur}/{pages} 页 · 共 {total} 条', { cur: histCur, pages: histPages, total: visibleSessions.length })}</span>
              <button disabled={histCur >= histPages} onClick={() => setHistPage(histCur + 1)}>{t('下一页')}</button>
            </div>
          )}
          {archivedList.length > 0 && (
            <>
              <button className="side-history-arch-head" onClick={() => setArchOpen(o => !o)} title={t('已归档的会话')}>
                <Archive size={12} />
                <span>{t('已归档')}</span>
                <span className="side-history-arch-count">{archivedList.length}</span>
                {archOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {archOpen && archivedList.map(s => (
                <div key={s.id} className="side-history-item archived">
                  <button className="side-history-main" title={t('{title}（点击恢复并打开）', { title: s.title })} onClick={() => { setSessionArchived(s.id, false); onNavigate(); requestOpenSession(s.id) }}>
                    <b>{s.title}</b>
                    <span>{t('{count} 条 · {time}', { count: s.count, time: fmtTime(s.updatedAt) })}</span>
                  </button>
                  <button className="icon-btn side-history-act" title={t('恢复')} onClick={() => setSessionArchived(s.id, false)}><ArchiveRestore size={12} /></button>
                  <button className="icon-btn side-history-act" title={t('删除会话')} onClick={() => deleteStoredSession(s.id)}><Trash2 size={12} /></button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState())

  // 界面语言：settings.language 为准（仅本机，不云同步、不进备份），驱动 i18n 当前语言；useLang 让全树随切换重渲染
  useLang()
  useEffect(() => {
    const want = (state.settings.language as Lang | undefined) ?? 'zh-CN'
    if (want !== getLang()) setLang(want)
  }, [state.settings.language])

  // 启动时拉取最新官方 Key 页地址表（平台改版地址后无需发版即可生效；失败则用内置地址）
  useEffect(() => { void refreshKeyUrls() }, [])

  // 本机物理内存 GB（供内存档位判断与服务联动开关共用）
  const [memGb, setMemGb] = useState(0)
  // 首次启动：按本机内存档位初始化本地服务开关（8G 只开 1 个），仅执行一次
  useEffect(() => {
    let alive = true
    void getSystemMemoryGb().then(gb => {
      if (!alive) return
      setMemGb(gb)
      if (state.settings.localServicesInitialized) {
        // v0.1.400 迁移：老用户 settings 里没有 qwentts 键，默认关（避免重服务默认启用）
        if (state.settings.localServices && !('qwentts' in state.settings.localServices)) {
          setState(prev => ({ ...prev, settings: { ...prev.settings, localServices: { ...prev.settings.localServices, qwentts: false } } }))
        }
        return
      }
      const tier = memoryToTier(gb)
      setState(s => s.settings.localServicesInitialized ? s : ({
        ...s,
        settings: {
          ...s.settings,
          localServices: initServicesForTier(tier),
          localServicesInitialized: true,
        },
      }))
    })
    return () => { alive = false }
  }, [])
  // 同步账户到语音模块（供语音 Key 读取，账户变化时自动失效缓存）
  useEffect(() => { syncVoiceAccounts(state.accounts) }, [state.accounts])
  // 全端默认进入 AI 助手页（v0.1.333 Ethan 定案；此前桌面端默认额度看板）；手机端侧栏抽屉默认隐藏
  // 预览参数仅用于浏览器验收手机端界面，生产环境不会带此参数
  const phonePreview = typeof location !== 'undefined' && (new URLSearchParams(location.search).get('preview') === 'phone' || location.hash.includes('preview=phone'))
  const isPhone = isNativeApp() || phonePreview
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get('tab')
    // 手机客户端已移除文档问答与本地生成：即使外部带参指向这些页也回落到默认页
    if (t && ['ai', 'dashboard', 'checkin', 'chat-translate', 'local-image', 'local-video', 'keys', 'usage', 'calendar', 'report', 'voice', 'settings', 'workshop'].includes(t)
      && !(isPhone && (t === 'docs' || t === 'local-image' || t === 'local-video'))) return t as Tab
    return 'ai'
  })
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(() => {
    if (phonePreview) return location.hash.includes('drawer') || new URLSearchParams(location.search).get('drawer') === '1'
    if (isPhone) return false
    try { return localStorage.getItem('acm.sidebar.visible') !== '0' } catch { return true }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toggleSidebar = () => setSidebarVisible(v => !v)
  // 侧边栏导航分组折叠（v0.1.260）：点分组标题收起该组入口，状态记忆；图标条模式下不生效（图标始终全显）
  const [closedNavGroups, setClosedNavGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('acm.nav.closedGroups') || '[]') } catch { return [] }
  })
  const toggleNavGroup = (label: string) => setClosedNavGroups(prev => {
    const next = prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
    try { localStorage.setItem('acm.nav.closedGroups', JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })
  // AI 助手历史会话区（侧边栏 AI 助手下方）：顶栏「会话列表」按钮经事件切换展开/收起
  const [historyOpen, setHistoryOpen] = useState(false)
  useEffect(() => {
    const onToggle = () => { setSidebarVisible(true); setHistoryOpen(v => !v) }
    window.addEventListener(TOGGLE_HISTORY_EVENT, onToggle)
    return () => window.removeEventListener(TOGGLE_HISTORY_EVENT, onToggle)
  }, [])
  // 统一导航：Claude 风格下"设置"走居中弹窗，其余模块正常切 tab
  const openTab = (id: Tab) => {
    // 手机客户端已移除文档问答与本地生成：任何残留入口跳到这些页时回落到 AI 页
    if (isPhone && (id === 'local-image' || id === 'local-video')) id = 'ai'
    if (id === 'settings') { setSettingsOpen(true); if (isPhone) setSidebarVisible(false); return }
    setTab(id)
    if (isPhone) setSidebarVisible(false)
    window.scrollTo(0, 0)
  }
  // v0.1.331：工坊工具直达信号（看板瓷砖等外部入口 → 打开工坊并直达工具页）
  const [wsSignal, setWsSignal] = useState<{ tool: string; n: number } | null>(null)
  const [checkinNonce, setCheckinNonce] = useState(0)
  const openWorkshopTool = (tool: string) => { setWsSignal({ tool, n: Date.now() }); openTab('workshop') }
  useEffect(() => {
    try { localStorage.setItem('acm.sidebar.visible', sidebarVisible ? '1' : '0') } catch { /* 忽略 */ }
  }, [sidebarVisible])
  const [onboardingOff, setOnboardingOff] = useState(() => {
    try { return localStorage.getItem('acm.onboarding.dismissed') === '1' } catch { return false }
  })
  const [catalogNews, setCatalogNews] = useState<AgentTool[]>([])
  // 启动时拉取工具目录，发现用户没见过的新工具则提醒（导航红点 + 目录页横幅）
  useEffect(() => {
    let alive = true
    void fetchCatalog(false).then(r => {
      if (alive && r.ok && r.snapshot) setCatalogNews(getUnseenTools(r.snapshot.tools))
    })
    return () => { alive = false }
  }, [])
  const ackCatalogNews = useCallback(() => {
    markCatalogSeen(currentCatalog().tools)
    setCatalogNews([])
  }, [])
  const [addOpen, setAddOpen] = useState(false)
  // 智能粘贴：粘贴 Key 识别平台后，带着 Key 直接打开对应平台的添加账户表单
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteSecret, setPasteSecret] = useState('')
  const [formProviderId, setFormProviderId] = useState<string | null>(null)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [quotaTarget, setQuotaTarget] = useState<string | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [importData, setImportData] = useState<AppState | null>(null)
  const [csvPreview, setCsvPreview] = useState<CsvImportPreview | null>(null)
  const [servicePreview, setServicePreview] = useState<ServiceEntry[] | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [backupGate, setBackupGate] = useState<{
    ids: string[]
    title: string
    confirmLabel: string
    backupOnly: boolean
    after: () => void
  } | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)
  const [backupDue, setBackupDue] = useState(false)
  const [bioAvailableGlobal, setBioAvailableGlobal] = useState(false)
  const [bioLabel, setBioLabel] = useState('生物识别')
  /**
   * 当前会话已验证的主密码。作用域仅限「API Key 管理页 + 安全设置」这一范畴：
   * 添加账户加密、修改主密码回填等。AI 助手等其余模块不读此值（各自独立解密），
   * 因此 Key 管理页的解锁状态不会影响其他功能。指纹/人脸模式则用 biometric 凭据。
   */
  const [sessionPwd, setSessionPwd] = useState('')
  /** 从设置页指纹/人脸解锁后，带入 Key 管理页的初始解锁密码（仅作用于 Key 页） */
  const [keyPageInitialPwd, setKeyPageInitialPwd] = useState('')
  useEffect(() => {
    void biometricAvailable().then(setBioAvailableGlobal)
    void biometricLabel().then(setBioLabel)
    touchCurrentDevice()
  }, [])

  useEffect(() => { saveStateDebounced(state) }, [state])
  // 数据存储：API Key 清单文件自动保持最新（v0.1.298）。账户增删改后防抖重写；
  // 清单是密文，不需要会话密码（v0.1.300 起固定密文 JSON）
  const apikeySyncHashRef = useRef('')
  useEffect(() => {
    if (!isDesktopApp()) return
    const prefs = loadStoragePrefs()
    if (!storageDir('apikey', prefs)) return
    const hash = JSON.stringify(state.accounts.map(a => [a.id, a.updatedAt, a.encryptedKey, a.label]))
    if (apikeySyncHashRef.current === hash) return
    const timer = window.setTimeout(() => {
      void writeApiKeyStorageFile(state, prefs).then(r => {
        if (r.ok) apikeySyncHashRef.current = hash
      })
    }, 1500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accounts, sessionPwd])
  // 页面隐藏/关闭前立即落盘，避免 250ms 防抖窗口内丢失最后一笔
  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') flushState() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('beforeunload', flushState)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('beforeunload', flushState)
      flushState()
    }
  }, [])

  // 切换模块后重置滚动到顶部，避免从长页面切到短页面时停留在半空造成"一高一低"
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      document.querySelector('.content')?.scrollTo?.(0, 0)
    })
    return () => window.cancelAnimationFrame(id)
  }, [tab])

  // 用 ref 跟踪最新 state，供稳定回调（定时通知等）读取，避免闭包陈旧
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const toastTimer = useRef<number | null>(null)
  const notify = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind })
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  // 插件系统：给运行时注入宿主回调（通知 + 最新状态源）；插件增删/启停时刷新全树，
  // 让 Key 管理里「查询/刷新余额」按钮随插件适配器的启用状态即时出现/消失
  const [, setPluginTick] = useState(0)
  useEffect(() => {
    setPluginHostHandlers({ notify, getState: () => stateRef.current })
    const on = () => setPluginTick(x => x + 1)
    window.addEventListener(PLUGINS_EVENT, on)
    return () => window.removeEventListener(PLUGINS_EVENT, on)
  }, [notify])

  // 本地服务联动控制器：设置页 / AI翻译 / AI图像 / AI视频 共用的服务开关状态源。
  // 所有开关读写同一份 settings.localServices，任一处切换后各处同步显示。
  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setState(s => updateSettings(s, patch))
  }, [])
  const appMemTier: MemoryTier = state.settings.memoryTierOverride ?? memoryToTier(memGb)
  const serviceController = useServiceController(state.settings, patchSettings, appMemTier, notify)

  /** 统一备份门禁：任何删除/备份操作都先走同一个弹窗，备份完成后才执行后续动作 */
  const requestBackup = useCallback((ids: string[], title: string, confirmLabel: string, after: () => void, backupOnly = false) => {
    if (!ids.length) { notify('没有选中的数据'); return }
    setBackupGate({ ids, title, confirmLabel, backupOnly, after })
  }, [notify])

  // ===== 删除撤回：保存删除前的完整快照，5 秒内可恢复 =====
  const [undo, setUndo] = useState<{ snapshot: AppState; label: string } | null>(null)
  const undoTimer = useRef<number | null>(null)
  const scheduleUndo = useCallback((snapshot: AppState, label: string) => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setUndo({ snapshot, label })
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000)
  }, [])
  const doUndo = useCallback(() => {
    if (!undo) return
    setState(undo.snapshot)
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    setUndo(null)
    notify('已撤回，数据已恢复')
  }, [undo, notify])

  /** 设置页快捷解锁：生物验证通过后（原生端密码在系统钥匙串、桌面端系统验证），把凭据带入 Key 管理页自动解锁 */
  const handleBioUnlock = useCallback(async () => {
    const pwd = await resolveBiometricVaultPassword(t('验证身份以解锁 API Key 管理'))
    if (!pwd) { notify(t('{bio}验证未通过，或未配置解锁凭据（请先在「解锁方式」中开启）', { bio: t(bioLabel) })); return }
    if (!(await verifyVault(pwd))) { notify('解锁凭据已失效，请重新开启'); return }
    setKeyPageInitialPwd('')
    window.setTimeout(() => setKeyPageInitialPwd(pwd), 0)
    setTab('keys')
    notify(t('已通过{bio}验证，正在解锁 API Key 管理页', { bio: t(bioLabel) }))
  }, [notify, bioLabel])

  // ============ 云同步 ============
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [, setSyncTick] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => getLastSyncAt())
  const cloudUserRef = useRef<CloudUser | null>(null)
  const localDirtyRef = useRef(false)   // 本机有尚未推送成功的修改
  const pushTimer = useRef<number | null>(null)
  const syncReady = useRef(false)
  const syncingRef = useRef(false)      // 同步互斥：拉取/推送不可同时进行
  const skipPushOnce = useRef(false)
  const lastPullAt = useRef(0)          // 最近一次拉取时间，避免拉取触发的 state 变化又被推回去
  const myClientId = useRef(getClientId())

  /** 把云端数据应用到本地（仅在确认是其他端更新时调用） */
  const applyRemote = useCallback((payload: NonNullable<PullResult['payload']>, version: string | null) => {
    lastPullAt.current = Date.now()
    skipPushOnce.current = true
    setBaseline(version)
    setState(s => applyPayload(payload, s))
    setLastSyncAt(getLastSyncAt())
    setSyncError(null)
    localDirtyRef.current = false
  }, [])

  // ---- 云端快照恢复（v0.1.330）：把快照内容作为新的当前状态，并推回云端成为同步基准 ----
  const restoreCloudSnapshot = useCallback(async (snap: { state: AppState; vault: import('./core/crypto').VaultSyncMaterial }): Promise<boolean> => {
    const payload = { appState: snap.state, vault: snap.vault, clientAt: new Date().toISOString(), clientId: getClientId() }
    applyRemote(payload, null)
    const r = await pushPayload(snap.state, undefined, { includeLocal: !!snap.state.settings.syncLocalProviders })
    return r.ok
  }, [applyRemote])

  // 统一的登录后初始化：拉取云端；云端为空则把本地作为初始快照上传；完成后才允许自动推送。
  const bootstrapCloud = useCallback(async (user: CloudUser, announce = true) => {
    cloudUserRef.current = user
    setCloudUser(user)
    syncReady.current = false
    syncingRef.current = true
    setSyncing(true)
    try {
      const result = await pullPayload()
      if (!result.ok) {
        setSyncError(result.error ?? '云端连接失败')
        if (announce) notify(t('云端连接失败：{err}', { err: result.error ?? '' }))
      } else if (result.payload) {
        applyRemote(result.payload, result.remoteVersion)
        if (announce) notify('已从云端同步最新数据')
      } else {
        const pushed = await pushPayload(stateRef.current, undefined, { includeLocal: !!stateRef.current.settings.syncLocalProviders })
        if (pushed.ok) {
          setSyncError(null)
          setLastSyncAt(getLastSyncAt())
          if (announce) notify('本地数据已上传云端，其他端登录即可同步')
        } else setSyncError(pushed.error ?? '上传失败')
      }
    } finally {
      syncReady.current = true
      syncingRef.current = false
      setSyncing(false)
    }
  }, [notify, applyRemote])

  // OAuth 回调必须在守卫之前处理；普通访问恢复会话后同样走 bootstrap。
  useEffect(() => {
    ;(async () => {
      try {
        const url = new URL(location.href)
        const provider = url.searchParams.get('provider')
        if (url.searchParams.has('code') && (provider === 'wechat' || provider === 'workbuddy')) {
          const handle = provider === 'wechat' ? cloud.auth.handleWechatWebCallback : cloud.auth.handleWorkBuddyCallback
          const { data: session, error } = await handle.call(cloud.auth)
          if (error) { notify(t('登录失败：{err}', { err: error.message })); return }
          if (session) {
            for (const k of ['code', 'state', 'provider']) url.searchParams.delete(k)
            history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
            await bootstrapCloud(session.user)
            return
          }
        }
        // localStorage 里会话键丢失时（手机 WebView 存储被清理等），先从耐久镜像还原再取会话
        await restoreCloudSessionMirror()
        let { data: session } = await cloud.auth.getSession()
        if (!session) {
          // 会话键还在但句柄已失效（续期轮换后写回失败/存储被回滚）时上面救不回来：
          // 把耐久镜像整份写回再重试一次，镜像存的是最近一次成功续期后的状态
          if (await restoreCloudSessionMirrorForce()) {
            const retry = await cloud.auth.getSession()
            session = retry.data
          }
        }
        if (session) { void mirrorCloudSession(); await bootstrapCloud(session.user, false) }
      } catch { /* 未登录或网络异常时保持本地模式 */ }
    })()
  }, [notify, bootstrapCloud])

  // 会话镜像维护：登录与每次续期后刷新镜像；被动失效（句柄过期等）不动镜像，
  // 下次启动可先还原镜像再续期；仅用户显式退出时清镜像（见 handleCloudLogout）
  useEffect(() => {
    try {
      const unsub = cloud.auth.onAuthStateChange((event, session) => {
        if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
          void mirrorCloudSession()
          window.setTimeout(() => { void mirrorCloudSession() }, 1200)
        }
      })
      return () => { try { unsub() } catch { /* ignore */ } }
    } catch { /* SDK 不支持订阅时忽略 */ }
  }, [])

  // 切后台/关页前再镜像一次会话：手机进程随时可能被系统回收，先把最新句柄存进耐久存储
  useEffect(() => {
    const save = () => { void mirrorCloudSession() }
    const onVis = () => { if (document.visibilityState === 'hidden') save() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', save)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', save) }
  }, [])

  // 数据变更时防抖推送（仅初始化完成后，且没有其他同步在进行）
  useEffect(() => {
    if (!cloudUser || !syncReady.current) return
    if (skipPushOnce.current) { skipPushOnce.current = false; return }
    localDirtyRef.current = true   // 有本地修改待推送
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(async () => {
      if (syncingRef.current) return
      if (Date.now() - lastPullAt.current < 1500) return  // 刚拉取过，丢弃这次由拉取引发的回环推送
      syncingRef.current = true
      try {
        const r = await pushPayload(stateRef.current, undefined, { includeLocal: !!stateRef.current.settings.syncLocalProviders })
        if (r.ok) { setLastSyncAt(getLastSyncAt()); setSyncError(null); localDirtyRef.current = false }
        else setSyncError(r.error ?? '推送失败')
      } finally { syncingRef.current = false }
    }, 1200)
    return () => { if (pushTimer.current !== null) window.clearTimeout(pushTimer.current) }
  }, [state, cloudUser])

  /** 检查云端是否有其他端的更新：版本变化且不是自己推的，则拉取并刷新 */
  const checkRemote = useCallback(async (silent = true) => {
    if (!cloudUserRef.current || !syncReady.current || syncingRef.current) return
    // 先占互斥锁再发请求，避免 interval 与 visibilitychange 并发触发重复拉取
    syncingRef.current = true
    try {
      const known = getRemoteVersion()
      const check = await checkRemoteVersion()
      if (!check.ok || !check.version) return
      if (known && check.version === known) return   // 无变化
      const result = await pullPayload()
      if (!result.ok) return
      // 是自己刚推的（比如推送延迟导致基线未更新），只更新基线不覆盖本地
      if (result.payload?.clientId === myClientId.current) {
        setBaseline(result.remoteVersion)
        return
      }
      if (result.payload) {
        // 同步策略（用户 2026-11-20 选定）：静默覆盖、新盖旧——云端是其他端的更新就直接应用，
        // 本机未推送的修改随之被覆盖，不再弹冲突提醒。applyRemote 会清掉待推送标记，不会把旧数据推回去。
        applyRemote(result.payload, result.remoteVersion)
        if (!silent) notify('已从云端同步其他端的最新数据')
      } else setBaseline(result.remoteVersion)
    } finally { syncingRef.current = false }
  }, [applyRemote, notify])

  // 轮询 + 切回前台立即检查：后台/锁屏时暂停轮询，省电省流量
  useEffect(() => {
    if (!cloudUser) return
    let timer: number | null = null
    const start = () => {
      if (timer !== null) return
      void checkRemote()  // 切回前台立即检查一次
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void checkRemote()
      }, 8000)
    }
    const stop = () => {
      if (timer !== null) { window.clearInterval(timer); timer = null }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') start(); else stop() }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [cloudUser, checkRemote])

  // 手动「立即同步」：重新拉取云端覆盖本地
  const pullCloud = useCallback(async () => {
    if (!cloudUserRef.current) return
    setSyncing(true)
    syncingRef.current = true
    try {
      const result = await pullPayload()
      if (!result.ok) { setSyncError(result.error ?? '拉取失败'); notify(t('拉取失败：{err}', { err: result.error ?? '' })) }
      else if (result.payload) {
        applyRemote(result.payload, result.remoteVersion)
        notify('已同步云端最新数据')
      } else { setSyncError(null); notify('云端暂无数据') }
    } finally { syncingRef.current = false; setSyncing(false) }
  }, [notify, applyRemote])

  // ---- 备用同步通道（v0.1.352）：WebDAV / iCloud Drive，与云同步独立，云端不可用时照常工作 ----
  const altSyncBusy = useRef(false)
  const [altSyncing, setAltSyncing] = useState(false)
  const [altStatus, setAltStatus] = useState(loadAltStatus)
  const runAltSync = useCallback(async (manual = false) => {
    if (altSyncBusy.current) return
    const jobs: { label: string; io: ChannelIO }[] = []
    const wcfg = loadWebdavConfig()
    if (wcfg.enabled && wcfg.username.trim()) jobs.push({ label: 'WebDAV', io: webdavIO(wcfg) })
    if (loadIcloudSyncConfig().enabled && isDesktopApp()) jobs.push({ label: 'iCloud Drive', io: icloudIO() })
    if (!jobs.length) { if (manual) notify('备用同步通道还没有启用或配置不完整'); return }
    altSyncBusy.current = true
    setAltSyncing(true)
    try {
      let cur = stateRef.current
      for (const job of jobs) {
        try {
          const r = await syncChannel(job.io, cur, {
            includeLocal: !!cur.settings.syncLocalProviders,
            apply: next => {
              skipPushOnce.current = true
              lastPullAt.current = Date.now()
              stateRef.current = next
              setState(next)
            },
          })
          cur = r.state
          if (manual) notify(r.action === 'applied' ? `${job.label}：已同步其他设备的最新数据` : r.action === 'pushed' ? `${job.label}：本机数据已推送` : `${job.label}：已是最新，无需同步`)
        } catch (e) {
          if (manual) notify(`${job.label} 同步失败：${(e as Error)?.message ?? String(e)}`)
        }
      }
    } finally {
      altSyncBusy.current = false
      setAltSyncing(false)
      setAltStatus(loadAltStatus())
    }
  }, [notify])

  // 备用通道自动同步：启动后跑一次，之后每 45 秒与切回前台时各跑一次（未启用时立即返回）
  useEffect(() => {
    const t0 = window.setTimeout(() => { void runAltSync(false) }, 4000)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runAltSync(false)
    }, 45000)
    const onVis = () => { if (document.visibilityState === 'visible') void runAltSync(false) }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearTimeout(t0)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [runAltSync])

  const handleCloudLogin = useCallback(async (user: CloudUser) => {
    setLoginOpen(false)
    setState(s => appendAudit(s, makeAuditEntry('云登录', user.name ?? undefined)))
    notify(t('已登录：{name}', { name: user.name ?? t('用户') }))
    await bootstrapCloud(user)
  }, [notify, bootstrapCloud])

  const handleCloudLogout = useCallback(async () => {
    await clearCloudSessionMirror()
    await cloud.auth.signOut()
    setCloudUser(null)
    cloudUserRef.current = null
    syncReady.current = false
    setSyncError(null)
    setState(s => appendAudit(s, makeAuditEntry('云登出')))
    notify('已退出云同步，数据仍保存在本机')
  }, [notify])

  // 已登录时每 30 秒刷新一次侧边栏「最近同步」相对时间文案
  useEffect(() => {
    if (!cloudUser) return
    const t = window.setInterval(() => setSyncTick(n => n + 1), 30000)
    return () => window.clearInterval(t)
  }, [cloudUser])

  /** 读取文件：自动识别 JSON 备份 / 账户 CSV / 额度 CSV / 用量 CSV */
  /** 导入文本（文件读入与粘贴导入共用）：按内容识别备份/清单/CSV（v0.1.331 抽出） */
  const handleImportText = useCallback((text: string, fileName = 'pasted.txt') => {
      try {
        // API Key 备份文件（JSON / CSV / TXT，按内容识别）
        if (parseKeyBackup(text)) {
          void (async () => {
            try {
              const pwd = sessionPwd || getBiometricPassword() || undefined
              const next = await importKeyBackup(text, stateRef.current, pwd)
              setState(next)
              notify('密钥备份已导入并合并（重复 ID 已覆盖）')
            } catch (e) { notify((e as Error)?.message ?? '备份导入失败') }
          })()
          return
        }
        // 第三方 API 服务清单（数组格式，含明文 Key）
        if (isServiceList(text)) {
          setServicePreview(parseServiceList(text))
          return
        }
        if (isJsonImport(fileName, text)) {
          setImportData(importState(text))
          return
        }
        const kind = detectCsvKind(text)
        if (!kind) { notify('无法识别文件格式：支持密钥备份 JSON/CSV/TXT、账户/额度/用量 CSV'); return }
        const s = stateRef.current
        if (kind === 'accounts') {
          setCsvPreview({ kind, accounts: parseAccountsCsv(text) })
        } else if (kind === 'quotas') {
          setCsvPreview({ kind, quotas: parseQuotasCsv(text, s.accounts) })
        } else {
          setCsvPreview({ kind, events: parseUsageCsv(text, s.accounts) })
        }
      } catch (err: any) { notify(err.message ?? '文件解析失败') }
  }, [notify, sessionPwd])

  const handleImportFile = useCallback((file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => handleImportText(String(reader.result ?? ''), file.name)
    reader.readAsText(file)
  }, [handleImportText])

  /** 按选择格式导出文件；dir 非空则写入指定目录（桌面端） */
  const doExport = useCallback(async (format: ExportFormat, dir?: string) => {
    const s = stateRef.current
    const { content, ext } = exportByFormat(format, s, latestQuota)
    const suffix = format === 'json' ? 'backup' : format
    const filename = `ai-credit-manager-${suffix}-${todayISO()}.${ext}`
    if (dir && isDesktopApp()) {
      // 桌面端：写入用户选择的目录
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> } }
      try {
        const invoke = w.__TAURI_INTERNALS__?.invoke
        if (!invoke) throw new Error('桌面端接口不可用')
        const path = await invoke('write_file_to_dir', { dir, filename, content })
        notify(t('已导出到：{path}', { path }))
      } catch (e: any) { notify(e.message ?? '写入文件失败') }
    } else {
      // Web 端：浏览器下载
      const blob = new Blob([content], { type: (format === 'json' ? 'application/json' : 'text/csv') + ';charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    }
    if (format === 'json') setState(prev => updateSettings(prev, { lastExportAt: new Date().toISOString() }))
    setState(prev => appendAudit(prev, makeAuditEntry(format === 'json' ? '导出备份' : '导出数据', format.toUpperCase())))
  }, [notify])

  /** 立即把本地数据推送云端（备份横幅/手动备份用） */
  const pushCloud = useCallback(async (): Promise<boolean> => {
    if (!cloudUserRef.current) return false
    setSyncing(true)
    syncingRef.current = true
    try {
      const r = await pushPayload(stateRef.current, undefined, { includeLocal: !!stateRef.current.settings.syncLocalProviders })
      if (r.ok) {
        setLastSyncAt(getLastSyncAt())
        setSyncError(null)
        setState(prev => updateSettings(prev, { lastExportAt: new Date().toISOString() }))
        notify('已备份到云端')
        return true
      }
      setSyncError(r.error ?? '推送失败')
      notify(t('云端备份失败：{err}', { err: r.error ?? t('未知错误') }))
      return false
    } finally { syncingRef.current = false; setSyncing(false) }
  }, [notify])

  /** 备份提醒：全平台通用的界面横幅。超过阈值天数未备份即提示。 */
  const checkBackupDue = useCallback(() => {
    const st = stateRef.current.settings
    if (!st.backupReminder) { setBackupDue(false); return }
    try {
      const snooze = Number(localStorage.getItem('acm.backup.snoozeUntil') ?? 0)
      if (snooze && Date.now() < snooze) { setBackupDue(false); return }
    } catch { /* 忽略 */ }
    const days = st.backupReminderDays ?? 7
    const ref = st.lastExportAt || stateRef.current.accounts[0]?.createdAt
    if (!ref) { setBackupDue(false); return }   // 没有数据时无需提醒
    const elapsed = Date.now() - new Date(ref).getTime()
    setBackupDue(elapsed >= days * 86400000)
  }, [])
  useEffect(() => {
    checkBackupDue()
    const t = window.setInterval(checkBackupDue, 60 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [checkBackupDue, state.settings.backupReminder, state.settings.backupReminderDays, state.settings.lastExportAt])

  const views: AccountView[] = useMemo(() => state.accounts.map((account) => {
    const provider = PROVIDER_MAP[account.providerId]
    const quota = latestQuota(state.quotas, account.id)
    const used = quota?.used ?? 0
    const total = quota?.total ?? 0
    const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
    let days: number | undefined
    if (quota?.resetAt) days = Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 86400000)
    const forecast = quota ? predictExhaustion(state, account.id) : undefined
    return { account, provider, quota, usagePercent: percent, daysUntilReset: days, forecast }
  }), [state])

  const pendingCheckins = CHECKIN_TOOLS.filter((t) =>
    !state.checkins.some((c) => c.providerId === t.id && c.date === todayISO() && c.done),
  )

  const lowQuota = views.filter((v) => v.usagePercent >= 80)
  const runningOut = views.filter((v) =>
    v.forecast?.level === 'exhausted' || v.forecast?.level === 'critical' ||
    (v.forecast?.level === 'warning' && (v.forecast.daysLeft ?? 99) <= state.settings.alertDays),
  )
  const monthCost = state.usage
    .filter((u) => u.date.startsWith(todayISO().slice(0, 7)))
    .reduce((s, u) => s + u.estimatedCost, 0)
  const portfolioValue = totalPortfolioValue(state)
  const healthRows = useMemo(() => scoreAccounts(state), [state])

  // ---- 外观主题：八套设计共用组件与数据；写入 <html data-ui-theme> 并做本机首屏缓存 ----
  const uiTheme = state.settings.uiTheme ?? 'aurora'
  useEffect(() => { applyUiTheme(uiTheme) }, [uiTheme])

  // ---- 明暗模式：system 跟随系统；暗夜/极光/星舰使用各自的固定深色画布 ----
  const themePref = state.settings.theme ?? 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = themePref === 'dark' || (themePref === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    if (themePref === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [themePref])

  // ---- Mac 系统毛玻璃增强（v0.1.294）：液态玻璃风格 + macOS 桌面端时，
  // 让 Rust 侧给主窗口挂系统 NSVisualEffectView 底材，并给 <html> 挂 sys-glass
  // 让壳/侧边栏底色调透（见 liquid-global.css 第 6 节）；切回经典即撤除 ----
  const uiStylePref = state.settings.uiStyle
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const isMac = /Mac/i.test(navigator.platform ?? '') || /Macintosh|Mac OS/i.test(navigator.userAgent ?? '')
    if (!isMac) return
    const enabled = uiStylePref === 'liquid' || uiTheme === 'aurora'
    document.documentElement.classList.toggle('sys-glass', enabled)
    const invoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke
    if (invoke) void invoke('set_window_glass', { enabled }).catch(() => { /* 老版本桌面端无此命令时静默：CSS 玻璃照常 */ })
  }, [uiStylePref, uiTheme])

  // ---- 桌面外壳联动（仅 Tauri）：托盘/快捷键发来导航事件时切页；待签到数同步到菜单栏标题 ----
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let unlisten: (() => void) | undefined
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlisten = await listen<string>('acm-navigate', (e) => { if (e.payload) openTab(e.payload as Tab) })
    })()
    return () => { unlisten?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // ---- 桌面端：把快捷键设置（总开关 + 自定义组合）下发给 Tauri 动态注册 ----
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
    void w.__TAURI_INTERNALS__?.invoke?.('shortcuts_apply', {
      enabled: state.settings.shortcutsEnabled ?? true,
      ai: state.settings.shortcutAi ?? 'CommandOrControl+Shift+A',
      mini: state.settings.shortcutMini ?? 'CommandOrControl+Shift+M',
    }).catch(() => { /* 旧版本桌面壳没有此命令时忽略，壳内默认快捷键仍生效 */ })
  }, [state.settings.shortcutsEnabled, state.settings.shortcutAi, state.settings.shortcutMini])

  // ---- 桌面端：图标显示位置（Dock / 菜单栏）下发给 Tauri 壳 ----
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
    void w.__TAURI_INTERNALS__?.invoke?.('icon_display_apply', {
      mode: state.settings.iconDisplay ?? 'both',
    }).catch(() => { /* 旧版本桌面壳没有此命令时忽略 */ })
  }, [state.settings.iconDisplay])

  // ---- 价格变动订阅：启动时（6 小时节流）拉取仓库价格表与本地快照对比，变动记入提醒 ----
  const [priceAlerts, setPriceAlerts] = useState<PriceChange[]>(() => loadPriceAlerts())
  const [priceCheckedAt, setPriceCheckedAt] = useState<string | null>(() => lastPriceCheckAt())
  const [checkingPrices, setCheckingPrices] = useState(false)
  const runPriceCheck = useCallback(async (force: boolean, silent: boolean) => {
    setCheckingPrices(true)
    try {
      const r = await checkPriceUpdates(force)
      setPriceCheckedAt(lastPriceCheckAt())
      if (r.ok && r.changes.length) {
        setPriceAlerts(prev => { const next = [...r.changes, ...prev].slice(0, 30); savePriceAlerts(next); return next })
        const fmt = (c: PriceChange) => `${PROVIDER_MAP[c.providerId]?.shortName ?? c.providerId} ${c.newPrice > c.oldPrice ? '涨价' : '降价'} ¥${c.oldPrice}→¥${c.newPrice}`
        const mine = r.changes.filter(c => stateRef.current.accounts.some(a => a.providerId === c.providerId))
        if (mine.length) notify(t('价格变动提醒：{list}{more}', { list: mine.slice(0, 3).map(fmt).join('；'), more: mine.length > 3 ? t(' 等 {n} 处', { n: mine.length }) : '' }))
        else if (!silent) notify(t('价格表有 {n} 处变动（不涉及你已添加的平台），详见用量页「价格动态」', { n: r.changes.length }))
      } else if (!silent) {
        notify(r.ok ? t('已检查，暂无价格变动') : t('检查失败（{err}），请稍后再试', { err: r.error ?? t('网络不可用') }))
      }
    } finally { setCheckingPrices(false) }
  }, [notify])
  const priceCheckRanRef = useRef(false)
  useEffect(() => {
    if (priceCheckRanRef.current) return
    priceCheckRanRef.current = true
    void runPriceCheck(false, true)
  }, [runPriceCheck])

  // ---- 本地网关自动开启：解锁保险箱后（且设置开启）注册路由并启动（仅桌面端） ----
  const gatewayAutoRef = useRef(false)
  useEffect(() => {
    if (!sessionPwd) { gatewayAutoRef.current = false; return }
    if (gatewayAutoRef.current) return
    const st = stateRef.current
    if (!('__TAURI_INTERNALS__' in window) || !st.settings.gatewayAutoStart || !st.settings.gatewayToken) return
    gatewayAutoRef.current = true
    void (async () => {
      try {
        const routes = await buildGatewayRoutes(st, sessionPwd)
        if (!Object.keys(routes).length) return
        await gatewaySetRoutes(routes)
        await gatewayStart(st.settings.gatewayPort || 8787, st.settings.gatewayToken!)
      } catch { /* 网关是增强功能，失败静默 */ }
    })()
  }, [sessionPwd])

  // ---- 保险箱闲置自动上锁：解锁后无操作达到设置时长，清空会话密码并通知 Key 管理页同步上锁 ----
  useEffect(() => {
    const mins = state.settings.autoLockMinutes ?? 0
    if (!sessionPwd || !mins) return
    const lock = () => {
      setSessionPwd('')
      window.dispatchEvent(new Event('acm-autolock'))
      notify(t('保险箱已自动上锁（闲置 {mins} 分钟）', { mins }))
    }
    let timer = window.setTimeout(lock, mins * 60_000)
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(lock, mins * 60_000) }
    window.addEventListener('pointerdown', reset, { passive: true })
    window.addEventListener('keydown', reset)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', reset)
      window.removeEventListener('keydown', reset)
    }
  }, [sessionPwd, state.settings.autoLockMinutes, notify])

  // ---- 余额自动巡检：保险箱解锁后（sessionPwd 就绪）静默刷新可查余额平台的官方余额 ----
  // 间隔由设置 → 通用 →「余额自动刷新间隔」决定（本机偏好，默认 6 小时，可关）；
  // 解锁时先按节流检查一次，之后每分钟看一眼是否到期，到期就再巡检一轮——
  // App 长开着也能周期刷新。失败静默，不打扰；无总额度的结果不落快照。
  const balancePatrolRunningRef = useRef(false)
  useEffect(() => {
    if (!sessionPwd) return
    const runPatrol = async () => {
      if (balancePatrolRunningRef.current) return
      const hours = loadPatrolHours()
      const last = Number(localStorage.getItem(PATROL_AT_KEY) ?? 0)
      if (!patrolDue(Date.now(), hours, last)) return
      balancePatrolRunningRef.current = true
      localStorage.setItem(PATROL_AT_KEY, String(Date.now()))
      try {
        await refreshAllBalances(stateRef.current.accounts, sessionPwd, (accountId, r) =>
          setState(s => upsertQuota(s, { accountId, used: r.used, total: r.total!, unit: r.unit, source: 'api' })))
      } finally { balancePatrolRunningRef.current = false }
    }
    void runPatrol()
    const t = window.setInterval(() => { void runPatrol() }, 60 * 1000)
    return () => window.clearInterval(t)
  }, [sessionPwd])

  // ---- 云端自动备份（v0.1.330）：登录云账号后按本机偏好（开关/间隔/保留份数）定时存整份状态快照 ----
  // 每 10 分钟看一眼是否到期；到期静默备份，失败不打扰。偏好只存本机，避免多端抢着备。
  const cloudBackupRunningRef = useRef(false)
  useEffect(() => {
    if (!cloudUser) return
    const tick = async () => {
      if (cloudBackupRunningRef.current) return
      const prefs = loadCloudBackupPrefs()
      if (!cloudBackupDue(prefs)) return
      cloudBackupRunningRef.current = true
      try { await createCloudSnapshot(stateRef.current, prefs.keep, '自动备份') }
      catch { /* 静默 */ }
      finally { cloudBackupRunningRef.current = false }
    }
    void tick()
    const t = window.setInterval(() => { void tick() }, 10 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [cloudUser])

  // ---- 自动签到（v0.1.362；v0.1.372 起锁定也能签；v0.1.421 修解锁触发与指纹副本）：本机开关打开后每天静默签一次 ----
  // 启动/解锁时先查一次（effect 依赖 sessionPwd，解锁会立即重跑一次 tick；v0.1.421 前依赖只有
  // [notify]，解锁后得等下一个 30 分钟 tick），之后每 30 分钟看一眼（覆盖跨午夜常驻）；结果留痕，迷你窗可直接看到。
  // 密码来源见 resolveAutoCheckinPassword：已解锁用会话密码；锁定中用指纹解锁留下的本机副本
  // （`||` 而非 `??`——锁定时会话密码是 ''，`??` 不会落到副本；仅开过指纹解锁的设备才有，
  // 且读取不弹验证框；没开指纹的设备锁定中跳过、解锁后补签）。
  const autoCheckinRunningRef = useRef(false)
  const sessionPwdRef = useRef(sessionPwd)
  sessionPwdRef.current = sessionPwd
  useEffect(() => {
    const tick = async () => {
      if (autoCheckinRunningRef.current) return
      autoCheckinRunningRef.current = true
      try {
        await autoCheckinTick(sessionPwdRef.current, notify)
      } catch { /* 静默：失败原因会在迷你窗/签到页手动刷新时呈现 */ }
      finally { autoCheckinRunningRef.current = false }
    }
    void tick()
    const t = window.setInterval(() => { void tick() }, 30 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [notify, sessionPwd])

  // ---- 免费游戏自动领取（v0.1.384；v0.1.421 起解锁也触发）：Epic 绑定后按偏好间隔巡查，拉取本周免费并自动领入库 ----
  // 启动/解锁时先看一眼（effect 依赖 sessionPwd，解锁会立即重跑一次 tick），之后每 30 分钟看一眼（覆盖跨周四 23:00 换新）；失败原因写进
  // 工坊领取记录，不静默跳过。密码来源与自动签到同款：会话密码或指纹副本（resolveAutoCheckinPassword，`||` 而非 `??`）。
  const autoFgRunningRef = useRef(false)
  useEffect(() => {
    const tick = async () => {
      if (autoFgRunningRef.current) return
      if (!freeGamesCheckDue()) return
      const pwd = resolveAutoCheckinPassword(sessionPwdRef.current)
      if (!pwd) return
      autoFgRunningRef.current = true
      try {
        const res = await runFreeGamesCheck(pwd)
        if (sessionPwdRef.current && (res.claimed.length || res.errors.length)) {
          notify(`免费游戏自动领取：${summarizeCheckResult(res)}`)
        }
      } catch { /* 静默：失败原因写进领取记录，打开工坊可见 */ }
      finally { autoFgRunningRef.current = false }
    }
    void tick()
    const t = window.setInterval(() => { void tick() }, 30 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [notify, sessionPwd])

  // ---- 全局刷新（v0.1.302）：Key 管理 / 额度看板 / 用量费用三页的「刷新」按钮共用 ----
  // 立即全量拉一遍可查余额平台的官方余额并落快照，同时重置自动巡检计时。
  const [globalRefreshing, setGlobalRefreshing] = useState(false)
  const globalRefreshRef = useRef(false)
  const doGlobalRefresh = async () => {
    if (globalRefreshRef.current) return
    if (!sessionPwd) { notify(t('请先解锁保险箱后再刷新（余额需要解密 Key 才能查询）')); return }
    globalRefreshRef.current = true
    setGlobalRefreshing(true)
    try {
      const res = await refreshAllBalances(stateRef.current.accounts, sessionPwd, (accountId, r) =>
        setState(s => upsertQuota(s, { accountId, used: r.used, total: r.total!, unit: r.unit, source: 'api' })))
      try { localStorage.setItem(PATROL_AT_KEY, String(Date.now())) } catch { /* ignore */ }
      if (res.supported === 0) notify(t('没有可自动刷新余额的账户（仅 DeepSeek、Kimi、硅基流动、OpenRouter 支持）'))
      else if (res.failed === 0) notify(t('已刷新全部余额：{n} 个账户已更新', { n: res.updated }))
      else notify(t('刷新完成：{ok} 个已更新，{fail} 个失败', { ok: res.updated, fail: res.failed }))
    } finally {
      globalRefreshRef.current = false
      setGlobalRefreshing(false)
    }
  }

  // ---- 系统通知提醒引擎：启动时 + 每 15 分钟评估一次，去重后发送 ----
  const notifyPrefs = notifyPrefsOf(state.settings)
  useEffect(() => {
    if (!notifyPrefs.enabled) return
    let cancelled = false
    const run = async () => {
      const perm = await getNotificationPermission()
      if (cancelled || perm !== 'granted') return
      const events = buildReminders({
        now: new Date(),
        prefs: notifyPrefs,
        pendingCheckins: pendingCheckins.map((t) => t.name),
        expiring: views
          .filter((v) => v.daysUntilReset != null && v.daysUntilReset >= 0 && v.daysUntilReset <= state.settings.alertDays)
          .map((v) => ({ accountId: v.account.id, name: v.account.label || v.provider?.name || '账户', days: v.daysUntilReset as number })),
        forecastAlerts: views
          .filter((v) => v.forecast && (v.forecast.level === 'exhausted' || v.forecast.level === 'critical' || (v.forecast.level === 'warning' && (v.forecast.daysLeft ?? 99) <= state.settings.alertDays)))
          .map((v) => ({ accountId: v.account.id, name: v.account.label || v.provider?.name || '账户', daysLeft: v.forecast?.daysLeft ?? 0 })),
        monthCost,
        monthlyBudget: state.settings.monthlyBudget,
        lowBalances: views
          .filter((v) => v.quota?.unit === 'currency' && (v.quota.total - v.quota.used) >= 0 && (v.quota.total - v.quota.used) < (state.settings.lowBalanceThreshold ?? 10))
          .map((v) => ({ accountId: v.account.id, name: v.account.label || v.provider?.name || '账户', remaining: (v.quota!.total - v.quota!.used), symbol: '¥' })),
        spendAnomalies: detectSpendAnomalies(state, todayISO()).map((sa) => {
          const acc = state.accounts.find((a) => a.id === sa.accountId)
          return { ...sa, name: acc?.label || (acc ? PROVIDER_MAP[acc.providerId]?.name : undefined) || '账户' }
        }),
        providerBudgets: Object.entries(state.settings.providerBudgets ?? {})
          .filter(([, b]) => b > 0)
          .map(([providerId, budget]) => ({
            providerId,
            name: PROVIDER_MAP[providerId]?.shortName ?? providerId,
            cost: state.usage
              .filter((u) => u.date.startsWith(todayISO().slice(0, 7)) && state.accounts.find((a) => a.id === u.accountId)?.providerId === providerId)
              .reduce((s, u) => s + u.estimatedCost, 0),
            budget,
          })),
        monthlyReportSummary: (() => {
          const lastMonth = prevMonthKey(todayISO().slice(0, 7))
          const rep = buildMonthlyReport(state, lastMonth)
          return { month: lastMonth, totalCost: rep.totalCost, recordCount: rep.recordCount, topPlatform: rep.byPlatform[0]?.name, deltaPct: rep.costDeltaPct }
        })(),
        subscriptionRenewals: summarizeSubscriptions(state).rows
          .filter((r) => r.daysLeft <= (state.settings.alertDays || 7))
          .map((r) => ({ accountId: r.accountId, name: r.label, days: r.daysLeft, renewAt: r.nextRenewAt })),
        accountBudgets: Object.entries(state.settings.accountBudgets ?? {})
          .filter(([, b]) => b > 0)
          .map(([accountId, budget]) => {
            const acc = state.accounts.find((a) => a.id === accountId)
            return {
              accountId,
              name: acc?.label || (acc ? PROVIDER_MAP[acc.providerId]?.shortName : undefined) || '账户',
              cost: state.usage
                .filter((u) => u.date.startsWith(todayISO().slice(0, 7)) && u.accountId === accountId)
                .reduce((s, u) => s + u.estimatedCost, 0),
              budget,
            }
          }),
      })
      const fresh = filterUnsent(events).slice(0, 3)
      for (const e of fresh) { if (!cancelled) await showNotification(e.title, e.body, e.id) }
      if (fresh.length && !cancelled) markSent(fresh)
    }
    void run()
    const t = window.setInterval(run, 15 * 60 * 1000)
    return () => { cancelled = true; window.clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // 安卓端：把额度摘要同步给桌面小组件（原生小组件读 Preferences 渲染）
  useEffect(() => { if (isNativeApp()) syncWidgetData(state) }, [state])

  // 安卓端：同步每日签到定时通知（App 关闭也能提醒）
  useEffect(() => {
    if (notifyPrefs.enabled && notifyPrefs.checkin) {
      const [h, m] = notifyPrefs.checkinTime.split(':').map((x) => Number(x) || 0)
      void scheduleDailyCheckin(h, m)
    } else {
      void cancelDailyCheckin()
    }
  }, [notifyPrefs.enabled, notifyPrefs.checkin, notifyPrefs.checkinTime])

  const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'ai', label: 'AI 助手', icon: Sparkles },
    { id: 'dashboard', label: '额度看板', icon: LayoutDashboard },
    { id: 'checkin', label: 'AI 工具大全', icon: CalendarCheck2 },
    { id: 'keys', label: 'API Key 管理', icon: KeyRound },
    { id: 'usage', label: '用量与费用', icon: BarChart3 },
    { id: 'calendar', label: '额度日历', icon: CalendarDays },
    { id: 'voice', label: '语音配置', icon: Volume2 },
    { id: 'workshop', label: 'AI 工坊', icon: Wrench },
    { id: 'plugins', label: '插件', icon: Puzzle },
    { id: 'settings', label: '设置', icon: Settings },
  ]

  // 侧栏分组（仅布局层：不改变任何 tab id / 路由 / 数据逻辑）
  const navGroups: Array<{ label: string; ids: Tab[] }> = [
    // v0.1.334 Ethan 定案：原「概览」组删除；「AI 创作」置顶，内含 AI 助手与 AI 工坊；额度看板在资产管理
    { label: 'AI 创作', ids: ['ai', 'workshop'] },
    { label: '资产管理', ids: ['dashboard', 'keys', 'usage', 'calendar'] },
    { label: '系统', ids: ['voice', 'plugins', 'settings'] },
  ]

  // 移动端底部导航：只保留 5 个高频入口，AI 置于正中，其余从抽屉进入（原 10 个太挤）
  const bottomTabs: Tab[] = ['dashboard', 'workshop', 'ai', 'keys', 'settings']
  const shortLabel: Record<Tab, string> = {
    ai: 'AI', dashboard: '看板', checkin: '工具', 'chat-translate': '对话翻译',     'local-image': '本地图像', 'local-video': '本地视频',
    keys: '密钥', usage: '用量', calendar: '日历', report: '报告', voice: '语音', settings: '设置', plugins: '插件', workshop: '工坊',
  }

  // ---- 全局搜索（Cmd/Ctrl+K） ----
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPaletteOpen(v => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const paletteItems: PaletteItem[] = useMemo(() => {
    const pages: PaletteItem[] = tabs.map(tabDef => ({ id: `page-${tabDef.id}`, group: t('页面'), title: t(tabDef.label), keywords: tabDef.id, run: () => openTab(tabDef.id) }))
    pages.push({ id: 'page-report', group: t('页面'), title: t('月度报告'), keywords: 'report month 月度 报告 汇总', run: () => openTab('report') })
    const actions: PaletteItem[] = [
      { id: 'act-add', group: t('操作'), title: t('添加账户'), keywords: 'add account new 添加 账户 新建 key', run: () => setAddOpen(true) },
    ]
    const accounts: PaletteItem[] = state.accounts.map(a => ({
      id: `acc-${a.id}`, group: t('账户'),
      title: a.label || PROVIDER_MAP[a.providerId]?.name || a.providerId,
      hint: PROVIDER_MAP[a.providerId]?.shortName,
      keywords: `${a.providerId} ${a.note ?? ''}`,
      run: () => openTab('keys'),
    }))
    let tools: PaletteItem[] = []
    try {
      tools = currentCatalog().tools.map(tool => ({
        id: `tool-${tool.id}`, group: t('AI 工具'), title: tool.name, hint: tool.nameEn,
        keywords: `${tool.id} ${tool.nameEn} ${tool.category}`, run: () => openTab('checkin'),
      }))
    } catch { /* 工具目录不可用时跳过 */ }
    return [...pages, ...actions, ...accounts, ...tools]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accounts])

  // ---- 审计日志快捷写入 ----
  const audit = useCallback((action: string, detail?: string) => {
    setState(s => appendAudit(s, makeAuditEntry(action, detail)))
  }, [])

  // 手机端侧栏：与桌面端使用同一分组顺序；手机客户端不含文档问答（无本机服务）
  const drawerTabs: Tab[] = (['ai', 'dashboard', 'workshop', 'keys', 'usage', 'calendar', 'voice', 'plugins', 'settings'] as Tab[])

  // 八套主题只改变显示层；极光沿用现有系统级玻璃能力，其余主题由统一设计令牌驱动。
  const liquidUi = state.settings.uiStyle === 'liquid' || uiTheme === 'aurora'
  const motionOn = state.settings.uiMotion !== false
  const shellClass = [
    'app-shell',
    `ui-theme-${uiTheme}`,
    isPhone ? 'phone-shell' : '',
    'claude-ui',
    liquidUi ? 'liquid-ui' : '',
    motionOn ? 'motion-ui' : 'no-motion',
    sidebarVisible ? '' : 'sidebar-collapsed',
    state.settings.showBottomNav ? 'has-bottom-nav' : '',
    sidebarVisible && closedNavGroups.length > 0 ? 'nav-any-closed' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={shellClass}>
      {/* 手机端抽屉遮罩：点击关闭侧栏 */}
      {isPhone && sidebarVisible && <button className="phone-scrim" aria-label={t('关闭菜单')} onClick={() => setSidebarVisible(false)} />}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src="./pwa-512.png" alt={t('AI 魔方')} className="app-mark-img" /></div>
          <div className="brand-text">
            <div className="brand-name">{t('AI 魔方')}</div>
            <div className="brand-sub">AI CREDIT MANAGER</div>
          </div>
          {isPhone && <button className="icon-btn sidebar-toggle" onClick={() => setSidebarVisible(false)} title={t('关闭菜单')}><X size={19} /></button>}
          {!isPhone && <button className="icon-btn sidebar-toggle sidebar-head-toggle" onClick={toggleSidebar} title={sidebarVisible ? t('收起侧边栏（只显示图标）') : t('展开侧边栏')} aria-label={t('切换侧边栏')}>{sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>}
        </div>
        <nav className="nav" aria-label={t('主导航')}>
          {navGroups.map((group) => {
            const visibleIds = group.ids.filter((id) => (isPhone ? drawerTabs : tabs.map((t) => t.id)).includes(id))
            if (!visibleIds.length) return null
            const groupClosed = sidebarVisible && closedNavGroups.includes(group.label)
            return (
              <div className="nav-group" key={group.label || 'top'}>
                {group.label !== '' && (
                  <div className="nav-group-label collapsible" onClick={() => toggleNavGroup(group.label)} title={groupClosed ? t('展开分组') : t('收起分组')}>
                    <span>{t(group.label)}</span>
                    {groupClosed && <span className="nav-group-count">{visibleIds.length}</span>}
                    <ChevronDown size={12} className={`nav-group-chevron ${groupClosed ? '' : 'open'}`} />
                  </div>
                )}
                {!groupClosed && visibleIds.map((id) => {
                  const tabDef = tabs.find((x) => x.id === id)!
                  const Icon = tabDef.icon
                  const badge = id === 'dashboard' && runningOut.length > 0 ? runningOut.length : id === 'checkin' && pendingCheckins.length > 0 ? pendingCheckins.length : null
                  return (
                    <Fragment key={tabDef.id}>
                      <button className={`nav-item ${tab === tabDef.id ? 'active' : ''}`}
                        onClick={() => openTab(tabDef.id)} title={t(tabDef.label)}>
                        <span className="nav-item-icon"><Icon size={17} /></span>
                        <span className="nav-item-label">{t(tabDef.label)}</span>
                        {id === 'checkin' && catalogNews.length > 0 ? <span className="nav-new-dot" title={t('目录新增 {n} 款工具', { n: catalogNews.length })} /> : null}
                        {badge ? <span className="badge nav-badge">{badge}</span> : null}
                      </button>
                      {id === 'ai' && sidebarVisible && (
                        <SidebarHistory open={historyOpen} onToggle={() => setHistoryOpen(v => !v)} onNavigate={() => openTab('ai')} />
                      )}
                    </Fragment>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <button className="cmdk-trigger" onClick={() => setPaletteOpen(true)} title={t('全局搜索（Ctrl/⌘ + K）')}>
          <Search size={15} />
          <span className="cmdk-trigger-label">{t('搜索页面 / 账户 / 工具')}</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          className="sync-status-bar"
          onClick={() => {
            if (!cloudUser) { setLoginOpen(true); return }
            if (!syncing) void pullCloud()
          }}
          title={!cloudUser ? t('登录后开启云同步') : syncError ? t('同步失败：{err}，点击重试', { err: syncError }) : t('点击立即同步')}
        >
          <span className={`status-dot ${!cloudUser ? 'off' : syncing ? 'busy' : syncError ? 'err' : 'ok'}`} />
          <div className="sync-status-text">
            <b>{!cloudUser ? t('本地模式') : syncing ? t('同步中…') : syncError ? t('同步失败') : t('已云同步')}</b>
            <span>{!cloudUser
              ? t('未登录云同步 · 点此登录')
              : syncing
                ? (cloudUser.name ?? cloudUser.email ?? t('正在与云端同步'))
                : syncError
                  ? t('点此重试')
                  : t('最近 {time} · 点此刷新', { time: syncTimeText(lastSyncAt) })}</span>
          </div>
          <span className="sync-status-icon">{!cloudUser ? <CloudOff size={16} /> : syncError ? <AlertTriangle size={16} /> : <Cloud size={16} />}</span>
        </button>
        <div className="sidebar-foot">
          <div className="sidebar-status">
            <span className="status-dot" />
            <div><b>{t('本地优先')}</b><span>{t('数据只保存在此设备')}</span></div>
          </div>
          <div className="compliance">
            {t('仅只读官方接口 · 签到跳转官方页本人操作')}
          </div>
        </div>
      </aside>

      <main className="main">
        {/* 手机端：悬浮玻璃菜单按钮，点击打开侧栏抽屉 */}
        {isPhone && !sidebarVisible && <button className="phone-menu-fab" aria-label={t('打开菜单')} onClick={() => setSidebarVisible(true)}><Menu size={22} /></button>}

        <div className={`content ${tab === 'ai' ? 'content-ai' : ''}`}>
          <Suspense fallback={<div style={{ padding: 32, color: 'var(--text-3)', fontSize: 13 }}>{t('加载中…')}</div>}>
          {tab === 'ai' && <AIView notify={notify} accounts={state.accounts} settings={state.settings} serviceController={isPhone ? undefined : serviceController} prompts={state.prompts ?? []} onPromptsChange={(prompts) => setState(s => ({ ...s, prompts }))} />}
          {tab === 'dashboard' && <>
          {state.accounts.length === 0 && !onboardingOff && <div className="onboarding-card">
            <button className="onboarding-close" onClick={() => { try { localStorage.setItem('acm.onboarding.dismissed', '1') } catch { /* 忽略 */ } setOnboardingOff(true) }} title={t('不再显示')}><X size={15} /></button>
            <h3>{t('三步上手 AI 魔方')}</h3>
            <div className="onboarding-steps">
              <div className="onboarding-step">
                <b>{t('1 · 添加账户')}</b>
                <span>{t('把你在用的 AI 平台账户（DeepSeek、Kimi、智谱等）加进来。')}</span>
                <button className="btn sm primary" onClick={() => setAddOpen(true)}><Plus size={14} /> {t('添加账户')}</button>
              </div>
              <div className="onboarding-step">
                <b>{t('2 · 录入额度')}</b>
                <span>{t('在账户卡片上点「录入/更新额度」，看板会自动预测到期时间与耗尽风险。')}</span>
              </div>
              <div className="onboarding-step">
                <b>{t('3 · 开提醒与同步')}</b>
                <span>{t('开启签到/到期提醒，登录云同步后手机与电脑自动对齐。')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm" onClick={() => setSettingsOpen(true)}>{t('开启提醒')}</button>
                  <button className="btn sm" onClick={() => setLoginOpen(true)}>{t('登录同步')}</button>
                </div>
              </div>
            </div>
          </div>}
          <div className="bento-greeting">
            <h2>{runningOut.length ? t('今天先处理这 {n} 件', { n: runningOut.length }) : t('今天一切正常')}</h2>
            {runningOut.length ? <span className="bento-alert-pill">{t('{n} 个账户告急', { n: runningOut.length })}</span> : pendingCheckins.length ? <span className="bento-alert-pill warn">{t('{n} 个待签到', { n: pendingCheckins.length })}</span> : <span className="bento-alert-pill ok">{t('额度健康')}</span>}
          </div>
          <section className="bento-grid" aria-label={t('概览')}>
            <div className="bento-tile bento-main">
              <div className="bento-label">{t('资源总估值 · {n} 个账户', { n: state.accounts.length })}</div>
              <div className="bento-big">¥{portfolioValue.toFixed(0)}</div>
              <div className="bento-sub">{t('本月已用 ¥{used} / 预算 ¥{budget}', { used: monthCost.toFixed(2), budget: state.settings.monthlyBudget ?? 0 })}<br />{t('单价可在用量页校准')}</div>
              <button className="btn bento-cta" onClick={() => setAddOpen(true)}><Plus size={15} /> {t('添加账户')}</button>
            </div>
            <button className="bento-tile bento-amber" onClick={() => openTab('checkin')}>
              <div className="bento-label">{t('今日待签到')}</div>
              <div className="bento-num">{pendingCheckins.length}<small> {t('个')}</small></div>
              <div className="bento-sub">{pendingCheckins.length ? t('去领取免费额度 →') : t('今日已全部完成')}</div>
            </button>
            <button className="bento-tile bento-red" onClick={() => openTab('usage')}>
              <div className="bento-label">{t('即将耗尽')}</div>
              <div className="bento-num">{runningOut.length}<small> {t('个')}</small></div>
              <div className="bento-sub">{runningOut.length ? t('{days} 天内优先处理 →', { days: state.settings.alertDays ?? 0 }) : t('{n} 个用量超 80%', { n: lowQuota.length })}</div>
            </button>
            <button className="bento-tile bento-green" onClick={() => openWorkshopTool('image')}>
              <div className="bento-label">{t('AI 图像')}</div>
              <div className="bento-action">{t('开始生成 →')}</div>
              <div className="bento-sub">{t('用你的模型账户生图')}</div>
            </button>
            <button className="bento-tile bento-blue" onClick={() => openWorkshopTool('video')}>
              <div className="bento-label">{t('AI 视频')}</div>
              <div className="bento-action">{t('开始生成 →')}</div>
              <div className="bento-sub">{t('用你的模型账户生视频')}</div>
            </button>
            <button className="bento-tile bento-violet" onClick={() => openTab('ai')}>
              <div className="bento-label">{t('AI 助手')}</div>
              <div className="bento-action">{t('开始对话 →')}</div>
              <div className="bento-sub">{t('对话、推理与附件分析')}</div>
            </button>
            <button className="bento-tile bento-teal" onClick={() => openTab('usage')}>
              <div className="bento-label">{t('本月预估费用')}</div>
              <div className="bento-num">¥{monthCost.toFixed(2)}</div>
              <div className="bento-sub">{t('预算 ¥{budget} · 查看趋势 →', { budget: state.settings.monthlyBudget ?? 0 })}</div>
            </button>
          </section>

          {healthRows.length > 0 && (
            <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
              <div className="row between">
                <b style={{ fontSize: 13.5 }}>{t('账户体检')} <span className="hint">{t('按分数从低到高 · 先救最差的')}</span></b>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('告急 {a} · 注意 {b} · 健康 {c}', { a: healthRows.filter(h => h.grade === '告急').length, b: healthRows.filter(h => h.grade === '注意').length, c: healthRows.filter(h => h.grade === '健康').length })}</span>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {healthRows.slice(0, 5).map(h => (
                  <div key={h.accountId} className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <b style={{ fontSize: 15, minWidth: 34, textAlign: 'center', color: h.grade === '告急' ? 'var(--red)' : h.grade === '注意' ? '#d97706' : '#16a34a' }}>{h.score}</b>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>{h.label} <span className="hint">{h.platform}</span></div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.reasons.length ? h.reasons.join('；') : t('状态良好')}</div>
                    </div>
                    <div style={{ width: 90, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', flex: 'none' }}>
                      <div style={{ height: '100%', width: `${h.score}%`, background: h.grade === '告急' ? 'var(--red)' : h.grade === '注意' ? '#d97706' : '#16a34a' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DashboardView views={views} onRefresh={() => void doGlobalRefresh()} refreshing={globalRefreshing} onAdd={() => setAddOpen(true)} onRemove={(id) => {
            const acc = state.accounts.find(a => a.id === id)
            const doRemove = () => {
              scheduleUndo(stateRef.current, t('账户已移除'))
              setState(s => removeAccount(s, id))
              notify(t('账户「{label}」及关联数据已移除（5 秒内可撤回）', { label: acc?.label ?? '' }))
            }
            // 本地模型删除无需备份（仅存本机、无密钥价值）
            if (acc && isLocalProvider(acc.providerId)) doRemove()
            else requestBackup([id], '删除前必须备份', '确认删除', doRemove)
          }} onRemoveMany={(ids) => {
            const localOnly = ids.every(id => {
              const a = state.accounts.find(x => x.id === id)
              return a && isLocalProvider(a.providerId)
            })
            const doRemove = () => {
              scheduleUndo(stateRef.current, t('已删除 {n} 个账户', { n: ids.length }))
              setState(s => ids.reduce((acc, id) => removeAccount(acc, id), s))
              notify(t('已删除 {n} 个账户（5 秒内可撤回）', { n: ids.length }))
            }
            if (localOnly) doRemove()
            else requestBackup(ids, '删除前必须备份', '确认删除', doRemove)
          }} onEditQuota={(accountId) => setQuotaTarget(accountId)} notify={notify} />
          </>}

          {tab === 'checkin' && <AgentToolsView
            key={checkinNonce}
            onRefresh={() => setCheckinNonce(n => n + 1)}
            onBack={() => openTab('workshop')}
            checkins={state.checkins} notify={notify}
            onToggle={(pid, aid) => setState(s => toggleCheckin(s, pid, aid))}
            catalogNews={catalogNews} onCatalogNewsAck={ackCatalogNews}
          />}


          {tab === 'chat-translate' && <ChatTranslateView accounts={state.accounts} notify={notify} settings={state.settings} serviceController={isPhone ? undefined : serviceController} onBack={() => openWorkshopTool('translate')} />}



          {!isPhone && tab === 'local-image' && <div className="set-content"><button className="btn sm ghost sd-back" onClick={() => openWorkshopTool('image')}><X size={15} /> {t('返回 AI 图像')}</button><LocalImageView notify={notify} serviceController={serviceController} /></div>}

          {!isPhone && tab === 'local-video' && <div className="set-content"><button className="btn sm ghost sd-back" onClick={() => openWorkshopTool('video')}><X size={15} /> {t('返回 AI 视频')}</button><LocalVideoView notify={notify} serviceController={serviceController} /></div>}

          {tab === 'keys' && <div className="page-action-row"><button className="btn" onClick={() => setPasteOpen(true)}><ClipboardPaste size={16} /> {t('智能粘贴')}</button><button className="btn primary" onClick={() => setAddOpen(true)}><Plus size={16} /> {t('添加账户')}</button></div>}
          {tab === 'keys' && <KeysView
            state={state} notify={notify} isPhone={isPhone}
            onRefresh={() => void doGlobalRefresh()} refreshing={globalRefreshing}
            onAudit={audit}
            onImportFile={handleImportFile} onImportText={handleImportText}
            onExport={() => setExportOpen(true)}
            onOpenVault={() => setVaultOpen(true)}
            onQuotaFetched={(accountId, used, total, unit) => {
              setState(s => upsertQuota(s, { accountId, used, total: total ?? used, unit, source: 'api' }))
            }}
            onRemoveKeys={(ids) => {
              audit('删除账户', ids.length === 1 ? (state.accounts.find(a => a.id === ids[0])?.label ?? '账户') : `${ids.length} 个账户`)
              scheduleUndo(stateRef.current, ids.length === 1
                ? t('已删除「{label}」', { label: state.accounts.find(a => a.id === ids[0])?.label ?? t('账户') })
                : t('已删除 {n} 个账户', { n: ids.length }))
              setState(s => ids.reduce((acc, id) => removeAccount(acc, id), s))
              notify(t('已删除 {n} 个账户及关联数据（5 秒内可撤回）', { n: ids.length }))
            }}
            onRequestBackup={(ids, title, confirmLabel, after, backupOnly) => {
              // 本地模型删除跳过备份门禁；真 API Key 保持原流程
              const localOnly = !backupOnly && ids.length > 0 && ids.every(id => {
                const a = state.accounts.find(x => x.id === id)
                return a && isLocalProvider(a.providerId)
              })
              if (localOnly) { after(); return }
              requestBackup(ids, title, confirmLabel, after, backupOnly)
            }}
            onUpdateAccount={(id, patch) => setState(s => updateAccount(s, id, patch))}
            onUnlocked={(pwd) => setSessionPwd(pwd)}
            initialPwd={keyPageInitialPwd}
            bioLabel={bioLabel}
          />}

          {tab === 'calendar' && <CalendarView state={state} />}

          {tab === 'report' && <ReportView state={state} notify={notify} />}

          {tab === 'plugins' && <PluginsView notify={notify} />}

          {tab === 'workshop' && <WorkshopView accounts={state.accounts} sessionPwd={sessionPwd} notify={notify} settings={state.settings} serviceController={isPhone ? undefined : serviceController} onUnlock={setSessionPwd} openSignal={wsSignal} onOpenTab={(tb) => openTab(tb as Tab)} />}

          {tab === 'usage' && <UsageView state={state} notify={notify}
            onRefresh={() => void doGlobalRefresh()} refreshing={globalRefreshing}
            priceAlerts={priceAlerts} priceCheckedAt={priceCheckedAt} checkingPrices={checkingPrices}
            onCheckPrices={() => void runPriceCheck(true, false)}
            onAckPriceAlerts={() => { setPriceAlerts([]); savePriceAlerts([]) }}
            onOpenReport={() => openTab('report')}
            onProviderBudget={(providerId, v) => setState(s => ({ ...s, settings: {
              ...s.settings, providerBudgets: { ...(s.settings.providerBudgets ?? {}), [providerId]: v },
            } }))}
            onAccountBudget={(accountId, v) => setState(s => ({ ...s, settings: {
              ...s.settings, accountBudgets: { ...(s.settings.accountBudgets ?? {}), [accountId]: v },
            } }))}
            onBudget={(v) => setState(s => ({ ...s, settings: { ...s.settings, monthlyBudget: v } }))}
            onPriceChange={(providerId, price) => setState(s => ({ ...s, settings: {
              ...s.settings, unitPrices: { ...s.settings.unitPrices, [providerId]: price },
            } }))}
            onAddUsage={() => setUsageOpen(true)}
            onDeleteUsage={(ids) => setState(s => ({ ...s, usage: s.usage.filter(u => !ids.includes(u.id)) }))}
            onImport={(events) => {
              setState(s => ({ ...s, usage: [
                ...s.usage,
                ...events.map(e => ({ ...e, id: uid('u') })),
              ] }))
              notify(t('已导入 {n} 条用量记录', { n: events.length }))
            }}
          />}

          {tab === 'voice' && <div className="set-content set-content-page">
            <SettingsSection title="语音配置" desc="朗读音色、方言、语速与声音克隆 · 所有配置仅保存在此设备" icon={Volume2} tone="blue">
              <div style={{ padding: '4px 2px 2px' }}><VoiceSettings notify={notify} accounts={state.accounts} sessionPwd={sessionPwd} onUnlock={setSessionPwd} serviceController={isPhone ? undefined : serviceController} /></div>
            </SettingsSection>
          </div>}

          </Suspense>
        </div>
      </main>

      {/* 设置中心：Claude 风为居中模态弹窗，其他风格仍可经 tab 打开 */}
      {settingsOpen && (() => {
        const node = <SettingsView
          isPhone={isPhone}
          onClearData={(cats) => {
            const doClear = () => {
              const hasHistory = cats.includes('history')
              const hasArchived = cats.includes('archived')
              if (hasHistory && hasArchived) clearSessionsData('all')
              else if (hasHistory) clearSessionsData('history')
              else if (hasArchived) clearSessionsData('archived')
              setState(s => ({
                ...s,
                accounts: cats.includes('api') ? [] : s.accounts,
                quotas: cats.includes('api') ? [] : s.quotas,
                usage: cats.includes('usage') ? [] : s.usage,
                checkins: cats.includes('calendar') ? [] : s.checkins,
                benefitMarks: cats.includes('calendar') ? [] : s.benefitMarks,
              }))
              notify('所选数据已清空')
            }
            // 勾选了 API 账户与密钥：必须先完成一次备份（备份门禁通过）才执行清空
            if (cats.includes('api') && state.accounts.length > 0) {
              requestBackup(state.accounts.map(a => a.id), '清空 API 账户与密钥前必须备份', '已备份，确认清空', doClear)
            } else doClear()
          }}
          state={state}
          onChange={(patch) => setState(s => updateSettings(s, patch))}
          notify={notify}
          auditEntries={state.audit ?? []}
          onClearAudit={() => { setState(s => ({ ...s, audit: [] })); notify('审计日志已清空') }}
          onRestoreSnapshot={restoreCloudSnapshot}
          onImportBackup={(imported) => {
            try { localStorage.setItem('acm.state.pre-import-backup', JSON.stringify(state)) } catch { /* 存不下就忽略，不阻断导入 */ }
            // 网关令牌是本机凭据、界面语言是本机偏好：导入备份不覆盖本机的这两项
            setState({ ...imported, settings: { ...imported.settings, gatewayToken: state.settings.gatewayToken, language: state.settings.language } })
            setSessionPwd('')
            audit('导入完整备份', `账户 ${imported.accounts.length} 个`)
            notify('备份已导入并覆盖当前数据；保险箱已锁定，请用备份来源的主密码重新解锁')
          }}
          onOpenVault={() => setVaultOpen(true)}
          onChangePassword={async (oldPwd, newPwd) => {
            const keyAccounts = state.accounts.filter(a => a.encryptedKey)
            const ciphers = keyAccounts.map(a => a.encryptedKey!)
            const renewed = await changeMasterPassword(oldPwd, newPwd, ciphers)
            renewed.forEach((cipher, i) => {
              setState(s => ({ ...s, accounts: s.accounts.map(a => a.id === keyAccounts[i].id ? { ...a, encryptedKey: cipher } : a) }))
            })
            if (state.settings.unlockMethod === 'biometric') { saveBiometricPassword(newPwd); void bindVaultPasswordNative(newPwd) }
            setSessionPwd(newPwd)
            audit('修改主密码')
          }}
          onResetVault={() => {
            clearBiometricPassword()
            void unbindVaultPasswordNative()
            resetVault()
            setSessionPwd('')
            setState(s => ({
              ...s,
              accounts: s.accounts.map(a => ({ ...a, encryptedKey: undefined, keyFingerprint: undefined })),
              settings: { ...s.settings, vaultInitialized: false, unlockMethod: 'password' },
            }))
            notify('保险箱已重置')
          }}
          onBioAvailable={bioAvailableGlobal}
          onBioUnlock={() => void handleBioUnlock()}
          bioLabel={bioLabel}
          sessionPwd={sessionPwd}
          onCheckUpdate={() => setUpdateOpen(true)}
          onClear={() => {
            requestBackup(state.accounts.map(a => a.id), '清空前必须备份', '确认清空', () => {
              void (async () => {
                const bioOk = await biometricAuth(t('验证身份以清空全部业务数据'))
                if (!bioOk) {
                  const unlocked = !!(sessionPwd || getBiometricPassword())
                  if (!unlocked) { notify('请先解锁保险箱或在支持生物识别的设备上验证，未执行清空'); return }
                }
                scheduleUndo(stateRef.current, '全部数据已清空')
                setState(s => clearAllData(s))
                clearSessionsData('all')
                notify('全部数据已清空（业务数据 5 秒内可撤回；聊天记录已清空）')
              })()
            })
          }}
          cloudUser={cloudUser}
          syncing={syncing}
          syncError={syncError}
          lastSyncAt={lastSyncAt}
          onLogin={() => setLoginOpen(true)}
          onLogout={handleCloudLogout}
          onSync={() => void pullCloud()}
          onAltSync={() => void runAltSync(true)}
          altSyncing={altSyncing}
          altStatus={altStatus}
        />
        return (
          <div className="set-modal-backdrop" onClick={() => setSettingsOpen(false)}>
            <div className="set-modal" onClick={e => e.stopPropagation()}>
              <div className="set-modal-head">
                <h2>{t('设置')}</h2>
                <button className="icon-btn" onClick={() => setSettingsOpen(false)} title={t('关闭')}><X size={18} /></button>
              </div>
              <div className="set-modal-body">{node}</div>
            </div>
          </div>
        )
      })()}

      {/* 移动端底部导航：仅当设置「底部菜单栏（手机端）」开启时显示（缺省关闭，页面切换用左上角抽屉） */}
      {state.settings.showBottomNav && <nav className="bottom-nav">
        {bottomTabs.map(id => {
          const tabDef = tabs.find(x => x.id === id)!
          const Icon = tabDef.icon
          return (
            <button key={tabDef.id} className={`bottom-nav-item ${tab === tabDef.id ? 'active' : ''} ${tabDef.id === 'ai' ? 'center' : ''}`} onClick={() => openTab(tabDef.id)}>
              <Icon size={20} />
              <span>{t(shortLabel[tabDef.id])}</span>
            </button>
          )
        })}
      </nav>}

      {addOpen && <PlatformPickerModal
        onClose={() => setAddOpen(false)}
        onPick={(pid) => {
          // 本地服务账户：开关关闭时弹窗不探测服务，需先打开弹窗内/设置页的服务开关（开关即权威）
          setAddOpen(false); setFormProviderId(pid)
        }}
      />}
      {pasteOpen && <SmartPasteModal
        onClose={() => setPasteOpen(false)}
        onConfirm={(pid, key) => { setPasteOpen(false); setPasteSecret(key); setFormProviderId(pid) }}
      />}
      {formProviderId && isLocalProvider(formProviderId) && <LocalAccountFormModal
        provider={PROVIDER_MAP[formProviderId]} sessionPwd={sessionPwd}
        serviceController={serviceController}
        onStartService={async (key) => {
          // 经服务控制器启动：同步把设置开关对齐为开（含内存互斥处理），
          // 避免弹窗里启动了服务、设置页与本地图像/视频页的开关却仍显示关闭
          if (!serviceController.enabled(key)) {
            await serviceController.toggle(key)
            return { ok: true, message: '' }
          }
          // 开关已开但进程没跑（状态脱节）：直接拉起进程，成功后派发事件让设置页徽标同步（v0.1.428 ⑤）
          const r = await startLocalService(key)
          if (r.ok) notifyLocalServiceChanged(key, true)
          return r
        }}
        onClose={() => { setFormProviderId(null); setAddOpen(true) }}
        onSave={(account, pwd) => {
          setState(s => ({ ...s, accounts: [{ ...account }, ...s.accounts] }))
          if (pwd && !sessionPwd) setSessionPwd(pwd)
          setFormProviderId(null); setAddOpen(true)
          notify(t('已添加本地模型「{label}」，可继续添加或关闭选择平台', { label: account.label }))
        }}
        notify={notify}
      />}
      {formProviderId && !isLocalProvider(formProviderId) && <AccountFormModal
        provider={PROVIDER_MAP[formProviderId]} sessionPwd={sessionPwd}
        initialSecret={pasteSecret || undefined}
        groupSuggestions={Array.from(new Set(state.accounts.map(a => a.group).filter((g): g is string => !!g))).sort()}
        onClose={() => { setFormProviderId(null); setPasteSecret(''); setAddOpen(true) }}
        onSave={async (data) => {
          setState(s => ({
            ...s,
            accounts: [{ ...data.account }, ...s.accounts],
            quotas: data.quota ? [...s.quotas, data.quota] : s.quotas,
          }))
          if (data.pwd && !sessionPwd) setSessionPwd(data.pwd)
          // 语音配置(APP)：解密 Key 并同步到语音配置模块，让「第三方语音服务配置」立即显示已配置
          if (data.account.providerId === 'voice-config' && data.account.encryptedKey && data.account.voiceProvider) {
            try {
              const plain = await decryptSecret(data.account.encryptedKey, data.pwd)
              saveTtsConfig({ provider: data.account.voiceProvider as import('./core/voice-download').TtsProviderConfig['provider'], endpoint: '', mode: 'direct', apiKey: plain })
              if (data.pwd) setVoiceSessionPwd(data.pwd)
              notify(t('已添加「{label}」，并同步到语音配置模块', { label: data.account.label }))
            } catch {
              notify(t('已添加「{label}」，但同步语音配置失败，请在语音配置页手动填写', { label: data.account.label }))
            }
          } else {
            notify(t('已添加「{label}」，已置顶到 API Key 管理列表', { label: data.account.label }))
          }
          setFormProviderId(null); setPasteSecret(''); setAddOpen(true)
        }}
      />}
      {vaultOpen && <VaultModal
        initialized={state.settings.vaultInitialized}
        currentPwd={sessionPwd || getBiometricPassword() || ''}
        onClose={() => setVaultOpen(false)} notify={notify}
        onInit={async (pwd) => {
          await initVault(pwd)
          if (state.settings.unlockMethod === 'biometric') { saveBiometricPassword(pwd); void bindVaultPasswordNative(pwd) }
          setState(s => ({ ...s, settings: { ...s.settings, vaultInitialized: true } }))
          setSessionPwd(pwd)
          notify('保险箱已创建')
        }}
      />}
      {quotaTarget && (() => {
        const acc = state.accounts.find(a => a.id === quotaTarget)
        if (!acc) return null
        const existing = latestQuota(state.quotas, quotaTarget)
        return <QuotaModal
          account={acc} provider={PROVIDER_MAP[acc.providerId]} existing={existing}
          defaultUnit={state.settings.defaultUnit}
          onClose={() => setQuotaTarget(null)}
          onSave={(q) => { setState(s => upsertQuota(s, { accountId: quotaTarget, ...q })); setQuotaTarget(null); notify('额度已更新') }}
        />
      })()}
      {usageOpen && <UsageModal
        accounts={state.accounts} projectSuggestions={projectSuggestions(state)} onClose={() => setUsageOpen(false)}
        onSave={(e) => { setState(s => addUsageEvent(s, e)); setUsageOpen(false); notify('用量记录已添加') }}
      />}
      {importData && <ImportModal
        incoming={importData} current={state} onClose={() => setImportData(null)}
        onImport={(mode) => {
          const before = stateRef.current
          if (mode === 'replace') {
            setState(importData)
            notify(t('已覆盖导入 {n} 个账户', { n: importData.accounts.length }))
          } else {
            setState(s => mergeState(s, importData))
            notify(t('已合并，新增 {n} 个账户', { n: importData.accounts.filter(a => !before.accounts.some(x => x.id === a.id)).length }))
          }
          setImportData(null)
        }}
      />}
      {csvPreview && <CsvImportModal
        preview={csvPreview} current={state} onClose={() => setCsvPreview(null)}
        onImport={(counts) => {
          const p = csvPreview
          setState(s => {
            if (p.kind === 'accounts') {
              const existing = new Set(s.accounts.map(a => `${a.providerId}|${a.label}`))
              const fresh = p.accounts.accounts.filter(a => !existing.has(`${a.providerId}|${a.label}`))
              return { ...s, accounts: [...s.accounts, ...fresh] }
            }
            if (p.kind === 'quotas') return { ...s, quotas: [...s.quotas, ...p.quotas.quotas] }
            return { ...s, usage: [...s.usage, ...p.events.map(e => ({ ...e, id: uid('u') }))] }
          })
          notify(t('已导入 {n} 条{kind}记录', { n: counts, kind: t(p.kind === 'accounts' ? '账户' : p.kind === 'quotas' ? '额度' : '用量') }))
          setCsvPreview(null)
        }}
      />}
      {servicePreview && <ServiceImportModal
        entries={servicePreview} current={state} sessionPwd={sessionPwd}
        onClose={() => setServicePreview(null)}
        onImport={(accounts, quotas, pwd) => {
          setState(s => {
            const existing = new Set(s.accounts.map(a => `${a.providerId}|${a.label}`))
            const fresh = accounts.filter(a => !existing.has(`${a.providerId}|${a.label}`))
            const freshIds = new Set(fresh.map(a => a.id))
            return {
              ...s,
              accounts: [...s.accounts, ...fresh],
              quotas: [...s.quotas, ...quotas.filter(q => freshIds.has(q.accountId))],
            }
          })
          if (pwd) setSessionPwd(pwd)
          setServicePreview(null)
          notify(t('已安全导入 {n} 个服务（密钥已加密）', { n: accounts.length }))
        }}
      />}
      {exportOpen && <ExportModal state={state} onClose={() => setExportOpen(false)} onExport={(fmt, dir) => { void doExport(fmt, dir); setExportOpen(false) }} />}
      {backupGate && <DeleteBackupModal
        state={state}
        accountIds={backupGate.ids}
        unlockedPwd={sessionPwd || getBiometricPassword() || undefined}
        title={backupGate.title}
        confirmLabel={backupGate.confirmLabel}
        backupOnly={backupGate.backupOnly}
        notify={notify}
        onClose={() => setBackupGate(null)}
        onDone={() => {
          // 备份完成即更新基准时间（全平台通用，CSV/备忘录/云备份都算）
          setState(prev => updateSettings(prev, { lastExportAt: new Date().toISOString() }))
          const after = backupGate.after; setBackupGate(null); after()
        }}
      />}
      {loginOpen && <CloudLoginModal onClose={() => setLoginOpen(false)} onSuccess={handleCloudLogin} />}
      {paletteOpen && <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
      {updateOpen && <UpdateModal onClose={() => setUpdateOpen(false)} notify={notify} />}
      {undo && <div className="undo-bar">
        <span><Check size={15} /> {undo.label}</span>
        <button onClick={doUndo}><RotateCcw size={14} /> {t('撤回')}</button>
        <i className="undo-countdown" />
      </div>}
      {backupDue && !undo && <div className="backup-due-bar">
        <AlertTriangle size={15} />
        <span>{t('已超过 {days} 天未备份数据。', { days: state.settings.backupReminderDays ?? 7 })}</span>
        <button onClick={() => { void doExport('json') }}>{t('立即导出备份')}</button>
        <button onClick={() => { if (cloudUser) { void pushCloud().then(ok => { if (ok) setBackupDue(false) }) } else setLoginOpen(true) }}>{cloudUser ? t('备份到云端') : t('登录后云备份')}</button>
        <button onClick={() => { try { localStorage.setItem('acm.backup.snoozeUntil', String(Date.now() + 3 * 86400000)) } catch { /* 忽略 */ } setBackupDue(false) }}>{t('3 天后再提醒')}</button>
        <button className="backup-due-close" onClick={() => setBackupDue(false)} title={t('本次忽略')}><X size={14} /></button>
      </div>}
      {toast && !undo && <div className={toast.kind === 'err' ? 'toast err' : 'toast'}>{toast.kind === 'err' ? <AlertTriangle size={15} /> : <Check size={15} />} {t(toast.msg)}</div>}
    </div>
  )
}

/** 同步时间相对文案：刚刚 / N 分钟前 / N 小时前 / 日期 */
function syncTimeText(iso: string | null): string {
  if (!iso) return t('尚未同步')
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return t('尚未同步')
  const diff = Date.now() - ts
  if (diff < 60_000) return t('刚刚')
  if (diff < 3_600_000) return t('{n} 分钟前', { n: Math.max(1, Math.floor(diff / 60_000)) })
  if (diff < 86_400_000) return t('{n} 小时前', { n: Math.floor(diff / 3_600_000) })
  return new Date(iso).toLocaleDateString(locale())
}

function StatCard({ icon, color, label, value, hint }: { icon: React.ReactNode; color: string; label: string; value: string; hint: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    blue: { bg: 'var(--blue-soft)', fg: 'var(--blue)' },
    amber: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
    red: { bg: 'var(--red-soft)', fg: 'var(--red)' },
    green: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  }
  const c = map[color]
  return (
    <div className="stat-card">
      <div className="stat-top">
        <div className="stat-icon" style={{ background: c.bg, color: c.fg }}>{icon}</div>
        <span className="stat-label">{t(label)}</span>
      </div>
      <div className="stat-value"><span className="me-num" key={value}>{value}</span></div>
      <div className="stat-hint">{t(hint)}</div>
    </div>
  )
}

function ProviderLogo({ provider, size = 38 }: { provider: ProviderDefinition; size?: number }) {
  // 全局平台图标：优先用打包的官网图标（public/logos/<id>.png），加载失败回退彩色分类图标
  const [err, setErr] = useState(false)
  if (!err) {
    return (
      <div className="ac-logo ac-logo-img" style={{ width: size, height: size }}>
        <img src={`logos/${provider.id}.png`} alt={provider.name} onError={() => setErr(true)} />
      </div>
    )
  }
  const Icon = CATEGORY_ICON[provider.category]
  return (
    <div className="ac-logo" style={{ background: provider.color, width: size, height: size }}>
      <Icon size={size * 0.45} />
    </div>
  )
}

/** 链接地址列的图标按钮：点击直达该平台官方「创建 / 管理 Key」页面（地址自动保持最新，见 core/keyUrls） */
function KeyPageButton({ provider, notify, accountUrl }: { provider: ProviderDefinition; notify: (m: string) => void; accountUrl?: string }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const h = () => setTick(t => t + 1)
    window.addEventListener(KEYURLS_EVENT, h)
    return () => window.removeEventListener(KEYURLS_EVENT, h)
  }, [])
  const isCustom = provider.id === 'custom-endpoint'
  const url = isCustom ? (accountUrl ?? '') : getKeyPageUrl(provider)
  const isLocal = provider.id.startsWith('local-') || isCustom
  return (
    <button className="icon-btn key-page-btn" title={isCustom ? t('打开服务地址：{url}', { url }) : isLocal ? t('打开官网：{url}', { url }) : t('前往官方创建 / 管理 Key：{url}', { url })}
      onClick={async () => {
        const ok = await openExternal(url)
        if (!ok) notify(t('打开失败，请手动访问：{url}', { url }))
        else if (!isDesktopApp()) notify(isLocal ? t('已在新标签页打开官网') : t('已在新标签页打开官方 Key 页面'))
      }}>
      {isLocal ? <Globe size={15} /> : <KeyRound size={15} />}
    </button>
  )
}

/** 官方外链按钮：桌面端用系统浏览器打开，Web 端开新标签；失败给出可复制的链接提示 */
function OutLink({ url, label, className = 'btn sm ghost', title, notify, style }: {
  url: string; label: React.ReactNode; className?: string; title?: string;
  notify: (m: string) => void; style?: React.CSSProperties
}) {
  return (
    <button className={className} style={{ ...style, display: 'inline-flex', alignItems: 'center', gap: 5 }} title={title}
      onClick={async () => {
        const ok = await openExternal(url)
        if (!ok) notify(t('{reason}，请手动复制：{url}', { reason: isDesktopApp() ? t('系统浏览器打开失败') : t('弹窗被拦截'), url }))
        else if (!isDesktopApp()) notify(t('已在新标签页打开官方页面，请本人操作'))
      }}>
      {label} <ExternalLink size={12} />
    </button>
  )
}

/** 智能打开工具：桌面端默认优先唤醒本机客户端；forceWeb 时强制打开官网（用于「官方下载」） */
function ToolLink({ tool, label, className = 'btn sm ghost', title, notify, icon: Icon = ExternalLink, forceWeb = false }: {
  tool: AgentTool; label: React.ReactNode; className?: string; title?: string;
  notify: (m: string) => void; icon?: typeof ExternalLink; forceWeb?: boolean
}) {
  const url = tool.checkinUrl ?? tool.downloadUrl
  return (
    <button className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title={title ?? t('{name} 官方站点', { name: tool.name })}
      onClick={async () => {
        if (forceWeb) {
          const ok = await openExternal(tool.downloadUrl)
          if (!ok) notify(t('打开失败，请手动访问：{url}', { url: tool.downloadUrl }))
          return
        }
        const { opened, via } = await openTool(tool.localApp, url)
        if (!opened) notify(t('打开失败，请手动访问官方站点：{url}', { url }))
        else if (via === 'local') notify(t('已唤醒本机「{name}」客户端', { name: tool.name }))
        else if (!isDesktopApp()) notify(t('已在新标签页打开官方页面，请本人操作'))
      }}>
      {label} <Icon size={12} />
    </button>
  )
}

/** 工具卡片（模块级 memo：搜索/筛选时避免整墙卸载重挂载） */
const AgentToolCard = memo(function AgentToolCard({ t: tool, done, hasLocal, notify, onToggle }: {
  t: AgentTool; done: boolean; hasLocal: boolean; notify: (m: string) => void; onToggle: (id: string) => void
}) {
  return (
    <article className="agent-card">
      <div className="agent-card-top">
        <div className="agent-logo" style={{ background: `${tool.color}14` }}>
          <img src={tool.icon} alt={t('{name} 官方图标', { name: tool.name })} width={36} height={36} loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        </div>
        <div className="agent-card-title">
          <div className="agent-name">{tool.name}</div>
          <div className="agent-name-en">{tool.nameEn}</div>
        </div>
        {tool.canCheckin && <span className={`tag ${done ? 'green' : 'amber'}`} style={{ flex: 'none' }}>
          {done ? <><Check size={11} /> {t('已签到')}</> : t('可签到')}
        </span>}
      </div>
      <div className="agent-card-badges">
        <span className="agent-chip" style={{ color: tool.color, background: `${tool.color}12` }}>{t(tool.category)}</span>
        <span className="agent-chip muted">{tool.region === 'cn' ? t('国内') : t('海外')}</span>
        {hasLocal && <span className="agent-chip local"><Monitor size={10} /> {t('本机已装')}</span>}
      </div>
      <p className="agent-desc" title={tool.desc}>{tool.desc}</p>
      <div className="agent-card-meta">
        <span className="agent-usage" title={t('按公开月访问量/月活估算，由高到低排序')}><TrendingUp size={12} /> {tool.usageLabel}</span>
        <span className="agent-platforms">{tool.platforms.map(p => <i key={p} title={p}>{p === '浏览器插件' ? t('插件') : p}</i>)}</span>
      </div>
      <div className={`agent-tip ${tool.canCheckin ? 'checkin' : 'benefit'}`}
        title={tool.canCheckin ? tool.checkinTip : tool.benefitTip}>
        <span className="agent-tip-label">{tool.canCheckin ? t('签到规则') : t('福利说明')}</span>
        {tool.canCheckin ? tool.checkinTip : tool.benefitTip}
      </div>
      <div className="agent-card-actions">
        <ToolLink tool={tool} label={hasLocal ? t('直达客户端') : t('官方网站')} className={`btn sm ${hasLocal ? 'primary' : 'ghost'}`}
          title={hasLocal ? t('唤醒本机 {name} 客户端（未安装则打开官网）', { name: tool.name }) : t('打开 {name} 官方站点', { name: tool.name })} notify={notify} />
        {/* 官方下载直达：始终打开官网下载页，不唤醒本地客户端 */}
        <ToolLink tool={tool} label={t('官方下载')} className="btn sm ghost" icon={Download} forceWeb
          title={t('打开 {name} 官方下载/主页', { name: tool.name })} notify={notify} />
        {tool.canCheckin && <button className="btn sm" onClick={() => onToggle(tool.id)} title={done ? t('标记为未签到') : t('标记今日已签到')}>
          {done ? t('撤销标记') : t('标记完成')}
        </button>}
      </div>
    </article>
  )
})

/** 分页工具条 */
function AgentPager({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter(n =>
    n === 1 || n === pages || Math.abs(n - page) <= 1)
  return (
    <div className="agent-pager">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>{t('上一页')}</button>
      {nums.map((n, i) => (
        <span key={n}>
          {i > 0 && n - nums[i - 1] > 1 && <em>…</em>}
          <button className={n === page ? 'active' : ''} onClick={() => onChange(n)}>{n}</button>
        </span>
      ))}
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>{t('下一页')}</button>
      <span className="agent-pager-info">{page} / {pages}</span>
    </div>
  )
}

function DashboardView({ views, onAdd, onRemove, onRemoveMany, onEditQuota, notify, onRefresh, refreshing }: {
  views: AccountView[]; onAdd: () => void; onRemove: (id: string) => void; onRemoveMany: (ids: string[]) => void; onEditQuota: (id: string) => void;
  notify: (m: string) => void; onRefresh: () => void; refreshing: boolean
}) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const PAGE_SIZE = 6
  // 筛选机制（v0.1.241）：搜索名称/平台、按额度状态、按分组、排序
  const [query, setQuery] = useState('')
  const [statusF, setStatusF] = useState<'all' | 'has' | 'none' | 'low'>('all')
  const [groupF, setGroupF] = useState('all')
  const [sortBy, setSortBy] = useState<'default' | 'remainDesc' | 'remainAsc' | 'percentDesc' | 'name'>('default')
  const dashGroups = Array.from(new Set(views.map(v => v.account.group).filter((g): g is string => !!g))).sort()
  const filtering = query.trim() !== '' || statusF !== 'all' || groupF !== 'all'
  const filtered = (() => {
    const q = query.trim().toLowerCase()
    const list = views.filter(v => {
      if (q && !`${v.account.label} ${v.provider.name}`.toLowerCase().includes(q)) return false
      if (statusF === 'has' && !v.quota) return false
      if (statusF === 'none' && v.quota) return false
      if (statusF === 'low' && !(v.quota && v.usagePercent >= 70)) return false
      if (groupF === '__none' && v.account.group) return false
      if (groupF !== 'all' && groupF !== '__none' && v.account.group !== groupF) return false
      return true
    })
    const remain = (v: AccountView) => (v.quota ? v.quota.total - v.quota.used : -1)
    switch (sortBy) {
      case 'remainDesc': list.sort((a, b) => remain(b) - remain(a)); break
      case 'remainAsc': list.sort((a, b) => remain(a) - remain(b)); break
      case 'percentDesc': list.sort((a, b) => b.usagePercent - a.usagePercent); break
      case 'name': list.sort((a, b) => a.account.label.localeCompare(b.account.label, 'zh')); break
      default: break
    }
    return list
  })()
  useEffect(() => { setPage(1) }, [views.length, query, statusF, groupF, sortBy])
  const cur = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)))
  const pageViews = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  if (views.length === 0) {
    return (
      <div className="empty me-stack">
        <div className="stat-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', margin: '0 auto' }}><Wallet size={22} /></div>
        <h3 className="me-text-layer">{t('还没有账户')}</h3>
        <p className="me-text-layer">{t('添加一个你自己的 AI 平台账户，开始统一管理积分与额度')}</p>
        <button className="btn primary" onClick={onAdd}><Plus size={15} /> {t('添加第一个账户')}</button>
      </div>
    )
  }
  return (
    <>
      <div className="section-head">
        <h2>{t('账户额度')} <span className="hint">{filtering ? t('{f} / {n} 个账户', { f: filtered.length, n: views.length }) : t('{n} 个账户', { n: views.length })}</span></h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <GlobalRefreshButton refreshing={refreshing} onRefresh={onRefresh} />
          <button className="btn sm" onClick={onAdd}><Plus size={14} /> {t('添加')}</button>
        </div>
      </div>
      <div className="dash-filters">
        <label className="dash-search">
          <Search size={14} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('搜索账户名 / 平台…')} />
          {query && <button className="dash-search-clear" onClick={() => setQuery('')} title={t('清除搜索')}><X size={13} /></button>}
        </label>
        <select className="select dash-filter-select" value={statusF} onChange={e => setStatusF(e.target.value as typeof statusF)} title={t('按额度状态筛选')}>
          <option value="all">{t('全部状态')}</option>
          <option value="has">{t('已录入额度')}</option>
          <option value="none">{t('未录入额度')}</option>
          <option value="low">{t('额度告急（已用 ≥70%）')}</option>
        </select>
        <select className="select dash-filter-select" value={groupF} onChange={e => setGroupF(e.target.value)} title={t('按分组筛选')}>
          <option value="all">{t('全部分组')}</option>
          {dashGroups.map(g => <option key={g} value={g}>{g}</option>)}
          <option value="__none">{t('未分组')}</option>
        </select>
        <select className="select dash-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} title={t('排序方式')}>
          <option value="default">{t('默认排序')}</option>
          <option value="remainDesc">{t('剩余：高 → 低')}</option>
          <option value="remainAsc">{t('剩余：低 → 高')}</option>
          <option value="percentDesc">{t('已用占比：高 → 低')}</option>
          <option value="name">{t('名称 A–Z')}</option>
        </select>
        {filtering && <button className="btn sm ghost" onClick={() => { setQuery(''); setStatusF('all'); setGroupF('all') }}>{t('清除筛选')}</button>}
      </div>
      {filtered.length === 0 && (
        <div className="empty" style={{ padding: '28px 0' }}>
          <p>{t('当前筛选下没有账户')}</p>
          <button className="btn sm" onClick={() => { setQuery(''); setStatusF('all'); setGroupF('all') }}>{t('清除筛选')}</button>
        </div>
      )}
      <SelectionBar
        selectedCount={selected.size} totalOnPage={pageViews.length}
        allSelected={pageViews.length > 0 && pageViews.every(v => selected.has(v.account.id))}
        onToggleAll={() => {
          const next = new Set(selected)
          const allOn = pageViews.every(v => next.has(v.account.id))
          if (allOn) pageViews.forEach(v => next.delete(v.account.id)); else pageViews.forEach(v => next.add(v.account.id))
          setSelected(next)
        }}
        onClear={() => setSelected(new Set())}
        actions={<button className="btn sm danger" onClick={() => {
          onRemoveMany(Array.from(selected))
          setSelected(new Set())
        }}><Trash2 size={13} /> {t('批量删除')}</button>}
      />
      <div className="account-grid">
        {pageViews.map((v) => {
          const percent = v.usagePercent
          const color = percent >= 90 ? 'var(--red)' : percent >= 70 ? 'var(--amber)' : 'var(--green)'
          const hasQuota = !!v.quota
          return (
            <div className={`account-card selectable ${selected.has(v.account.id) ? 'selected' : ''}`} key={v.account.id}>
              <input className="item-check" type="checkbox" title={t('选择此账户')}
                checked={selected.has(v.account.id)} onChange={e => {
                  const next = new Set(selected)
                  if (e.target.checked) next.add(v.account.id); else next.delete(v.account.id)
                  setSelected(next)
                }} />
              <div className="ac-head">
                <ProviderLogo provider={v.provider} />
                <div style={{ minWidth: 0 }}>
                  <div className="ac-title">{v.account.label}</div>
                  <div className="ac-mode">
                    <span>{v.provider.name}</span>
                    <span style={{ color: 'var(--border-strong)' }}>·</span>
                    <span>{t(MODE_LABEL[v.account.mode])}</span>
                  </div>
                </div>
                <div className="ac-menu">
                  <div className="dots">
                    <button className="icon-btn" title={t('录入/更新额度')} onClick={() => onEditQuota(v.account.id)}><RefreshCw size={14} /></button>
                    <HoldToConfirm title={t('移除账户')} onConfirm={() => onRemove(v.account.id)} />
                  </div>
                </div>
              </div>
              {hasQuota ? (
                <>
                  <div className="ac-quota">
                    <div className="ac-quota-num">
                      <span className="me-num" key={`q-${v.account.id}-${v.quota!.used}`}>{(v.quota!.total - v.quota!.used).toLocaleString()}</span>
                      <small>{t(UNIT_LABEL[v.quota!.unit])}</small>
                    </div>
                    <div className="ac-quota-label">{t('剩余 / 共 {total}', { total: v.quota!.total.toLocaleString() })}</div>
                  </div>
                  <div className="progress"><div style={{ width: `${Math.max(percent, 2)}%`, background: color }} /></div>
                  <div className="ac-foot">
                    <span className={`tag ${percent >= 90 ? 'red' : percent >= 70 ? 'amber' : 'green'}`}>
                      {t('已用 {percent}%', { percent })}
                    </span>
                    {v.daysUntilReset !== undefined
                      ? <span><Clock size={11} style={{ verticalAlign: '-1px' }} /> {v.daysUntilReset > 0 ? t('{days} 天后重置', { days: v.daysUntilReset }) : t('即将重置')}</span>
                      : <span style={{ color: 'var(--text-3)' }}>{t('更新日期：{date}', { date: v.quota!.capturedAt.slice(0, 10) })}</span>}
                  </div>
                  {v.forecast && v.forecast.level !== 'insufficient' && (
                    <div className={`forecast ${v.forecast.level}`} title={t('依据：{basis} · {samples} 个样本{exhaust}', { basis: v.forecast.basis === 'quota-history' ? t('额度历史') : t('用量记录'), samples: v.forecast.samples, exhaust: v.forecast.exhaustDate ? t(' · 预计 {date}', { date: v.forecast.exhaustDate }) : '' })}>
                      <TrendingUp size={13} />
                      <span>{forecastText(v.forecast)}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ padding: '10px 0 14px', fontSize: 13, color: 'var(--text-3)' }}>{t('尚未录入额度')}</div>
                  <div className="ac-foot">
                    <button className="btn sm" onClick={() => onEditQuota(v.account.id)}><RefreshCw size={13} /> {t('录入额度')}</button>
                    <OutLink url={v.provider.usageUrl} label={t('官方用量页')} notify={notify} style={{ color: 'var(--primary)' }} />
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      <Pager total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
    </>
  )
}

/** AI 工具目录：地区 → 签到 → 功能 → 平台 多级筛选 + 使用量排序 + 每页 3 项分页 */
function AgentToolsView({ checkins, notify, onToggle, catalogNews, onCatalogNewsAck, onBack, onRefresh }: {
  checkins: AppState['checkins']; notify: (m: string) => void;
  onToggle: (pid: string, aid?: string) => void
  catalogNews?: AgentTool[]; onCatalogNewsAck?: () => void
  /** v0.1.331：大全已并入工坊，页面顶部提供返回工坊入口 */
  onBack?: () => void
  onRefresh?: () => void
}) {
  const today = todayISO()
  const initial = useMemo(() => currentCatalog(), [])
  const [tools, setTools] = useState<AgentTool[]>(initial.tools)
  const [updatedAt, setUpdatedAt] = useState<string | null>(initial.updatedAt)
  const [syncing, setSyncing] = useState(false)
  // 筛选改为多选集合（空集 = 全部）：四组默认收起为按钮，点开下拉多选（v0.1.249）
  const [regionSel, setRegionSel] = useState<Set<string>>(new Set())
  const [signSel, setSignSel] = useState<Set<string>>(new Set())
  const [catSel, setCatSel] = useState<Set<string>>(new Set())
  const [platSel, setPlatSel] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = useState<'region' | 'sign' | 'cat' | 'plat' | null>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!filterOpen) return
    const onDown = (e: MouseEvent) => {
      if (filterBarRef.current && !filterBarRef.current.contains(e.target as Node)) setFilterOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [filterOpen])
  const toggleSel = (sel: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const n = new Set(sel)
    if (n.has(v)) n.delete(v); else n.add(v)
    setter(n)
    setPage(1)
  }
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const PAGE_SIZE = 3

  // 实时抓取：挂载后后台拉取最新目录（15 分钟内有缓存则不重复），成功则覆盖内置快照
  useEffect(() => {
    let alive = true
    void fetchCatalog(false).then(r => {
      if (alive && r.ok && r.snapshot) {
        setTools(r.snapshot.tools)
        setUpdatedAt(r.snapshot.updatedAt)
      }
    })
    return () => { alive = false }
  }, [])

  const refreshCatalog = async () => {
    setSyncing(true)
    try {
      const r = await fetchCatalog(true)
      if (r.ok && r.snapshot) {
        setTools(r.snapshot.tools)
        setUpdatedAt(r.snapshot.updatedAt)
        notify(t('目录已更新 · {n} 款工具', { n: r.snapshot.tools.length }))
      } else notify(t('更新失败（{err}），当前显示本地数据', { err: r.error ?? t('网络不可用') }))
    } finally { setSyncing(false) }
  }

  // 桌面端：启动时并行检测本机已安装的客户端
  useEffect(() => {
    if (!isDesktopApp()) return
    let alive = true
    const withLocal = AGENT_TOOLS.filter(t => t.localApp)
    Promise.all(withLocal.map(async t => {
      const ok = await isAppInstalled(t.localApp!.bundleIds, t.localApp!.exeNames)
      return ok && alive ? t.id : null
    })).then(ids => {
      if (alive) setInstalled(new Set(ids.filter(Boolean) as string[]))
    }).catch(() => { /* 检测失败保持未安装状态 */ })
    return () => { alive = false }
  }, [])

  const doneIds = useMemo(() => new Set(
    checkins.filter(c => c.date === today && c.done).map(c => c.providerId),
  ), [checkins, today])
  const doneCount = tools.filter(t => t.canCheckin && doneIds.has(t.id)).length

  // ---- 签到助手（引导模式）：把待签到排成队列，逐个打开页面→点「已签到」自动推进 ----
  const [guideQueue, setGuideQueue] = useState<string[] | null>(null)
  const [guideSkipped, setGuideSkipped] = useState<string[]>([])
  const pendingTools = useMemo(
    () => tools.filter(t => t.canCheckin && !doneIds.has(t.id)).sort((a, b) => b.usage - a.usage),
    [tools, doneIds],
  )
  const guideCurrent = guideQueue
    ? tools.find(t => t.id === guideQueue.find(id => !doneIds.has(id) && !guideSkipped.includes(id)))
    : undefined
  const guideDone = guideQueue ? guideQueue.filter(id => doneIds.has(id)).length : 0
  const startGuide = () => {
    if (!pendingTools.length) { notify(t('今日待签到已全部完成')); return }
    setGuideSkipped([])
    setGuideQueue(pendingTools.map(t => t.id))
  }
  // 一键全部打开待签到页（桌面/Web）：逐个错峰打开，签完回工具页点卡片上的签到按钮登记
  const openAllCheckins = () => {
    const urls = pendingTools.map(x => x.checkinUrl ?? x.downloadUrl).filter((u): u is string => !!u)
    if (!urls.length) { notify(t('待签到工具暂无可打开的签到页')); return }
    urls.forEach((u, i) => { window.setTimeout(() => { void openExternal(u) }, i * 350) })
    notify(t('正在打开 {n} 个签到页面，挨个领取即可（浏览器若拦截多标签，请允许弹窗后重试）', { n: urls.length }))
  }
  const endGuide = () => { setGuideQueue(null); setGuideSkipped([]) }
  const q = keyword.trim().toLowerCase()

  // 多级筛选：地区 → 签到 → 功能 → 平台 → 关键词；再按使用量由高到低排序
  const filtered = useMemo(() => tools.filter(t =>
    (regionSel.size === 0 || regionSel.has(t.region)) &&
    (signSel.size === 0 || signSel.has(t.canCheckin ? 'yes' : 'no')) &&
    (catSel.size === 0 || catSel.has(t.category)) &&
    (platSel.size === 0 || t.platforms.some(p => platSel.has(p))) &&
    (!q || t.name.toLowerCase().includes(q) || t.nameEn.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)),
  ).sort((a, b) => b.usage - a.usage), [tools, regionSel, signSel, catSel, platSel, q])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // 任一筛选变化时回到第一页
  const setKeywordP = (v: string) => { setKeyword(v); setPage(1) }
  const filterGroups = [
    { key: 'region' as const, label: '地区', sel: regionSel, setter: setRegionSel, options: [{ v: 'cn', label: '🇨🇳 国内' }, { v: 'global', label: '🌍 海外' }] },
    { key: 'sign' as const, label: '签到', sel: signSel, setter: setSignSel, options: [{ v: 'yes', label: '可签到' }, { v: 'no', label: '不可签到' }] },
    { key: 'cat' as const, label: '功能', sel: catSel, setter: setCatSel, options: CATEGORY_TAGS.map(c => ({ v: c, label: c })) },
    { key: 'plat' as const, label: '平台', sel: platSel, setter: setPlatSel, options: PLATFORM_TAGS.map(p => ({ v: p, label: p })) },
  ]
  const anyFilter = regionSel.size + signSel.size + catSel.size + platSel.size > 0
  const clearAllFilters = () => { setRegionSel(new Set()); setSignSel(new Set()); setCatSel(new Set()); setPlatSel(new Set()); setPage(1) }

  const handleToggle = useCallback((id: string) => onToggle(id), [onToggle])
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : t('内置数据')

  return (
    <div className="agent-tools">
      {(onBack || onRefresh) && <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {onBack && <button className="btn sm ghost" onClick={onBack}><ArrowLeft size={14} /> 返回工坊</button>}
        {onRefresh && <button className="btn sm ghost" title="刷新本页" onClick={onRefresh}><RefreshCw size={14} /></button>}
      </div>}
      {catalogNews && catalogNews.length > 0 && <div className="catalog-news-bar">
        <Sparkles size={15} />
        <span>{t('目录上新：{names}{more}，去看看有没有免费额度可领。', { names: catalogNews.slice(0, 3).map(x => x.name).join('、'), more: catalogNews.length > 3 ? t(' 等 {n} 款新工具', { n: catalogNews.length }) : '' })}</span>
        <button onClick={onCatalogNewsAck}>{t('知道了')}</button>
      </div>}
      <div className="checkin-guide">
        {!guideQueue ? (
          <div className="cg-row">
            <div className="cg-info">
              <div className="cg-title"><CalendarCheck2 size={16} /> {t('今日签到助手')}</div>
              <div className="cg-sub">{pendingTools.length > 0
                ? t('还有 {n} 个工具待签到：逐个打开签到页，你点完领取，这边自动跳下一个', { n: pendingTools.length })
                : t('今日可签到的工具已全部完成 🎉')}</div>
            </div>
            {pendingTools.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={startGuide}>{t('开始签到（{n}）', { n: pendingTools.length })}</button>
              {!isNativeApp() && <button className="btn" onClick={openAllCheckins} title={t('把今天待签到的页面一次全部打开，挨个领取')}><ExternalLink size={14} /> {t('全部打开')}</button>}
            </div>}
          </div>
        ) : guideCurrent ? (
          <div className="cg-active">
            <div className="cg-progress-row">
              <span className="cg-progress-label">{t('进度 {done}/{total}', { done: guideDone + guideSkipped.length, total: guideQueue.length })}</span>
              <div className="cg-bar"><i style={{ width: `${((guideDone + guideSkipped.length) / guideQueue.length) * 100}%` }} /></div>
              <button className="btn sm ghost" onClick={endGuide}>{t('结束')}</button>
            </div>
            <div className="cg-current">
              <span className="cg-tool-ic" style={{ background: guideCurrent.color }}>{guideCurrent.name.slice(0, 1)}</span>
              <div className="cg-tool-info">
                <b>{guideCurrent.name}</b>
                <span>{guideCurrent.checkinTip ?? guideCurrent.desc}</span>
              </div>
            </div>
            <div className="cg-actions">
              <button className="btn" onClick={() => { void openExternal(guideCurrent.checkinUrl ?? guideCurrent.downloadUrl) }}><ExternalLink size={14} /> {t('打开签到页')}</button>
              <button className="btn primary" onClick={() => handleToggle(guideCurrent.id)}><Check size={14} /> {t('我已签到')}</button>
              <button className="btn ghost" onClick={() => setGuideSkipped(sk => [...sk, guideCurrent.id])}>{t('跳过')}</button>
            </div>
          </div>
        ) : (
          <div className="cg-row">
            <div className="cg-info">
              <div className="cg-title">{t('🎉 本轮签到完成')}</div>
              <div className="cg-sub">{t('完成 {done} 个{skipped}，明天再来领新额度。', { done: guideDone, skipped: guideSkipped.length ? t('，跳过 {n} 个', { n: guideSkipped.length }) : '' })}</div>
            </div>
            <button className="btn" onClick={endGuide}>{t('关闭')}</button>
          </div>
        )}
      </div>
      <div className="agent-toolbar">
        <div className="agent-search">
          <Search size={15} />
          <input value={keyword} onChange={e => setKeywordP(e.target.value)} placeholder={t('搜索工具名称 / 英文名 / 简介')} />
          {keyword && <button className="icon-btn" onClick={() => setKeywordP('')} title={t('清除')}><X size={13} /></button>}
        </div>
        <div className="agent-toolbar-meta">
          <span className="agent-quick-stat" title={t('已收录工具总数')}><b>{tools.length}</b> {t('款')}</span>
          <span className="agent-quick-stat checkin" title={t('今日已签到 / 可签到')}><b>{doneCount}</b>/{tools.filter(x => x.canCheckin).length} {t('已签')}</span>
        </div>
        <button className="btn sm" onClick={() => void refreshCatalog()} disabled={syncing} title={t('从数据源抓取最新使用量与签到规则')}>
          <RefreshCw size={13} className={syncing ? 'spin' : ''} /> {syncing ? t('更新中') : t('更新数据')}
        </button>
        <span className="agent-sync-time" title={t('目录数据最后更新时间')}>{t('更新于 {label}', { label: updatedAt ? updatedLabel : t('内置数据') })}</span>
      </div>

      {/* 筛选：四组默认收起为一颗按钮，点开下拉多选（与 AI 助手工具菜单同样的呈现方式） */}
      <div className="agent-filter-bar" ref={filterBarRef}>
        {filterGroups.map(g => (
          <button key={g.key} className={`agent-filter-chip ${g.sel.size ? 'active' : ''} ${filterOpen === g.key ? 'open' : ''}`}
            onClick={() => setFilterOpen(filterOpen === g.key ? null : g.key)}>
            {t(g.label)}
            {g.sel.size > 0 && <span className="agent-filter-count">{g.sel.size}</span>}
            <ChevronDown size={13} style={filterOpen === g.key ? { transform: 'rotate(180deg)' } : undefined} />
          </button>
        ))}
        {anyFilter && <button className="agent-filter-clear" onClick={clearAllFilters}>{t('清除筛选')}</button>}
        {filterOpen && (() => {
          const g = filterGroups.find(x => x.key === filterOpen)!
          return (
            <div className="agent-filter-menu">
              <div className="agent-filter-menu-head">
                <span>{t('{label} · 可多选（不选 = 全部）', { label: t(g.label) })}</span>
                {g.sel.size > 0 && <button onClick={() => { g.setter(new Set()); setPage(1) }}>{t('清除本组')}</button>}
              </div>
              <div className="agent-filter-options">
                {g.options.map(o => (
                  <button key={o.v} className={`agent-filter-btn ${g.sel.has(o.v) ? 'active' : ''}`} onClick={() => toggleSel(g.sel, g.setter, o.v)}>
                    {t(o.label)}{g.sel.has(o.v) && <Check size={13} style={{ marginLeft: 4 }} />}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      <div className="agent-result-head">
        <span>{t('共 {n} 款 · 按使用量由高到低', { n: filtered.length })}</span>
        <span>{t('每页 {n} 项', { n: PAGE_SIZE })}</span>
      </div>

      {pageItems.length > 0 ? (
        <>
          <div className="agent-grid">{pageItems.map(t => (
            <AgentToolCard key={t.id} t={t} done={doneIds.has(t.id)} hasLocal={installed.has(t.id)}
              notify={notify} onToggle={handleToggle} />
          ))}</div>
          <AgentPager page={safePage} pages={pages} onChange={setPage} />
        </>
      ) : (
        <div className="agent-empty" style={{ padding: 56 }}>{t('当前分类下暂无工具，换个筛选条件试试')}</div>
      )}
    </div>
  )
}

function KeysView({ state, notify, onOpenVault, onRemoveKeys, onRequestBackup, onQuotaFetched, onUpdateAccount, onImportFile, onImportText, onExport, onUnlocked, initialPwd, bioLabel, onAudit, isPhone, onRefresh, refreshing: globalRefreshing }: {
  state: AppState; notify: (m: string) => void; onOpenVault: () => void; isPhone?: boolean;
  onImportFile: (file?: File) => void; onImportText?: (text: string) => void; onExport: () => void;
  onRemoveKeys: (ids: string[]) => void;
  onRequestBackup: (ids: string[], title: string, confirmLabel: string, after: () => void, backupOnly?: boolean) => void;
  onQuotaFetched: (accountId: string, used: number, total: number | undefined, unit: CreditUnit) => void;
  onUpdateAccount: (id: string, patch: Partial<AppState['accounts'][number]>) => void;
  onUnlocked: (pwd: string) => void;
  onRefresh: () => void; refreshing: boolean;
  initialPwd?: string;
  bioLabel?: string
  onAudit: (action: string, detail?: string) => void
}) {
  const [unlockPwd, setUnlockPwd] = useState('')
  const [vaultPwd, setVaultPwd] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [showBalance, setShowBalance] = useState<Record<string, boolean>>({})
  const [bioAvailable, setBioAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [category, setCategory] = useState('__all__')
  const [groupFilter, setGroupFilter] = useState('__all__')
  const [page, setPage] = useState(1)
  const [pasteImportOpen, setPasteImportOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [toolExportOpen, setToolExportOpen] = useState(false)
  const [toolExportFormat, setToolExportFormat] = useState<'env' | 'json'>('env')
  const [revealKeyTarget, setRevealKeyTarget] = useState<{ id: string; label: string; plain: string } | null>(null)
  // 点眼睛查看值（余额/Key）时若未解锁：先记下待查看目标，走解锁流程，解锁成功后自动打开查看
  const [pendingView, setPendingView] = useState<{ kind: 'key' | 'balance'; id: string } | null>(null)
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())
  // Key 健康检查：结果存本地（healthCheck.ts），逐个/全部探测 /v1/models
  const [health, setHealth] = useState<Record<string, KeyHealthResult>>(() => loadKeyHealth())
  const [checking, setChecking] = useState<Set<string>>(new Set())
  const runHealthCheck = async (list: AppState['accounts']) => {
    const targets = list.filter(a => !checking.has(a.id))
    if (!targets.length) return
    setChecking(s => new Set([...s, ...targets.map(a => a.id)]))
    let okN = 0, badN = 0, skipN = 0
    await Promise.all(targets.map(async a => {
      const eff = { ...a, apiUrl: a.apiUrl || PROVIDER_MAP[a.providerId]?.apiBaseUrl || '' }
      const r = await checkKeyHealth(eff, revealed[a.id])
      if (r.status === 'ok') okN++; else if (r.status === 'skipped') skipN++; else badN++
      setHealth(prev => { const next = { ...prev, [a.id]: r }; saveKeyHealth(next); return next })
      setChecking(s => { const n = new Set(s); n.delete(a.id); return n })
    }))
    if (list.length > 1) notify(t('健康检查完成：正常 {ok}{bad}{skip}', { ok: okN, bad: badN ? t(' · 异常 {n}', { n: badN }) : '', skip: skipN ? t(' · 跳过 {n}（未解锁或无地址）', { n: skipN }) : '' }))
  }
  const PAGE_SIZE = 3
  const keyAccounts = state.accounts.filter(a => a.encryptedKey)

  useEffect(() => { void biometricAvailable().then(setBioAvailable) }, [])
  // 全局自动上锁事件：同步锁上本页（清掉本页会话密码与已显示的明文）
  useEffect(() => {
    const onAutoLock = () => { setVaultPwd(''); setRevealed({}); setUnlockOpen(false); setShowBalance({}); setPendingView(null); setRevealKeyTarget(null) }
    window.addEventListener('acm-autolock', onAutoLock)
    return () => window.removeEventListener('acm-autolock', onAutoLock)
  }, [])
  // 筛选条件变化时重置页码
  useEffect(() => { setPage(1) }, [category])

  const unlockWith = async (pwd: string) => {
    setBusy(true)
    try {
      const ok = await verifyVault(pwd)
      if (!ok) { notify('主密码错误'); return }
      const decrypted: Record<string, string> = {}
      for (const a of keyAccounts) {
        try { decrypted[a.id] = await decryptSecret(a.encryptedKey!, pwd) } catch { /* skip */ }
      }
      setRevealed(decrypted)
      setVaultPwd(pwd)
      onUnlocked(pwd)
      setUnlockPwd('')
      setUnlockOpen(false)
      notify('已解锁，密钥已明文展示')
      // 解锁前点过眼睛查看某个值：解锁成功后自动完成那次查看
      if (pendingView) {
        const pv = pendingView
        setPendingView(null)
        if (pv.kind === 'balance') {
          setShowBalance(s => ({ ...s, [pv.id]: true }))
        } else {
          const acc = keyAccounts.find(a => a.id === pv.id)
          if (acc && decrypted[pv.id]) { onAudit('查看Key', acc.label); setRevealKeyTarget({ id: acc.id, label: acc.label, plain: decrypted[pv.id] }) }
          else if (acc) notify('该 Key 解密失败，无法查看')
        }
      }
    } finally { setBusy(false) }
  }

  // 从设置页指纹/人脸解锁跳转进来时，用带入的已验证密码自动解锁本页
  const autoUnlockedRef = useRef('')
  useEffect(() => {
    if (initialPwd && initialPwd !== autoUnlockedRef.current && !vaultPwd) {
      autoUnlockedRef.current = initialPwd
      void unlockWith(initialPwd)
    }
  }, [initialPwd])

  /** 从备注提取分类：取 [ xxx ] 或冒号前的部分 */
  const categoryOf = noteCategory
  const categories = Array.from(new Set(keyAccounts.map(a => categoryOf(a.note)))).sort()
  /** 保险箱分组（账户 group 字段）：已有分组名列表 */
  const groups = Array.from(new Set(keyAccounts.map(a => a.group).filter((g): g is string => !!g))).sort()
  const filtered = keyAccounts.filter(a =>
    (category === '__all__' || categoryOf(a.note) === category) &&
    (groupFilter === '__all__' || (groupFilter === '__none__' ? !a.group : a.group === groupFilter)))
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  /** 手机端账户卡片：与桌面表格同一套数据/操作，纵向排布（表格在窄屏会被挤压错位，故手机端不用表格） */
  const renderKeyCard = (a: AppState['accounts'][number]) => {
    const provider = PROVIDER_MAP[a.providerId]
    const plain = revealed[a.id]
    const q = latestQuota(state.quotas, a.id)
    const balance = q ? `${(q.total - q.used).toLocaleString()} ${t(UNIT_LABEL[q.unit])}` : t('未录入')
    const adapter = getAdapterWithPlugins(a.providerId)
    const h = health[a.id]
    const busyH = checking.has(a.id)
    return (
      <div className="key-card" key={a.id}>
        <div className="key-card-head">
          <input type="checkbox" checked={selectedKeys.has(a.id)} onChange={e => {
            const next = new Set(selectedKeys)
            if (e.target.checked) next.add(a.id); else next.delete(a.id)
            setSelectedKeys(next)
          }} />
          <ProviderLogo provider={provider} size={30} />
          <div className="key-card-title">
            <div className="key-name" title={a.label}>{a.label}</div>
            <div className="key-sub">{provider?.shortName ?? a.providerId}</div>
          </div>
          <button className={`health-badge ${busyH ? 'checking' : h ? h.status : 'none'}`} disabled={busyH}
            title={busyH ? t('正在检查…') : h ? t('{label}：{msg}{lat}（{time}）· 点击重新检查', { label: t(HEALTH_LABEL[h.status]), msg: h.message, lat: h.status === 'ok' && h.latencyMs ? `（${h.latencyMs}ms）` : '', time: new Date(h.checkedAt).toLocaleString(locale()) }) : t('未检查 · 点击检查该 Key 是否可用')}
            onClick={() => void runHealthCheck([a])}>
            {busyH ? <Loader2 size={16} style={{ animation: 'acm-spin 1s linear infinite' }} /> : <HeartPulse size={16} />}
          </button>
        </div>
        <div className="key-card-row">
          <span className="key-card-label">{t('余额')}</span>
          <div className="row" style={{ gap: 5 }}>
            {showBalance[a.id] && <span className="mono" style={{ fontSize: 12 }}>{balance}</span>}
            <button className="icon-btn" title={showBalance[a.id] ? t('隐藏余额') : t('显示余额（需先解锁保险箱）')}
              onClick={() => {
                if (showBalance[a.id]) { setShowBalance(s => ({ ...s, [a.id]: false })); return }
                if (vaultPwd) { setShowBalance(s => ({ ...s, [a.id]: true })); return }
                setPendingView({ kind: 'balance', id: a.id })
                setUnlockOpen(true)
              }}>{showBalance[a.id] ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            {adapter.supported && <button className="icon-btn" title={t('刷新官方余额')}
              disabled={refreshing.has(a.id)}
              onClick={async () => {
                if (!plain) { notify('请先解锁保险箱'); return }
                setRefreshing(s => new Set(s).add(a.id))
                try {
                  const r = await adapter.fetchUsage!(plain)
                  onQuotaFetched(a.id, r.used, r.total, r.unit)
                  notify(t('余额已更新：{balance}', { balance: formatUsageBalance(r) }))
                } catch (e: any) { notify(errorText(e, '获取官方余额失败')) }
                finally { setRefreshing(s => { const n = new Set(s); n.delete(a.id); return n }) }
              }}><RefreshCw size={14} style={refreshing.has(a.id) ? { animation: 'acm-spin 1s linear infinite' } : undefined} /></button>}
          </div>
        </div>
        <div className="key-card-row">
          <span className="key-card-label">API Key</span>
          <button className="icon-btn" title={t('查看完整 Key（需先解锁保险箱）')}
            onClick={() => {
              if (plain) { onAudit('查看Key', a.label); setRevealKeyTarget({ id: a.id, label: a.label, plain }); return }
              setPendingView({ kind: 'key', id: a.id })
              setUnlockOpen(true)
            }}><Eye size={14} /></button>
        </div>
        <div className="key-card-row">
          <span className="key-card-label">{t('官方 Key 页')}</span>
          <KeyPageButton provider={provider.id === 'voice-config' && a.voiceProvider && VOICE_KEY_PROVIDER[a.voiceProvider]
            ? (PROVIDER_MAP[VOICE_KEY_PROVIDER[a.voiceProvider]] ?? provider)
            : provider} notify={notify} accountUrl={a.apiUrl} />
        </div>
        {a.note && <div className="key-card-row"><span className="key-card-label">{t('备注')}</span><span className="key-note">{a.note}</span></div>}
        <div className="key-card-row">
          <span className="key-card-label">{t('分组')}</span>
          {a.group ? <span className="group-chip">{a.group}</span> : <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('未分组')}</span>}
        </div>
        <div className="key-card-actions">
          <button className="key-action" title={t('编辑')} onClick={() => setEditing(a.id)}><Pencil size={15} /></button>
          <button className="key-action" title={t('复制 Key')} onClick={async () => {
            if (!plain) { notify('请先解锁保险箱'); return }
            const okCopy = await copyKeyWithAutoClear(plain)
            if (okCopy) { onAudit('复制Key', a.label); notify('API Key 已复制（30 秒后自动清除剪贴板）') }
            else notify('复制失败，请检查浏览器权限')
          }}><Copy size={15} /></button>
          <button className="key-action" title={t('备份密钥')} onClick={() => onRequestBackup([a.id], '备份密钥', '完成备份', () => notify('备份已完成'), true)}><Download size={15} /></button>
          {adapter.supported && <button className="key-action" title={t('查询官方用量')} onClick={async () => {
            if (!plain) { notify('请先解锁保险箱'); return }
            try {
              const r = await adapter.fetchUsage!(plain)
              onQuotaFetched(a.id, r.used, r.total, r.unit)
              notify(r.remaining !== undefined || r.label ? t('查询成功：{balance}', { balance: formatUsageBalance(r) }) : t('查询成功：已用 {used} {unit}', { used: r.used.toLocaleString(), unit: r.unit }))
            } catch (e: any) { notify(errorText(e, '查询失败')) }
          }}><RefreshCw size={15} /></button>}
          <HoldToConfirm title={isLocalProvider(a.providerId) ? t('删除本地模型') : t('删除前必须先备份')} onConfirm={() => onRequestBackup([a.id], '删除前必须备份', '确认删除', () => {
            onRemoveKeys([a.id])
            setSelectedKeys(prev => { const n = new Set(prev); n.delete(a.id); return n })
            setRevealed(prev => { const n = { ...prev }; delete n[a.id]; return n })
          })} />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="keys-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t('API Key 管理')}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{t('{n} 个密钥 · 本地加密存储', { n: keyAccounts.length })}</div>
        </div>
        <div className="keys-header-tools">
          <GlobalRefreshButton refreshing={globalRefreshing} onRefresh={onRefresh} />
          <button className="btn sm" disabled={checking.size > 0 || keyAccounts.length === 0}
            onClick={() => void runHealthCheck(keyAccounts)}
            title={t('用每个 Key 轻量调用一次平台接口，检查密钥是否可用、服务是否可达（云端 Key 需先解锁保险箱）')}>
            <Activity size={14} /> {checking.size > 0 ? t('检查中（剩 {n}）', { n: checking.size }) : t('健康检查')}
          </button>
          {categories.length > 0 && (
            <select className="select keys-filter-select" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="__all__">{t('全部分类 ({n})', { n: keyAccounts.length })}</option>
              {categories.map(c => <option key={c} value={c}>{c} ({keyAccounts.filter(a => categoryOf(a.note) === c).length})</option>)}
            </select>
          )}
          <select className="select keys-filter-select" value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setPage(1) }} title={t('按保险箱分组筛选（在编辑条目里给 Key 填分组）')}>
            <option value="__all__">{t('全部分组 ({n})', { n: keyAccounts.length })}</option>
            {groups.map(g => <option key={g} value={g}>{g} ({keyAccounts.filter(a => a.group === g).length})</option>)}
            <option value="__none__">{t('未分组 ({n})', { n: keyAccounts.filter(a => !a.group).length })}</option>
          </select>
          <div className="keys-unlock-group">
            <label className="btn sm" style={{ cursor: 'pointer' }} title={t('导入备份')}>
              <Download size={14} style={{ transform: 'rotate(180deg)' }} /> {t('导入')}
              <input type="file" accept=".json,.csv,.txt,application/json,text/csv" style={{ display: 'none' }} onChange={e => {
                onImportFile(e.target.files?.[0]); e.target.value = ''
              }} />
            </label>
            {onImportText && <button className="btn sm" onClick={() => setPasteImportOpen(true)} title={t('粘贴备份文本导入（备忘录里复制的备份也能粘）')}><ClipboardPaste size={14} /> {t('粘贴导入')}</button>}
            <button className="btn sm" onClick={onExport} title={t('导出备份（不含密钥）')}><Download size={14} /> {t('导出')}</button>
            {!isVaultInitialized() && <button className="btn sm" onClick={onOpenVault}><ShieldCheck size={14} /> {t('创建保险箱')}</button>}
            {vaultPwd ? (
              <button className="btn sm" onClick={() => { setRevealed({}); setVaultPwd(''); setUnlockPwd(''); setRevealKeyTarget(null); setShowBalance({}); setPendingView(null); notify('已锁定') }}><Lock size={14} /> {t('锁定')}</button>
            ) : (
              <button className="btn sm primary" onClick={() => setUnlockOpen(true)}><Unlock size={14} /> {t('解锁')}</button>
            )}
          </div>
        </div>
      </div>

      {groups.length === 0 && keyAccounts.length > 0 && (
        <div className="group-stats">
          <span className="group-stats-label">{t('保险箱分组')}</span>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{t('点任意 Key 的「编辑」填写分组（如 工作 / 个人 / 项目），或添加账户时直接填；分好组后这里会按组统计剩余额度，表头下拉可按组筛选。')}</span>
        </div>
      )}
      {groups.length > 0 && (
        <div className="group-stats">
          <span className="group-stats-label">{t('分组额度')}</span>
          {groups.map(g => {
            const members = state.accounts.filter(a => a.group === g)
            const remain = members.reduce((sum, a) => {
              const q = latestQuota(state.quotas, a.id)
              return q && q.unit === 'currency' ? sum + Math.max(0, q.total - q.used) : sum
            }, 0)
            return (
              <button key={g} className={`group-stat-chip ${groupFilter === g ? 'active' : ''}`}
                onClick={() => { setGroupFilter(groupFilter === g ? '__all__' : g); setPage(1) }}
                title={t('点击按此分组筛选')}>
                {t('{g} · {n} 个账户 · 剩余 ¥{remain}', { g, n: members.length, remain: remain.toFixed(1) })}
              </button>
            )
          })}
          <button className={`group-stat-chip ${groupFilter === '__none__' ? 'active' : ''}`}
            onClick={() => { setGroupFilter(groupFilter === '__none__' ? '__all__' : '__none__'); setPage(1) }}>
            {t('未分组 · {n} 个密钥', { n: keyAccounts.filter(a => !a.group).length })}
          </button>
        </div>
      )}

      {isPhone ? (
        <div className="key-cards">
          {pageItems.length === 0
            ? <div className="key-cards-empty">{keyAccounts.length === 0 ? t('暂无密钥。添加账户时选择「官方 API」模式即可保存。') : t('当前筛选下没有密钥')}</div>
            : pageItems.map(a => renderKeyCard(a))}
        </div>
      ) : (
      <div className="panel key-table-wrap">
        <table className="key-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" title={t('全选本页')}
                  checked={pageItems.length > 0 && pageItems.every(a => selectedKeys.has(a.id))}
                  onChange={e => {
                    const next = new Set(selectedKeys)
                    if (e.target.checked) pageItems.forEach(a => next.add(a.id))
                    else pageItems.forEach(a => next.delete(a.id))
                    setSelectedKeys(next)
                  }} />
              </th>
              <th style={{ width: 150 }}>{t('名称')}</th>
              <th style={{ width: 110 }}>{t('余额')}</th>
              <th style={{ width: 160 }}>{t('链接地址 (API)')}</th>
              <th style={{ width: 130 }}>API Key</th>
              <th style={{ width: 118 }}>{t('健康状态')}</th>
              <th>{t('备注 (用途)')}</th>
              <th style={{ width: 110 }}>{t('分组')}</th>
              <th style={{ width: 210 }}>{t('操作')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 40 }}>
                {keyAccounts.length === 0 ? t('暂无密钥。添加账户时选择「官方 API」模式即可保存。') : t('当前筛选下没有密钥')}
              </td></tr>
            ) : pageItems.map(a => {
              const provider = PROVIDER_MAP[a.providerId]
              const plain = revealed[a.id]
              const q = latestQuota(state.quotas, a.id)
              const balance = q ? `${(q.total - q.used).toLocaleString()} ${t(UNIT_LABEL[q.unit])}` : t('未录入')
              const adapter = getAdapterWithPlugins(a.providerId)
              return (
                <tr key={a.id}>
                  <td>
                    <input type="checkbox" checked={selectedKeys.has(a.id)} onChange={e => {
                      const next = new Set(selectedKeys)
                      if (e.target.checked) next.add(a.id); else next.delete(a.id)
                      setSelectedKeys(next)
                    }} />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <ProviderLogo provider={provider} size={26} />
                      <div style={{ minWidth: 0 }}>
                        <div className="key-name" title={a.label}>{a.label}</div>
                        <div className="key-sub">{provider?.shortName ?? a.providerId}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 5 }}>
                      {showBalance[a.id] && (
                        <span className="mono" style={{ fontSize: 11.5, minWidth: 42 }}>{balance}</span>
                      )}
                      <button className="icon-btn" title={showBalance[a.id] ? t('隐藏余额') : t('显示余额（需先解锁保险箱）')}
                        onClick={() => {
                          if (showBalance[a.id]) { setShowBalance(s => ({ ...s, [a.id]: false })); return }
                          if (vaultPwd) { setShowBalance(s => ({ ...s, [a.id]: true })); return }
                          // 未解锁：先走解锁流程，解锁成功后自动显示（见 unlockWith 的 pendingView 消费）
                          setPendingView({ kind: 'balance', id: a.id })
                          setUnlockOpen(true)
                        }}>{showBalance[a.id] ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                      {adapter.supported && <button className="icon-btn" title={t('刷新官方余额')}
                        disabled={refreshing.has(a.id)}
                        onClick={async () => {
                          if (!plain) { notify('请先解锁保险箱'); return }
                          setRefreshing(s => new Set(s).add(a.id))
                          try {
                            const r = await adapter.fetchUsage!(plain)
                            onQuotaFetched(a.id, r.used, r.total, r.unit)
                            notify(t('余额已更新：{balance}', { balance: formatUsageBalance(r) }))
                          } catch (e: any) { notify(errorText(e, '获取官方余额失败')) }
                          finally { setRefreshing(s => { const n = new Set(s); n.delete(a.id); return n }) }
                        }}><RefreshCw size={13} style={refreshing.has(a.id) ? { animation: 'acm-spin 1s linear infinite' } : undefined} /></button>}
                    </div>
                  </td>
                  <td>
                    <KeyPageButton provider={provider.id === 'voice-config' && a.voiceProvider && VOICE_KEY_PROVIDER[a.voiceProvider]
                      ? (PROVIDER_MAP[VOICE_KEY_PROVIDER[a.voiceProvider]] ?? provider)
                      : provider} notify={notify} accountUrl={a.apiUrl} />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 5 }}>
                      <button className="icon-btn" title={t('查看完整 Key（需先解锁保险箱）')}
                        onClick={() => {
                          if (plain) { onAudit('查看Key', a.label); setRevealKeyTarget({ id: a.id, label: a.label, plain }); return }
                          // 未解锁：先走解锁流程，解锁成功后自动打开查看弹窗
                          setPendingView({ kind: 'key', id: a.id })
                          setUnlockOpen(true)
                        }}><Eye size={13} /></button>
                    </div>
                  </td>
                  <td>
                    {(() => { const h = health[a.id]; const busyH = checking.has(a.id); return (
                      <button className={`health-badge ${busyH ? 'checking' : h ? h.status : 'none'}`} disabled={busyH}
                        title={busyH ? t('正在检查…') : h ? t('{label}：{msg}{lat}（{time}）· 点击重新检查', { label: t(HEALTH_LABEL[h.status]), msg: h.message, lat: h.status === 'ok' && h.latencyMs ? `（${h.latencyMs}ms）` : '', time: new Date(h.checkedAt).toLocaleString(locale()) }) : t('未检查 · 点击检查该 Key 是否可用')}
                        onClick={() => void runHealthCheck([a])}>
                        {busyH
                          ? <Loader2 size={16} style={{ animation: 'acm-spin 1s linear infinite' }} />
                          : <HeartPulse size={16} />}
                      </button> ) })()}
                  </td>
                  <td><span className="key-note" title={a.note ?? ''}>{a.note ?? '—'}</span></td>
                  <td>{a.group
                    ? <span className="group-chip">{a.group}</span>
                    : <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('未分组')}</span>}</td>
                  <td>
                    <div className="key-actions">
                      <button className="key-action" title={t('编辑')} onClick={() => setEditing(a.id)}><Pencil size={15} /></button>
                      <button className="key-action" title={t('复制 Key')} onClick={async () => {
                        if (!plain) { notify('请先解锁保险箱'); return }
                        const okCopy = await copyKeyWithAutoClear(plain)
                        if (okCopy) { onAudit('复制Key', a.label); notify('API Key 已复制（30 秒后自动清除剪贴板）') }
                        else notify('复制失败，请检查浏览器权限')
                      }}><Copy size={15} /></button>
                      <button className="key-action" title={t('备份密钥')} onClick={() => onRequestBackup([a.id], '备份密钥', '完成备份', () => notify('备份已完成'), true)}><Download size={15} /></button>
                      {adapter.supported && <button className="key-action" title={t('查询官方用量')} onClick={async () => {
                        if (!plain) { notify('请先解锁保险箱'); return }
                        try {
                          const r = await adapter.fetchUsage!(plain)
                          onQuotaFetched(a.id, r.used, r.total, r.unit)
                          notify(r.remaining !== undefined || r.label ? t('查询成功：{balance}', { balance: formatUsageBalance(r) }) : t('查询成功：已用 {used} {unit}', { used: r.used.toLocaleString(), unit: r.unit }))
                        } catch (e: any) { notify(errorText(e, '查询失败')) }
                      }}><RefreshCw size={15} /></button>}
                      <HoldToConfirm title={isLocalProvider(a.providerId) ? t('删除本地模型') : t('删除前必须先备份')} onConfirm={() => onRequestBackup([a.id], '删除前必须备份', '确认删除', () => {
                        onRemoveKeys([a.id])
                        setSelectedKeys(prev => { const n = new Set(prev); n.delete(a.id); return n })
                        setRevealed(prev => { const n = { ...prev }; delete n[a.id]; return n })
                      })} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}

      <SelectionBar
        selectedCount={selectedKeys.size} totalOnPage={pageItems.length}
        allSelected={pageItems.length > 0 && pageItems.every(a => selectedKeys.has(a.id))}
        onToggleAll={() => {
          const next = new Set(selectedKeys)
          const allOn = pageItems.every(a => next.has(a.id))
          if (allOn) pageItems.forEach(a => next.delete(a.id)); else pageItems.forEach(a => next.add(a.id))
          setSelectedKeys(next)
        }}
        onClear={() => setSelectedKeys(new Set())}
        actions={<>
          <button className="btn sm" disabled={selectedKeys.size === 0} onClick={() => setToolExportOpen(true)}><Download size={13} /> {t('导出工具配置')}</button>
          <button className="btn sm danger" disabled={selectedKeys.size === 0} onClick={() => {
            const ids = Array.from(selectedKeys)
            onRequestBackup(ids, '删除前必须备份', '确认删除', () => {
              onRemoveKeys(ids)
              setRevealed(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n })
              setSelectedKeys(new Set())
            })
          }}><Trash2 size={13} /> {t('批量删除账户')}</button>
        </>}
      />
      <Pager total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />

      {editing && (() => {
        const acc = state.accounts.find(a => a.id === editing)
        if (!acc) return null
        return <KeyEditModal
          account={acc} provider={PROVIDER_MAP[acc.providerId]}
          groupSuggestions={groups}
          currentKey={revealed[acc.id]}
          onClose={() => setEditing(null)}
          onSave={(patch, newKey) => {
            onUpdateAccount(acc.id, patch)
            if (newKey !== undefined && newKey !== '') {
              void (async () => {
                if (!vaultPwd) { notify('修改密钥请先解锁保险箱'); return }
                const enc = await encryptSecret(newKey, vaultPwd)
                onUpdateAccount(acc.id, { encryptedKey: enc, keyFingerprint: fingerprint(newKey) })
                setRevealed(s => ({ ...s, [acc.id]: newKey }))
                notify('密钥已更新')
              })()
            }
            setEditing(null)
          }}
          notify={notify}
        />
      })()}

      {toolExportOpen && (() => {
        const items: ToolExportItem[] = []
        const missing: string[] = []
        for (const id of selectedKeys) {
          const a = state.accounts.find(x => x.id === id)
          if (!a) continue
          const plain = revealed[a.id]
          if (plain) items.push({ providerId: a.providerId, label: a.label || PROVIDER_MAP[a.providerId]?.name || a.providerId, apiKey: plain, apiUrl: a.apiUrl || PROVIDER_MAP[a.providerId]?.apiBaseUrl || undefined })
          else missing.push(a.label || a.providerId)
        }
        const doExport = async () => {
          const content = toolExportFormat === 'env' ? buildEnvExport(items) : buildJsonExport(items)
          const r = await saveExportFile(toolExportFormat === 'env' ? 'ai-keys.env' : 'ai-keys.json', content)
          if (r.cancelled) return
          if (!r.ok) { notify(t('导出失败：{err}', { err: r.error ?? t('未知错误') })); return }
          onAudit('导出工具配置', `${items.length} 个 Key · ${toolExportFormat === 'env' ? '.env' : 'JSON'}`)
          notify(t('已导出到：{where}（{n} 个 Key 的配置，明文请妥善保管）', { where: r.where ?? '', n: items.length }))
          setToolExportOpen(false)
        }
        return (
          <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setToolExportOpen(false) }}>
            <div className="modal" style={{ maxWidth: 460 }}>
              <div className="modal-head"><h3 style={{ margin: 0 }}>{t('导出工具配置')}</h3><button className="icon-btn" onClick={() => setToolExportOpen(false)}><X size={18} /></button></div>
              <div className="modal-body">
                <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>{t('把所选 Key 生成其他工具（如 Cursor、各类 CLI / SDK）能直接使用的配置文件。')}</p>
                <div className="form-row">
                  <label className="form-label">{t('格式')}</label>
                  <div className="row" style={{ gap: 8 }}>
                    <button className={`btn sm ${toolExportFormat === 'env' ? 'primary' : ''}`} onClick={() => setToolExportFormat('env')}>{t('.env 环境变量')}</button>
                    <button className={`btn sm ${toolExportFormat === 'json' ? 'primary' : ''}`} onClick={() => setToolExportFormat('json')}>JSON</button>
                  </div>
                </div>
                <p style={{ fontSize: 12.5, color: '#dc2626', lineHeight: 1.6 }}>{t('⚠️ 导出文件包含明文 Key，请妥善保管，不要发给他人或提交到代码仓库。')}</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{t('可导出 {n} 个{skipped}', { n: items.length, skipped: missing.length ? t('；{m} 个未解锁/无 Key 已跳过（{names}{more}）', { m: missing.length, names: missing.slice(0, 3).join('、'), more: missing.length > 3 ? t(' 等') : '' }) : '' })}</p>
              </div>
              <div className="modal-foot">
                <button className="btn" onClick={() => setToolExportOpen(false)}>{t('取消')}</button>
                <button className="btn primary" disabled={items.length === 0} onClick={doExport}><Download size={14} /> {t('生成并下载')}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {pasteImportOpen && (
        <div className="modal-backdrop" onClick={() => setPasteImportOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h3 style={{ margin: '0 0 6px' }}>{t('粘贴导入')}</h3>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-2)' }}>{t('把备份文本粘贴到下面即可导入：备忘录里那条「AI 魔方密钥备份」笔记全选复制、或备份文件的内容都可以，格式自动识别。')}</p>
            <textarea className="input" rows={9} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} value={pasteText}
              onChange={e => setPasteText(e.target.value)} placeholder={t('在此粘贴备份文本…')} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="btn sm" onClick={() => { void navigator.clipboard?.readText().then(tx => setPasteText(tx)).catch(() => notify('读取剪贴板失败，请手动粘贴')) }}>{t('从剪贴板粘贴')}</button>
              <button className="btn sm ghost" onClick={() => setPasteImportOpen(false)}>{t('取消')}</button>
              <button className="btn sm primary" disabled={!pasteText.trim()} onClick={() => { onImportText?.(pasteText); setPasteImportOpen(false); setPasteText('') }}>{t('导入')}</button>
            </div>
          </div>
        </div>
      )}
      {unlockOpen && !vaultPwd && <UnlockModal
        method={state.settings.unlockMethod} bioAvailable={bioAvailable} bioLabel={bioLabel ?? '生物'}
        onClose={() => { setUnlockOpen(false); setUnlockPwd(''); setPendingView(null) }}
        onPassword={(pwd) => void unlockWith(pwd)}
        onBiometric={async () => {
          const pwd = await resolveBiometricVaultPassword(t('验证身份以解锁保险箱'))
          if (!pwd) { notify(t('未通过{bio}验证，或未配置解锁凭据（请在设置中开启）', { bio: bioLabel ?? t('生物') })); return false }
          await unlockWith(pwd)
          return true
        }}
        busy={busy} pwd={unlockPwd} setPwd={setUnlockPwd}
      />}

      {revealKeyTarget && <KeyRevealModal
        label={revealKeyTarget.label} plain={revealKeyTarget.plain}
        onClose={() => setRevealKeyTarget(null)}
        onCopied={() => notify('API Key 已复制到剪贴板')}
      />}

    </>
  )
}


/** 删除前强制备份弹窗：三种备份方式，只有备份成功且确认后才允许删除 */
function DeleteBackupModal({ state, accountIds, unlockedPwd, title, confirmLabel, backupOnly = false, notify, onClose, onDone }: {
  state: AppState
  accountIds: string[]
  unlockedPwd?: string
  title: string
  confirmLabel: string
  backupOnly?: boolean
  notify: (m: string) => void
  onClose: () => void
  onDone: () => void
}) {
  const [mode, setMode] = useState<KeyBackupMode>('cloud')
  const [format, setFormat] = useState<KeyBackupFormat>('cipher')
  const [fileFormat, setFileFormat] = useState<BackupFileFormat>('json')
  const [pwd, setPwd] = useState(unlockedPwd ?? '')
  const [busy, setBusy] = useState(false)
  const [backup, setBackup] = useState<KeyBackupFile | null>(null)
  const [location, setLocation] = useState('')
  // 数据存储已指定 API Key 文件夹时，备份默认走该文件夹且不再让选（v0.1.298）
  const keyStoreDir = storageDir('apikey')
  const [backupDir, setBackupDir] = useState<string | null>(() => keyStoreDir)
  const [confirmed, setConfirmed] = useState(false)
  const [codeInput, setCodeInput] = useState('')

  const targets = state.accounts.filter(a => accountIds.includes(a.id))
  const names = targets.slice(0, 3).map(a => a.label).join('、') + (targets.length > 3 ? t(' 等 {n} 个', { n: targets.length }) : '')
  const effectiveFormat: KeyBackupFormat = mode === 'notes' ? 'plain' : format
  const needPwd = effectiveFormat === 'plain' && !unlockedPwd

  const resetBackup = (m: KeyBackupMode, f: KeyBackupFormat) => {
    setMode(m); setFormat(f); setBackup(null); setLocation(''); setConfirmed(false); setCodeInput(''); setBackupDir(keyStoreDir)
  }

  const doBackup = async () => {
    setBusy(true)
    try {
      if (effectiveFormat === 'plain') {
        const p = unlockedPwd || pwd
        if (!p) { notify('请先输入主密码'); return }
        if (!(await verifyVault(p))) { notify('主密码错误'); return }
      }
      const b = await buildKeyBackup(state, accountIds, effectiveFormat, unlockedPwd || pwd)
      const r = mode === 'cloud'
        ? await backupToCloud(b, state)
        : mode === 'local'
          ? await backupToLocalFile(b, backupDir, fileFormat)
          : await backupToNotes(b, fileFormat)
      if (!r.ok) { notify(r.error ?? '备份失败'); return }
      setBackup(b)
      // 备忘录方式：确认码就显示在弹窗里，手输纯属摩擦（Ethan 要求）——生成成功即自动填入输入框；
      // 真正的把关保留在「我已保存」勾选上
      if (mode === 'notes') setCodeInput(b.confirmationCode)
      setLocation(r.location ?? '')
      notify(mode === 'cloud' ? '密文备份已存入云端' : mode === 'local' ? '备份文件已保存' : '备份内容已就绪，请在备忘录中保存')
    } catch (e) {
      notify((e as Error)?.message ?? '备份失败')
    } finally { setBusy(false) }
  }

  const canDelete = !!backup && confirmed && (mode !== 'notes' || codeInput.trim() === backup.confirmationCode)

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-head"><h3>{t(title)}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="upd-current">{t('即将处理')} <b>{names}</b></div>
          {!backupOnly && <div className="backup-warn"><AlertTriangle size={15} /> {t('删除后只有 5 秒可撤回。请先完成一份长期备份，否则密钥将无法恢复。')}</div>}

          <div className="backup-options">
            <button className={`backup-option ${mode === 'cloud' ? 'active' : ''}`} onClick={() => resetBackup('cloud', 'cipher')} disabled={busy}>
              <Cloud size={17} />
              <span><b>{t('密文备份到云')}</b><small>{t('密钥仍为密文，含保险箱材料，可跨设备恢复')}</small></span>
            </button>
            <button className={`backup-option ${mode === 'local' ? 'active' : ''}`} onClick={() => resetBackup('local', 'cipher')} disabled={busy}>
              <HardDrive size={17} />
              <span><b>{t('备份到本机文件夹')}</b><small>{t('桌面下载到「下载」，手机写入 Documents 目录')}</small></span>
            </button>
            <button className={`backup-option ${mode === 'notes' ? 'active' : ''}`} onClick={() => resetBackup('notes', 'plain')} disabled={busy}>
              <Download size={17} />
              <span><b>{t('备份到本机备忘录')}</b><small>{t('仅明文；调起系统分享或复制到剪贴板，由你粘贴保存')}</small></span>
            </button>
          </div>

          {mode === 'local' && (
            <>
              <div className="backup-format">
                <span className="field-label" style={{ margin: '0 8px 0 0' }}>{t('文件格式')}</span>
                <button className={`btn sm ${format === 'cipher' ? 'primary' : ''}`} onClick={() => resetBackup('local', 'cipher')}><Lock size={13} /> {t('密文')}</button>
                <button className={`btn sm ${format === 'plain' ? 'primary' : ''}`} onClick={() => resetBackup('local', 'plain')}><Unlock size={13} /> {t('明文')}</button>
              </div>
              <div className="backup-format" style={{ marginTop: 10 }}>
                <span className="field-label" style={{ margin: '0 8px 0 0' }}>{t('文件容器')}</span>
                {(['json', 'csv', 'txt', 'md', 'html', 'xlsx'] as BackupFileFormat[]).map(f => (
                  <button key={f} className={`btn sm ${fileFormat === f ? 'primary' : ''}`} onClick={() => { setFileFormat(f); setBackup(null); setConfirmed(false) }}>{f === 'xlsx' ? 'Excel' : f.toUpperCase()}</button>
                ))}
              </div>
              {isReadableFormat(fileFormat) && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>{t('MD / HTML / Excel 是便于查看的清单格式（名称、余额、链接地址、Key、分组），不能用于恢复导入；恢复备份请用 JSON / CSV / TXT')}</div>
              )}
              {isDesktopApp() && !keyStoreDir && (
                <button className="btn sm" style={{ marginTop: 10 }} onClick={async () => {
                  const dir = await chooseBackupFolder()
                  if (dir) { setBackupDir(dir); setBackup(null); setConfirmed(false); notify(t('备份目录：{dir}', { dir })) }
                  else notify('已取消选择目录')
                }}><HardDrive size={13} /> {backupDir ? t('目录：{dir}', { dir: backupDir }) : t('选择备份文件夹')}</button>
              )}
              {isDesktopApp() && keyStoreDir && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)', wordBreak: 'break-all' }}>{t('备份将保存到数据存储文件夹：{dir}', { dir: keyStoreDir })}</div>
              )}
            </>
          )}

          {needPwd && (
            <div className="backup-pwd">
              <span className="field-label" style={{ margin: 0 }}>{t('主密码（仅用于本次明文备份，不保存）')}</span>
              <input className="input" type="password" value={pwd} onChange={e => { setPwd(e.target.value); setBackup(null) }} placeholder={t('输入保险箱主密码')} disabled={busy} />
            </div>
          )}

          <button className="btn primary" style={{ width: '100%', marginTop: 16 }} onClick={() => void doBackup()} disabled={busy}>
            {busy ? <RefreshCw size={15} className="spin" /> : <ShieldCheck size={15} />}
            {busy ? t('正在备份…') : mode === 'cloud' ? t('备份到云') : mode === 'local' ? t('生成备份文件') : t('生成备忘录备份内容')}
          </button>

          {backup && (
            <div className="backup-success">
              <div className="upd-new ok"><Check size={16} /> {t('备份已完成')}</div>
              <div className="hint" style={{ marginTop: 6 }}>{location}</div>
              {mode === 'notes' && (
                <>
                  <div className="backup-code">{t('确认码 {code}', { code: backup.confirmationCode })}</div>
                  <input className="input" style={{ marginTop: 8 }} value={codeInput} onChange={e => setCodeInput(e.target.value)} placeholder={t('请在备忘录保存后输入确认码')} />
                </>
              )}
              <label className="backup-confirm">
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                {mode === 'notes' ? t('我已将明文备份粘贴到备忘录并保存') : mode === 'local' ? t('我已保存备份文件') : t('我确认密文备份已存入云端')}
              </label>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className={`btn ${backupOnly ? 'primary' : 'danger'}`} disabled={!canDelete} onClick={() => onDone()}>
            {backupOnly ? <Check size={15} /> : <Trash2 size={15} />} {t(confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 明文 Key 查看弹窗：显示完整 Key 并可一键复制 */
function KeyRevealModal({ label, plain, onClose, onCopied }: {
  label: string; plain: string; onClose: () => void; onCopied: () => void
}) {
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head"><h3>{t('查看 API Key')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>{label}</div>
          <div className="secret-reveal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span className="mono" style={{ wordBreak: 'break-all', lineHeight: 1.6 }}>{plain}</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('关闭')}</button>
          <button className="btn primary" onClick={async () => {
            if (await copyKeyWithAutoClear(plain)) onCopied()
          }}><Copy size={14} /> {t('复制 Key')}</button>
        </div>
      </div>
    </div>
  )
}

/** 解锁弹窗：按设置只显示指纹或密码一种方式 */
function UnlockModal({ method, bioAvailable, bioLabel, onClose, onPassword, onBiometric, busy, pwd, setPwd }: {
  method: 'biometric' | 'password'; bioAvailable: boolean; bioLabel: string;
  onClose: () => void; onPassword: (pwd: string) => void; onBiometric: () => Promise<boolean>;
  busy: boolean; pwd: string; setPwd: (v: string) => void
}) {
  const useBio = method === 'biometric' && bioAvailable
  // 指纹/触控模式：弹窗一打开就直接调起系统验证，不再多点一次「验证」按钮；
  // 取消/失败后才落回按钮页可重试。密码模式仍走输入框（v0.1.253）
  const autoBioRef = useRef(false)
  const [bioPrompting, setBioPrompting] = useState(false)
  const [bioFailed, setBioFailed] = useState(false)
  const runBio = async () => {
    setBioFailed(false); setBioPrompting(true)
    const ok = await onBiometric()
    setBioPrompting(false); if (!ok) setBioFailed(true)
  }
  useEffect(() => {
    if (!useBio || autoBioRef.current) return
    autoBioRef.current = true
    void runBio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useBio])
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-head"><h3>{t('解锁密钥保险箱')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          {useBio ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%', margin: '0 auto 18px',
                background: 'var(--primary-soft)', color: 'var(--primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Fingerprint size={36} /></div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{t('使用{bio}解锁', { bio: t(bioLabel) })}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 22 }}>{bioPrompting ? t('请在系统弹窗中完成{bio}验证', { bio: t(bioLabel) }) : t('验证{bio}后显示全部 API Key 明文', { bio: bioLabel === '人脸' ? 'Face ID' : bioLabel === '指纹' ? 'Touch ID' : t(bioLabel) })}</div>
              {bioFailed && <button className="btn primary" style={{ width: '100%' }} onClick={() => void runBio()} disabled={busy || bioPrompting}>
                <Fingerprint size={16} /> {t('重新验证{bio}', { bio: t(bioLabel) })}
              </button>}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>{t('输入主密码解锁，解密后本页所有 API Key 将以明文展示。')}</div>
              <div className="field">
                <label>{t('主密码')}</label>
                <input className="input" type="password" autoFocus placeholder={t('输入主密码')} value={pwd}
                  onChange={e => setPwd(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && pwd) onPassword(pwd) }} />
              </div>
              <button className="btn primary" style={{ width: '100%' }} onClick={() => onPassword(pwd)} disabled={busy || !pwd}>
                <Unlock size={15} /> {t('解锁')}
              </button>
            </>
          )}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>{t('取消')}</button></div>
      </div>
    </div>
  )
}


/** 密钥条目编辑弹窗 */
function KeyEditModal({ account, provider, currentKey, onClose, onSave, notify, groupSuggestions }: {
  account: AppState['accounts'][number]; provider: ProviderDefinition; currentKey?: string;
  onClose: () => void;
  onSave: (patch: Partial<AppState['accounts'][number]>, newKey?: string) => void;
  notify: (m: string) => void
  groupSuggestions: string[]
}) {
  const [label, setLabel] = useState(account.label)
  const [apiUrl, setApiUrl] = useState(account.apiUrl ?? '')
  const [noteCat, setNoteCat] = useState<NoteCategory>(() => categoryFromNote(account.note))
  const [noteExtra, setNoteExtra] = useState(() => (account.note ?? '').replace(/^\[[^\]]+\]\s*/, '').split(/[:：]/).slice(1).join(':').trim())
  const [newKey, setNewKey] = useState('')
  const [group, setGroup] = useState(account.group ?? '')
  const [subOn, setSubOn] = useState(!!account.subscription)
  const [subPrice, setSubPrice] = useState(account.subscription ? String(account.subscription.price) : '')
  const [subCycle, setSubCycle] = useState<'monthly' | 'yearly'>(account.subscription?.cycle ?? 'monthly')
  const [subRenewAt, setSubRenewAt] = useState(account.subscription?.renewAt ?? '')

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head"><h3>{t('编辑密钥条目')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="row" style={{ gap: 10, marginBottom: 16 }}>
            <ProviderLogo provider={provider} size={28} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>{provider.name} · {currentKey ? t('已配置密钥') : t('未配置')}</div>
          </div>
          <div className="field">
            <label>{t('名称')}</label>
            <input className="input" value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <div className="field">
            <label>{t('链接地址 (API)')}</label>
            <div className="row" style={{ gap: 6 }}>
              <input className="input" placeholder={provider.apiBaseUrl ?? 'https://api.example.com/v1'} value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
              {provider.apiBaseUrl && <button className="btn sm" title={t('恢复官方地址')} onClick={() => setApiUrl(provider.apiBaseUrl!)}>{t('官方')}</button>}
            </div>
            {provider.apiBaseUrl && <div className="desc">{t('官方地址：{url}（留空则自动使用此地址）', { url: provider.apiBaseUrl })}</div>}
          </div>
          <div className="field">
            <label>{t('模型分类')}</label>
            <select className="select" value={noteCat} onChange={e => setNoteCat(e.target.value as NoteCategory)}>
              {NOTE_CATEGORIES.map(c => <option key={c} value={c}>{t(c)}</option>)}
            </select>
            <input className="input" style={{ marginTop: 8 }} placeholder={t('补充说明（可选）')} value={noteExtra} onChange={e => setNoteExtra(e.target.value)} />
            <div className="desc">{t('分类决定 AI 助手里该模型的用途与联动')}</div>
          </div>
          <div className="field">
            <label>{t('保险箱分组（可选）')}</label>
            <input className="input" list="acm-group-list" placeholder={t('如：工作 / 个人 / 项目（留空 = 未分组）')} value={group} onChange={e => setGroup(e.target.value)} />
            <datalist id="acm-group-list">{groupSuggestions.map(g => <option key={g} value={g} />)}</datalist>
            <div className="desc">{t('按用途分组管理密钥；Key 管理页可按组筛选，并按组统计剩余额度')}</div>
          </div>
          <div className="field">
            <label>{t('订阅续费（可选）')}</label>
            <label className="row" style={{ gap: 6, fontSize: 13, alignItems: 'center' }}><input type="checkbox" checked={subOn} onChange={e => setSubOn(e.target.checked)} /> {t('这是订阅制账户（包月/包年）')}</label>
            {subOn && (
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <input className="input" type="number" min="0" step="0.01" placeholder={t('价格（元）')} value={subPrice} onChange={e => setSubPrice(e.target.value)} style={{ flex: 1 }} />
                <select className="select" value={subCycle} onChange={e => setSubCycle(e.target.value as 'monthly' | 'yearly')}>
                  <option value="monthly">{t('每月')}</option>
                  <option value="yearly">{t('每年')}</option>
                </select>
                <input className="input" type="date" value={subRenewAt} onChange={e => setSubRenewAt(e.target.value)} style={{ flex: 1.2 }} title={t('下次续费日')} />
              </div>
            )}
            <div className="desc">{t('填好后会出现在用量页「订阅续费」总览里，临近续费日会收到提醒')}</div>
          </div>
          <div className="field">
            <label>{t('更换 API Key（留空表示不修改）')}</label>
            <input className="input" type="password" placeholder={t('留空保持不变')} value={newKey} onChange={e => setNewKey(e.target.value)} />
            <div className="desc">{t('修改密钥需先在主界面解锁保险箱；新密钥将以主密码重新加密。')}</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" onClick={() => {
            if (!label.trim()) { notify('名称不能为空'); return }
            onSave({ label: label.trim(), apiUrl: apiUrl.trim(), note: buildNote(noteCat, noteExtra), group: group.trim() || undefined, subscription: subOn && Number(subPrice) > 0 && subRenewAt ? { price: Number(subPrice), cycle: subCycle, renewAt: subRenewAt } : undefined }, newKey.trim() || undefined)
          }}>{t('保存')}</button>
        </div>
      </div>
    </div>
  )
}

function UsageView({ state, notify, onBudget, onAddUsage, onImport, onPriceChange, onDeleteUsage, onProviderBudget, onAccountBudget, onOpenReport, priceAlerts, priceCheckedAt, checkingPrices, onCheckPrices, onAckPriceAlerts, onRefresh, refreshing }: {
  state: AppState; notify: (m: string) => void; onBudget: (v: number) => void;
  onAddUsage: () => void;
  onDeleteUsage: (ids: string[]) => void;
  onImport: (events: UsageEventInput[]) => void
  onPriceChange: (providerId: string, price: number) => void
  onProviderBudget: (providerId: string, v: number) => void
  onAccountBudget: (accountId: string, v: number) => void
  onOpenReport: () => void
  priceAlerts: PriceChange[]; priceCheckedAt: string | null; checkingPrices: boolean
  onCheckPrices: () => void; onAckPriceAlerts: () => void
  onRefresh: () => void; refreshing: boolean
}) {
  const [selectedUsage, setSelectedUsage] = useState<Set<string>>(new Set())
  const [rankTab, setRankTab] = useState<'provider' | 'model'>('provider')
  const month = todayISO().slice(0, 7)
  const monthEvents = state.usage.filter(u => u.date.startsWith(month))
  const [usagePage, setUsagePage] = useState(1)
  const USAGE_PAGE_SIZE = 3
  useEffect(() => { setUsagePage(1) }, [monthEvents.length])
  const usageCur = Math.min(usagePage, Math.max(1, Math.ceil(monthEvents.length / USAGE_PAGE_SIZE)))
  const pagedUsage = monthEvents.slice().reverse().slice((usageCur - 1) * USAGE_PAGE_SIZE, usageCur * USAGE_PAGE_SIZE)
  const totalCost = monthEvents.reduce((s, u) => s + u.estimatedCost, 0)
  const totalIn = monthEvents.reduce((s, u) => s + u.inputTokens, 0)
  const totalOut = monthEvents.reduce((s, u) => s + u.outputTokens, 0)
  const budget = state.settings.monthlyBudget
  const budgetPct = budget > 0 ? Math.min(100, Math.round(totalCost / budget * 100)) : 0

  const byDay = useMemo(() => {
    const map: Record<string, number> = {}
    monthEvents.forEach(u => { map[u.date] = (map[u.date] ?? 0) + u.estimatedCost })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).slice(-14)
  }, [monthEvents])

  const maxDay = Math.max(...byDay.map(d => d[1]), 0.01)
  const spendByPlatform = monthlySpendByPlatform(state, month)
  const ownedProviders = Array.from(new Set(state.accounts.map(a => a.providerId)))
  const prices = state.settings.unitPrices ?? {}
  const effectivePrices = { ...DEFAULT_UNIT_PRICES, ...prices }
  const rankRows = rankTab === 'provider' ? rankProvidersByValue(state) : rankModelsByValue(state)
  const subSummary = summarizeSubscriptions(state)
  const projectRows = summarizeByProject(state, month)
  const spendFc = forecastMonthSpend(state)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <GlobalRefreshButton refreshing={refreshing} onRefresh={onRefresh} />
      </div>
      <div className="stats-grid">
        <StatCard icon={<Wallet size={17} />} color="blue" label="本月费用" value={`¥${totalCost.toFixed(2)}`} hint="本地估算" />
        <StatCard icon={<BarChart3 size={17} />} color="green" label="本月 Tokens" value={(totalIn + totalOut).toLocaleString()} hint={t('输入 {input} · 输出 {output}', { input: totalIn.toLocaleString(), output: totalOut.toLocaleString() })} />
        <StatCard icon={<TrendingUp size={17} />} color="amber" label="预算使用" value={`${budgetPct}%`} hint={t('预算 ¥{budget}', { budget: budget.toFixed(0) })} />
        <StatCard icon={<CalendarCheck2 size={17} />} color="blue" label="记录天数" value={String(new Set(monthEvents.map(u => u.date)).size)} hint="本月已记录" />
      </div>

      <div className="split">
        <div className="panel" style={{ padding: 18 }}>
          <div className="section-head" style={{ marginTop: 0 }}><h2>{t('费用趋势')} <span className="hint">{t('近 14 天')}</span></h2></div>
          {byDay.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '20px 0' }}>{t('暂无数据')}</div> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, paddingTop: 10 }}>
              {byDay.map(([date, cost]) => (
                <div key={date} style={{ flex: 1, textAlign: 'center' }} title={`${date}: ¥${cost.toFixed(2)}`}>
                  <div style={{ background: 'var(--primary)', borderRadius: '4px 4px 0 0', height: `${Math.max(4, cost / maxDay * 96)}px`, marginBottom: 5 }} />
                  <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{date.slice(8)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel" style={{ padding: 18 }}>
          <div className="section-head" style={{ marginTop: 0 }}><h2>{t('预算设置')}</h2></div>
          <div className="field">
            <label>{t('每月预算（元）')}</label>
            <input className="input" type="number" min="0" step="10" defaultValue={budget}
                   onBlur={e => { const v = Number(e.target.value); if (!isNaN(v) && v >= 0) { onBudget(v); notify('预算已更新') } }} />
          </div>
          <div className="progress" style={{ height: 8 }}><div style={{ width: `${budgetPct}%`, background: budgetPct >= 90 ? 'var(--red)' : 'var(--primary)' }} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
            <span>{t('已用 ¥{used}', { used: totalCost.toFixed(2) })}</span><span>{t('预算 ¥{budget}', { budget: budget.toFixed(0) })}</span>
          </div>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={onOpenReport}>{t('查看月度报告 →')}</button>
        </div>
      </div>

      <div className="section-head"><h2>{t('按平台消费结构')} <span className="hint">{t('本月')}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {spendByPlatform.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('暂无消费数据')}</div>
        ) : spendByPlatform.map(p => (
          <div key={p.providerId} style={{ marginBottom: 13 }}>
            <div className="row between" style={{ fontSize: 12.5, marginBottom: 6 }}>
              <span style={{ fontWeight: 500 }}>{p.name}</span>
              <span style={{ color: 'var(--text-2)' }}>¥{p.cost.toFixed(2)} · {(p.share * 100).toFixed(0)}%</span>
            </div>
            <div className="progress"><div style={{ width: `${Math.max(2, p.share * 100)}%`, background: 'var(--primary)' }} /></div>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>{t('分平台预算')} <span className="hint">{t('本月 · 留空或 0 表示不限；超 90% 会提醒')}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {ownedProviders.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('添加账户后可为各平台单独设置月预算')}</div>
        ) : Array.from(new Set([...ownedProviders, ...Object.keys(state.settings.providerBudgets ?? {})])).map(pid => {
          const spend = spendByPlatform.find(p => p.providerId === pid)?.cost ?? 0
          const pb = state.settings.providerBudgets?.[pid] ?? 0
          const pct = pb > 0 ? Math.min(100, Math.round(spend / pb * 100)) : 0
          return (
            <div className="settings-row" key={pid}>
              <span style={{ fontSize: 13 }}>{PROVIDER_MAP[pid]?.shortName ?? pid}
                <span style={{ color: 'var(--text-3)', fontSize: 11.5, marginLeft: 8 }}>{t('本月已花 ¥{spend}{pct}', { spend: spend.toFixed(2), pct: pb > 0 ? ` · ${pct}%` : '' })}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pb > 0 && <span className="progress" style={{ width: 90 }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--red)' : pct >= 90 ? 'var(--amber)' : 'var(--primary)' }} /></span>}
                <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t('预算 ¥')}</span>
                <input className="input" type="number" min="0" step="10" style={{ width: 96 }}
                  defaultValue={pb || ''}
                  placeholder={t('不限')}
                  key={`${pid}-${pb}`}
                  onBlur={e => { const v = Number(e.target.value); if (!isNaN(v) && v >= 0 && v !== pb) { onProviderBudget(pid, v); notify(v > 0 ? '分平台预算已更新' : '已取消该平台预算') } }} />
              </span>
            </div>
          )
        })}
      </div>

      <div className="section-head"><h2>{t('分账户预算')} <span className="hint">{t('本月 · 给单个 Key/账户单独设上限；留空或 0 表示不限，超 90% 会提醒')}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {state.accounts.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('添加账户后可为单个账户单独设置月预算')}</div>
        ) : state.accounts
          .filter(a => (state.settings.accountBudgets?.[a.id] ?? 0) > 0 || monthEvents.some(u => u.accountId === a.id))
          .map(a => {
            const spend = monthEvents.filter(u => u.accountId === a.id).reduce((s, u) => s + u.estimatedCost, 0)
            const ab = state.settings.accountBudgets?.[a.id] ?? 0
            const pct = ab > 0 ? Math.min(100, Math.round(spend / ab * 100)) : 0
            return (
              <div className="settings-row" key={a.id}>
                <span style={{ fontSize: 13 }}>{a.label || PROVIDER_MAP[a.providerId]?.shortName || a.providerId}
                  <span style={{ color: 'var(--text-3)', fontSize: 11.5, marginLeft: 8 }}>{t('{platform} · 本月已花 ¥{spend}{pct}', { platform: PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId, spend: spend.toFixed(2), pct: ab > 0 ? ` · ${pct}%` : '' })}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {ab > 0 && <span className="progress" style={{ width: 90 }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--red)' : pct >= 90 ? 'var(--amber)' : 'var(--primary)' }} /></span>}
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t('预算 ¥')}</span>
                  <input className="input" type="number" min="0" step="10" style={{ width: 96 }}
                    defaultValue={ab || ''}
                    placeholder={t('不限')}
                    key={`${a.id}-${ab}`}
                    onBlur={e => { const v = Number(e.target.value); if (!isNaN(v) && v >= 0 && v !== ab) { onAccountBudget(a.id, v); notify(v > 0 ? '分账户预算已更新' : '已取消该账户预算') } }} />
                </span>
              </div>
            )
          })}
        {state.accounts.length > 0 && state.accounts.every(a => (state.settings.accountBudgets?.[a.id] ?? 0) <= 0 && !monthEvents.some(u => u.accountId === a.id)) && (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('本月暂无消费的账户不显示；给账户所在行填预算即可单独管控')}</div>
        )}
      </div>

      <div className="section-head"><h2>{t('订阅续费')} <span className="hint">{t('订阅制账户的固定支出与下次续费日 · 在 API Key 管理里编辑账户填写订阅信息')}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {subSummary.rows.length === 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('暂无订阅账户。订阅制账户（如包月/包年套餐）在 API Key 管理里编辑该账户，勾选「这是订阅制账户」并填价格、周期和下次续费日，就会汇总到这里。')}</div>
          : <>
            {subSummary.rows.map(r => (
              <div key={r.accountId} className="row between" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13.5 }}>{r.label} <span className="hint">{r.platform}</span></span>
                <span style={{ fontSize: 13.5 }}>{t('¥{price} / {cycle} · 下次续费 {date}', { price: r.price.toFixed(2), cycle: r.cycle === 'monthly' ? t('月') : t('年'), date: r.nextRenewAt })} <b style={{ color: r.daysLeft <= 7 ? 'var(--red)' : r.daysLeft <= 30 ? 'var(--amber, #d97706)' : 'var(--text-3)' }}>{r.daysLeft === 0 ? t('今天') : t('{days} 天后', { days: r.daysLeft })}</b></span>
              </div>
            ))}
            <div className="row between" style={{ paddingTop: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{t('每月固定支出合计（年付按月摊销）')}</span>
              <b>¥{subSummary.monthlyTotal.toFixed(2)}</b>
            </div>
          </>}
      </div>

      <div className="section-head"><h2>{t('性价比榜')} <span className="hint">{t('按你的实际用量统计 · ¥/百万 token，越低越划算（样本需 ≥1 万 token）')}</span></h2>
        <div className="row" style={{ gap: 6 }}>
          <button className={`btn sm ${rankTab === 'provider' ? 'primary' : 'ghost'}`} onClick={() => setRankTab('provider')}>{t('按平台')}</button>
          <button className={`btn sm ${rankTab === 'model' ? 'primary' : 'ghost'}`} onClick={() => setRankTab('model')}>{t('按模型')}</button>
        </div>
      </div>
      <div className="panel" style={{ padding: 18 }}>
        {rankRows.length === 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('暂无足够样本：某个{kind}的累计用量达到 1 万 token 后会出现在这里。', { kind: rankTab === 'provider' ? t('平台') : t('模型') })}</div>
          : rankRows.slice(0, 10).map((r, i) => (
            <div key={r.key} className="row between" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13.5 }}>{i + 1}. {r.name}</span>
              <span style={{ fontSize: 13.5 }}><b>¥{r.perMillion.toFixed(2)}</b> {t('/ 百万 token')} <span className="hint">{t('共 {tokens} 万 token · 花 ¥{cost}', { tokens: (r.tokens / 10000).toFixed(1), cost: r.cost.toFixed(2) })}</span></span>
            </div>
          ))}
      </div>

      <div className="section-head"><h2>{t('本月消费预测')} <span className="hint">{t('按本月日均速度推算到月底，提前看会不会超预算')}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {spendFc.spent <= 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('本月暂无消费记录。')}</div>
          : <div style={{ fontSize: 13.5, lineHeight: 1.9 }}>
              {t('本月已过 {elapsed}/{total} 天 · 已花', { elapsed: spendFc.daysElapsed, total: spendFc.daysInMonth })} <b>¥{spendFc.spent.toFixed(2)}</b> {t('· 日均 ¥{avg}', { avg: spendFc.dailyAvg.toFixed(2) })}<br />
              {t('按当前速度，月底预计总消费')} <b style={{ fontSize: 15 }}>¥{spendFc.projected.toFixed(2)}</b>
              {state.settings.monthlyBudget > 0 && (
                <> {t('· 月预算 ¥{budget} ——', { budget: state.settings.monthlyBudget.toFixed(0) })} {spendFc.projected > state.settings.monthlyBudget
                  ? <b style={{ color: 'var(--red)' }}>{t('预计超支 ¥{over}，注意控制', { over: (spendFc.projected - state.settings.monthlyBudget).toFixed(2) })}</b>
                  : <span style={{ color: '#16a34a' }}>{t('在预算内（预计用 {pct}%）', { pct: (spendFc.projected / state.settings.monthlyBudget * 100).toFixed(0) })}</span>}</>
              )}
            </div>}
      </div>

      <div className="section-head"><h2>{t('按项目汇总')} <span className="hint">{t('给用量记录打项目标签后，这里看每个项目花了多少 · 添加用量记录时填写「项目标签」')}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {projectRows.length === 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('暂无用量记录。')}</div>
          : projectRows.map(r => (
            <div key={r.project} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13.5 }}>{r.project} <span className="hint">{t('{count} 笔', { count: r.count })}</span></span>
              <span style={{ fontSize: 13 }}>{t('本月 ¥{month} · 累计', { month: r.monthCost.toFixed(2) })} <b>¥{r.totalCost.toFixed(2)}</b> {t('· {tokens} 万 token', { tokens: (r.tokens / 10000).toFixed(1) })}</span>
            </div>
          ))}
      </div>

      <div className="section-head"><h2>{t('价格动态')} <span className="hint">{t('官方参考单价变动订阅 · 每 6 小时自动检查')}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        <div className="row between" style={{ marginBottom: priceAlerts.length ? 10 : 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {priceCheckedAt
              ? t('上次检查：{time}', { time: new Date(priceCheckedAt).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) })
              : t('尚未检查')} {t('· 平台调价时自动记录，涉及你账户的变动会弹窗提醒')}
          </span>
          <button className="btn sm" disabled={checkingPrices} onClick={onCheckPrices}>{checkingPrices ? t('检查中…') : t('检查更新')}</button>
        </div>
        {priceAlerts.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('暂无价格变动')}</div>
        ) : <>
          {priceAlerts.map((c, i) => (
            <div key={`${c.providerId}-${c.detectedAt}-${i}`} className="settings-row">
              <span style={{ fontSize: 13 }}>{PROVIDER_MAP[c.providerId]?.name ?? c.providerId}
                <span style={{ color: 'var(--text-3)', fontSize: 11.5, marginLeft: 8 }}>{t('{date} 检测到', { date: new Date(c.detectedAt).toLocaleDateString(locale()) })}</span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: c.newPrice > c.oldPrice ? '#dc2626' : '#16a34a' }}>
                {c.newPrice > c.oldPrice ? t('↑ 涨价') : t('↓ 降价')} ¥{c.oldPrice} → ¥{c.newPrice} {t('/ 单位')}
              </span>
            </div>
          ))}
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <button className="btn sm ghost" onClick={onAckPriceAlerts}>{t('全部知道了')}</button>
          </div>
        </>}
      </div>

      <div className="section-head"><h2>{t('额度单价校准')} <span className="hint">{t('用于资源总估值 · 官方参考价 {asOf}', { asOf: OFFICIAL_PRICES_AS_OF })}</span></h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {ownedProviders.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('添加账户后可校准对应平台的单价')}</div>
        ) : (<>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn sm" onClick={() => {
              let changed = 0
              for (const pid of ownedProviders) {
                const off = officialUnitPrice(pid)
                if (off !== undefined && priceDrifted(effectivePrices[pid] ?? DEFAULT_UNIT_PRICES.default, off)) { onPriceChange(pid, off); changed++ }
              }
              notify(changed ? t('已按官方参考价校准 {n} 个平台', { n: changed }) : '所有平台单价已与官方参考价一致')
            }} title={t('把已收录平台的单价一键填为官方参考价（不同模型价格差异较大，仅作估值参考）')}>{t('按官方价自动校准')}</button>
          </div>
          {ownedProviders.map(pid => { const off = officialUnitPrice(pid); const eff = effectivePrices[pid] ?? DEFAULT_UNIT_PRICES.default; const drift = priceDrifted(eff, off); return (
          <div className="settings-row" key={pid}>
            <span style={{ fontSize: 13 }}>{PROVIDER_MAP[pid]?.shortName ?? pid}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {drift && <span style={{ fontSize: 11.5, color: 'var(--amber, #d97706)' }}>{t('官方参考 ¥{price}', { price: off ?? 0 })}</span>}
              {drift && <button className="btn sm ghost" onClick={() => onPriceChange(pid, off!)}>{t('采用')}</button>}
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{t('元 / {unit}', { unit: t(UNIT_LABEL[state.quotas.find(q => q.accountId === state.accounts.find(a => a.providerId === pid)?.id)?.unit ?? 'credit']) })}</span>
              <input className="input" type="number" min="0" step="0.0001"
                value={eff}
                onChange={e => onPriceChange(pid, Math.max(0, Number(e.target.value)))}
                style={{ width: 100 }} />
            </span>
          </div> ) })}
        </>)}
      </div>

      <div className="section-head"><h2>{t('用量记录')} <span className="hint">{t('{n} 条', { n: monthEvents.length })}</span></h2></div>
      <SelectionBar
        selectedCount={selectedUsage.size} totalOnPage={pagedUsage.length}
        allSelected={pagedUsage.length > 0 && pagedUsage.every(u => selectedUsage.has(u.id))}
        onToggleAll={() => {
          const next = new Set(selectedUsage)
          const allOn = pagedUsage.every(u => next.has(u.id))
          if (allOn) pagedUsage.forEach(u => next.delete(u.id)); else pagedUsage.forEach(u => next.add(u.id))
          setSelectedUsage(next)
        }}
        onClear={() => setSelectedUsage(new Set())}
        actions={<button className="btn sm danger" onClick={() => {
          onDeleteUsage(Array.from(selectedUsage)); notify(t('已删除 {n} 条记录', { n: selectedUsage.size })); setSelectedUsage(new Set())
        }}><Trash2 size={13} /> {t('批量删除')}</button>}
      />
      <div className="panel">
        <table>
          <thead><tr>
            <th style={{ width: 32 }}><input type="checkbox" title={t('全选本页')}
              checked={pagedUsage.length > 0 && pagedUsage.every(u => selectedUsage.has(u.id))}
              onChange={e => {
                const next = new Set(selectedUsage)
                if (e.target.checked) pagedUsage.forEach(u => next.add(u.id)); else pagedUsage.forEach(u => next.delete(u.id))
                setSelectedUsage(next)
              }} /></th>
            <th>{t('日期')}</th><th>{t('账户')}</th><th>{t('模型')}</th><th>{t('输入 Tokens')}</th><th>{t('输出 Tokens')}</th><th>{t('估算费用')}</th>
          </tr></thead>
          <tbody>
            {monthEvents.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 30 }}>{t('暂无记录')}</td></tr> :
              pagedUsage.map(u => {
                const acc = state.accounts.find(a => a.id === u.accountId)
                return (
                  <tr key={u.id}>
                    <td><input type="checkbox" checked={selectedUsage.has(u.id)} onChange={e => {
                      const next = new Set(selectedUsage)
                      if (e.target.checked) next.add(u.id); else next.delete(u.id)
                      setSelectedUsage(next)
                    }} /></td>
                    <td className="mono">{u.date}</td>
                    <td>{acc?.label ?? '—'}</td>
                    <td className="mono">{u.model ?? '—'}</td>
                    <td className="mono">{u.inputTokens.toLocaleString()}</td>
                    <td className="mono">{u.outputTokens.toLocaleString()}</td>
                    <td>¥{u.estimatedCost.toFixed(3)}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      <Pager total={monthEvents.length} page={usagePage} pageSize={USAGE_PAGE_SIZE} onChange={setUsagePage} />
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={onAddUsage}><Plus size={13} /> {t('手动添加记录')}</button>
        <label className="btn sm" style={{ cursor: 'pointer' }}>
          <Download size={13} style={{ transform: 'rotate(180deg)' }} /> {t('导入 CSV')}
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              try {
                const events = parseUsageCsv(String(reader.result), state.accounts)
                if (events.length === 0) { notify(t('未解析到有效记录，请检查 CSV 格式')); return }
                onImport(events)
              } catch (err: any) { notify(err.message ?? 'CSV 解析失败') }
            }
            reader.readAsText(file)
            e.target.value = ''
          }} />
        </label>
        <button className="btn sm ghost" onClick={async () => {
          const csv = 'date,account,inputTokens,outputTokens,cost,model\n2026-01-01,我的账户,1000,500,0.15,gpt-4o\n'
          const r = await saveExportFile('usage-template.csv', '\ufeff' + csv)
          if (r.cancelled) return
          notify(r.ok ? t('模板已保存到：{where}', { where: r.where ?? '' }) : t('导出失败：{err}', { err: r.error ?? t('未知错误') }))
        }}><Download size={13} /> {t('CSV 模板')}</button>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)', alignSelf: 'center' }}>{t('列：date, account, inputTokens, outputTokens, cost, model')}</span>
      </div>
    </>
  )
}

/** 第一步：选择要添加的平台 */
/** 本地模型独立添加页：路径为 Key，网关端口由本机实时探测（只读不可改） */
function LocalAccountFormModal({ provider, sessionPwd, onClose, onSave, notify, onStartService, serviceController }: {
  provider: ProviderDefinition; sessionPwd: string;
  onClose: () => void;
  onSave: (account: AppState['accounts'][number], pwd: string) => void;
  notify: (m: string) => void;
  /** 一键启动入口：优先走服务控制器（同步开关状态），缺省直接拉进程 */
  onStartService?: (key: LocalServiceKey) => Promise<{ ok: boolean; message: string }>;
  /** 服务开关控制器：开关关闭时弹窗不探测服务（开关即权威），需先打开开关 */
  serviceController?: ServiceController;
}) {
  const [services, setServices] = useState<LocalService[]>([])
  const [selected, setSelected] = useState<LocalService | null>(null)
  const [path, setPath] = useState('')
  const [note, setNote] = useState('')
  const [detecting, setDetecting] = useState(true)
  const [detectErr, setDetectErr] = useState('')
  const [busy, setBusy] = useState(false)
  // 就地输入主密码（无会话解锁/生物识别时）
  const [formPwd, setFormPwd] = useState('')
  const pwdRef = useRef<HTMLInputElement>(null)
  // 探测序号：只有最新一次探测的结果可以落盘，避免旧探测晚返回覆盖新状态
  const detectSeq = useRef(0)
  const setPwdFocus = () => pwdRef.current?.focus()
  const needInlinePwd = !sessionPwd && !getBiometricPassword()
  // 从本地服务拉取的已加载模型列表（选择式输入主入口）
  const [availModels, setAvailModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsErr, setModelsErr] = useState('')

  const serviceKey = provider.id === 'local-ollama' ? 'ollama'
    : provider.id === 'local-comfyui' ? 'comfyui' : 'lmstudio'
  // 开关即权威：该服务开关关闭时不探测本机服务（哪怕端口上正好有服务在跑也不显示），
  // 打开开关后才探测。控制器缺省时（异常路径）按开启处理，不挡正常添加。
  const svcEnabled = serviceController ? serviceController.enabled(serviceKey) : true
  /** 拉取当前服务的模型列表 */
  const loadModels = async (svc: LocalService) => {
    setModelsLoading(true); setModelsErr('')
    const r = await fetchLocalModels(serviceKey, svc.url)
    setAvailModels(r.models)
    setModelsErr(r.error ?? '')
    setModelsLoading(false)
  }
  // 选中服务变化时拉取模型列表
  useEffect(() => {
    if (selected) void loadModels(selected)
    else { setAvailModels([]); setModelsErr('') }
  }, [selected?.url])

  // 当前弹窗期望的服务类型（用于过滤探测结果，避免把别的本地服务混进来）
  const expectService = provider.id === 'local-ollama' ? 'Ollama'
    : provider.id === 'local-comfyui' ? 'ComfyUI' : ''
  const detect = async () => {
    // 开关关闭：不探测，直接清空（与设置页开关状态保持一致）
    if (!svcEnabled) { setServices([]); setSelected(null); setDetecting(false); return }
    const seq = ++detectSeq.current
    setDetecting(true); setDetectErr('')
    // 先直查期望服务的默认端口（单服务指纹校验，命中即返回，不必跑全端口扫描）
    if (expectService) {
      const url = await checkLocalService(serviceKey).catch(() => null)
      if (seq !== detectSeq.current) return
      if (url) {
        const port = Number(new URL(url).port) || (serviceKey === 'ollama' ? 11434 : serviceKey === 'comfyui' ? 8188 : 1234)
        const svc: LocalService = { service: expectService, host: '127.0.0.1', port, url }
        setServices([svc]); setSelected(svc); setDetecting(false)
        return
      }
    }
    const r = await detectLocalServices()
    if (seq !== detectSeq.current) return
    // 按 provider 精确匹配：如添加 Ollama 只显示识别为 Ollama 的服务
    const matched = expectService ? r.services.filter(s => s.service === expectService) : r.services
    setServices(matched)
    setDetectErr(r.error ?? '')
    if (matched.length) setSelected(prev => prev && matched.some(s => s.port === prev.port) ? prev : matched[0])
    else setSelected(null)
    setDetecting(false)
  }
  // 开关状态驱动探测：打开（含弹窗打开时已开）→ 探测；关闭 → 作废进行中的探测并清空
  useEffect(() => {
    if (svcEnabled) void detect()
    else { detectSeq.current++; setServices([]); setSelected(null); setDetecting(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svcEnabled])

  // 一键启动：探测不到服务时直接在弹窗内拉起本机服务，起来后自动重新探测并选中
  const [starting, setStarting] = useState(false)
  const startService = async () => {
    setStarting(true)
    // 作废进行中的探测并退出「正在探测」状态：启动与探测互不阻塞，按钮点下去立刻有反馈
    detectSeq.current++
    setDetecting(false)
    try {
      const r = onStartService ? await onStartService(serviceKey) : await startLocalService(serviceKey)
      if (!r.ok) { notify(r.message); return }
      notify(t('正在启动 {service}…', { service: expectService || provider.shortName }))
      // 轮询等待服务真正开始监听（最多约 21 秒），命中后自动重新探测
      for (let i = 0; i < 14; i++) {
        await new Promise(res => setTimeout(res, 1500))
        const url = await checkLocalService(serviceKey).catch(() => null)
        if (url) { await detect(); return }
      }
      notify(t('启动命令已执行，但仍未探测到 {service}，请确认本机已正确安装后点「重新探测」', { service: expectService || provider.shortName }))
    } finally { setStarting(false) }
  }

  const submit = async () => {
    if (!selected) { notify('请先选择本机探测到的服务'); return }
    if (!path.trim()) { notify('请选择或输入模型'); return }
    if (isMotionModule(path.trim())) { notify('这是 AnimateDiff 运动模块，不能单独作为模型使用，请选择一个 checkpoint 底模'); return }
    if (!isVaultInitialized()) { notify('请先在「设置 → 安全」创建保险箱'); return }
    // 密码来源：会话解锁 > 生物识别 > 表单内就地输入（不再强制跳转到 Key 管理页解锁）
    const pwd = sessionPwd || getBiometricPassword() || formPwd.trim()
    if (!pwd) { notify('请在下方输入主密码以加密保存'); setPwdFocus(); return }
    setBusy(true)
    try {
      if (!(await verifyVault(pwd))) { notify('主密码错误'); return }
      // Key 值 = 模型路径地址；apiUrl = 探测到的本机网关（不可改）
      const enc = await encryptSecret(path.trim(), pwd)
      const now = new Date().toISOString()
      const capability = detectModelCapability(path.trim())
      const account: AppState['accounts'][number] = {
        id: uid('acc'), providerId: provider.id, label: path.trim().split(/[\\/]/).pop() || provider.shortName,
        mode: 'api', encryptedKey: enc, keyFingerprint: fingerprint(path.trim()),
        apiUrl: selected.url, note: note.trim() || `本地 ${selected.service}`,
        modelCapability: capability.capability,
        createdAt: now, updatedAt: now,
      }
      onSave(account, pwd)
    } catch (e) { notify((e as Error)?.message ?? '保存失败') }
    finally { setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal account-form-modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <div className="row" style={{ gap: 10 }}>
            <ProviderLogo provider={provider} size={30} />
            <div>
              <h3 style={{ margin: 0 }}>{t('添加本地模型 · {name}', { name: provider.shortName })}</h3>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{t('网关地址由本机实时探测，不可修改')}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label className="form-label">{t('本机服务（实时探测 · 网关与端口不可改）')}</label>
            {!svcEnabled && serviceController ? (
              <>
                <div className="form-static" style={{ color: 'var(--text-2)' }}>
                  {t('{service} 的服务开关已关闭。关闭时不探测本机服务，打开开关后才能检测并添加。', { service: expectService || provider.shortName })}
                </div>
                <div style={{ marginTop: 8 }}>
                  <ServiceSwitch controller={serviceController} serviceKey={serviceKey} />
                </div>
              </>
            ) : (
              <>
                {detecting ? <div className="form-static">{t('正在探测本机服务…')}</div> : services.length === 0
                  ? <div className="form-static" style={{ color: 'var(--red)' }}>
                      {detectErr || (expectService
                        ? t('未检测到运行中的 {service} 服务，请先在本机启动{portHint}后点「重新探测」', { service: expectService, portHint: expectService === 'Ollama' ? t('（默认端口 11434）') : expectService === 'ComfyUI' ? t('（默认端口 8188）') : '' })
                        : t('未检测到本机本地模型服务，请确认服务已启动'))}
                    </div>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {services.map(s => (
                      <button key={`${s.host}:${s.port}`} className={`backup-option ${selected?.port === s.port ? 'active' : ''}`} onClick={() => setSelected(s)}>
                        <span><b>{s.service}</b><small>{s.url}</small></span>
                      </button>
                    ))}
                  </div>}
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn sm" onClick={() => void detect()} disabled={detecting || starting}>{t('重新探测')}</button>
                  {serviceKey !== 'lmstudio' && isDesktopApp() && (
                    services.length === 0 ? (
                      <button className="btn sm primary" onClick={() => void startService()} disabled={starting}>
                        {starting ? t('正在启动…') : t('一键启动 {service}', { service: expectService || provider.shortName })}
                      </button>
                    ) : (
                      // 已探测到 = 服务已在运行：按钮常显但禁用，明示状态，避免用户以为 Ollama 没有一键启动
                      <button className="btn sm" disabled>{t('{service} 已在运行', { service: expectService || provider.shortName })}</button>
                    )
                  )}
                </div>
              </>
            )}
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <label className="form-label">{t('选择模型')}
              <span style={{ fontWeight: 400, color: 'var(--text-3)', fontSize: 11 }}>{t('（作为标识加密保存）')}</span>
            </label>
            {/* 主入口：从服务已加载的模型列表选择（自动标注能力类型） */}
            {availModels.length > 0 ? (
              <select className="select" value={path} onChange={e => setPath(e.target.value)} disabled={busy} style={{ width: '100%' }}>
                <option value="">{t('请选择模型…')}</option>
                {availModels.map(m => {
                  const cap = detectModelCapability(m)
                  // 运动模块不是底模：列出但禁用，避免被误选为图像/对话模型
                  return <option key={m} value={m} disabled={isMotionModule(m)}>{m}　[{t(cap.label)}]</option>
                })}
              </select>
            ) : modelsLoading ? (
              <div className="me-skeleton-stack" aria-label={t('正在从本机服务读取模型列表')}>
                <div className="me-skeleton" style={{ height: 14, width: '72%' }} />
                <div className="me-skeleton" style={{ height: 14, width: '55%', marginTop: 8 }} />
                <div className="me-skeleton" style={{ height: 14, width: '63%', marginTop: 8 }} />
              </div>
            ) : (
              <div className="local-model-hint">
                {modelsErr ? t('未能自动读取模型列表：{err}', { err: modelsErr }) : t('本机服务暂无可读取的模型列表')}
              </div>
            )}
            {availModels.some(m => isMotionModule(m)) && (
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.6 }}>
                {t('列表中灰色的运动模块不能单独添加为账户；它在「AI 视频 · 本地」页里与底模搭配生成视频，直接从 ComfyUI 读取，无需在此添加')}
              </div>
            )}
            {/* 选中模型的能力标注与提示 */}
            {path.trim() && (() => {
              const cap = detectModelCapability(path.trim())
              const hidden = shouldHideFromChat(cap)
              return (
                <div className={`model-cap-hint ${hidden ? 'warn' : ''}`}>
                  <span className="cap-badge">{t(cap.label)}</span>
                  <span>{isMotionModule(path.trim())
                    ? t('这是 AnimateDiff 运动模块，不能单独出图或对话；需在 ComfyUI 的 AnimateDiff 工作流中搭配 SD1.5 底模生成视频。')
                    : hidden
                    ? t('{reason}识别为「{label}」模型，不能用于 AI 聊天对话；添加后会在聊天列表自动隐藏。', { reason: cap.reason, label: t(cap.label) })
                    : cap.capability === 'translation'
                      ? t('翻译专用模型，可走对话接口但更适合翻译任务。')
                      : cap.capability === 'unknown'
                        ? t('未识别类型，默认允许聊天；如实际不能对话请留意。')
                        : t('识别为对话模型，可用于 AI 聊天。')}</span>
                </div>
              )
            })()}
            <div className="local-model-actions">
              <button className="btn sm" disabled={busy || modelsLoading} onClick={() => { if (selected) void loadModels(selected) }}>
                {modelsLoading ? t('读取中…') : t('刷新模型列表')}
              </button>
              <button className="btn sm" disabled={busy} onClick={async () => {
                const picked = await chooseModelFile()
                if (picked) setPath(picked.split(/[\\/]/).pop() || picked)
              }}>{t('浏览本地文件…')}</button>
            </div>
            {/* 兜底：手动输入 */}
            <input className="input" style={{ marginTop: 8 }} value={path} onChange={e => setPath(e.target.value)}
              placeholder={t('也可手动输入模型名，如 llama3:latest')} disabled={busy} />
            <div className="local-model-note">
              {t('优先从服务已加载的模型中选择；「浏览本地文件」仅取文件名作标识。支持格式：Ollama 用自身管理的模型（如 llama3、qwen2.5:7b）；ComfyUI 支持 .gguf / .safetensors / .ckpt / .bin（需放在 ComfyUI 的 models 目录）；LM Studio 支持 .gguf。App 不直接加载文件，实际调用由本机服务完成。')}
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <label className="form-label">{t('备注（可选）')}</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder={t('用途说明')} disabled={busy} />
          </div>
          {needInlinePwd && (
            <div className="form-row" style={{ marginTop: 12 }}>
              <label className="form-label">{t('主密码')} <span className="req">*</span> <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{t('· 用于加密本次保存，输入后本次会话记住')}</span></label>
              <input ref={pwdRef} className="input" type="password" value={formPwd} onChange={e => setFormPwd(e.target.value)} placeholder={t('输入保险箱主密码')} disabled={busy} />
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.6 }}>
            {t('本地模型仅保存在本机，不参与云同步、备份与导出（路径含本机信息，无跨端意义）。')}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy || !selected}>{busy ? t('保存中…') : t('添加本地模型')}</button>
        </div>
      </div>
    </div>
  )
}

function PlatformPickerModal({ onClose, onPick }: {
  onClose: () => void; onPick: (providerId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ProviderDefinition['category'] | 'all'>('all')
  const q = query.trim().toLowerCase()
  const matched = PROVIDERS.filter(p =>
    (category === 'all' || p.category === category) &&
    (!q || p.name.toLowerCase().includes(q) || p.shortName.toLowerCase().includes(q) || p.id.includes(q)),
  )
  const grouped = CATEGORY_ORDER
    .map(cat => ({ cat, items: matched.filter(p => p.category === cat) }))
    .filter(g => g.items.length > 0)
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal picker-modal" style={{ maxWidth: 640 }}>
        <div className="modal-head"><h3>{t('选择平台')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 12 }}>{t('按模型功能分类 · 共 {n} 个平台', { n: PROVIDERS.length })}</div>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <div className="search-wrap" style={{ flex: 1 }}>
              <Search size={14} />
              <input className="input" placeholder={t('搜索平台名称…')} value={query} onChange={e => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="category-chips">
            <button className={`chip ${category === 'all' ? 'active' : ''}`} onClick={() => setCategory('all')}>{t('全部')}</button>
            {CATEGORY_ORDER.map(cat => (
              <button key={cat} className={`chip ${category === cat ? 'active' : ''}`} onClick={() => setCategory(cat)}>{t(CATEGORY_LABEL[cat])}</button>
            ))}
          </div>
          <div className="platform-groups">
            {grouped.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>{t('没有匹配的平台')}</div>}
            {grouped.map(g => (
              <div className="platform-group" key={g.cat}>
                <div className="platform-group-title"><span className={`cat-dot cat-${g.cat}`} />{t(CATEGORY_LABEL[g.cat])} <span className="hint">{g.items.length}</span></div>
                <div className="provider-picker" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  {g.items.map(p => (
                    <button key={p.id} className="provider-opt" onClick={() => onPick(p.id)} title={t('添加 {name}', { name: p.name })}>
                      <ProviderLogo provider={p} size={30} />
                      <span className="p-name">{p.shortName}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>{t('取消')}</button></div>
      </div>
    </div>
  )
}

/** 第二步：填表 —— 平台名(固定) / API链接(只读可跳转) / 备注 / Key+自动余额 */
/** 智能粘贴：粘贴 API Key（可带说明文字）→ 按格式识别平台 → 确认后带着 Key 打开添加账户表单 */
function SmartPasteModal({ onClose, onConfirm }: {
  onClose: () => void
  onConfirm: (providerId: string, key: string) => void
}) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState('')
  const detection = useMemo(() => detectProviderFromKey(text), [text])
  const key = useMemo(() => extractKey(text), [text])
  useEffect(() => { if (detection) setPicked(detection.providerId) }, [detection?.providerId])
  const candidates = PROVIDERS.filter(p => !p.id.startsWith('local-'))
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-head"><h3 style={{ margin: 0 }}>{t('智能粘贴添加账户')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div style={{ padding: '4px 18px 18px' }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0, color: 'var(--text-2)' }}>{t('把 API Key 粘贴进来（带说明文字也没关系），按格式自动识别平台；识别不准可以在下面改选。')}</p>
          <textarea
            value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus
            placeholder={t('粘贴 API Key，例如 sk-… / gsk_… / sk-ant-…')}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12.5 }}
          />
          {text.trim() && !key && <p style={{ fontSize: 12.5, color: 'var(--red)' }}>{t('没识别到像 Key 的内容（需要一段至少 16 位的字母数字串）。')}</p>}
          {key && (
            <div style={{ marginTop: 10 }}>
              {detection
                ? <p style={{ fontSize: 12.5, margin: 0, color: 'var(--text-2)' }}>{t('识别结果：')}<b>{PROVIDER_MAP[detection.providerId]?.name ?? detection.providerId}</b>{detection.confidence === 'low' ? t('（低置信，请确认）') : ''} · {detection.reason}</p>
                : <p style={{ fontSize: 12.5, margin: 0, color: 'var(--text-2)' }}>{t('这个 Key 的格式没有特征，请手动选择平台：')}</p>}
              <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 13 }}>{t('平台')}</span>
                <select className="select" value={picked} onChange={e => setPicked(e.target.value)} style={{ flex: 1 }}>
                  <option value="">{t('请选择平台')}</option>
                  {candidates.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>{t('取消')}</button>
            <button className="btn primary" disabled={!key || !picked} onClick={() => onConfirm(picked, key)}>{t('下一步：填写账户信息')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountFormModal({ provider, sessionPwd, onClose, onSave, groupSuggestions, initialSecret }: {
  provider: ProviderDefinition; sessionPwd: string;
  onClose: () => void;
  onSave: (data: { account: AppState['accounts'][number]; quota?: QuotaSnapshot; pwd: string }) => void
  groupSuggestions: string[]
  /** 智能粘贴带入的 Key（预填密钥框） */
  initialSecret?: string
}) {
  const [note, setNote] = useState('')
  const [group, setGroup] = useState('')
  const [noteCat, setNoteCat] = useState<NoteCategory>('通用型')
  const [secret, setSecret] = useState(initialSecret ?? '')
  const [balance, setBalance] = useState<string | null>(null)
  // 已获取的剩余额度（结构化保存，提交时生成初始额度快照；label 型结果无快照）
  const [fetchedQuota, setFetchedQuota] = useState<{ total: number; unit: CreditUnit } | null>(null)
  const [fetching, setFetching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 就地输入主密码（无会话解锁/生物识别时）
  const [formPwd, setFormPwd] = useState('')
  const pwdRef = useRef<HTMLInputElement>(null)
  const needInlinePwd = !sessionPwd && !getBiometricPassword()
  const adapter = getAdapterWithPlugins(provider.id)

  const isCustom = provider.id === 'custom-endpoint'
  const [customUrl, setCustomUrl] = useState('')
  const isVoiceCfg = provider.id === 'voice-config'
  // 语音配置(APP)可选服务商（需 API Key 的；system/local 无需 Key，排除）
  const voiceProviderChoices = VOICE_PROVIDERS.filter(p => p.id !== 'system' && p.id !== 'local')
  const [voiceProvider, setVoiceProvider] = useState<string>(voiceProviderChoices[0]?.id ?? 'aliyun')
  const chosenVoice = voiceProviderChoices.find(p => p.id === voiceProvider)

  const apiUrl = isCustom ? customUrl.trim() : (provider.apiBaseUrl ?? '')
  // 语音配置：API 链接用所选服务商官方文档；其余用平台默认
  const keyUrl = isVoiceCfg
    ? (voiceProvider && VOICE_KEY_PROVIDER[voiceProvider] && PROVIDER_MAP[VOICE_KEY_PROVIDER[voiceProvider]]
      ? getKeyPageUrl(PROVIDER_MAP[VOICE_KEY_PROVIDER[voiceProvider]])
      : (chosenVoice?.docs ?? provider.officialUrl))
    : getKeyPageUrl(provider)

  const fetchBalance = async () => {
    setErr('')
    if (!secret.trim()) { setErr('请先输入 API Key'); return }
    if (!adapter.supported) {
      setBalance('该平台无公开余额 API，请在官方页面查看后手动录入')
      return
    }
    setFetching(true)
    try {
      const r = await adapter.fetchUsage!(secret.trim())
      setBalance(formatUsageBalance(r))
      if (r.label) setFetchedQuota(null)
      else if (r.remaining !== undefined) setFetchedQuota({ total: r.remaining, unit: 'currency' })
      else setFetchedQuota({ total: Math.max(0, (r.total ?? r.used) - r.used), unit: r.unit })
    } catch (e: any) { setErr(errorText(e, '获取余额失败')); setBalance(null); setFetchedQuota(null) }
    finally { setFetching(false) }
  }

  const reset = () => { setNote(''); setNoteCat('通用型'); setSecret(''); setBalance(null); setFetchedQuota(null); setErr('') }

  const submit = async () => {
    setErr('')
    if (isCustom && !customUrl.trim()) { setErr('请填写服务地址'); return }
    if (isCustom && !/^https?:\/\//i.test(customUrl.trim())) { setErr('服务地址需以 http:// 或 https:// 开头'); return }
    if (!isCustom && !secret.trim()) { setErr('请填写 API Key'); return }
    // 自定义端点没有 Key 时用占位值加密保存（网关不校验 Bearer；调用链要求 Key 非空）
    const secretVal = isCustom ? (secret.trim() || 'no-key-required') : secret.trim()
    if (!isVaultInitialized()) { setErr('请先在「设置 → 安全」创建保险箱'); return }
    // 密码来源：会话解锁 > 生物识别 > 表单内就地输入（不再强制跳转到 Key 管理页解锁）
    const pwd = sessionPwd || getBiometricPassword() || formPwd.trim()
    if (!pwd) { setErr('请在下方输入主密码以加密保存'); pwdRef.current?.focus(); return }
    setBusy(true)
    try {
      const ok = await verifyVault(pwd)
      if (!ok) { setErr('主密码错误'); return }
      const enc = await encryptSecret(secretVal, pwd)
      const fp = fingerprint(secretVal)
      const customHost = isCustom ? (() => { try { return new URL(customUrl.trim()).host } catch { return customUrl.trim() } })() : ''
      const now = new Date().toISOString()
      // 已获取的余额生成初始额度快照（若成功获取）
      const quotaTotal = fetchedQuota?.total ?? 0
      const account: AppState['accounts'][number] = {
        id: uid('acc'), providerId: provider.id,
        label: isVoiceCfg ? `${chosenVoice?.short ?? '语音'}（语音配置APP）` : isCustom ? `自定义 · ${customHost}` : provider.shortName,
        mode: 'api',
        encryptedKey: enc, keyFingerprint: fp, apiUrl: apiUrl || undefined,
        note: isVoiceCfg ? `[语音配置(APP)] ${chosenVoice?.short ?? ''}${note.trim() ? ' · ' + note.trim() : ''}` : buildNote(noteCat, note),
        group: group.trim() || undefined,
        voiceProvider: isVoiceCfg ? voiceProvider : undefined,
        createdAt: now, updatedAt: now,
      }
      const quota: QuotaSnapshot | undefined = quotaTotal > 0 ? {
        id: uid('q'), accountId: account.id, unit: fetchedQuota!.unit, total: quotaTotal, used: 0,
        capturedAt: now, source: 'api' as const,
      } : undefined
      onSave({ account, quota, pwd })
    } catch (e: any) { setErr(e.message ?? '保存失败') }
    finally { setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal account-form-modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <div className="row" style={{ gap: 10 }}>
            <ProviderLogo provider={provider} size={30} />
            <div>
              <h3 style={{ margin: 0 }}>{t('添加账户')}</h3>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{t('填写下方信息以添加并加密保存')}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {/* 行1：平台名（固定写死） */}
          <div className="form-row">
            <label className="form-label">{t('平台名称')}</label>
            <div className="form-static"><ProviderLogo provider={provider} size={22} /> <b>{provider.name}</b><span className="tag gray" style={{ marginLeft: 'auto' }}>{t('固定')}</span></div>
          </div>
          {/* 行2：API 链接地址（只读可点击直达创建 key 页）；自定义端点改为填服务地址 */}
          {isCustom ? (
            <div className="form-row">
              <label className="form-label">{t('服务地址（Base URL）')} <span className="req">*</span></label>
              <input className="input" placeholder="http://127.0.0.1:8000/v1 或 https://example.com/v1" value={customUrl} onChange={e => setCustomUrl(e.target.value)} />
              <div className="form-hint">{t('填 OpenAI 兼容网关地址，如 dsh 独立网关、One API、LM Studio、本地转发端口；模型列表会从该地址自动拉取')}</div>
            </div>
          ) : (
            <div className="form-row">
              <label className="form-label">API {t('链接地址')} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{t('· 点击前往官方创建 Key')}</span></label>
              <button className="form-link" onClick={() => { void openExternal(keyUrl); }} title={keyUrl}>
                <span>{isVoiceCfg ? (chosenVoice?.name ?? keyUrl) : (provider.apiBaseUrl || '—')}</span><ExternalLink size={13} />
              </button>
              <div className="form-hint">{t('只读 · 点击上述地址可直达官方 API Key 管理页')}</div>
            </div>
          )}
          {/* 行3：模型分类（语音配置固定，其余写死下拉）+ 可选说明 */}
          <div className="form-row">
            {isVoiceCfg ? (
              <>
                <label className="form-label">{t('语音服务商')} <span className="req">*</span></label>
                <select className="select" value={voiceProvider} onChange={e => { setVoiceProvider(e.target.value); setBalance(null) }}>
                  {voiceProviderChoices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="form-hint" style={{ marginTop: 6 }}>{chosenVoice?.desc}</div>
                <div className="voice-fixed-cat" style={{ marginTop: 10 }}>{t('🔊 语音配置(APP) · 专用于语音朗读/声音克隆')}</div>
                <input className="input" style={{ marginTop: 8 }} placeholder={t('备注（可选），例如：我的百炼 Key')} value={note} onChange={e => setNote(e.target.value)} />
                <div className="form-hint">{t('此 Key 仅「语音配置」模块使用；AI 聊天不会调用，也不会在聊天模型列表里出现。添加后会自动同步到「语音配置」页。')}</div>
              </>
            ) : (
              <>
                <label className="form-label">{t('模型分类')} <span className="req">*</span> <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{t('· 决定 AI 助手里该模型的用途与联动')}</span></label>
                <select className="select" value={noteCat} onChange={e => setNoteCat(e.target.value as NoteCategory)}>
                  {NOTE_CATEGORIES.map(c => <option key={c} value={c}>{t(c)}</option>)}
                </select>
                <input className="input" style={{ marginTop: 8 }} placeholder={t('补充说明（可选），例如：日常对话 / 批量生图')} value={note} onChange={e => setNote(e.target.value)} />
                <div className="form-hint">{t('分类按该模型的官方真实用途选择；AI 助手将按此分类展示与调用')}</div>
              </>
            )}
          </div>
          {/* 行3.5：保险箱分组（可选） */}
          <div className="form-row">
            <label className="form-label">{t('保险箱分组（可选）')}</label>
            <input className="input" list="acm-group-list-add" placeholder={t('如：工作 / 个人 / 项目（留空 = 未分组）')} value={group} onChange={e => setGroup(e.target.value)} />
            <datalist id="acm-group-list-add">{groupSuggestions.map(g => <option key={g} value={g} />)}</datalist>
            <div className="form-hint">{t('按用途分组管理；Key 管理页可按组筛选与统计剩余额度')}</div>
          </div>
          {/* 行4：API Key 输入（语音配置无需余额） */}
          <div className="form-row">
            <label className="form-label">API Key {!isCustom && <span className="req">*</span>}
              {provider.id !== 'voice-config' && !isCustom && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{t('· 输入后自动获取余额')}</span>}
              {isCustom && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{t('· 网关不要求 Key 时可留空')}</span>}
            </label>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 1 }} type="text" placeholder={isCustom ? t('没有 Key 可留空') : t('粘贴你的 API Key（明文输入）')} value={secret} onChange={e => { setSecret(e.target.value); setBalance(null) }} />
              {provider.id !== 'voice-config' && !isCustom && (
                <button className="btn sm" onClick={() => void fetchBalance()} disabled={fetching || !secret.trim()}>
                  <RefreshCw size={13} style={fetching ? { animation: 'acm-spin 1s linear infinite' } : undefined} /> {fetching ? t('获取中') : t('获取余额')}
                </button>
              )}
            </div>
            {provider.id !== 'voice-config' && !isCustom && (
              <div className={`balance-box ${balance ? 'has' : ''}`}>
                <Wallet size={13} /> {balance ?? t('余额未获取（可选，可稍后手动录入）')}
              </div>
            )}
          </div>
          {needInlinePwd && (
            <div className="form-row">
              <label className="form-label">{t('主密码')} <span className="req">*</span> <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{t('· 用于加密本次保存，输入后本次会话记住')}</span></label>
              <input ref={pwdRef} className="input" type="password" value={formPwd} onChange={e => setFormPwd(e.target.value)} placeholder={t('输入保险箱主密码')} disabled={busy} />
              <div className="form-hint">{t('Key 会加密保存在本机。查看/删除已保存的 Key 仍需解锁保险箱。')}</div>
            </div>
          )}
          {err && <div className="form-error">{t(err)}</div>}
        </div>
        <div className="modal-foot account-form-foot">
          <button className="btn btn-close" onClick={onClose}>{t('关闭')}</button>
          <button className="btn btn-reset" onClick={reset}>{t('重置')}</button>
          <button className="btn btn-add" onClick={() => void submit()} disabled={busy}>{busy ? t('添加中…') : t('添加')}</button>
        </div>
      </div>
    </div>
  )
}


function VaultModal({ initialized, currentPwd, onClose, onInit, notify }: {
  initialized: boolean
  currentPwd: string
  onClose: () => void
  onInit: (pwd: string) => Promise<void>
  notify: (m: string) => void
}) {
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [revealed, setRevealed] = useState(currentPwd)
  const [viewPwd, setViewPwd] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (pwd.length < 6) { notify('主密码至少 6 位'); return }
    if (pwd !== confirm) { notify('两次密码不一致'); return }
    setBusy(true)
    try { await onInit(pwd); onClose() } finally { setBusy(false) }
  }
  /** 重置：仅清空本页内容，不删除保险箱数据 */
  const resetPage = () => {
    setPwd(''); setConfirm(''); setRevealed(''); setViewPwd('')
    notify('已清空本页内容')
  }
  const reveal = async () => {
    const ok = await verifyVault(viewPwd)
    if (!ok) { notify('主密码错误'); return }
    setRevealed(viewPwd); setViewPwd('')
  }

  // 已创建保险箱：明文展示当前密码
  if (initialized) {
    return (
      <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="modal" style={{ maxWidth: 440 }}>
          <div className="modal-head"><h3>{t('本地保险箱')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
          <div className="modal-body">
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>{t('当前主密码（明文）')}</div>
            {revealed ? (
              <div className="secret-reveal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span className="mono" style={{ fontSize: 15, letterSpacing: 1 }}>{revealed}</span>
                <button className="icon-btn" title={t('复制主密码')} onClick={() => { navigator.clipboard.writeText(revealed); notify('主密码已复制') }}><Copy size={14} /></button>
              </div>
            ) : (
              <div className="field">
                <label>{t('输入主密码以查看')}</label>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input" type="password" placeholder={t('输入主密码')} value={viewPwd}
                    onChange={e => setViewPwd(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && viewPwd) void reveal() }} />
                  <button className="btn sm primary" onClick={() => void reveal()} disabled={!viewPwd}>{t('查看')}</button>
                </div>
              </div>
            )}
          </div>
          <div className="modal-foot">
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={resetPage}>{t('重置')}</button>
            <button className="btn" onClick={onClose}>{t('关闭')}</button>
          </div>
        </div>
      </div>
    )
  }

  // 未创建保险箱：创建密码页
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head"><h3>{t('创建本地保险箱')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="field"><label>{t('设置主密码（至少 6 位）')}</label><input className="input" type="text" value={pwd} onChange={e => setPwd(e.target.value)} /></div>
          <div className="field"><label>{t('确认主密码')}</label><input className="input" type="text" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
        </div>
        <div className="modal-foot">
          <button className="btn danger" style={{ marginRight: 'auto' }} onClick={resetPage}>{t('重置')}</button>
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" onClick={submit} disabled={busy}>{t('创建')}</button>
        </div>
      </div>
    </div>
  )
}

/** 额度录入 / 更新模态框 */
function QuotaModal({ account, provider, existing, defaultUnit, onClose, onSave }: {
  account: AppState['accounts'][number]; provider: ProviderDefinition; existing?: AppState['quotas'][number];
  defaultUnit?: CreditUnit;
  onClose: () => void;
  onSave: (q: { unit: CreditUnit; used: number; total: number; resetAt?: string; source: QuotaSnapshot['source'] }) => void
}) {
  const [unit, setUnit] = useState<CreditUnit>(existing?.unit ?? defaultUnit ?? 'credit')
  const [total, setTotal] = useState(existing ? String(existing.total) : '')
  const [used, setUsed] = useState(existing ? String(existing.used) : '0')
  const [resetAt, setResetAt] = useState(existing?.resetAt?.slice(0, 10) ?? '')
  const totalNum = Number(total), usedNum = Number(used)
  const valid = total !== '' && !isNaN(totalNum) && totalNum >= 0 && !isNaN(usedNum) && usedNum >= 0
  const pct = valid && totalNum > 0 ? Math.min(100, Math.round(usedNum / totalNum * 100)) : 0

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>{existing ? t('更新额度') : t('录入额度')}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="row" style={{ gap: 10, marginBottom: 16 }}>
            <ProviderLogo provider={provider} size={28} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>{account.label} · {provider.name}</div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>{t('单位')}</label>
              <select className="select" value={unit} onChange={e => setUnit(e.target.value as CreditUnit)}>
                {(Object.keys(UNIT_LABEL) as CreditUnit[]).map(u => <option key={u} value={u}>{t(UNIT_LABEL[u])}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t('重置/到期日（可选）')}</label>
              <input className="input" type="date" value={resetAt} onChange={e => setResetAt(e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>{t('总额度')}</label>
              <input className="input" type="number" min="0" placeholder={t('如 100')} value={total} onChange={e => setTotal(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('已使用')}</label>
              <input className="input" type="number" min="0" placeholder={t('如 20')} value={used} onChange={e => setUsed(e.target.value)} />
            </div>
          </div>
          {valid && totalNum > 0 && (
            <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: 12 }}>
              <div className="row between" style={{ fontSize: 12.5, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-2)' }}>{t('剩余')} <b style={{ color: 'var(--text)' }}>{Math.max(0, totalNum - usedNum).toLocaleString()} {t(UNIT_LABEL[unit])}</b></span>
                <span className={`tag ${pct >= 90 ? 'red' : pct >= 70 ? 'amber' : 'green'}`}>{t('已用 {pct}%', { pct })}</span>
              </div>
              <div className="progress"><div style={{ width: `${Math.max(pct, 2)}%`, background: pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)' }} /></div>
            </div>
          )}
          <div className="desc" style={{ marginTop: 10 }}>{t('来源：手动录入')}{existing ? t(' · 上次更新 {date}', { date: existing.capturedAt.slice(0, 10) }) : ''}</div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({
            unit, used: usedNum, total: totalNum,
            resetAt: resetAt ? new Date(`${resetAt}T23:59:59`).toISOString() : undefined,
            source: 'manual',
          })}>{t('保存')}</button>
        </div>
      </div>
    </div>
  )
}

/** 用量记录添加模态框 */
function UsageModal({ accounts, projectSuggestions: projSug, onClose, onSave }: {
  accounts: AppState['accounts'];
  projectSuggestions?: string[];
  onClose: () => void;
  onSave: (e: UsageEventInput) => void
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [date, setDate] = useState(todayISO())
  const [inputTokens, setInputTokens] = useState('0')
  const [outputTokens, setOutputTokens] = useState('0')
  const [estimatedCost, setEstimatedCost] = useState('0')
  const [model, setModel] = useState('')
  const [project, setProject] = useState('')
  const valid = !!accountId && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    [inputTokens, outputTokens, estimatedCost].every(v => v !== '' && !isNaN(Number(v)) && Number(v) >= 0)

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head"><h3>{t('添加用量记录')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          {accounts.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('请先添加一个账户后再录入用量。')}</div>
          ) : (
            <>
              <div className="field-row">
                <div className="field">
                  <label>{t('账户')}</label>
                  <select className="select" value={accountId} onChange={e => setAccountId(e.target.value)}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>{t('日期')}</label>
                  <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>{t('输入 Tokens')}</label>
                  <input className="input" type="number" min="0" value={inputTokens} onChange={e => setInputTokens(e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('输出 Tokens')}</label>
                  <input className="input" type="number" min="0" value={outputTokens} onChange={e => setOutputTokens(e.target.value)} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>{t('估算费用（元）')}</label>
                  <input className="input" type="number" min="0" step="0.001" value={estimatedCost} onChange={e => setEstimatedCost(e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('模型（可选）')}</label>
                  <input className="input" placeholder={t('如 gpt-4o')} value={model} onChange={e => setModel(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>{t('项目标签（可选）')}</label>
                <input className="input" list="acm-project-list" placeholder={t('如：短视频项目 / 客户 A（用量页可按项目汇总）')} value={project} onChange={e => setProject(e.target.value)} />
                <datalist id="acm-project-list">{(projSug ?? []).map(p => <option key={p} value={p} />)}</datalist>
              </div>
              <div className="desc">{t('费用为本地估算，以平台官方账单为准。')}</div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({
            accountId, date,
            inputTokens: Number(inputTokens), outputTokens: Number(outputTokens),
            estimatedCost: Number(estimatedCost), model: model.trim() || undefined,
            project: project.trim() || undefined,
          })}>{t('保存记录')}</button>
        </div>
      </div>
    </div>
  )
}

/** 数据导入确认模态框：选择覆盖或合并 */
/** 导出格式选择弹窗 */
function ExportModal({ state, onClose, onExport }: {
  state: AppState; onClose: () => void; onExport: (format: ExportFormat, dir?: string) => void
}) {
  const [dir, setDir] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const options: { fmt: ExportFormat; icon: React.ReactNode; title: string; desc: string; tag?: string }[] = [
    { fmt: 'json', icon: <Download size={18} />, title: t('JSON 完整备份'), tag: t('推荐'),
      desc: t('全部数据（{a} 账户 / {q} 额度 / {u} 用量），可完整导回，不含密钥', { a: state.accounts.length, q: state.quotas.length, u: state.usage.length }) },
    { fmt: 'accounts-csv', icon: <KeyRound size={18} />, title: t('账户 CSV'),
      desc: t('平台、名称、模式、API 地址、备注（{n} 条），Excel 可直接打开，不含密钥', { n: state.accounts.length }) },
    { fmt: 'quotas-csv', icon: <Wallet size={18} />, title: t('额度 CSV'),
      desc: t('每个账户最新额度（单位/总额/已用/重置日），可导回匹配账户') },
    { fmt: 'usage-csv', icon: <BarChart3 size={18} />, title: t('用量 CSV'),
      desc: t('日期、账户、输入/输出 Tokens、费用、模型（{n} 条），可导回', { n: state.usage.length }) },
  ]
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head"><h3>{t('选择导出格式')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          {/* 保存位置选择（桌面端可选目录，Web 端走浏览器下载） */}
          <div className="export-dir-box">
            <div className="row" style={{ gap: 8 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)', flex: 1 }}>{t('保存位置')}</span>
              {isDesktopApp() && <button className="btn sm" disabled={picking} onClick={async () => {
                setPicking(true)
                try {
                  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<string | null> } }
                  const invoke = w.__TAURI_INTERNALS__?.invoke
                  if (!invoke) return
                  const picked = await invoke('choose_save_dir')
                  if (picked) setDir(picked)
                } catch { /* 用户取消或不支持 */ }
                finally { setPicking(false) }
              }}><Download size={13} style={{ transform: 'rotate(180deg)' }} /> {picking ? t('选择中…') : t('选择文件夹')}</button>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6, wordBreak: 'break-all' }}>
              {dir ? t('将保存到：{dir}', { dir }) : (isDesktopApp() ? t('未选择 → 使用系统默认下载目录') : t('浏览器下载 → 由浏览器决定保存位置'))}
            </div>
            {dir && <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setDir(null)}>{t('清除，改回默认位置')}</button>}
          </div>
          <div className="provider-picker" style={{ gridTemplateColumns: '1fr', maxHeight: 'none', gap: 8 }}>
            {options.map(o => (
              <button key={o.fmt} className="provider-opt" style={{ padding: 13, alignItems: 'flex-start' }} onClick={() => onExport(o.fmt, dir ?? undefined)}>
                <span style={{ color: 'var(--primary)', marginTop: 2 }}>{o.icon}</span>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div className="p-name">{o.title}{o.tag && <span className="tag green" style={{ marginLeft: 8, fontSize: 10 }}>{o.tag}</span>}</div>
                  <div className="desc" style={{ marginTop: 4 }}>{o.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>{t('取消')}</button></div>
      </div>
    </div>
  )
}

/** CSV 导入预览弹窗：显示解析结果，确认后追加 */
function CsvImportModal({ preview, current, onClose, onImport }: {
  preview: CsvImportPreview; current: AppState; onClose: () => void; onImport: (count: number) => void
}) {
  const title = preview.kind === 'accounts' ? '账户' : preview.kind === 'quotas' ? '额度' : '用量'
  const count = preview.kind === 'accounts'
    ? preview.accounts.accounts.length
    : preview.kind === 'quotas'
      ? preview.quotas.quotas.length
      : preview.events.length
  const rows: string[][] = preview.kind === 'accounts'
    ? preview.accounts.accounts.slice(0, 8).map(a => [a.label, PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId, t(MODE_LABEL[a.mode]), a.note ?? ''])
    : preview.kind === 'quotas'
      ? preview.quotas.quotas.slice(0, 8).map(q => [current.accounts.find(a => a.id === q.accountId)?.label ?? q.accountId, t(UNIT_LABEL[q.unit]), String(q.total), String(q.used)])
      : preview.events.slice(0, 8).map(e => [e.date, current.accounts.find(a => a.id === e.accountId)?.label ?? e.accountId, String(e.inputTokens), String(e.outputTokens), `¥${e.estimatedCost}`])
  const heads = preview.kind === 'accounts' ? ['名称', '平台', '模式', '备注']
    : preview.kind === 'quotas' ? ['账户', '单位', '总额', '已用']
      : ['日期', '账户', '输入', '输出', '费用']
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-head"><h3>{t('导入{title} CSV', { title: t(title) })}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div style={{ fontSize: 13, marginBottom: 12 }}>{t('识别到 {count} 条{title}记录，将追加到现有数据（不会删除已有内容）：', { count, title: t(title) })}</div>
          {count === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 12.5, padding: 20, textAlign: 'center' }}>{t('未解析到有效数据行，请检查表头格式')}</div>
          ) : (
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="key-table" style={{ fontSize: 12 }}>
                <thead><tr>{heads.map(h => <th key={h}>{t(h)}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {count > 8 && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>{t('仅预览前 8 条，共 {count} 条', { count })}</div>}
          {preview.kind === 'accounts' && preview.accounts.unknownProviders.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 8 }}>{t('未识别平台：{list}（将按原 id 保存）', { list: preview.accounts.unknownProviders.join('、') })}</div>
          )}
          {preview.kind === 'quotas' && preview.quotas.unmatched.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 8 }}>{t('未匹配账户：{list}{more}（这些行已跳过）', { list: preview.quotas.unmatched.slice(0, 5).join('、'), more: preview.quotas.unmatched.length > 5 ? '…' : '' })}</div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" disabled={count === 0} onClick={() => onImport(count)}>{t('确认导入 {count} 条', { count })}</button>
        </div>
      </div>
    </div>
  )
}

/** 第三方 API 服务清单导入：预览 + 主密码加密入库 */
function ServiceImportModal({ entries, current, sessionPwd, onClose, onImport }: {
  entries: ServiceEntry[]; current: AppState; sessionPwd: string; onClose: () => void;
  onImport: (accounts: AppState['accounts'], quotas: QuotaSnapshot[], pwd: string) => void
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(entries.map((_, i) => i)))
  const [pwd, setPwd] = useState(sessionPwd || getBiometricPassword() || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const known = new Set(current.accounts.map(a => `${a.providerId}|${a.label}`))
  const dupCount = entries.filter(e => known.has(`${e.providerId}|${e.label}`)).length

  const maskKey = (k: string) => k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : (k ? '••••' : t('（空）'))

  const doImport = async () => {
    setErr('')
    if (!isVaultInitialized()) { setErr('请先在「设置 → 安全」创建保险箱，再导入含密钥的清单'); return }
    if (!pwd) { setErr('请输入主密码用于加密密钥'); return }
    setBusy(true)
    try {
      const ok = await verifyVault(pwd)
      if (!ok) { setErr('主密码错误'); return }
      const now = new Date().toISOString()
      const accounts: AppState['accounts'] = []
      const quotas: QuotaSnapshot[] = []
      for (const i of selected) {
        const e = entries[i]
        if (!e.plainKey) continue // 空密钥跳过（如本地服务可能无需密钥）
        const enc = await encryptSecret(e.plainKey, pwd)
        const accId = uid('acc')
        accounts.push({
          id: accId, providerId: e.providerId, label: e.label, mode: 'api',
          encryptedKey: enc, keyFingerprint: fingerprint(e.plainKey),
          apiUrl: e.apiBase || undefined, note: e.note,
          createdAt: now, updatedAt: now,
        })
        if (e.quota) {
          quotas.push({
            id: uid('q'), accountId: accId, unit: 'currency',
            total: e.quota.total, used: 0,
            capturedAt: now, source: 'import',
          })
        }
      }
      onImport(accounts, quotas, pwd)
    } catch (e: any) { setErr(e.message ?? '导入失败') }
    finally { setBusy(false) }
  }

  const toggle = (i: number) => setSelected(prev => {
    const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next
  })

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 660 }}>
        <div className="modal-head"><h3>{t('导入 API 服务清单')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 10 }}>
            {t('识别到 {n} 个服务（含密钥）。请选择要导入的项，密钥将用主密码 AES-256-GCM 加密后仅存本机。', { n: entries.length })}
          </div>
          {dupCount > 0 && <div style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 8 }}>{t('{n} 项与现有账户重名，将自动跳过。', { n: dupCount })}</div>}
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table className="key-table" style={{ fontSize: 12 }}>
              <thead><tr><th style={{ width: 34 }}></th><th>{t('名称 / 用途')}</th><th>{t('平台')}</th><th>API Key</th><th>{t('额度')}</th></tr></thead>
              <tbody>
                {entries.map((e, i) => {
                  const p = PROVIDER_MAP[e.providerId]
                  const isDup = known.has(`${e.providerId}|${e.label}`)
                  return (
                    <tr key={i} style={{ opacity: isDup ? 0.5 : 1 }} onClick={() => !isDup && toggle(i)}>
                      <td><input type="checkbox" checked={selected.has(i) && !isDup} disabled={isDup} onChange={() => toggle(i)} onClick={ev => ev.stopPropagation()} /></td>
                      <td><div style={{ fontWeight: 500 }}>{e.label}</div><div style={{ color: 'var(--text-3)', fontSize: 11 }}>{e.note} · {e.model}</div></td>
                      <td>{p?.shortName ?? e.name}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{maskKey(e.plainKey)}</td>
                      <td>{e.quota ? `¥${e.quota.total}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label>{t('主密码（用于加密密钥{extra}）', { extra: isVaultInitialized() ? '' : t(' · 保险箱尚未创建') })}</label>
            <input className="input" type="text" placeholder={t('输入主密码')} value={pwd} onChange={e => setPwd(e.target.value)} />
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>{t(err)}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('取消')}</button>
          <button className="btn primary" disabled={busy || selected.size === 0} onClick={() => void doImport()}>
            {busy ? t('加密导入中…') : t('安全导入 {n} 项', { n: selected.size })}
          </button>
        </div>
      </div>
    </div>
  )
}

function ImportModal({ incoming, current, onClose, onImport }: {
  incoming: AppState; current: AppState; onClose: () => void; onImport: (mode: 'replace' | 'merge') => void
}) {
  const newIds = incoming.accounts.filter(a => !current.accounts.some(c => c.id === a.id)).length
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head"><h3>{t('导入数据')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="field">
            <label>{t('导入方式')}</label>
            <div className="provider-picker" style={{ gridTemplateColumns: '1fr', maxHeight: 'none' }}>
              <button className="provider-opt" style={{ padding: 14 }} onClick={() => onImport('merge')}>
                <RefreshCw size={18} style={{ color: 'var(--primary)' }} />
                <div style={{ textAlign: 'left' }}>
                  <div className="p-name">{t('合并（推荐）')}</div>
                  <div className="desc" style={{ marginTop: 4 }}>{t('保留当前数据，追加 {n} 个新账户；相同 id 不重复', { n: newIds })}</div>
                </div>
              </button>
              <button className="provider-opt" style={{ padding: 14 }} onClick={() => onImport('replace')}>
                <Trash2 size={18} style={{ color: 'var(--red)' }} />
                <div style={{ textAlign: 'left' }}>
                  <div className="p-name">{t('覆盖')}</div>
                  <div className="desc" style={{ marginTop: 4 }}>{t('清空当前全部数据，仅保留备份内容（不可撤销）')}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>{t('取消')}</button></div>
      </div>
    </div>
  )
}


/** 通用分页控件（每页 3 条），各列表页复用 */
function Pager({ total, page, pageSize, onChange }: {
  total: number; page: number; pageSize: number; onChange: (p: number) => void
}) {
  if (total <= pageSize) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const cur = Math.min(page, pages)
  return (
    <div className="keys-pagination">
      <span>{t('共 {total} 条 · 第 {cur}/{pages} 页', { total, cur, pages })}</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" disabled={cur <= 1} onClick={() => onChange(Math.max(1, cur - 1))}>{t('上一页')}</button>
        {Array.from({ length: pages }, (_, i) => i + 1).map(n => (
          <button key={n} className={`btn sm ${n === cur ? 'primary' : ''}`} onClick={() => onChange(n)}>{n}</button>
        ))}
        <button className="btn sm" disabled={cur >= pages} onClick={() => onChange(Math.min(pages, cur + 1))}>{t('下一页')}</button>
      </div>
    </div>
  )
}

/** 批量选择操作条：显示选中数、全选本页、清空、自定义批量操作 */
function SelectionBar({ selectedCount, totalOnPage, allSelected, onToggleAll, onClear, actions }: {
  selectedCount: number; totalOnPage: number; allSelected: boolean;
  onToggleAll: () => void; onClear: () => void; actions?: React.ReactNode
}) {
  if (totalOnPage === 0 && selectedCount === 0) return null
  return (
    <div className="selection-bar">
      <label className="selection-all" title={t('全选/取消本页')}>
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} /> {t('全选本页')}
      </label>
      <span className="selection-count">{t('已选')} <b>{selectedCount}</b> {t('项')}</span>
      {selectedCount > 0 && (
        <>
          {actions}
          <button className="btn sm ghost" onClick={onClear}>{t('清空选择')}</button>
        </>
      )}
    </div>
  )
}

/** 开关组件 */
function Toggle({ checked, onChange, danger, disabled }: { checked: boolean; onChange: (v: boolean) => void; danger?: boolean; disabled?: boolean }) {
  // 果冻动画：null=静态，'on'/'off'=正在向对应方向滑动
  const [anim, setAnim] = useState<'on' | 'off' | null>(null)
  const prevChecked = useRef(checked)
  useEffect(() => {
    if (prevChecked.current !== checked) {
      setAnim(checked ? 'on' : 'off')
      prevChecked.current = checked
      const t = window.setTimeout(() => setAnim(null), 360)
      return () => window.clearTimeout(t)
    }
  }, [checked])
  return (
    <button
      role="switch" aria-checked={checked}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked) }}
      className={`jelly-toggle ${checked ? 'is-on' : ''} ${danger ? 'danger' : ''}`}
      style={disabled ? { opacity: .45, pointerEvents: 'none' } : undefined}
      aria-label={checked ? t('关闭') : t('开启')}
    >
      <span className={`jelly-dot ${anim ? `anim-${anim}` : (checked ? 'static-on' : 'static-off')}`} />
    </button>
  )
}

/** 设置分组容器 */
function SettingsSection({ title, desc, icon: Icon, tone = 'indigo', children }: {
  title: string; desc?: string; icon?: typeof Settings; tone?: 'indigo' | 'green' | 'amber' | 'blue' | 'red'; children: React.ReactNode
}) {
  // 分段可折叠：点标题栏收起/展开，设置项多时不用长滚（v0.1.259）
  // 折叠状态按分段标题持久化到本机（v0.1.298，Ethan 要求）：收起过的分段
  // 下次打开设置/重启 App 后仍保持收起，不再每次自动展开
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const m = JSON.parse(localStorage.getItem('acm.set.sections') || '{}') as Record<string, boolean>
      return m[title] !== false
    } catch { return true }
  })
  const toggleOpen = () => setOpen(o => {
    const next = !o
    try {
      const m = JSON.parse(localStorage.getItem('acm.set.sections') || '{}') as Record<string, boolean>
      m[title] = next
      localStorage.setItem('acm.set.sections', JSON.stringify(m))
    } catch { /* ignore */ }
    return next
  })
  return (
    <section className={`set-card ${open ? '' : 'collapsed'}`}>
      <div className="set-card-head collapsible" onClick={toggleOpen} title={open ? t('点击收起') : t('点击展开')}>
        {Icon && <span className={`set-card-icon ${tone}`}><Icon size={17} /></span>}
        <div className="set-card-heading">
          <h3>{t(title)}</h3>
          {desc && <p>{t(desc)}</p>}
        </div>
        <ChevronDown size={16} className={`set-card-chevron ${open ? 'open' : ''}`} />
      </div>
      {open && <div className="set-card-body">{children}</div>}
    </section>
  )
}

/** 数据存储的目录选择控件：按钮 + 按钮下方直接显示已选路径。
 * 路径不能放 SettingsRow 的 desc——claude-ui 样式把 .settings-row-desc 全局隐藏了，
 * 放那里用户永远看不见（v0.1.300 Ethan 反馈后改到这里）。 */
function StorageDirPicker({ dir, onPick }: { dir: string; onPick: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, maxWidth: 400 }}>
      <button className="btn sm" onClick={onPick}><Folder size={13} /> {t(dir ? '更换文件夹' : '选择文件夹')}</button>
      <div style={{ fontSize: 11.5, color: dir ? 'var(--text-2)' : 'var(--text-3)', wordBreak: 'break-all', textAlign: 'right', lineHeight: 1.45 }}>{dir || t('尚未选择')}</div>
    </div>
  )
}

/** 全局刷新按钮（v0.1.302）：Key 管理 / 额度看板 / 用量费用三页共用 */
function GlobalRefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return (
    <button className="btn sm" onClick={onRefresh} disabled={refreshing}
      title={t('立即刷新全部可自动查询的余额（DeepSeek、Kimi、硅基流动、OpenRouter）')}>
      <RefreshCw size={14} style={refreshing ? { animation: 'acm-spin 1s linear infinite' } : undefined} /> {refreshing ? t('刷新中…') : t('刷新')}
    </button>
  )
}

/** 设置行：标题 + 说明 + 控件 */
function SettingsRow({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{t(title)}</div>
        {desc && <div className="settings-row-desc" style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.5 }}>{t(desc)}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

/** 设置中心 */
type ClearCat = 'history' | 'archived' | 'api' | 'usage' | 'calendar'
const CLEAR_CATS: { key: ClearCat; label: string; hint: string }[] = [
  { key: 'history', label: 'AI 聊天历史', hint: '未归档的会话' },
  { key: 'archived', label: '已归档聊天', hint: '已归档的会话' },
  { key: 'api', label: 'API 账户与密钥', hint: '含额度快照' },
  { key: 'usage', label: '用量费用记录', hint: '用量与费用明细' },
  { key: 'calendar', label: '签到与日历数据', hint: '签到记录与福利标记' },
]

/** AI 助手工具栏：工具键 → 设置页显示名（顺序由 mergeToolbarOrder 决定） */
const AI_TOOLBAR_LABELS: Record<string, string> = {
  autoSpeak: '自动朗读', voiceCall: '语音通话', chatSearch: '搜索对话', chatExport: '导出对话',
  myData: '引用我的数据', webSearch: '联网搜索', compare: '多模型对比', sessions: '会话列表', prompts: '提示词', clearChat: '清空对话',
}

function SettingsView({ state, onChange, notify, onOpenVault, onClear, onChangePassword, onResetVault, onBioAvailable, onBioUnlock, bioLabel, sessionPwd, cloudUser, syncing, syncError, lastSyncAt, onLogin, onLogout, onSync, onAltSync, altSyncing, altStatus, onCheckUpdate, auditEntries, onClearAudit, onImportBackup, onRestoreSnapshot, isPhone, onClearData }: {
  onClearData?: (cats: ClearCat[]) => void
  isPhone?: boolean
  state: AppState
  onChange: (patch: Partial<AppState['settings']>) => void
  notify: (m: string) => void
  auditEntries: AppState['audit']
  onClearAudit: () => void
  onImportBackup: (state: AppState) => void
  onRestoreSnapshot?: (snap: { state: AppState; vault: import('./core/crypto').VaultSyncMaterial }) => Promise<boolean>
  onOpenVault: () => void
  onClear: () => void
  onChangePassword: (oldPwd: string, newPwd: string) => Promise<void>
  onResetVault: () => void
  onBioAvailable: boolean
  onBioUnlock: () => void
  bioLabel: string
  sessionPwd: string
  cloudUser: CloudUser | null
  syncing: boolean
  syncError: string | null
  lastSyncAt: string | null
  onLogin: () => void
  onLogout: () => void
  onSync: () => void
  onAltSync: () => void
  altSyncing: boolean
  altStatus: ReturnType<typeof loadAltStatus>
  onCheckUpdate: () => void
}) {
  const s = state.settings
  const [confirmClear, setConfirmClear] = useState(false)
  // 数据清理多选（v0.1.255）：勾选类别 → 确认弹窗 → 执行
  const [clearSel, setClearSel] = useState<ClearCat[]>([])
  const [scanDesktop, setScanDesktopState] = useState(() => comfyScanDesktopEnabled())
  const [launchDesktop, setLaunchDesktopState] = useState(() => comfyLaunchDesktopEnabled())
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const toggleClearCat = (key: ClearCat) => setClearSel(sel => sel.includes(key) ? sel.filter(k => k !== key) : [...sel, key])
  const [confirmReset, setConfirmReset] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdBusy, setPwdBusy] = useState(false)
  const [bioSwitchOpen, setBioSwitchOpen] = useState(false)
  const [bioSwitchPwd, setBioSwitchPwd] = useState('')
  const [bioSwitchBusy, setBioSwitchBusy] = useState(false)
  const [setTab, setSetTab] = useState<'general' | 'data' | 'security'>('general')
  // ---- 完整数据备份（导出/导入 JSON 文件） ----
  const backupInputRef = useRef<HTMLInputElement>(null)
  const [pendingImport, setPendingImport] = useState<Extract<ParseBackupResult, { ok: true }> | null>(null)
  const doExportBackup = async () => {
    const r = await saveExportFile(`ai-credit-manager-backup-${todayISO()}.json`, buildBackup(state, APP_VERSION))
    if (r.cancelled) return
    notify(r.ok ? t('完整备份已导出到：{where}（包含全部数据；密钥为加密密文）', { where: r.where ?? '' }) : t('导出失败：{err}', { err: r.error ?? t('未知错误') }))
  }
  const onBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = parseBackup(await f.text())
    if (!r.ok) { notify(r.error); return }
    setPendingImport(r)
  }
  // ---- 余额自动刷新间隔（本机偏好） ----
  const [patrolHours, setPatrolHours] = useState<number>(() => loadPatrolHours())
  const [toolCalling, setToolCalling] = useState<boolean>(() => loadToolCallingEnabled())
  // ---- 阅览方式（仅桌面端、本机偏好）：AI 生成的视频/图片用哪个本机软件打开 ----
  const [viewerPrefs, setViewerPrefs] = useState<ViewerPrefs>(() => loadViewerPrefs())
  const [mediaApps, setMediaApps] = useState<MediaAppInfo[]>([])
  const [mediaAppsLoading, setMediaAppsLoading] = useState(false)
  const scanMediaApps = async (force = false) => {
    if (!isDesktopApp()) return
    setMediaAppsLoading(true)
    try { setMediaApps(await listMediaApps(force)) } catch { /* 扫描失败保持空列表 */ } finally { setMediaAppsLoading(false) }
  }
  useEffect(() => { void scanMediaApps() }, [])
  // ---- 云端自动备份（v0.1.330，本机偏好）：定时把整份状态快照存云端，可回滚 ----
  const [cbPrefs, setCbPrefs] = useState<CloudBackupPrefs>(() => loadCloudBackupPrefs())
  const [cbList, setCbList] = useState<SnapshotMeta[]>([])
  const [cbBusy, setCbBusy] = useState(false)
  const [cbConfirmId, setCbConfirmId] = useState<string | null>(null)
  const patchCb = (next: CloudBackupPrefs) => { setCbPrefs(next); saveCloudBackupPrefs(next) }
  const refreshCbList = useCallback(async () => {
    if (!cloudUser) { setCbList([]); return }
    const r = await listCloudSnapshots()
    if (r.ok) setCbList(r.list)
  }, [cloudUser])
  useEffect(() => { void refreshCbList() }, [refreshCbList])
  const doCbNow = async () => {
    setCbBusy(true)
    const r = await createCloudSnapshot(state, cbPrefs.keep, '手动备份')
    setCbBusy(false)
    notify(r.ok ? '云端快照已保存' : `备份失败：${r.error ?? ''}`)
    if (r.ok) void refreshCbList()
  }
  const doCbDelete = async (id: string) => {
    setCbBusy(true)
    const r = await deleteCloudSnapshot(state, id)
    setCbBusy(false)
    notify(r.ok ? '快照已删除' : `删除失败：${r.error ?? ''}`)
    if (r.ok) void refreshCbList()
  }
  const [icloudBusy, setIcloudBusy] = useState(false)
  const doIcloudSave = async () => {
    setIcloudBusy(true)
    const r = await saveBackupToIcloudDrive(state)
    setIcloudBusy(false)
    notify(r.ok ? `已保存到 iCloud Drive：${(r.path ?? '').split('/').pop()}` : (r.error ?? '保存失败'))
  }
  const doCbRestore = async (id: string) => {
    if (!onRestoreSnapshot) return
    setCbBusy(true)
    // 先取目标快照，再存「恢复前」安全快照（顺序反了安全快照可能把目标挤出保留份数）
    const snap = await getCloudSnapshot(id)
    if (!snap) { setCbBusy(false); notify('读取快照失败，请重试'); return }
    await createCloudSnapshot(state, cbPrefs.keep, '恢复前自动备份')
    const ok = await onRestoreSnapshot(snap)
    setCbBusy(false)
    setCbConfirmId(null)
    notify(ok ? '已恢复到该快照的数据' : '已恢复到本地，但推回云端失败，请点「立即同步」')
    void refreshCbList()
  }

  // ---- 数据存储（仅桌面端、本机偏好）：三类文件的自定义存放文件夹 ----
  const [storagePrefs, setStoragePrefs] = useState<StoragePrefs>(() => loadStoragePrefs())
  const patchStorage = (next: StoragePrefs, syncKeys = false) => {
    setStoragePrefs(next)
    saveStoragePrefs(next)
    // API Key 存放刚开启/改了目录时，立刻把当前清单写一份过去
    if (syncKeys) {
      void writeApiKeyStorageFile(state, next).then(r => {
        if (r.ok) notify(t('API Key 清单已保存到：{path}', { path: r.path ?? '' }))
        else if (r.error) notify(t('清单写入失败：{err}', { err: r.error }))
      })
    }
  }
  const pickStorageDir = async (kind: 'apikey' | 'ai' | 'media') => {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string) => Promise<string | null> } }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return
    const dir = await invoke('choose_save_dir')
    if (!dir) return
    const next = { ...storagePrefs, [kind]: { ...storagePrefs[kind], dir } }
    patchStorage(next, kind === 'apikey')
  }
  // ---- 备用同步通道配置（v0.1.352，仅本机保存）：WebDAV + iCloud Drive ----
  const [wcfg, setWcfg] = useState(loadWebdavConfig)
  const patchW = (next: typeof wcfg) => { setWcfg(next); saveWebdavConfig(next) }
  const [icEnabled, setIcEnabled] = useState(() => loadIcloudSyncConfig().enabled)
  const patchIc = (v: boolean) => { setIcEnabled(v); saveIcloudSyncConfig({ enabled: v }) }
  const [wTest, setWTest] = useState<string | null>(null)
  const [wTesting, setWTesting] = useState(false)
  const doWTest = async () => {
    setWTesting(true)
    try { setWTest(await webdavTest(wcfg)) }
    catch (e) { setWTest(`连接失败：${(e as Error)?.message ?? String(e)}`) }
    finally { setWTesting(false) }
  }
  const altStatusText = (m: { lastOkAt?: string; lastError?: string }) =>
    m.lastError ? `上次失败：${m.lastError}` : m.lastOkAt ? `最近同步：${new Date(m.lastOkAt).toLocaleString(locale())}` : '尚未同步过'

  // ---- 照片图库授权（仅桌面端，v0.1.347）：触发系统弹窗 / 读一次数据库验证权限 ----
  const probePhotosAccess = async () => {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string) => Promise<string> } }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return
    try { notify(await invoke('photos_access_probe')) }
    catch (e) { notify(`照片授权未通过：${String(e)}`) }
  }
  // ---- 提醒通知（系统通知） ----
  const np = notifyPrefsOf(s)
  const [notifyPerm, setNotifyPerm] = useState<NotificationPermissionState>('prompt')
  useEffect(() => { void getNotificationPermission().then(setNotifyPerm) }, [])
  const patchNotify = (patch: Partial<typeof np>) => onChange({ notify: { ...np, ...patch } })
  const onToggleNotifyEnabled = async (v: boolean) => {
    if (!v) { patchNotify({ enabled: false }); return }
    const perm = await requestNotificationPermission()
    setNotifyPerm(perm)
    if (perm === 'denied') notify('通知权限被拒绝，请到系统设置里允许本应用发送通知')
    if (perm === 'unsupported') notify('当前平台不支持系统通知')
    patchNotify({ enabled: true })
  }
  const onTestNotification = async () => {
    let perm = await getNotificationPermission()
    if (perm !== 'granted') { perm = await requestNotificationPermission(); setNotifyPerm(perm) }
    if (perm !== 'granted') { notify('未获得通知权限，无法发送测试通知'); return }
    const ok = await showNotification(t('AI 魔方'), t('这是一条测试通知，提醒功能工作正常。'), 'acm-test')
    notify(ok ? '测试通知已发送，请留意系统通知' : '当前平台不支持系统通知')
  }
  // ---- 桌面外壳（仅 Tauri 桌面端）：开机自启开关 ----
  const desktopShell = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const shortcutMod = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? '') ? '⌘' : 'Ctrl'
  const [autostart, setAutostart] = useState<boolean | null>(null)
  useEffect(() => {
    if (!desktopShell) return
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
    void w.__TAURI_INTERNALS__?.invoke?.('autostart_is_enabled').then(v => setAutostart(!!v)).catch(() => setAutostart(null))
  }, [desktopShell])
  const onToggleAutostart = async (v: boolean) => {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
    try { await w.__TAURI_INTERNALS__?.invoke?.('autostart_set', { enabled: v }); setAutostart(v) }
    catch { notify('设置开机自启失败，请重试') }
  }
  // ---- 静默启动（仅桌面端）：开机自启时不弹主窗口，只常驻菜单栏 ----
  const [silentStart, setSilentStart] = useState<boolean | null>(null)
  useEffect(() => {
    if (!desktopShell) return
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
    void w.__TAURI_INTERNALS__?.invoke?.('silent_start_get').then(v => setSilentStart(!!v)).catch(() => setSilentStart(null))
  }, [desktopShell])
  const onToggleSilentStart = async (v: boolean) => {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
    try { await w.__TAURI_INTERNALS__?.invoke?.('silent_start_set', { enabled: v }); setSilentStart(v) }
    catch { notify('设置静默启动失败，请重试') }
  }
  // ---- 本地统一网关（仅桌面端） ----
  const [gwStatus, setGwStatus] = useState<GatewayStatusInfo | null>(null)
  const [gwBusy, setGwBusy] = useState(false)
  const refreshGw = async () => { try { setGwStatus(await gatewayStatus()) } catch { setGwStatus(null) } }
  useEffect(() => { if (desktopShell) void refreshGw() }, [desktopShell])
  const gwStartFlow = async () => {
    if (!sessionPwd) { notify('请先解锁保险箱，再开启网关（需要解密各账户的 Key 来注册路由）'); return }
    setGwBusy(true)
    try {
      let tok = s.gatewayToken
      if (!tok) { tok = genGatewayToken(); onChange({ gatewayToken: tok }) }
      const routes = await buildGatewayRoutes(state, sessionPwd)
      const models = Object.keys(routes).length
      if (!models) { notify('没有可注册的模型：需要已配 Key、且平台在引擎目录里的账户'); setGwBusy(false); return }
      await gatewaySetRoutes(routes)
      const msg = await gatewayStart(s.gatewayPort || 8787, tok)
      notify(t('{msg} · 已注册 {n} 个模型', { msg, n: models }))
      await refreshGw()
    } catch (e) { notify(t('开启网关失败：{err}', { err: (e as Error)?.message ?? e })) }
    setGwBusy(false)
  }
  const gwStopFlow = async () => {
    setGwBusy(true)
    try { await gatewayStop(); notify('网关已停止，内存中的 Key 路由已清除') } catch { /* 忽略 */ }
    await refreshGw()
    setGwBusy(false)
  }
  // ---- 全局快捷键自定义（桌面端）：组合存 settings，App 壳下发 Tauri 动态注册 ----
  const [recording, setRecording] = useState<'ai' | 'mini' | null>(null)
  const accelAi = s.shortcutAi ?? 'CommandOrControl+Shift+A'
  const accelMini = s.shortcutMini ?? 'CommandOrControl+Shift+M'
  const fmtAccel = (a: string) => a.split('+').map(p => (p === 'CommandOrControl' ? shortcutMod : p)).join('+')
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return // 只按了修饰键，继续等主键
      const mods: string[] = []
      if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl')
      if (e.altKey) mods.push('Alt')
      if (e.shiftKey) mods.push('Shift')
      if (mods.length === 0) { notify('组合键需至少带一个修饰键（Ctrl/⌘/Alt/Shift）'); return }
      let key = e.key
      if (key === ' ') key = 'Space'
      else if (key.length === 1) key = key.toUpperCase()
      else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase()
      else { notify(t('主键「{key}」暂不支持，请用字母、数字、空格或 F 键', { key })); return }
      const accel = [...mods, key].join('+')
      if ((recording === 'ai' ? accelMini : accelAi) === accel) { notify('与另一个快捷键冲突，换个组合'); return }
      onChange(recording === 'ai' ? { shortcutAi: accel } : { shortcutMini: accel })
      setRecording(null)
      notify(t('已设为 {accel}', { accel: fmtAccel(accel) }))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, accelAi, accelMini])
  const [devices, setDevices] = useState<DeviceRecord[]>(() => loadDevices())

  // 本地模型服务：检测物理内存 → 档位（Web/手机端检测失败用手动覆盖档位）
  const [memGb, setMemGb] = useState(0)
  useEffect(() => { let alive = true; void getSystemMemoryGb().then(g => { if (alive) setMemGb(g) }); return () => { alive = false } }, [])
  const memTier: MemoryTier = s.memoryTierOverride ?? memoryToTier(memGb)
  const memDetected = memGb > 0
  // 手机客户端没有本机服务概念：「本地模型服务」整段不渲染（判定与 App 壳 isPhone 一致）
  const phoneShell = isNativeApp() || (typeof location !== 'undefined' && (new URLSearchParams(location.search).get('preview') === 'phone' || location.hash.includes('preview=phone')))

  // 各服务实时运行状态（null=未检测/非桌面端，字符串=运行中的地址，''=未运行）
  const [serviceStatus, setServiceStatus] = useState<Partial<Record<LocalServiceKey, string | null>>>({})
  const [managedKeys, setManagedKeys] = useState<Partial<Record<LocalServiceKey, boolean>>>({})
  const [busyKey, setBusyKey] = useState<LocalServiceKey | null>(null)
  const refreshServiceStatus = useCallback(() => {
    void Promise.all(LOCAL_SERVICE_KEYS.map(async k => [k, await checkLocalService(k), await isServiceAppManaged(k)] as const))
      .then(rows => {
        // 查过但没在跑记 ''（徽标显示「未运行」）；null 只留给「还没查过」（显示「未检测」）
        setServiceStatus(Object.fromEntries(rows.map(r => [r[0], r[1] ?? ''])))
        setManagedKeys(Object.fromEntries(rows.map(r => [r[0], r[2]])))
      })
  }, [])
  useEffect(() => { refreshServiceStatus() }, [refreshServiceStatus])

  /** 单个服务的状态同步刷新（v0.1.428 ⑤）：别处（语音页开关、添加账户弹窗）启停服务后，
   *  已打开的设置页徽标跟着刷新，不再卡「未检测」；开着但还没监听上时轮询等它起来。 */
  const refreshOneServiceStatus = useCallback((key: LocalServiceKey, enabled?: boolean) => {
    void (async () => {
      const addr = await checkLocalService(key).catch(() => null)
      const managed = await isServiceAppManaged(key).catch(() => false)
      setServiceStatus(prev => ({ ...prev, [key]: addr ?? '' }))
      setManagedKeys(prev => ({ ...prev, [key]: managed }))
      if (enabled && !addr) {
        let tries = 0
        const poll = window.setInterval(() => {
          void checkLocalService(key).then(a => {
            if (a) {
              setServiceStatus(prev => ({ ...prev, [key]: a }))
              setManagedKeys(prev => ({ ...prev, [key]: true }))
              window.clearInterval(poll)
            } else if (++tries >= (key === 'qwentts' ? 30 : 15)) {
              window.clearInterval(poll)
              setServiceStatus(prev => ({ ...prev, [key]: '' }))
            }
          })
        }, 2000)
      }
    })()
  }, [])
  useEffect(() => {
    const onSvc = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string; enabled?: boolean }>).detail
      const key = detail?.key as LocalServiceKey | undefined
      if (!key || !LOCAL_SERVICE_KEYS.includes(key)) return
      refreshOneServiceStatus(key, detail?.enabled)
    }
    window.addEventListener(LOCAL_SERVICE_CHANGED_EVENT, onSvc)
    return () => window.removeEventListener(LOCAL_SERVICE_CHANGED_EVENT, onSvc)
  }, [refreshOneServiceStatus])

  /** 启动服务后台进程（不打开 GUI 窗口）；启动后轮询状态 */
  const onStartService = async (key: LocalServiceKey) => {
    setBusyKey(key)
    try {
      const r = await startLocalService(key)
      notify(r.message)
      if (r.ok) {
        // 让语音页等其他监听处同步刷新徽标（v0.1.428 ⑤）
        notifyLocalServiceChanged(key, true)
        let tries = 0
        const poll = window.setInterval(() => {
          void checkLocalService(key).then(addr => {
            if (addr) {
              setServiceStatus(prev => ({ ...prev, [key]: addr }))
              setManagedKeys(prev => ({ ...prev, [key]: true }))
              window.clearInterval(poll)
            } else if (++tries >= (key === 'qwentts' ? 30 : 15)) window.clearInterval(poll) // 最多等 ~30s（ComfyUI 首次加载较慢；Qwen3-TTS 模型加载放宽到 ~60s）
          })
        }, 2000)
      }
    } finally { setBusyKey(null) }
  }

  /** 停止由本 App 启动的服务进程（不碰用户手动启动的服务） */
  const onStopService = async (key: LocalServiceKey) => {
    setBusyKey(key)
    try {
      const r = await stopLocalService(key)
      notify(r.message)
      if (r.ok) {
        setServiceStatus(prev => ({ ...prev, [key]: null }))
        setManagedKeys(prev => ({ ...prev, [key]: false }))
      }
    } finally { setBusyKey(null) }
  }

  /** 切换本地服务开关：8G 互斥（开新服务自动停旧服务释放内存）；开启拉起进程，关闭停止端口进程 */
  const onToggleLocalService = async (key: LocalServiceKey) => {
    const plan = planServiceToggle(s, key, memTier)
    if (!plan) return
    const { next, stopKeys, enabled } = plan
    onChange({ localServices: next })
    const name = key === 'ollama' ? 'Ollama' : key === 'comfyui' ? 'ComfyUI' : key === 'qwentts' ? 'Qwen3-TTS' : 'LM Studio'
    // 互斥：先停掉被挤掉的旧服务（关自己的情况留给下方 else 分支统一处理）
    for (const oldKey of stopKeys) {
      if (oldKey === key) continue
      const r = await stopServiceByPort(oldKey)
      setServiceStatus(prev => ({ ...prev, [oldKey]: '' }))
      setManagedKeys(prev => ({ ...prev, [oldKey]: false }))
      notifyLocalServiceChanged(oldKey, false)
      const oldName = oldKey === 'ollama' ? 'Ollama' : oldKey === 'comfyui' ? 'ComfyUI' : oldKey === 'qwentts' ? 'Qwen3-TTS' : 'LM Studio'
      if (r.ok) notify(t('已关闭 {name} 以释放内存（{msg}）', { name: oldName, msg: r.message }))
    }
    if (enabled) {
      // 开启：若端口已有服务在跑则直接复用，否则拉起进程（LM Studio 无 CLI，跳过）
      const already = await checkLocalService(key)
      if (already) {
        setServiceStatus(prev => ({ ...prev, [key]: already }))
        notify(t('{name} 服务已在运行，已直接启用（{already}）', { name, already }))
      } else if (key !== 'lmstudio') {
        const r = await startLocalService(key)
        notify(t('{name}：{msg}', { name, msg: r.message }))
        if (r.ok) {
          let tries = 0
          const poll = window.setInterval(() => {
            void checkLocalService(key).then(addr => {
              if (addr) { setServiceStatus(prev => ({ ...prev, [key]: addr })); setManagedKeys(prev => ({ ...prev, [key]: true })); window.clearInterval(poll) }
              else if (++tries >= (key === 'qwentts' ? 30 : 15)) {
                window.clearInterval(poll)
                if (key === 'comfyui' && comfyLaunchDesktopEnabled()) {
                  // Desktop 拉起模式：应用已打开但实例还没由用户点开，不算失败——不回滚开关
                  notify('已打开 Comfy Desktop，请在其中打开你的实例，启动后会自动识别')
                } else {
                  // 启动命令返回成功但服务始终没起来 → 回滚开关，避免"已开启却连不上"的状态脱节
                  onChange({ localServices: { ...(s.localServices ?? {}), [key]: false } })
                  setServiceStatus(prev => ({ ...prev, [key]: null }))
                  setManagedKeys(prev => ({ ...prev, [key]: false }))
                  notifyLocalServiceChanged(key, false)
                  notify(t('{name} 启动后未能正常监听端口，已自动关闭开关。请确认本机 {key} 可正常运行后重试', { name, key }))
                }
              }
            })
          }, 2000)
        } else {
          // 启动命令直接失败 → 回滚开关（与 useServiceController 的切换逻辑一致）
          onChange({ localServices: { ...(s.localServices ?? {}), [key]: false } })
          notifyLocalServiceChanged(key, false)
        }
      } else {
        notify(t('{name} 无 CLI 后台启动方式，请在 LM Studio 应用内手动开启本地服务器', { name }))
      }
    } else {
      // 关闭：停止端口上的进程（含外部启动的），真正释放端口与内存
      const r = await stopServiceByPort(key)
      notify(t('{name}：{msg}', { name, msg: r.ok ? r.message : t('停止失败：{msg}', { msg: r.message }) }))
      setServiceStatus(prev => ({ ...prev, [key]: '' }))
      setManagedKeys(prev => ({ ...prev, [key]: false }))
    }
    notifyLocalServiceChanged(key, enabled)
  }

  /** 切换到指纹解锁：验证主密码后保存到本机，再更新设置 */
  const enableBio = async () => {
    setBioSwitchBusy(true)
    try {
      const ok = await verifyVault(bioSwitchPwd)
      if (!ok) { notify('主密码错误，未切换'); return }
      saveBiometricPassword(bioSwitchPwd)
      void bindVaultPasswordNative(bioSwitchPwd)
      onChange({ unlockMethod: 'biometric' })
      setBioSwitchOpen(false)
      setBioSwitchPwd('')
      notify('已切换为指纹解锁')
    } finally { setBioSwitchBusy(false) }
  }

  return (
    <>
      <div className="set-hero">
        <div className="set-hero-mark"><Settings size={26} /></div>
        <div className="set-hero-text">
          <h2>{t('设置中心')}</h2>
          <p>{t('管理你的账户、偏好与数据安全 · 所有设置仅保存在此设备')}</p>
        </div>
        <div className="set-hero-badges">
          <span className={`set-badge ${cloudUser ? 'on' : ''}`}><Cloud size={13} /> {cloudUser ? t('云同步已开启') : t('仅本机存储')}</span>
          <span className="set-badge">v{APP_VERSION}</span>
        </div>
      </div>

      <nav className="set-tabs">
        <button className={setTab === 'general' ? 'active' : ''} onClick={() => setSetTab('general')}><Palette size={15} /> {t('偏好设置')}</button>
        <button className={setTab === 'data' ? 'active' : ''} onClick={() => setSetTab('data')}><Database size={15} /> {t('账户与数据')}</button>
        <button className={setTab === 'security' ? 'active' : ''} onClick={() => setSetTab('security')}><ShieldCheck size={15} /> {t('安全隐私')}</button>
      </nav>

      <div className="set-content" key={setTab}>
        {setTab === 'general' && <>
          <SettingsSection title="外观设计" desc="界面风格与动态效果" icon={Palette} tone="indigo">
            <SettingsRow title="语言" desc="界面显示语言，切换立即生效并同步到其他设备">
              <select className="select" value={(s.language as Lang | undefined) ?? 'zh-CN'} onChange={e => onChange({ language: e.target.value as Lang })}>
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </SettingsRow>
            <SettingsRow title="主题" desc="深色模式护眼省电；跟随系统时随系统外观自动切换">
              <div className="seg-control">
                {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([v, label]) => (
                  <button key={v} className={`seg-btn ${(s.theme ?? 'system') === v ? 'active' : ''}`} onClick={() => onChange({ theme: v })}>{t(label)}</button>
                ))}
              </div>
            </SettingsRow>
            <div className="theme-setting-block">
              <div className="theme-setting-heading">
                <div>
                  <strong>{t('界面主题')}</strong>
                  <p>{t('八套完整视觉与交互语言，点击即时切换；选择仅保存在本机，不影响任何业务数据。')}</p>
                </div>
                <span className="theme-current-badge">{t('当前')} · {t(UI_THEMES.find(theme => theme.id === (s.uiTheme ?? 'aurora'))?.name ?? '极光琉璃')}</span>
              </div>
              <div className="theme-gallery" role="radiogroup" aria-label={t('界面主题')}>
                {UI_THEMES.map(theme => {
                  const selected = (s.uiTheme ?? 'aurora') === theme.id
                  return (
                    <button type="button" key={theme.id} role="radio" aria-checked={selected}
                      className={`theme-choice ${selected ? 'active' : ''}`}
                      onClick={() => onChange({ uiTheme: theme.id, uiStyle: theme.id === 'aurora' ? 'liquid' : 'claude' })}>
                      <span className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true">
                        <span className="theme-preview-side" />
                        <span className="theme-preview-main"><i /><i /><i /></span>
                        <span className="theme-preview-glow" />
                      </span>
                      <span className="theme-choice-copy">
                        <span className="theme-choice-title">
                          <strong>{theme.letter} · {t(theme.name)}</strong>
                          <span className="theme-selected-mark"><Check size={13} /></span>
                        </span>
                        <span className="theme-choice-desc">{t(theme.description)}</span>
                        <span className="theme-choice-interaction">{t(theme.interaction)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="theme-gallery-note">{t('暗夜指挥舱、极光琉璃与星舰 HUD 使用固定深色画布；其他主题继续响应上方的明暗模式。关闭动态效果后会停用视差、光斑和弹性动画。')}</div>
            </div>
            <SettingsRow title="动态效果" desc="抽屉滑入、卡片渐入、光斑浮动等动效">
              <Toggle checked={s.uiMotion !== false} onChange={v => onChange({ uiMotion: v })} />
            </SettingsRow>
            {isPhone && <SettingsRow title="底部菜单栏" desc="开启后底部固定显示菜单栏；关闭则用左上角按钮打开侧边栏切换页面，聊天等页面全屏无遮挡">
              <Toggle checked={!!s.showBottomNav} onChange={v => onChange({ showBottomNav: v })} />
            </SettingsRow>}
          </SettingsSection>

          <SettingsSection title="AI 行为" desc="对话推理与思考偏好，全局生效" icon={Sparkles} tone="indigo">
            <SettingsRow title="AI 思考模式" desc="开启后 AI 对话默认深度推理（答案更严谨，但更慢、消耗更高）；仍可在聊天框单独调整等级。文档问答等模块同步生效。">
              <Toggle checked={!!s.thinkingMode} onChange={v => onChange({ thinkingMode: v })} />
            </SettingsRow>
            <SettingsRow title="AI 记忆" desc="开启后，AI 在任何会话里都会带上全部历史会话的近期上下文，能记住你之前聊过的内容；关闭则每个会话互相独立。开启会多消耗一些 token。">
              <Toggle checked={!!s.aiMemory} onChange={v => onChange({ aiMemory: v })} />
            </SettingsRow>
            <SettingsRow title="免费模型通道" desc="直连 OpenCode Zen 与 Kilo 公共网关的免费模型（免 Key，清单跟随上游更新），出现在 AI 助手的「免费模型」分类里。可用性与额度取决于上游和你的网络。">
              <Toggle checked={s.upstreamFree !== false} onChange={v => onChange({ upstreamFree: v })} />
            </SettingsRow>
            <SettingsRow title="对话自动调用工具" desc="开启后，用自有 API 账户聊天时，AI 可自主调用已连接的 MCP 工具（抓网页、读文件、查资料等，工具在「插件」页连接）。仅本机生效、默认关闭；所选模型不支持工具调用时会自动按普通对话回答。">
              <Toggle checked={toolCalling} onChange={v => { setToolCalling(v); saveToolCallingEnabled(v) }} />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="AI 助手工具栏" desc="AI 助手右上角「全部功能」菜单里的工具：逐个开关显隐，用上下箭头调整顺序" icon={Wrench} tone="indigo">
            {mergeToolbarOrder(s.aiToolbarOrder).map((key, idx, arr) => (
              <SettingsRow key={key} title={AI_TOOLBAR_LABELS[key]}>
                <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                  <button className="icon-btn" title={t('上移')} disabled={idx === 0} onClick={() => { const next = [...arr]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]; onChange({ aiToolbarOrder: next as string[] }) }}><ChevronUp size={15} /></button>
                  <button className="icon-btn" title={t('下移')} disabled={idx === arr.length - 1} onClick={() => { const next = [...arr]; [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]]; onChange({ aiToolbarOrder: next as string[] }) }}><ChevronDown size={15} /></button>
                  <Toggle checked={s.aiToolbar?.[key] !== false} onChange={v => onChange({ aiToolbar: { ...(s.aiToolbar ?? {}), [key]: v } })} />
                </div>
              </SettingsRow>
            ))}
          </SettingsSection>

          {!phoneShell && (<SettingsSection title="本地模型服务" desc="App 内按需启用，不影响系统服务与其他软件" icon={HardDrive} tone="green">
            <div className="local-mem-info">
              <span className="local-mem-badge">
                {memDetected ? t('已检测物理内存 {gb} GB', { gb: memGb.toFixed(1) }) : t('未获取到系统内存（请在下方选择档位）')}
              </span>
              <span className="local-mem-tier">{t('当前档位：{tier}G · 最多同时开启 {n} 个', { tier: memTier, n: maxServicesForTier(memTier) })}</span>
            </div>
            <div className="local-mem-advice">{t(tierAdvice(memTier))}</div>
            {!memDetected && (
              <div className="local-mem-override">
                <span>{t('内存档位：')}</span>
                <select className="select" style={{ width: 110 }} value={memTier}
                  onChange={e => onChange({ memoryTierOverride: Number(e.target.value) as MemoryTier })}>
                  <option value={8}>{t('8G 及以下')}</option>
                  <option value={16}>{t('16G 左右')}</option>
                  <option value={32}>{t('16G 以上')}</option>
                </select>
              </div>
            )}
            {LOCAL_SERVICE_KEYS.map(key => {
              const label = key === 'ollama' ? 'Ollama' : key === 'comfyui' ? 'ComfyUI' : key === 'qwentts' ? 'Qwen3-TTS' : 'LM Studio'
              const enabled = isServiceEnabled(s, key)
              const status = serviceStatus[key]
              const running = typeof status === 'string' && status.length > 0
              const managed = !!managedKeys[key]
              return (
                <div className="local-service-row" key={key}>
                  <div className="local-service-main">
                    <div className="local-service-title">
                      <span>{t('允许 App 使用 {label}', { label })}</span>
                      <span className={`local-status-badge ${enabled && running ? 'running' : ''}`}>
                        {!enabled ? t('已停用') : status === undefined || status === null ? t('未检测') : running ? (managed ? t('运行中 · App启动') : t('运行中 · 外部')) : t('未运行')}
                      </span>
                    </div>
                    <div className="local-service-desc">
                      {!enabled
                        ? t('已停用：端口进程已停止、内存已释放。打开开关将重新启动服务。')
                        : running
                          ? t('服务地址 {status} · {by}', { status, by: managed ? t('由本 App 启动') : t('由你或其他软件启动') })
                          : t('本机后台服务未启动，打开开关或点「启动」将拉起服务进程（不开图形界面）')}
                    </div>
                  </div>
                  <div className="local-service-actions">
                    {enabled && !running && (
                      <button className="btn sm" disabled={busyKey === key}
                        onClick={() => void onStartService(key)} title={t('仅启动后台服务进程，不打开 GUI')}>
                        {busyKey === key ? t('处理中…') : t('启动')}
                      </button>
                    )}
                    {enabled && running && managed && (
                      <button className="btn sm" disabled={busyKey === key}
                        onClick={() => void onStopService(key)} title={t('停止由本 App 启动的进程')}>
                        {busyKey === key ? t('处理中…') : t('停止')}
                      </button>
                    )}
                    {enabled && running && <button className="btn sm" onClick={refreshServiceStatus} title={t('刷新运行状态')}>{t('刷新')}</button>}
                    <Toggle checked={enabled} onChange={() => void onToggleLocalService(key)} />
                  </div>
                </div>
              )
            })}
            <div className="local-mem-note">
              {t('「允许 App 使用」开启会拉起服务进程，关闭会停止该服务端口上的进程（含其他软件启动的）并释放内存；「启动/停止」单独管理服务进程（不开图形界面、不改系统自启）。LM Studio 无 CLI 后台启动方式，需在其应用内手动开启。')}
            </div>
            {isDesktopApp() && (
              <SettingsRow title="模型扫描覆盖 Comfy Desktop 实例" desc="添加本地模型时，磁盘扫描除 ~/ComfyUI/models 外，同时覆盖 Comfy Desktop 各实例的模型目录与 extra_model_paths.yaml 指向的目录（仅本机设置）">
                <Toggle checked={scanDesktop} onChange={v => { setComfyScanDesktop(v); setScanDesktopState(v) }} />
              </SettingsRow>
            )}
            {isDesktopApp() && (
              <SettingsRow title="ComfyUI 启动时拉起 Comfy Desktop" desc="开启后，在本 App 里开启 ComfyUI（开关或一键启动）将改为打开 Comfy Desktop 应用，还需在其中点开你的实例；关闭则按 ~/ComfyUI 命令行方式启动（仅本机设置）">
                <Toggle checked={launchDesktop} onChange={v => { setComfyLaunchDesktop(v); setLaunchDesktopState(v) }} />
              </SettingsRow>
            )}
          </SettingsSection>)}

          <SettingsSection title="通用" desc="提醒与预警行为" icon={Settings} tone="indigo">
            <SettingsRow title="签到提醒" desc="在看板与侧栏显示 AI Agent 工具今日待签到数量">
              <Toggle checked={s.checkinReminder} onChange={v => onChange({ checkinReminder: v })} />
            </SettingsRow>
            <SettingsRow title="耗尽预警阈值" desc={t('额度预计剩余不超过 {days} 天时计入"即将耗尽"', { days: s.alertDays })}>
              <select className="select" style={{ width: 90 }} value={s.alertDays} onChange={e => onChange({ alertDays: Number(e.target.value) })}>
                {[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{t('{d} 天', { d })}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow title="默认额度单位" desc="新账户录入额度时的预选单位">
              <select className="select" style={{ width: 110 }} value={s.defaultUnit} onChange={e => onChange({ defaultUnit: e.target.value as CreditUnit })}>
                {(Object.keys(UNIT_LABEL) as CreditUnit[]).map(u => <option key={u} value={u}>{t(UNIT_LABEL[u])}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow title="每月预算" desc="人民币，超出 90% 时提示">
              <input className="input" type="number" min="0" step="10" value={s.monthlyBudget}
                     onChange={e => onChange({ monthlyBudget: Math.max(0, Number(e.target.value)) })}
                     style={{ width: 100 }} />
            </SettingsRow>
            <SettingsRow title="余额自动刷新间隔" desc="保险箱解锁后，按此间隔静默刷新能自动查余额的平台（DeepSeek、Kimi、硅基流动、OpenRouter）；其余平台无官方接口，不受影响。此设置只保存在本设备">
              <select className="select" style={{ width: 110 }} value={patrolHours} onChange={e => { const v = Number(e.target.value); setPatrolHours(v); savePatrolHours(v) }}>
                {PATROL_HOUR_OPTIONS.map(h => <option key={h} value={h}>{h === 0 ? t('关闭') : t('{h} 小时', { h })}</option>)}
              </select>
            </SettingsRow>
          </SettingsSection>

          {isDesktopApp() && (
          <SettingsSection title="阅览方式" desc="AI 生成的视频/图片用本机软件打开" icon={Eye} tone="indigo">
            <SettingsRow title="视频播放软件" desc="在视频生成结果里点「外部打开」时用它播放">
              <select className="select" style={{ width: 190 }} value={viewerPrefs.video}
                      onChange={e => { const v = { ...viewerPrefs, video: e.target.value }; setViewerPrefs(v); saveViewerPrefs(v) }}>
                <option value="internal">{t('应用内播放')}</option>
                <option value="system">{t('系统默认软件')}</option>
                {mediaApps.filter(a => a.kinds.includes('video')).map(a => <option key={a.path} value={a.path}>{a.name}</option>)}
                {viewerPrefs.video !== 'internal' && viewerPrefs.video !== 'system' && !mediaApps.some(a => a.path === viewerPrefs.video) && (
                  <option value={viewerPrefs.video}>{viewerPrefs.video.split('/').pop()?.replace(/\.app$/, '') ?? viewerPrefs.video}（{t('未检测到')}）</option>
                )}
              </select>
            </SettingsRow>
            <SettingsRow title="图片查看软件" desc="在图片生成结果里点「外部打开」时用它查看，与视频选项互相独立">
              <select className="select" style={{ width: 190 }} value={viewerPrefs.image}
                      onChange={e => { const v = { ...viewerPrefs, image: e.target.value }; setViewerPrefs(v); saveViewerPrefs(v) }}>
                <option value="internal">{t('应用内查看')}</option>
                <option value="system">{t('系统默认软件')}</option>
                {mediaApps.filter(a => a.kinds.includes('image')).map(a => <option key={a.path} value={a.path}>{a.name}</option>)}
                {viewerPrefs.image !== 'internal' && viewerPrefs.image !== 'system' && !mediaApps.some(a => a.path === viewerPrefs.image) && (
                  <option value={viewerPrefs.image}>{viewerPrefs.image.split('/').pop()?.replace(/\.app$/, '') ?? viewerPrefs.image}（{t('未检测到')}）</option>
                )}
              </select>
            </SettingsRow>
            <SettingsRow title="本机软件扫描" desc="按各软件声明可打开的文件类型自动分类；新安装的软件重新打开设置或点重新扫描即可出现">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{mediaAppsLoading ? t('扫描中…') : t('已发现 {v} 个视频软件、{i} 个图片软件', { v: mediaApps.filter(a => a.kinds.includes('video')).length, i: mediaApps.filter(a => a.kinds.includes('image')).length })}</span>
                <button className="btn sm ghost" onClick={() => void scanMediaApps(true)} disabled={mediaAppsLoading}><RefreshCw size={13} /> {t('重新扫描')}</button>
              </div>
            </SettingsRow>
          </SettingsSection>
          )}

          <SettingsSection title="提醒通知" desc="通过系统通知提醒签到、到期、额度告急与预算" icon={Bell} tone="amber">
            <SettingsRow title="开启系统通知" desc={notifyPerm === 'granted' ? '通知权限已获得' : notifyPerm === 'denied' ? '通知权限被拒绝，请到系统设置中开启' : notifyPerm === 'unsupported' ? '当前平台不支持系统通知' : '开启时将请求系统通知权限'}>
              <Toggle checked={np.enabled} onChange={(v) => void onToggleNotifyEnabled(v)} />
            </SettingsRow>
            {np.enabled && <>
              <SettingsRow title="每日签到提醒" desc="到达设定时间后，当天仍有未签到工具时提醒；安卓端关掉 App 也会定时提醒">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="input" type="time" value={np.checkinTime} onChange={e => patchNotify({ checkinTime: e.target.value || '09:00' })} style={{ width: 108 }} />
                  <Toggle checked={np.checkin} onChange={v => patchNotify({ checkin: v })} />
                </div>
              </SettingsRow>
              <SettingsRow title="到期提醒" desc={t('订阅/额度在 {days} 天内到期时提醒', { days: s.alertDays })}>
                <Toggle checked={np.expiry} onChange={v => patchNotify({ expiry: v })} />
              </SettingsRow>
              <SettingsRow title="额度告急提醒" desc="按当前用量预测，账户额度即将耗尽时提醒">
                <Toggle checked={np.forecast} onChange={v => patchNotify({ forecast: v })} />
              </SettingsRow>
              <SettingsRow title="预算提醒" desc="本月花费达到预算 90% 以及超支时提醒">
                <Toggle checked={np.budget} onChange={v => patchNotify({ budget: v })} />
              </SettingsRow>
              <SettingsRow title="低余额提醒" desc="账户余额低于阈值时提醒（余额由自动巡检与手动刷新更新）">
                <Toggle checked={np.lowBalance} onChange={v => patchNotify({ lowBalance: v })} />
              </SettingsRow>
              <SettingsRow title="低余额阈值（元）" desc="货币额度账户的剩余额度低于此值时触发低余额提醒">
                <input className="input" type="number" min="0" step="1" value={s.lowBalanceThreshold ?? 10}
                       onChange={e => onChange({ lowBalanceThreshold: Math.max(0, Number(e.target.value)) })}
                       style={{ width: 100 }} />
              </SettingsRow>
              <SettingsRow title="消费异常提醒" desc="某账户单日花费远超近 7 天日均时提醒（防 Key 盗刷/程序跑飞）">
                <Toggle checked={np.anomaly} onChange={v => patchNotify({ anomaly: v })} />
              </SettingsRow>
              <SettingsRow title="月度报告推送" desc="进入新月份后推一条上月消费摘要（总消费、最高平台、环比），每月只推一次">
                <Toggle checked={np.monthlyReport} onChange={v => patchNotify({ monthlyReport: v })} />
              </SettingsRow>
              <SettingsRow title="测试通知" desc="立即发送一条测试通知，确认系统能收到">
                <button className="btn sm" onClick={() => void onTestNotification()}>{t('发送测试')}</button>
              </SettingsRow>
            </>}
          </SettingsSection>

          {desktopShell && <SettingsSection title="桌面端" desc="菜单栏常驻、全局快捷键与开机自启（仅桌面客户端）" icon={Monitor} tone="indigo">
            <SettingsRow title="应用图标显示" desc="仅菜单栏：不在 Dock 显示；仅 Dock：无菜单栏图标，关闭主窗口即退出应用；迷你窗打开后无操作且鼠标移开约 5 秒会自动收起">
              <div style={{ display: 'flex', gap: 6 }}>
                {([['both', '两者都显示'], ['dock', '仅 Dock'], ['menubar', '仅菜单栏']] as const).map(([v, label]) => (
                  <button key={v} className={`btn sm ${((s.iconDisplay ?? 'both') === v) ? 'primary' : ''}`} onClick={() => onChange({ iconDisplay: v })}>{t(label)}</button>
                ))}
              </div>
            </SettingsRow>
            <SettingsRow title="开机自启（登录系统后常驻菜单栏）" desc="开启后开机自动启动，点菜单栏图标打开迷你窗">
              {autostart === null
                ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('不可用')}</span>
                : <Toggle checked={autostart} onChange={(v) => void onToggleAutostart(v)} />}
            </SettingsRow>
            <SettingsRow title="静默启动" desc="开启后，开机自启时不打开主窗口，只在菜单栏/Dock 常驻，需要时点图标打开；手动启动 App 不受影响">
              {silentStart === null
                ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('不可用')}</span>
                : <Toggle checked={silentStart} onChange={(v) => void onToggleSilentStart(v)} />}
            </SettingsRow>
            <SettingsRow title="全局快捷键" desc="关闭后两个组合键都不再生效（托盘图标与迷你窗不受影响）">
              <Toggle checked={s.shortcutsEnabled ?? true} onChange={v => onChange({ shortcutsEnabled: v })} />
            </SettingsRow>
            <SettingsRow title="快捷键：呼出 AI 助手" desc="在任何应用中按下即可呼出主窗口并打开 AI 助手；点按钮后按新组合录制">
              <button className="btn sm" onClick={() => setRecording('ai')}>{recording === 'ai' ? t('请按下组合键…（Esc 取消）') : fmtAccel(accelAi)}</button>
            </SettingsRow>
            <SettingsRow title="快捷键：菜单栏迷你窗" desc="点菜单栏图标也可弹出速览；关闭主窗口后应用仍常驻，退出请用托盘菜单">
              <button className="btn sm" onClick={() => setRecording('mini')}>{recording === 'mini' ? t('请按下组合键…（Esc 取消）') : fmtAccel(accelMini)}</button>
            </SettingsRow>
            {(s.shortcutAi || s.shortcutMini) && <SettingsRow title="恢复默认快捷键" desc="回到 ⌘/Ctrl+Shift+A（AI 助手）与 ⌘/Ctrl+Shift+M（迷你窗）">
              <button className="btn sm" onClick={() => onChange({ shortcutAi: undefined, shortcutMini: undefined })}>{t('恢复默认')}</button>
            </SettingsRow>}
          </SettingsSection>}

          {desktopShell && <SettingsSection title="本地统一网关" desc="在本机开一个 OpenAI 兼容接口（仅 127.0.0.1），Cursor 等工具填这个地址即可用管家里的 Key；按模型名路由，同模型多账户自动故障转移；真实 Key 只存内存，停止即清除" icon={Network} tone="indigo">
            <SettingsRow title={gwStatus?.running ? t('运行中 · {models} 个模型 / {routes} 条路由 · 已处理 {reqs} 次请求', { models: gwStatus.modelCount, routes: gwStatus.routeCount, reqs: gwStatus.requests }) : '网关未运行'} desc="开启需要先解锁保险箱（解密 Key 注册路由，只存内存不落盘）">
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" onClick={() => void refreshGw()}>{t('刷新')}</button>
                {gwStatus?.running
                  ? <button className="btn sm" disabled={gwBusy} onClick={() => void gwStopFlow()}>{t('停止并清除 Key')}</button>
                  : <button className="btn sm primary" disabled={gwBusy} onClick={() => void gwStartFlow()}>{gwBusy ? t('开启中…') : t('开启网关')}</button>}
              </div>
            </SettingsRow>
            <SettingsRow title="接口地址（填到 Cursor 等工具的 OpenAI Base URL）" desc="模型名填引擎目录里的 id（如 deepseek-chat），工具会自动按名路由">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <code style={{ fontSize: 12 }}>http://127.0.0.1:{s.gatewayPort || 8787}/v1</code>
                <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(`http://127.0.0.1:${s.gatewayPort || 8787}/v1`); notify('接口地址已复制') }}>{t('复制')}</button>
              </div>
            </SettingsRow>
            <SettingsRow title="访问令牌（工具里的 API Key 填这个）" desc="不是你的真实平台 Key；泄露了重新生成即可（生成后需重启网关生效）">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="input" style={{ width: 190 }} value={s.gatewayToken ?? ''} placeholder={t('尚未生成')} onChange={e => onChange({ gatewayToken: e.target.value })} />
                <button className="btn sm" onClick={() => onChange({ gatewayToken: genGatewayToken() })}>{t('生成')}</button>
                <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(s.gatewayToken ?? ''); notify('令牌已复制') }}>{t('复制')}</button>
              </div>
            </SettingsRow>
            <SettingsRow title="监听端口" desc="改端口后需停止再重新开启网关">
              <input className="input" type="number" min={1024} max={65535} style={{ width: 110 }} value={s.gatewayPort ?? 8787} onChange={e => onChange({ gatewayPort: Number(e.target.value) || 8787 })} />
            </SettingsRow>
            <SettingsRow title="解锁保险箱后自动开启" desc="每次解锁后自动注册路由并启动网关（令牌需已生成）">
              <Toggle checked={!!s.gatewayAutoStart} onChange={v => onChange({ gatewayAutoStart: v })} />
            </SettingsRow>
          </SettingsSection>}
        </>}

        {setTab === 'data' && <>
          <SettingsSection title="云同步" desc="同一账号跨 Web / 桌面 / 安卓 / 小程序自动同步" icon={Cloud} tone="indigo">
            <SettingsRow
              title={cloudUser ? (cloudUser.name ? t('已登录：{name}', { name: cloudUser.name }) : t('已登录')) : '未登录（仅本机存储）'}
              desc={cloudUser
                ? t('数据自动同步 · 最近同步 {time}', { time: lastSyncAt ? new Date(lastSyncAt).toLocaleString(locale()) : t('待同步') })
                : '登录后在任意客户端的数据都会自动同步；不登录也可正常本地使用'}
            >
              {cloudUser ? <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" onClick={onSync} disabled={syncing}>{syncing ? t('同步中…') : t('立即同步')}</button>
                <button className="btn sm ghost" onClick={onLogout}>{t('退出')}</button>
              </div> : <button className="btn sm primary" onClick={onLogin}>{t('登录 / 注册')}</button>}
            </SettingsRow>
            {cloudUser && syncError && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5, color: 'var(--red, #d92d20)' }}>
              <AlertTriangle size={14} /> {t('同步失败：{err}（点「立即同步」重试）', { err: syncError })}
            </div>}
            <SettingsRow title="同步本地模型账户" desc="把 Ollama / ComfyUI 等本地模型账户也同步到云端（其他设备上仅显示记录，仍需本机服务才能调用）">
              <Toggle checked={!!s.syncLocalProviders} onChange={v => onChange({ syncLocalProviders: v })} />
            </SettingsRow>
            <p className="set-note">{t('支持微信扫码、手机号验证码、邮箱验证码、WorkBuddy 账号登录。登录后任意端的增删改会在约 5 秒内自动同步到其他端；同步内容包含账户、额度、签到、用量与加密密钥（密文），各端需用同一主密码解锁。')}</p>
          </SettingsSection>

          <SettingsSection title="WebDAV 同步" desc="备用通道：同步到你自己的网盘（坚果云等），不依赖云端账号" icon={Cloud} tone="indigo">
            <SettingsRow title="启用 WebDAV 同步" desc="开启后自动同步（启动时、每 45 秒、切回前台时），规则与云同步一致：静默覆盖、新盖旧">
              <Toggle checked={wcfg.enabled} onChange={v => patchW({ ...wcfg, enabled: v })} />
            </SettingsRow>
            <SettingsRow title="服务器地址" desc="坚果云默认已填好；其他支持 WebDAV 的网盘改这里（需 https）">
              <input className="input" style={{ width: 250 }} value={wcfg.url} onChange={e => patchW({ ...wcfg, url: e.target.value })} placeholder="https://dav.jianguoyun.com/dav/" />
            </SettingsRow>
            <SettingsRow title="账号" desc="坚果云填你的登录邮箱">
              <input className="input" style={{ width: 250 }} value={wcfg.username} onChange={e => patchW({ ...wcfg, username: e.target.value })} placeholder="邮箱" />
            </SettingsRow>
            <SettingsRow title="应用密码" desc="不是登录密码：坚果云网页版 → 账户信息 → 安全设置 → 第三方应用管理 → 添加应用密码">
              <input className="input" style={{ width: 250 }} type="password" value={wcfg.passcode} onChange={e => patchW({ ...wcfg, passcode: e.target.value })} placeholder="应用密码" />
            </SettingsRow>
            <SettingsRow title="文件路径" desc="同步文件在网盘里的位置，不存在会自动创建">
              <input className="input" style={{ width: 250 }} value={wcfg.path} onChange={e => patchW({ ...wcfg, path: e.target.value })} placeholder="AI魔方/sync.json" />
            </SettingsRow>
            <SettingsRow title="立即同步" desc={altStatusText(altStatus.webdav)}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" disabled={wTesting || !wcfg.username.trim()} onClick={() => void doWTest()}>{wTesting ? '测试中…' : '测试连接'}</button>
                <button className="btn sm primary" disabled={altSyncing || !wcfg.enabled} onClick={onAltSync}>{altSyncing ? '同步中…' : '立即同步'}</button>
              </div>
            </SettingsRow>
            {wTest && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-2)' }}>{wTest}</div>}
            <p className="set-note">配置与应用密码只保存在本机，不进任何同步与备份。同步内容与云同步口径一致（密钥为密文，需同一主密码解锁）。与云同步可以同时开，以最后修改的一端为准。</p>
          </SettingsSection>

          {desktopShell && (
            <SettingsSection title="iCloud Drive 同步" desc="备用通道（苹果设备）：同步文件放 iCloud Drive，苹果设备间自动同步" icon={Cloud} tone="indigo">
              <SettingsRow title="启用 iCloud Drive 同步" desc="同步文件写在 iCloud Drive 根目录的「AI魔方同步.json」；仅装了 iCloud Drive 的电脑可用，安卓无法使用此通道">
                <Toggle checked={icEnabled} onChange={patchIc} />
              </SettingsRow>
              <SettingsRow title="立即同步" desc={altStatusText(altStatus.icloud)}>
                <button className="btn sm primary" disabled={altSyncing || !icEnabled} onClick={onAltSync}>{altSyncing ? '同步中…' : '立即同步'}</button>
              </SettingsRow>
              <p className="set-note">适合多台苹果设备之间同步；跨安卓请用 WebDAV 通道。两个备用通道可同时开，以最后修改的一端为准。</p>
            </SettingsSection>
          )}

          <SettingsSection title="云端自动备份" desc="定时快照存云端，出事可回滚（与云同步互补）" icon={Cloud} tone="indigo">
            <SettingsRow title="自动备份" desc="开启后本机在 App 运行期间按间隔自动存快照；此偏好仅本机保存，各设备可各自设置">
              <Toggle checked={cbPrefs.enabled} onChange={v => patchCb({ ...cbPrefs, enabled: v })} />
            </SettingsRow>
            <SettingsRow title="备份间隔" desc="自动备份的时间间隔">
              <select className="select" value={cbPrefs.intervalHours} onChange={e => patchCb({ ...cbPrefs, intervalHours: Number(e.target.value) })}>
                <option value={6}>每 6 小时</option>
                <option value={24}>每天</option>
                <option value={168}>每周</option>
              </select>
            </SettingsRow>
            <SettingsRow title="保留份数" desc="云端最多保留的快照数，超出的最旧一份自动删除">
              <select className="select" value={cbPrefs.keep} onChange={e => patchCb({ ...cbPrefs, keep: Number(e.target.value) })}>
                <option value={3}>3 份</option>
                <option value={5}>5 份</option>
                <option value={10}>10 份</option>
              </select>
            </SettingsRow>
            <SettingsRow title="立即备份" desc={cloudUser ? (cloudBackupLastAt() ? `上次备份：${new Date(cloudBackupLastAt()).toLocaleString(locale())}` : '还没有备份过') : '登录云账号后可用'}>
              <button className="btn sm primary" disabled={!cloudUser || cbBusy} onClick={() => void doCbNow()}>{cbBusy ? '处理中…' : '立即备份一次'}</button>
            </SettingsRow>
            {isDesktopApp() && (
              <SettingsRow title="保存到 iCloud Drive" desc="把一份完整备份文件写进这台电脑的 iCloud Drive 文件夹，自动同步到你的 iCloud（内容与云端快照一致，密钥为密文）">
                <button className="btn sm" disabled={icloudBusy} onClick={() => void doIcloudSave()}>{icloudBusy ? '保存中…' : '保存一份到 iCloud'}</button>
              </SettingsRow>
            )}
            {cloudUser && (cbList.length === 0
              ? <div className="voice-empty">暂无云端快照</div>
              : cbList.map(m => (
                <div key={m.id} className="set-stat" style={{ justifyContent: 'space-between' }}>
                  <span>{new Date(m.createdAt).toLocaleString(locale())} · {(m.size / 1024).toFixed(0)} KB{m.note ? ` · ${m.note}` : ''}{m.mine ? '' : ' · 其他设备'}</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {cbConfirmId === m.id
                      ? <><button className="btn sm" style={{ color: 'var(--red, #d92d20)' }} disabled={cbBusy} onClick={() => void doCbRestore(m.id)}>确认恢复（覆盖当前数据）</button>
                        <button className="btn sm ghost" onClick={() => setCbConfirmId(null)}>取消</button></>
                      : <><button className="btn sm" disabled={cbBusy} onClick={() => setCbConfirmId(m.id)}>恢复</button>
                        <button className="btn sm ghost" disabled={cbBusy} onClick={() => void doCbDelete(m.id)}>删除</button></>}
                  </span>
                </div>
              )))}
            <p className="set-note">快照是某个时间点的整份数据副本：误删、改坏后可一键回到当时。恢复前会自动把当前状态也存一份快照防手滑。快照内容与云同步口径一致（密钥为密文、本地模型账户默认不含）。</p>
          </SettingsSection>

          <SettingsSection title="账号管理" desc="已登录账号、登录方式与本机可见设备" icon={Fingerprint} tone="blue">
            <SettingsRow title="当前账号" desc="已登录账号的 ID 与登录来源">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* 账号信息必须渲染为可见内容：主题会隐藏 settings-row-desc，写进 desc 等于不显示 */}
                {cloudUser
                  ? <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{t('ID：{id}… · 来源：{src}', { id: cloudUser.id.slice(0, 12), src: cloudUser.provider ?? (cloudUser.email ? t('邮箱') : cloudUser.phone ? t('手机号') : t('第三方')) })}</span>
                  : <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{t('未登录')}</span>}
                <button className="btn sm" onClick={onLogin}>{cloudUser ? t('切换账号') : t('登录')}</button>
              </div>
            </SettingsRow>
            {cloudUser && <>
              <SettingsRow title="账号标识" desc="登录所用的邮箱或手机号">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{cloudUser.email ?? cloudUser.phone ?? cloudUser.name ?? t('未公开')}</span>
                  <span className="set-status-dot ok" />
                </div>
              </SettingsRow>
            </>}
            <div className="voice-section-label" style={{ marginTop: 12 }}>{t('本机可见登录设备')} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>（{devices.length}）</span></div>
            {devices.length === 0 ? <div className="voice-empty">{t('暂无设备记录')}</div> : devices.map(d => (
              <div key={d.clientId} className="set-stat" style={{ justifyContent: 'space-between' }}>
                <span>{d.label} · {d.platform}</span>
                <b style={{ fontSize: 11, color: 'var(--text-3)' }}>{new Date(d.lastSeen).toLocaleString(locale())}</b>
              </div>
            ))}
            <div className="voice-hint"><Info size={13} /> {t('当前云服务接口不提供服务端会话列表，这里显示的是本机登记过的设备；同一账号的实际登录设备请到官方账号中心查看。')}</div>
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setDevices([...loadDevices()])}><RefreshCw size={13} /> {t('刷新设备列表')}</button>
          </SettingsSection>

          <SettingsSection title="应用更新" desc={t('当前版本 v{ver} · 检查并安装新版本', { ver: APP_VERSION })} icon={RefreshCw} tone="green">
            <SettingsRow title="检查更新" desc={isDesktopApp()
              ? '桌面端自动下载安装，完成后点击重启生效'
              : currentPlatform() === 'docker'
                ? 'Docker 版提供可一键复制的更新命令，在终端执行后自动替换实例'
                : currentPlatform() === 'android'
                  ? '安卓端下载最新 APK 覆盖安装，数据不丢失'
                  : '检测新版本并按平台提示更新方式'}>
              <button className="btn sm primary" onClick={onCheckUpdate}><RefreshCw size={14} /> {t('检查更新')}</button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="数据管理" desc="备份、恢复与清理" icon={HardDrive} tone="amber">
            <SettingsRow title="备份提醒" desc="超过设定天数未备份时在界面提示（全平台通用）">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select className="select" style={{ width: 76 }} value={s.backupReminderDays ?? 7}
                  onChange={e => onChange({ backupReminderDays: Number(e.target.value) as 3 | 7 | 15 })}>
                  <option value={3}>{t('{d} 天', { d: 3 })}</option>
                  <option value={7}>{t('{d} 天', { d: 7 })}</option>
                  <option value={15}>{t('{d} 天', { d: 15 })}</option>
                </select>
                <Toggle checked={s.backupReminder} onChange={v => onChange({ backupReminder: v })} />
              </span>
            </SettingsRow>
            <SettingsRow title="清空全部数据" desc="删除全部账户、额度、签到、用量记录与 AI 聊天历史（含归档）；设置与保险箱保留">
              {confirmClear ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm danger" onClick={() => { onClear(); setConfirmClear(false) }}>{t('确认清空')}</button>
                  <button className="btn sm ghost" onClick={() => setConfirmClear(false)}>{t('取消')}</button>
                </span>
              ) : <button className="btn sm danger" onClick={() => setConfirmClear(true)}><Trash2 size={13} /> {t('清空')}</button>}
            </SettingsRow>
            <SettingsRow title="清空历史与数据" desc="按类别勾选要清空的数据（可多选），执行前会再次确认">
              <button className="btn sm danger" disabled={clearSel.length === 0} onClick={() => setClearConfirmOpen(true)}>
                <Trash2 size={13} /> {t('清空所选')}{clearSel.length > 0 ? `（${clearSel.length}）` : ''}
              </button>
            </SettingsRow>
            <div className="clear-cat-list">
              {CLEAR_CATS.map(c => (
                <div key={c.key} className="clear-cat">
                  <div className="clear-cat-text"><span>{t(c.label)}</span><small>{t(c.hint)}</small></div>
                  <Toggle danger checked={clearSel.includes(c.key)} onChange={() => toggleClearCat(c.key)} />
                </div>
              ))}
            </div>
          </SettingsSection>
          {clearConfirmOpen && (
            <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setClearConfirmOpen(false) }}>
              <div className="modal" style={{ maxWidth: 420 }}>
                <div className="modal-head"><h3>{t('确认清空')}</h3><button className="icon-btn" onClick={() => setClearConfirmOpen(false)}><X size={18} /></button></div>
                <div className="modal-body">
                  <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>{t('以下数据将被永久删除，无法恢复：')}</div>
                  <ul style={{ margin: '0 0 6px', paddingLeft: 18, fontSize: 13, lineHeight: 1.9 }}>
                    {CLEAR_CATS.filter(c => clearSel.includes(c.key)).map(c => <li key={c.key}>{t(c.label)}</li>)}
                  </ul>
                  {clearSel.includes('api') && <div style={{ fontSize: 12, color: 'var(--red)' }}>{t('含 API 密钥：点「确认清空」后会先要求完成一次备份，备份成功才会真正执行清空。')}</div>}
                </div>
                <div className="modal-foot">
                  <button className="btn" onClick={() => setClearConfirmOpen(false)}>{t('取消')}</button>
                  <button className="btn danger" onClick={() => { onClearData?.(clearSel); setClearSel([]); setClearConfirmOpen(false) }}>{t('确认清空')}</button>
                </div>
              </div>
            </div>
          )}

          <SettingsSection title="数据备份" desc="导出/导入完整数据文件，不依赖云同步" icon={Database} tone="green">
            <SettingsRow title="导出完整备份" desc="账户、额度、签到、用量与设置导出为一个 JSON 文件；密钥只含加密密文，文件请妥善保管">
              <button className="btn sm" onClick={doExportBackup}><Download size={13} /> {t('导出备份')}</button>
            </SettingsRow>
            <SettingsRow title="导入备份" desc="用备份文件覆盖当前全部数据；导入前会自动把当前数据另存到本机（localStorage），后悔了可用那份文件再导回">
              <button className="btn sm" onClick={() => backupInputRef.current?.click()}><Upload size={13} /> {t('选择备份文件')}</button>
              <input ref={backupInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => void onBackupFile(e)} />
            </SettingsRow>
          </SettingsSection>

          {isDesktopApp() && (<>
          {!phoneShell && isDesktopApp() && (
          <SettingsSection title="照片图库授权" desc="macOS 要求获得许可后，AI 魔方才能读取照片图库与它的数据库（仅本机）" icon={Folder} tone="blue">
            <SettingsRow title="照片权限" desc="点「打开系统照片权限」去系统设置里给 AI 魔方打开开关（请选完全访问）；或点「触发授权弹窗」让系统直接弹窗询问。应用更新后若再被问一次，是安装包签名变化所致，重新允许即可">
              <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Photos')}>打开系统照片权限</button>
                <button className="btn sm" onClick={() => void probePhotosAccess()}>触发授权弹窗</button>
              </span>
            </SettingsRow>
            <SettingsRow title="授权后能看到什么" desc="图库会读照片数据库，把全部照片和视频都列出来；只在 iCloud 云端、本机还没下载的会标「iCloud 云端」，在照片 App 里打开一次下载到本机后，回到图库刷新即可查看">
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>授权后回图库点刷新生效</span>
            </SettingsRow>
          </SettingsSection>
          )}
          <SettingsSection title="数据存储" desc="为三类文件指定本机存放文件夹；设置只保存在此设备，不云同步" icon={Folder} tone="blue">
            <SettingsRow title="数据存储" desc="总开关：开启后下面三类各有独立开关，互不影响；关闭则全部按默认方式存放">
              <Toggle checked={storagePrefs.enabled} onChange={v => patchStorage({ ...storagePrefs, enabled: v }, v)} />
            </SettingsRow>
            <SettingsRow title="API Key 存放" desc="全部 Key 生成一份密文清单文件（apikeys.json）放进所选文件夹，增删改后自动更新；密钥备份也默认存到这里">
              <Toggle checked={storagePrefs.apikey.enabled} disabled={!storagePrefs.enabled} onChange={v => patchStorage({ ...storagePrefs, apikey: { ...storagePrefs.apikey, enabled: v } }, v)} />
            </SettingsRow>
            {storagePrefs.enabled && storagePrefs.apikey.enabled && (
              <SettingsRow title="存放文件夹">
                <StorageDirPicker dir={storagePrefs.apikey.dir} onPick={() => void pickStorageDir('apikey')} />
              </SettingsRow>
            )}
            <SettingsRow title="AI 助手文件存放" desc="导出的对话记录、归档会话（自动存为一问一答的 md 文件）默认放进所选文件夹">
              <Toggle checked={storagePrefs.ai.enabled} disabled={!storagePrefs.enabled} onChange={v => patchStorage({ ...storagePrefs, ai: { ...storagePrefs.ai, enabled: v } })} />
            </SettingsRow>
            {storagePrefs.enabled && storagePrefs.ai.enabled && (
              <SettingsRow title="存放文件夹">
                <StorageDirPicker dir={storagePrefs.ai.dir} onPick={() => void pickStorageDir('ai')} />
              </SettingsRow>
            )}
            <SettingsRow title="图像/视频存放" desc="AI 图像、AI 视频生成完成后自动存进所选文件夹；手动点保存时也默认存这里">
              <Toggle checked={storagePrefs.media.enabled} disabled={!storagePrefs.enabled} onChange={v => patchStorage({ ...storagePrefs, media: { ...storagePrefs.media, enabled: v } })} />
            </SettingsRow>
            {storagePrefs.enabled && storagePrefs.media.enabled && (
              <SettingsRow title="存放文件夹">
                <StorageDirPicker dir={storagePrefs.media.dir} onPick={() => void pickStorageDir('media')} />
              </SettingsRow>
            )}
          </SettingsSection>
          </>)}

          {pendingImport && (
            <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setPendingImport(null) }}>
              <div className="modal" style={{ maxWidth: 440 }}>
                <div className="modal-head"><h3 style={{ margin: 0 }}>{t('确认导入备份')}</h3><button className="icon-btn" onClick={() => setPendingImport(null)}><X size={18} /></button></div>
                <div className="modal-body">
                  <p style={{ fontSize: 13, lineHeight: 1.7, marginTop: 0 }}>
                    {t('备份内容：账户 {a} 个 · 用量 {u} 条 · 签到 {c} 条 · 额度快照 {q} 条。', { a: pendingImport.summary.accounts, u: pendingImport.summary.usage, c: pendingImport.summary.checkins, q: pendingImport.summary.quotas })}
                  </p>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: '#dc2626' }}>
                    {t('导入将覆盖当前全部数据（导入前会自动另存当前数据到本机）。备份里的密钥是密文，导入后请用备份来源设备的同一主密码解锁保险箱。')}
                  </p>
                </div>
                <div className="modal-foot">
                  <button className="btn" onClick={() => setPendingImport(null)}>{t('取消')}</button>
                  <button className="btn primary" onClick={() => { onImportBackup(pendingImport.state); setPendingImport(null) }}>{t('确认导入并覆盖')}</button>
                </div>
              </div>
            </div>
          )}

          <div className="set-grid-2">
            <SettingsSection title="数据概览" desc="当前本地存储的内容" icon={Database} tone="blue">
              <div className="set-stat"><span>{t('账户')}</span><b>{state.accounts.length}</b></div>
              <div className="set-stat"><span>{t('额度快照')}</span><b>{state.quotas.length}</b></div>
              <div className="set-stat"><span>{t('签到记录')}</span><b>{state.checkins.length}</b></div>
              <div className="set-stat"><span>{t('用量记录')}</span><b>{state.usage.length}</b></div>
            </SettingsSection>
            <SettingsSection title="关于" desc="版本与合规说明" icon={Info} tone="indigo">
              <div className="set-stat"><span>{t('版本')}</span><b className="mono">v{APP_VERSION}</b></div>
              <div className="set-stat"><span>{t('定位')}</span><b style={{ fontSize: 12 }}>{t('本地优先 · 个人资源管理工具')}</b></div>
              <div className="set-about-note"><ShieldCheck size={14} /> {t('数据仅存本机，密钥经 AES-256-GCM 加密，不上传明文')}</div>
            </SettingsSection>
          </div>
        </>}

        {setTab === 'security' && <>
          <SettingsSection title="操作审计日志" desc="查看/复制/删除 Key、导出、改密码、云登录等敏感操作的时间线（只记动作，不记密钥内容；随云同步跨端合并）" icon={ClipboardList} tone="indigo">
            {(auditEntries ?? []).length === 0
              ? <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '6px 2px' }}>{t('暂无审计记录。进行查看 Key、导出备份等敏感操作后会出现在这里。')}</div>
              : <>
                <div className="audit-list">
                  {[...(auditEntries ?? [])].slice(-30).reverse().map(e => (
                    <div key={e.id} className="audit-row">
                      <span className="audit-time">{new Date(e.at).toLocaleString(locale())}</span>
                      <span className="audit-action">{t(e.action)}</span>
                      {e.detail && <span className="audit-detail">{e.detail}</span>}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn sm ghost" onClick={onClearAudit}>{t('清空日志')}</button>
                </div>
              </>}
          </SettingsSection>
          <SettingsSection title="密钥保险箱" desc="本地 AES-256-GCM 加密存储" icon={ShieldCheck} tone="green">
            <SettingsRow title="保险箱状态" desc={s.vaultInitialized ? '已启用 · API Key 加密保存' : '未创建 · API Key 将无法加密保存'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`set-status-dot ${s.vaultInitialized ? 'ok' : ''}`} />
                <button className="btn sm" onClick={onOpenVault}>{s.vaultInitialized ? t('管理') : t('创建')}</button>
              </div>
            </SettingsRow>
            <SettingsRow title="解锁方式" desc={onBioAvailable
              ? (bioLabel.includes('人脸') ? t('可选密码或系统人脸解锁（Face ID）') : t('可选密码或系统生物识别解锁（{bio}）', { bio: t(bioLabel) }))
              : '当前设备不支持生物识别，仅可用密码'}>
              <select className="select" style={{ width: 150 }} value={bioSwitchOpen ? 'biometric' : s.unlockMethod}
                onChange={e => {
                  const m = e.target.value as 'biometric' | 'password'
                  if (m === 'password') {
                    clearBiometricPassword()
                    void unbindVaultPasswordNative()
                    onChange({ unlockMethod: 'password' })
                    setBioSwitchOpen(false)
                  } else if (m === 'biometric' && onBioAvailable) {
                    setBioSwitchPwd('')
                    setBioSwitchOpen(true)
                  }
                }}>
                <option value="password">{t('密码解锁')}</option>
                {onBioAvailable && <option value="biometric">
                  {bioLabel.includes('人脸') ? t('系统人脸解锁 (Face ID)') : bioLabel.includes('触控') ? t('系统触控解锁 (Touch ID)') : t('{bio}解锁', { bio: t(bioLabel) })}
                </option>}
              </select>
            </SettingsRow>
            {onBioAvailable && s.vaultInitialized && (
              <SettingsRow title={t('{bio}快速解锁', { bio: t(bioLabel) })} desc={t('验证{bio}后直接进入 API Key 管理页并解锁密钥（仅作用于该页）', { bio: t(bioLabel) })}>
                <button className="btn sm" onClick={onBioUnlock}><Fingerprint size={14} /> {t('验证解锁')}</button>
              </SettingsRow>
            )}
            {bioSwitchOpen && (
              <div className="set-inline-panel">
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>{t('输入主密码以启用{bio}解锁（验证后本机保存）', { bio: t(bioLabel) })}</div>
                <div className="field">
                  <input className="input" type="password" autoFocus placeholder={t('主密码')} value={bioSwitchPwd}
                    onChange={e => setBioSwitchPwd(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && bioSwitchPwd) void enableBio() }} />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn sm primary" disabled={bioSwitchBusy || !bioSwitchPwd} onClick={() => void enableBio()}>{t('确认启用')}</button>
                  <button className="btn sm" onClick={() => { setBioSwitchOpen(false); setBioSwitchPwd('') }}>{t('取消')}</button>
                </div>
              </div>
            )}
            <SettingsRow title="闲置自动上锁" desc="解锁后无操作达到此时长，自动清空会话密码并重新上锁（活动会重置计时）">
              <select className="select" style={{ width: 150 }} value={s.autoLockMinutes ?? 0} onChange={e => onChange({ autoLockMinutes: Number(e.target.value) })}>
                <option value={0}>{t('关闭')}</option>
                <option value={1}>{t('{n} 分钟', { n: 1 })}</option>
                <option value={5}>{t('{n} 分钟', { n: 5 })}</option>
                <option value={15}>{t('{n} 分钟', { n: 15 })}</option>
                <option value={30}>{t('{n} 分钟', { n: 30 })}</option>
              </select>
            </SettingsRow>
            <SettingsRow title="修改主密码" desc="需用原密码验证，所有密钥将重新加密">
              <button className="btn sm" onClick={() => {
                const known = sessionPwd || getBiometricPassword() || ''
                setOldPwd(known); setNewPwd(''); setConfirmPwd(''); setPwdOpen(true)
              }} disabled={!s.vaultInitialized}>{t('修改')}</button>
            </SettingsRow>
            <SettingsRow title="重置保险箱" desc="清除所有密钥与密码，不可恢复">
              {confirmReset ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm danger" onClick={() => { onResetVault(); setConfirmReset(false) }}>{t('确认重置')}</button>
                  <button className="btn sm ghost" onClick={() => setConfirmReset(false)}>{t('取消')}</button>
                </span>
              ) : (
                <button className="btn sm danger" onClick={() => setConfirmReset(true)} disabled={!s.vaultInitialized}>{t('重置')}</button>
              )}
            </SettingsRow>
          </SettingsSection>
          <p className="set-note"><Lock size={13} /> {t('主密码仅用于派生加密密钥，永不存储明文；"解锁"仅作用于 API Key 管理页，不影响其他功能。')}</p>
        </>}
      </div>

      {pwdOpen && (
        <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) { setPwdOpen(false); setOldPwd(''); setNewPwd(''); setConfirmPwd('') } }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-head"><h3>{t('修改主密码')}</h3><button className="icon-btn" onClick={() => { setPwdOpen(false); setOldPwd(''); setNewPwd(''); setConfirmPwd('') }}><X size={18} /></button></div>
            <div className="modal-body">
              <div className="field">
                <label>{t('原主密码')}</label>
                <input className="input" type="text" autoFocus placeholder={t('输入当前主密码')} value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
              </div>
              <div className="field">
                <label>{t('新主密码（至少 6 位）')}</label>
                <input className="input" type="password" placeholder={t('输入新主密码')} value={newPwd} onChange={e => setNewPwd(e.target.value)} />
              </div>
              <div className="field">
                <label>{t('确认新密码')}</label>
                <input className="input" type="password" placeholder={t('再次输入新主密码')} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
              </div>
            </div>
            <div className="modal-foot" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setPwdOpen(false); setOldPwd(''); setNewPwd(''); setConfirmPwd('') }}>{t('取消')}</button>
              <button className="btn primary" disabled={pwdBusy || !oldPwd || !newPwd} onClick={async () => {
                if (newPwd.length < 6) { notify('新密码至少 6 位'); return }
                if (newPwd !== confirmPwd) { notify('两次新密码不一致'); return }
                setPwdBusy(true)
                try {
                  await onChangePassword(oldPwd, newPwd)
                  setPwdOpen(false); setOldPwd(''); setNewPwd(''); setConfirmPwd('')
                  notify('主密码已修改，密钥已重新加密')
                } catch (e: any) { notify(e.message ?? '修改失败') }
                finally { setPwdBusy(false) }
              }}>{t('确认修改')}</button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}

export default App
