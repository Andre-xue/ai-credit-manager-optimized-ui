// 工坊 · 免费游戏（v0.1.384）：Epic 喜加一自动领取。
// v0.1.398：只保留 Epic，GOG / 育碧分组已删。
// Ethan 追加要求：①分组各自可展开折叠（状态本机记忆），每组列表分页（每页 8 条）；
// ②点每个游戏卡片直达官网领取页面（桌面走 Tauri open_url，手机走系统浏览器）。
// 领取记录：失败组置顶；验证码/登录失效明说原因并给重新绑定入口，绝不静默跳过。
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ChevronDown, ExternalLink, Gamepad2, Loader2, Lock,
  RefreshCw, Store, Trash2, CircleCheck, CircleAlert, Clock3, Link2,
} from 'lucide-react'
import {
  loadPrefs, savePrefs, loadCache, readRecords, clearRecords, sortRecords,
  loadClosedGroups, saveClosedGroups, pageSlice, pageCount,
  fetchEpicFreeGames,
  runFreeGamesCheck, claimEpicGameManual, summarizeCheckResult,
  syncOwnedEpicGames, markEpicGameClaimed,
  bindEpicWithAuthCode, hasEpicAuth, unbindEpic, loadEpicAuth,
  loadLastCheckAt, loadLastError, nextCheckAt,
  EPIC_LOGIN_URL,
  sanitizeLoadFailedMessage, checkoutUrlOf,
  type FreeGame, type FreeGamesPrefs, type FreeGamesCache, type ClaimRecord,
} from '../core/freeGames'
import { openExternal, isDesktopApp, isNativeApp } from '../core/openExternal'
import { epicLauncherUrlOfCheckoutUrl, openViaClient } from '../core/clientLinks'
import {
  openEpicBrowser, listenEpicBrowserClaim, isEpicBrowserSupported, claimFailureFallback,
  epicBrowserOutcomeText, recordEpicBrowserOutcome,
  loadEpicBrowserStatus, saveEpicBrowserStatus,
} from '../core/epicBrowser'
import { getBiometricPassword } from '../core/crypto'
import { Pager } from './Pager'

function JellyToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const [anim, setAnim] = useState<'on' | 'off' | null>(null)
  const prev = useRef(checked)
  useEffect(() => {
    if (prev.current !== checked) {
      setAnim(checked ? 'on' : 'off')
      prev.current = checked
      const t = window.setTimeout(() => setAnim(null), 360)
      return () => window.clearTimeout(t)
    }
  }, [checked])
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`jelly-toggle ${checked ? 'is-on' : ''}`} aria-label={checked ? '关闭' : '开启'}>
      <span className={`jelly-dot ${anim ? `anim-${anim}` : (checked ? 'static-on' : 'static-off')}`} />
    </button>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface GroupDef {
  id: string
  title: string
  sub: string
  games: FreeGame[]
  emptyText: string
  emptyUrl?: string
  emptyUrlLabel?: string
}

function GameCard({ game, claimed, claiming, onClaim, onMarkClaimed }: {
  game: FreeGame
  claimed: boolean
  claiming: boolean
  onClaim?: (g: FreeGame) => void
  onMarkClaimed?: (g: FreeGame) => void
}) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <div className="fg-card" role="button" tabIndex={0} title="点击直达官网领取页面"
      onClick={() => void openExternal(game.url)}
      onKeyDown={e => { if (e.key === 'Enter') void openExternal(game.url) }}>
      <div className="fg-cover">
        {game.imageUrl && imgOk
          ? <img src={game.imageUrl} alt={game.title} loading="lazy" onError={() => setImgOk(false)} />
          : <span className="fg-cover-fallback"><Gamepad2 size={26} /></span>}
        <span className={`fg-badge ${game.status === 'upcoming' ? 'soon' : claimed ? 'in' : 'free'}`}>
          {claimed ? '已入库' : game.status === 'upcoming' ? '即将开始' : '免费'}
        </span>
      </div>
      <div className="fg-card-body">
        <div className="fg-card-title">{game.title}</div>
        <div className="fg-card-meta">
          {game.originalPrice && game.isFree ? <span><s>{game.originalPrice}</s> → 免费</span> : <span>免费</span>}
          {game.endDate && <span> · {fmtDate(game.endDate)} 截止</span>}
          {game.startDate && game.status === 'upcoming' && <span> · {fmtDate(game.startDate)} 开始</span>}
        </div>
        <div className="fg-card-foot">
          <span className="fg-open"><ExternalLink size={12} /> 直达商店领取</span>
          {game.platform === 'epic' && game.status === 'free' && !claimed && onClaim && (
            <button className="btn sm primary" disabled={claiming}
              onClick={e => { e.stopPropagation(); onClaim(game) }}>
              {claiming ? <Loader2 size={12} className="spin" /> : null} {game.autoClaimable ? '立即领取' : '去商店领'}
            </button>
          )}
          {/* v0.1.405：在浏览器领过的游戏，点一下就标成已入库（只影响显示，不会重复下单） */}
          {game.platform === 'epic' && game.status === 'free' && !claimed && onMarkClaimed && (
            <button className="btn sm ghost"
              onClick={e => { e.stopPropagation(); onMarkClaimed(game) }}>
              已领过
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function FreeGamesTool({ sessionPwd, onUnlock, notify, onBack }: {
  sessionPwd: string
  onUnlock: (pwd: string) => void
  notify: (m: string, kind?: 'ok' | 'err') => void
  onBack: () => void
}) {
  const [prefs, setPrefs] = useState<FreeGamesPrefs>(loadPrefs)
  const [cache, setCache] = useState<FreeGamesCache | null>(loadCache)
  const [records, setRecords] = useState<ClaimRecord[]>(() => readRecords())
  const [lastCheck, setLastCheck] = useState<number | null>(() => loadLastCheckAt())
  const [lastError, setLastError] = useState<string | null>(() => loadLastError())
  const [epicBound, setEpicBound] = useState(() => hasEpicAuth())
  // v0.1.404：refresh_token 兜底是正常工作状态，绑定卡平静显示（已绑定 · 自动领取 ·
  // 当前用 refresh_token 登录），详细错误只收进可展开详情，不再红字吓人。
  // 兜底原因（Epic 的 errorCode）随授权加密存本机，重进后详情仍在。
  const [epicFallback, setEpicFallback] = useState(false)
  const [epicFallbackDetail, setEpicFallbackDetail] = useState<string | null>(null)
  useEffect(() => {
    if (!sessionPwd || !hasEpicAuth()) return
    let alive = true
    void loadEpicAuth(sessionPwd).then(a => {
      if (alive && a?.authMode === 'refresh') {
        setEpicFallback(true)
        setEpicFallbackDetail(a.deviceAuthError ?? null)
      } else if (alive) {
        setEpicFallback(false)
        setEpicFallbackDetail(null)
      }
    })
    return () => { alive = false }
  }, [sessionPwd])
  const [checking, setChecking] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [claimingId, setClaimingId] = useState('')
  const [closedGroups, setClosedGroups] = useState<string[]>(loadClosedGroups)
  const [pages, setPages] = useState<Record<string, number>>({})
  const [bindOpen, setBindOpen] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [bindBusy, setBindBusy] = useState(false)
  const [pwdInput, setPwdInput] = useState('')
  // v0.1.397：内嵌浏览器自动领的状态行（桌面端才有；失败原因要显示出来）
  const [epicBrowserStatus, setEpicBrowserStatus] = useState<string | null>(() => loadEpicBrowserStatus())
  useEffect(() => {
    if (!isDesktopApp()) return
    let unlisten: (() => void) | undefined
    void listenEpicBrowserClaim(p => {
      const text = epicBrowserOutcomeText(p.outcome)
      setEpicBrowserStatus(text)
      saveEpicBrowserStatus(text)
      if (recordEpicBrowserOutcome(p.outcome, p.title ?? '', p.checkoutUrl)) refreshRecords()
    }).then(u => { unlisten = u }).catch(() => { /* 监听失败不影响领取 */ })
    return () => { unlisten?.() }
  }, [])

  // 兜底（v0.1.386）：任何残留的英文 "Load failed" 在进 toast 前一律换成中文，
  // 避免以后新增的 fetch 再漏包（385 只包了列表请求，绑定/领取 6 处漏了）。
  const notifySafe = (m: string, kind?: 'ok' | 'err') => notify(sanitizeLoadFailedMessage(m), kind)

  const updatePrefs = (patch: Partial<FreeGamesPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch }
      savePrefs(next)
      return next
    })
  }

  const toggleGroup = (id: string) => setClosedGroups(prev => {
    const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    saveClosedGroups(next)
    return next
  })

  const refreshRecords = () => setRecords(readRecords())
  const refreshMeta = () => {
    setLastCheck(loadLastCheckAt())
    setLastError(loadLastError())
    setCache(loadCache())
    setEpicBound(hasEpicAuth())
  }

  const claimedSet = new Set(
    records.filter(r => r.outcome === 'claimed' || r.outcome === 'already').map(r => `${r.platform}:${r.title}`),
  )

  const refreshListsOnly = async () => {
    setRefreshing(true)
    try {
      const epic = await fetchEpicFreeGames().catch(e => { throw e })
      const at = Date.now()
      const next: FreeGamesCache = { at, epicCurrent: epic.current, epicUpcoming: epic.upcoming }
      try { localStorage.setItem('acm.freegames.cache.v1', JSON.stringify(next)) } catch { /* 忽略 */ }
      setCache(next)
      notifySafe(`已刷新：本周免费 ${epic.current.length} 款，预告 ${epic.upcoming.length} 款`)
    } catch (e) {
      notifySafe(e instanceof Error ? e.message : '拉取失败', 'err')
    } finally { setRefreshing(false) }
  }

  const runCheck = async () => {
    const pwd = sessionPwd || getBiometricPassword() || ''
    setChecking(true)
    try {
      const res = await runFreeGamesCheck(pwd)
      refreshMeta()
      refreshRecords()
      if (res.errors.length) notifySafe(`检查完成：${summarizeCheckResult(res)}；${res.errors[0]}`, 'err')
      else notifySafe(`检查完成：${summarizeCheckResult(res)}`)
    } catch (e) {
      notifySafe(e instanceof Error ? e.message : '检查失败', 'err')
    } finally { setChecking(false) }
  }

  // v0.1.397：内嵌浏览器自动领（实验性质，仅桌面端）。打不开就回落到 396 的
  // 手动兜底（系统浏览器直开结账页），绝不静默失败。领取结果由 Rust 事件回传，
  // 上面的监听 effect 负责显示状态与写记录。
  const openInAppBrowser = async (checkoutUrl: string, title: string) => {
    if (!isEpicBrowserSupported()) { void openExternal(checkoutUrl); return }
    setEpicBrowserStatus('正在打开内嵌浏览器…')
    try {
      await openEpicBrowser(checkoutUrl, title)
      const text = '内嵌浏览器已打开结账页，正在尝试自动领取…（若遇人机验证，请在窗口内完成验证后手动点领取）'
      setEpicBrowserStatus(text)
      saveEpicBrowserStatus(text)
    } catch (e) {
      const text = '内嵌浏览器打不开，已改走系统浏览器'
      setEpicBrowserStatus(text)
      saveEpicBrowserStatus(text)
      notifySafe(e instanceof Error ? e.message : '打开内嵌浏览器失败', 'err')
      void openExternal(checkoutUrl)
    }
  }

  // v0.1.413：直达 Epic 客户端（com.epicgames.launcher://store/purchase?...，
  // 浏览器结账页只换 origin）。直达失败或没装客户端时回落浏览器并报真实原因，
  // 「去浏览器领」按钮保留。内嵌浏览器自动领（397/404）逻辑不动。
  // 注意：open 成功只代表系统把链接交给了客户端，客户端内是否真落到结账页
  // 要真机实测——落不到时请反馈，改走客户端内商店页直达。
  const openEpicClient = async (checkoutUrl: string, title: string) => {
    const launcherUrl = epicLauncherUrlOfCheckoutUrl(checkoutUrl)
    if (!launcherUrl) {
      notifySafe('这条记录的结账链接直达不了客户端，已在浏览器打开', 'err')
      void openExternal(checkoutUrl)
      return
    }
    const res = await openViaClient(launcherUrl, checkoutUrl)
    if (res.via === 'client') {
      notifySafe(`已在 Epic 客户端打开「${title}」的结账页`)
    } else {
      notifySafe(res.browserOpened === false
        ? `Epic 客户端直达失败（${res.reason}），浏览器也没打开，请手动打开结账页`
        : `Epic 客户端直达失败（${res.reason}），已改走浏览器打开结账页`, 'err')
    }
  }

  // v0.1.405：同步浏览器领取——查 Epic 库房已购，对照本周免费列表，命中
  // 的补一条已入库记录（卡片与已入库组立刻显示已入库）。库房接口查不到时
  // 用下面的 markClaimed 手动标记，失败原因会明确报出来，不静默。
  const syncBrowserClaimed = async () => {
    const pwd = sessionPwd || getBiometricPassword() || ''
    if (!pwd) { notifySafe('请先解锁保险箱（同步库房要用 Epic 登录态）'); return }
    setSyncing(true)
    try {
      const res = await syncOwnedEpicGames(pwd)
      refreshMeta()
      refreshRecords()
      if (res.synced.length) notifySafe(`已同步：${res.synced.join('、')} 已在库，显示为已入库`)
      else if (res.alreadyKnown.length) notifySafe(`库房已对照：${res.alreadyKnown.join('、')} 本来就显示已入库`)
      else notifySafe(`库房已对照：本周免费游戏里没有在浏览器领过的（库房共 ${res.ownedCount} 款）`)
    } catch (e) {
      notifySafe(e instanceof Error ? e.message : '同步失败', 'err')
    } finally { setSyncing(false) }
  }

  const markClaimed = (title: string) => {
    if (markEpicGameClaimed(title)) {
      refreshRecords()
      notifySafe(`「${title}」已标记为已入库，之后不会再重复领取`)
    } else {
      notifySafe(`「${title}」本来就显示已入库`)
    }
  }

  const claimOne = async (game: FreeGame) => {
    if (game.platform !== 'epic') { void openExternal(game.url); return }
    if (!game.autoClaimable) { void openExternal(game.url); return }
    const pwd = sessionPwd || getBiometricPassword() || ''
    if (!pwd) { notifySafe('请先解锁保险箱（领取要用 Epic 设备授权）'); return }
    setClaimingId(game.id)
    try {
      await claimEpicGameManual(pwd, game)
      refreshRecords()
      notifySafe(`「${game.title}」已领取入库`)
    } catch (e) {
      refreshRecords()
      // v0.1.404：自动领取失败先走 App 内嵌浏览器（桌面端），不再直接跳外部浏览器；
      // 内嵌浏览器打不开时 openInAppBrowser 自己回落到系统浏览器，领不成时记录里
      // 「去浏览器领」还在（396 手动兜底）。安卓/网页保持直接走系统浏览器。
      const url = checkoutUrlOf(e)
      if (url) {
        if (claimFailureFallback() === 'in-app') {
          await openInAppBrowser(url, game.title)
          notifySafe('自动领取没拿到下单凭证，已在 App 内嵌浏览器打开结账页，登录后点一下就能领', 'err')
        } else {
          void openExternal(url)
          notifySafe('自动领取没拿到下单凭证，已在浏览器打开 Epic 结账页，登录后点一下就能领', 'err')
        }
      } else {
        notifySafe(e instanceof Error ? e.message : '领取失败', 'err')
      }
    } finally { setClaimingId('') }
  }

  const doBind = async () => {
    const pwd = sessionPwd || getBiometricPassword() || ''
    if (!pwd) { notifySafe('请先解锁保险箱，设备授权要加密保存'); return }
    setBindBusy(true)
    try {
      const auth = await bindEpicWithAuthCode(authCode, pwd)
      setEpicBound(true)
      setBindOpen(false)
      setAuthCode('')
      if (auth.deviceAuthError) {
        setEpicFallback(true)
        setEpicFallbackDetail(auth.deviceAuthError)
        // v0.1.404：兜底是正常状态，toast 也平静报，不再把 errorCode 贴进提示里吓人
        notifySafe('Epic 已绑定，当前用 refresh_token 登录，自动领取可用')
      } else {
        setEpicFallback(false)
        setEpicFallbackDetail(null)
        notifySafe('Epic 已绑定，自动领取已就绪')
      }
    } catch (e) {
      notifySafe(e instanceof Error ? e.message : '绑定失败', 'err')
    } finally { setBindBusy(false) }
  }

  const epicClaimedCount = records.filter(r => r.platform === 'epic' && r.outcome === 'claimed').length
  const loginFailed = records.some(r => r.outcome === 'error' && /登录失效|重新绑定/.test(r.message))
  const captchaFailed = records.some(r => r.outcome === 'error' && /验证码/.test(r.message))

  const groups: GroupDef[] = [
    {
      id: 'current', title: '本周可领', sub: 'Epic 喜加一',
      games: prefs.epicEnabled ? (cache?.epicCurrent ?? []) : [],
      emptyText: '本周暂无免费游戏，或还没拉取过列表，点「立即检查一次」试试。',
    },
    {
      id: 'upcoming', title: '即将开始', sub: 'Epic 下周预告',
      games: prefs.epicEnabled ? (cache?.epicUpcoming ?? []) : [],
      emptyText: '暂无预告。Epic 每周四 23:00（北京时间）换新免费游戏。',
    },
    {
      id: 'claimed', title: '已入库', sub: '通过 App 领到的游戏',
      games: records
        .filter(r => (r.outcome === 'claimed' || r.outcome === 'already'))
        .map(r => ({
          platform: r.platform, id: r.title, title: r.title, slug: '',
          url: 'https://store.epicgames.com/zh-CN/free-games',
          originalPrice: '', isFree: true, status: 'free' as const, startDate: null, endDate: null, autoClaimable: false,
        })),
      emptyText: '还没通过 App 领到游戏。绑定 Epic 后每周自动领。',
    },
  ]

  const sortedRecords = sortRecords(records)

  return (
    <div className="ws-tool fg-tool">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn sm ghost" onClick={onBack}><ArrowLeft size={14} /> 返回工坊</button>
        <button className="btn sm ghost" title="只刷新游戏列表（不领取）" onClick={() => void refreshListsOnly()}><RefreshCw size={14} /></button>
      </div>
      <h3 className="ws-tool-title">免费游戏</h3>
      <p className="ws-tool-desc">Epic 每周喜加一：绑定一次，定时自动领入库。只领完全免费的，绝不花一分钱。</p>

      {!sessionPwd && (
        <div className="fg-unlock">
          <Lock size={14} /> 保险箱未解锁：绑定 Epic 与自动领取需要主密码解密设备授权。
          <input className="input" type="password" placeholder="输入主密码解锁" value={pwdInput}
            onChange={e => setPwdInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && pwdInput) onUnlock(pwdInput) }} />
          <button className="btn sm" disabled={!pwdInput} onClick={() => onUnlock(pwdInput)}>解锁</button>
        </div>
      )}

      {/* 顶部：总开关 + 下次检查 */}
      <div className="fg-topbar">
        <div className="fg-topbar-left">
          <JellyToggle checked={prefs.autoClaim} onChange={v => updatePrefs({ autoClaim: v })} />
          <span>自动领取 {prefs.autoClaim ? '已开启' : '已暂停'}</span>
          <span className="fg-muted">
            <Clock3 size={12} /> {lastCheck
              ? `上次检查 ${fmtTime(lastCheck)} · 下次 ${fmtTime(nextCheckAt(prefs, lastCheck))}`
              : '还没检查过'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm" disabled={refreshing} onClick={() => void refreshListsOnly()}>
            {refreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 只刷新列表
          </button>
          <button className="btn sm primary" disabled={checking} onClick={() => void runCheck()}>
            {checking ? <Loader2 size={13} className="spin" /> : null} 立即检查并领取
          </button>
        </div>
      </div>
      {lastError && <div className="fg-warn"><CircleAlert size={14} /> 上次检查有问题：{lastError}</div>}

      {/* 平台账号卡 */}
      <div className="fg-platforms">
        <div className="fg-plat">
          <div className="fg-plat-head">
            <span className="fg-plat-name"><Store size={16} /> Epic Games</span>
            <JellyToggle checked={prefs.epicEnabled} onChange={v => updatePrefs({ epicEnabled: v })} />
          </div>
          <div className="fg-plat-body">
            {epicBound ? (
              <>
                <div>已绑定 · 自动领取{epicClaimedCount ? ` · 累计领了 ${epicClaimedCount} 款` : ' · 还没领过'}</div>
                {epicFallback && <div className="fg-muted">当前用 refresh_token 登录，自动领取可用</div>}
                {epicFallback && (
                  <details className="fg-detail">
                    <summary>为什么是 refresh_token 登录？</summary>
                    <div>
                      {epicFallbackDetail
                        ? <>设备授权创建失败：{epicFallbackDetail}{/missing_permissions/.test(epicFallbackDetail) ? '。Epic 限制了这种登录方式的设备授权权限，不影响自动领取。' : ''}</>
                        : '设备授权未建成（原因未记录），已改用 refresh_token 登录，自动领取可用。'}
                    </div>
                  </details>
                )}
                {loginFailed && <div className="fg-err">登录失效，请重新绑定账号。</div>}
                {captchaFailed && <div className="fg-err">最近一次领取遇到验证码：请在浏览器打开商店手动领取一次，验证通过后可恢复自动领取。</div>}
              </>
            ) : (
              <div>未绑定 Epic 账号。绑定后每周自动领喜加一。</div>
            )}
            {!isDesktopApp() && !isNativeApp() && (
              <div className="fg-muted">网页版直连 Epic 会被浏览器 CORS 拦截，绑定与领取请用桌面端或安卓 App。</div>
            )}
          </div>
          <div className="fg-plat-foot">
            {epicBound ? (
              <>
                {/* v0.1.405：在浏览器领过的游戏，点这里对照库房同步成已入库 */}
                <button className="btn sm" disabled={syncing} onClick={() => void syncBrowserClaimed()}>
                  {syncing ? <Loader2 size={13} className="spin" /> : null} 同步浏览器领取
                </button>
                <button className="btn sm ghost" onClick={() => { setBindOpen(true); setAuthCode('') }}>重新绑定</button>
                <button className="btn sm ghost" onClick={() => { unbindEpic(); setEpicBound(false); setEpicFallback(false); setEpicFallbackDetail(null); notifySafe('已解除 Epic 绑定') }}>解除绑定</button>
              </>
            ) : (
              <button className="btn sm primary" onClick={() => setBindOpen(true)}><Link2 size={13} /> 绑定 Epic 账号</button>
            )}
            <span className="fg-muted">自动领取 · {prefs.epicEnabled ? '开' : '关'}</span>
          </div>
          {bindOpen && (
            <div className="fg-bind">
              <div className="fg-bind-title">绑定 Epic 账号（设备授权，只存本机、主密码加密）</div>
              <ol className="fg-bind-steps">
                <li>点下面按钮，在浏览器打开 Epic 登录页并登录你的 Epic 账号。</li>
                <li>登录成功后，页面会显示一段 JSON，复制其中 authorizationCode 的值粘贴到下面（只粘码，不要粘整个页面内容）。</li>
                <li>粘贴到下面，点「确认绑定」——App 只保存设备授权，不保存你的 Epic 密码。</li>
              </ol>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void openExternal(EPIC_LOGIN_URL)}>
                  <ExternalLink size={13} /> 打开 Epic 登录页
                </button>
              </div>
              <input className="input" placeholder="粘贴 authorizationCode（只粘码，不要粘整个网址）"
                value={authCode} onChange={e => setAuthCode(e.target.value)} />
              <button className="btn sm primary" disabled={bindBusy || !authCode.trim()} onClick={() => void doBind()}>
                {bindBusy ? <Loader2 size={13} className="spin" /> : null} 确认绑定
              </button>
            </div>
          )}
        </div>

      </div>

      {/* 定时设置 */}
      <div className="fg-settings">
        <label>检查频率
          <select className="select" value={prefs.intervalHours}
            onChange={e => updatePrefs({ intervalHours: Number(e.target.value) })}>
            <option value={3}>每 3 小时</option>
            <option value={6}>每 6 小时</option>
            <option value={12}>每 12 小时</option>
            <option value={24}>每 24 小时</option>
          </select>
        </label>
        <label className="fg-check"><JellyToggle checked={prefs.notify} onChange={v => updatePrefs({ notify: v })} /> 领取通知</label>
        <label className="fg-check"><JellyToggle checked={prefs.captchaRemind} onChange={v => updatePrefs({ captchaRemind: v })} /> 验证码提醒</label>
        <span className="fg-muted">只领完全免费：固定开启，价格不为 0 的绝不下单。</span>
      </div>

      {/* 游戏分组：各自折叠 + 每组分页 */}
      {groups.map(g => {
        const closed = closedGroups.includes(g.id)
        const page = Math.min(pages[g.id] ?? 1, pageCount(g.games.length))
        const total = pageCount(g.games.length)
        return (
          <div key={g.id} className="fg-group">
            <div className="fg-group-head" role="button" tabIndex={0} style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => toggleGroup(g.id)} title={closed ? '展开分组' : '收起分组'}>
              <ChevronDown size={15} style={{ transform: closed ? 'rotate(-90deg)' : undefined, transition: 'transform .2s' }} />
              <span>{g.title}</span>
              <small>{g.sub}</small>
              <span className="fg-group-count">{g.games.length} 款</span>
            </div>
            {!closed && (
              g.games.length === 0 ? (
                <div className="fg-empty">
                  {g.emptyText}
                  {g.emptyUrl && (
                    <button className="btn sm ghost" onClick={() => void openExternal(g.emptyUrl!)}>
                      <ExternalLink size={13} /> {g.emptyUrlLabel}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="fg-grid">
                    {pageSlice(g.games, page).map(game => (
                      <GameCard key={`${game.platform}-${game.id}`} game={game}
                        claimed={claimedSet.has(`${game.platform}:${game.title}`)}
                        claiming={claimingId === game.id}
                        onClaim={game.platform === 'epic' && game.status === 'free' ? claimOne : undefined}
                        onMarkClaimed={game.platform === 'epic' && game.status === 'free' ? (g => markClaimed(g.title)) : undefined} />
                    ))}
                  </div>
                  <Pager page={page} pageCount={total} total={g.games.length} unit="款"
                    onPage={n => setPages(prev => ({ ...prev, [g.id]: n }))} />
                </>
              )
            )}
          </div>
        )
      })}

      {/* v0.1.397：内嵌浏览器自动领的状态行（桌面端才有） */}
      {epicBrowserStatus && <div className="fg-muted" style={{ margin: '0 0 8px' }}>{epicBrowserStatus}</div>}
      {/* 领取记录：失败组置顶 */}
      <div className="fg-group">
        <div className="fg-group-head">
          <span>领取记录</span>
          <small>失败的排在前面</small>
          <span className="fg-group-count">{records.length} 条</span>
          {records.length > 0 && (
            <button className="btn sm ghost" style={{ marginLeft: 'auto' }}
              onClick={() => { clearRecords(); setRecords([]) }}>
              <Trash2 size={13} /> 清空
            </button>
          )}
        </div>
        {sortedRecords.length === 0 ? (
          <div className="fg-empty">还没有领取记录。绑定 Epic 后第一次巡查就会留痕。</div>
        ) : (
          <div className="fg-records">
            {sortedRecords.slice(0, 30).map((r, i) => (
              <div key={`${r.at}-${i}`} className={`fg-record ${r.outcome === 'error' ? 'err' : ''}`}>
                {r.outcome === 'claimed'
                  ? <CircleCheck size={15} className="fg-ok" />
                  : r.outcome === 'already'
                    ? <CircleCheck size={15} className="fg-dim" />
                    : <CircleAlert size={15} className="fg-bad" />}
                <div className="fg-record-main">
                  <div className="fg-record-title">
                    {r.title}
                    <span className="fg-muted"> · Epic · {fmtTime(r.at)}</span>
                  </div>
                  <div className="fg-record-msg">{r.message}</div>
                </div>
                {r.outcome === 'error' && /登录失效|重新绑定/.test(r.message) && (
                  <button className="btn sm" onClick={() => { setBindOpen(true); setAuthCode('') }}>重新绑定</button>
                )}
                {/* v0.1.405：领取失败的记录也能直接标「已领过」（浏览器领过的就不用再领了） */}
                {r.outcome === 'error' && r.title !== 'Epic 账号登录' && !claimedSet.has(`epic:${r.title}`) && (
                  <button className="btn sm" onClick={() => markClaimed(r.title)}>已领过</button>
                )}
                {r.outcome === 'error' && /验证码/.test(r.message) && (
                  <button className="btn sm" onClick={() => void openExternal('https://store.epicgames.com/zh-CN/free-games')}>去商店手动领</button>
                )}
                {r.outcome === 'error' && r.checkoutUrl && (
                  <>
                    {isDesktopApp() && (
                      <button className="btn sm" onClick={() => void openInAppBrowser(r.checkoutUrl!, r.title)}>在 App 内领</button>
                    )}
                    {isDesktopApp() && (
                      <button className="btn sm" onClick={() => void openEpicClient(r.checkoutUrl!, r.title)}>直达客户端</button>
                    )}
                    <button className="btn sm primary" onClick={() => void openExternal(r.checkoutUrl!)}>去浏览器领</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
