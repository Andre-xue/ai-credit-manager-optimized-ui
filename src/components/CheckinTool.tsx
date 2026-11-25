import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarCheck, ChevronDown, Fingerprint, Loader2, LogOut, RefreshCw, Sparkles, UserPlus } from 'lucide-react'
import { ToolShell } from './WorkshopView'
import { PlatformIcon } from './PlatformIcon'
import { openExternal, biometricAvailable } from '../core/openExternal'
import { resolveBiometricVaultPassword } from '../core/biometric'
import {
  minimaxBeginDevice, minimaxPollDevice,
  type MinimaxDeviceFlow,
} from '../core/checkin'
import {
  migrateLegacyWorkbuddyCred, poolAccountStatuses, poolClaimOne, listPoolMeta,
  type PoolAccountStatus,
} from '../core/wbPool'
import {
  migrateLegacyMinimaxCred, listMmMeta, addMmAccount, removeMmAccount,
  mmAccountStatuses, mmClaimOne, type MmAccountStatus,
} from '../core/mmPool'
import { getAutoCheckinEnabled, setAutoCheckinEnabled, readLastCheckinRun, summarizeCheckinRun, recordCheckinOutcome, clearLastCheckinRun, AUTO_KEY, type CheckinRun } from '../core/checkinRun'
import { getPlatformEnabled, setPlatformEnabled, platformMeta, TOKEN_PLATFORM_IDS, type CheckinPlatformId } from '../core/checkinPlatforms'
import { CHECKIN_TAB_LABELS, checkinTabCategories, visibleCheckinTabs, readSavedCheckinTab, saveCheckinTab, resolveCheckinTab, type CheckinRegionFilter } from '../core/checkinTabs'
import { listTokenMeta, addTokenAccount, removeTokenAccount, loadTokenSecret, exportTokenCredentials, importTokenCredentials, type TokenAccountMeta } from '../core/tokenPool'
import { saveExportFile } from '../core/saveFile'
import { getTokenStatus, claimToken } from '../core/tokenCheckin'
import type { CheckinStatus } from '../core/checkin'

/**
 * 每日签到工具页（v0.1.356 上线；359 WorkBuddy 走账号池；363 MiniMax 改多账号）：
 * 两个平台都是多账号——逐个查状态、可逐个签或全部签。
 * 凭据都用保险箱主密码加密、只存本机。
 */
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

/** 平台使用说明：默认折叠，点开看凭据怎么拿、怎么用 */
function GuideFold({ id }: { id: CheckinPlatformId }) {
  const [open, setOpen] = useState(false)
  const meta = platformMeta(id)
  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
      <button className="btn sm ghost" style={{ padding: '2px 6px', fontSize: 12.5 }} onClick={() => setOpen(!open)}>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /> 使用说明（怎么拿凭据）
      </button>
      {open && (
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.8, marginTop: 6, padding: '0 6px' }}>
          {meta.guide.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  )
}

interface TokenRow { meta: TokenAccountMeta; status: CheckinStatus | null; error?: string }

/** 令牌类平台的通用区块：粘贴凭据添加账号，状态/签到/移除都走同一套。
 * onMetaChange：增删账号后通知父级刷新页签上的账号数。 */
function TokenPlatformSection({ id, sessionPwd, notify, onMetaChange }: { id: CheckinPlatformId; sessionPwd: string; notify: (m: string) => void; onMetaChange?: () => void }) {
  const meta = platformMeta(id)
  const [enabled, setEnabled] = useState(() => getPlatformEnabled(id))
  const [rows, setRows] = useState<TokenRow[]>([])
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)
  const [labelInput, setLabelInput] = useState('')
  const [secretInput, setSecretInput] = useState('')

  const refresh = useCallback(async () => {
    const metas = listTokenMeta(id)
    if (!sessionPwd) { setRows(metas.map(m => ({ meta: m, status: null }))); return }
    setBusy('status')
    const out: TokenRow[] = []
    for (const m of metas) {
      const secret = await loadTokenSecret(id, m.id, sessionPwd)
      if (!secret) { out.push({ meta: m, status: null, error: '凭据解不开' }); continue }
      const st = await getTokenStatus(id, secret)
      out.push({ meta: m, status: st.state === 'unknown' ? null : st, error: st.state === 'unknown' ? st.message : undefined })
    }
    setRows(out)
    setBusy('')
  }, [id, sessionPwd])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!sessionPwd) return
    const onWake = () => { void refresh() }
    const onStorage = (e: StorageEvent) => { if (e.key === 'acm.checkin.lastRun.v1') onWake() }
    window.addEventListener('focus', onWake)
    window.addEventListener('storage', onStorage)
    window.addEventListener('acm-checkin-done', onWake)
    return () => {
      window.removeEventListener('focus', onWake)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('acm-checkin-done', onWake)
    }
  }, [sessionPwd, refresh])

  const done = rows.filter(r => r.status?.state === 'claimed').length
  const claimable = rows.filter(r => r.status?.state === 'claimable').length
  const showList = open !== null ? open : !(rows.length > 0 && done === rows.length && claimable === 0 && !rows.some(r => r.error))
  const agg = !rows.length ? '' : claimable > 0 ? `${rows.length} 个账号 · ${claimable} 个待签到` : done === rows.length ? `${rows.length} 个账号 · 今日全部已签 ✓` : `${rows.length} 个账号 · 已签 ${done}`

  const claimOne = async (row: TokenRow) => {
    if (!sessionPwd) return
    setBusy(`claim:${row.meta.id}`)
    try {
      const secret = await loadTokenSecret(id, row.meta.id, sessionPwd)
      if (!secret) throw new Error('凭据解不开')
      const r = await claimToken(id, secret)
      recordCheckinOutcome({ label: `${meta.name} · ${row.meta.label}`, outcome: 'claimed', message: r.message, points: r.points })
      notify(`${row.meta.label}：${r.message}`)
      void refresh()
    } catch (e) { notify(e instanceof Error ? e.message : '签到失败') }
    setBusy('')
  }

  const claimAll = async () => {
    setBusy('claim-all')
    let n = 0
    for (const row of rows) {
      if (row.status?.state !== 'claimable') continue
      try {
        const secret = await loadTokenSecret(id, row.meta.id, sessionPwd)
        if (!secret) continue
        const r = await claimToken(id, secret)
        recordCheckinOutcome({ label: `${meta.name} · ${row.meta.label}`, outcome: 'claimed', message: r.message, points: r.points })
        n++
      } catch { /* 单个失败不阻塞其余 */ }
    }
    notify(n ? `已给 ${n} 个${meta.name}账号签到` : `没有可签到的${meta.name}账号`)
    setBusy('')
    void refresh()
  }

  const submitAdd = async () => {
    if (!sessionPwd || !secretInput.trim()) return
    setBusy('add')
    try {
      const m = await addTokenAccount(id, labelInput.trim() || `${meta.name}账号`, secretInput, sessionPwd)
      // 立刻验一次凭据能不能用，坏凭据当场说清
      const st = await getTokenStatus(id, secretInput.trim())
      setAdding(false); setLabelInput(''); setSecretInput('')
      notify(st.state === 'unknown' ? `已添加「${m.label}」，但凭据验证没通过：${st.message}` : `已添加${meta.name}账号：${m.label}`)
      onMetaChange?.()
      void refresh()
    } catch (e) { notify(e instanceof Error ? e.message : '添加失败') }
    setBusy('')
  }

  return (
    <div style={{ marginTop: 16 }}>
      <PlatformGroupHead id={id} enabled={enabled} onToggle={v => { setEnabled(v); setPlatformEnabled(id, v); notify(v ? `${meta.name} 已加入自动签到` : `${meta.name} 已移出自动签到（批量签到会跳过）`) }} />
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'var(--panel)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PlatformIcon id={id} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{meta.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{agg || '还没有账号：点「添加账号」，按使用说明粘贴凭据'}</div>
          </div>
          {rows.length > 1 && <button className="btn sm ghost" onClick={() => setOpen(!showList)}>{showList ? '收起' : '展开'}</button>}
          <button className="btn sm" disabled={!sessionPwd || adding} onClick={() => setAdding(true)}><UserPlus size={14} /> 添加账号</button>
          {rows.length > 0 && (
            <button className="btn sm" disabled={!sessionPwd || busy === 'status'} onClick={() => void refresh()}>
              {busy === 'status' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} 刷新
            </button>
          )}
          {claimable > 0 && (
            <button className="btn sm primary" disabled={busy === 'claim-all'} onClick={() => void claimAll()}>
              {busy === 'claim-all' ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />} 全部签到（{claimable}）
            </button>
          )}
        </div>

        {adding && (
          <div className="ws-result" style={{ marginTop: 10 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <input className="input" placeholder="账号备注名（如：我的豆包号）" value={labelInput} onChange={e => setLabelInput(e.target.value)} />
              <textarea className="input" rows={3} placeholder="把凭据粘贴到这里（Cookie / Token / PAT，按下方使用说明获取）" value={secretInput} onChange={e => setSecretInput(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm primary" disabled={!secretInput.trim() || busy === 'add'} onClick={() => void submitAdd()}>
                  {busy === 'add' ? <Loader2 size={14} className="spin" /> : null} 保存并验证
                </button>
                <button className="btn sm ghost" onClick={() => { setAdding(false); setSecretInput('') }}>取消</button>
              </div>
            </div>
          </div>
        )}

        {showList && rows.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {rows.map(r => (
              <div key={r.meta.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 2px', borderTop: '1px solid var(--border)' }}>
                <span style={{ flexShrink: 0, fontSize: 11, padding: '1px 8px', borderRadius: 999, background: 'var(--panel-2)', color: r.error ? 'var(--danger, #d33)' : r.status?.state === 'claimable' ? 'var(--accent, #6c5ce7)' : 'var(--text-3)' }}>
                  {r.error ? '异常' : r.status?.state === 'claimable' ? '待签到' : r.status?.state === 'claimed' ? '已签 ✓' : r.status?.state === 'unavailable' ? '不可签' : '…'}
                </span>
                <b style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '30%' }}>{r.meta.label}</b>
                <span style={{ fontSize: 12, color: r.error ? 'var(--danger, #d33)' : 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.error ? r.error : r.status ? <><Sparkles size={11} style={{ verticalAlign: -1 }} /> {r.status.message}{typeof r.status.balance === 'number' ? ` · 余额 ${Math.round(r.status.balance)}` : ''}</> : '状态加载中…'}
                </span>
                {r.status?.state === 'claimable' && (
                  <button className="btn sm primary" style={{ marginLeft: 'auto', flexShrink: 0 }} disabled={busy === `claim:${r.meta.id}`} onClick={() => void claimOne(r)}>
                    {busy === `claim:${r.meta.id}` ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />} 签到{r.status.points ? ` +${r.status.points}` : ''}
                  </button>
                )}
                <button className="btn sm ghost" style={{ flexShrink: 0, marginLeft: r.status?.state === 'claimable' ? 0 : 'auto' }} onClick={() => { removeTokenAccount(id, r.meta.id); onMetaChange?.(); void refresh(); notify('已移除该账号（本机凭据已删除）') }}>
                  <LogOut size={14} /> 移除
                </button>
              </div>
            ))}
          </div>
        )}

        <GuideFold id={id} />
      </div>
    </div>
  )
}

/** 平台分组头：区域 · 分类 + 该平台的自动签到开关（关掉后批量签到跳过它） */
function PlatformGroupHead({ id, enabled, onToggle }: { id: CheckinPlatformId; enabled: boolean; onToggle: (v: boolean) => void }) {
  const meta = platformMeta(id)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 4px 8px' }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)', letterSpacing: 0.4 }}>{meta.regionLabel} · {meta.category}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12.5, color: enabled ? 'var(--text-3)' : 'var(--danger, #d33)' }}>{enabled ? '自动签到' : '已关闭自动签到（批量签到会跳过）'}</span>
      <JellyToggle checked={enabled} onChange={onToggle} />
    </div>
  )
}

export function CheckinTool({ sessionPwd, onUnlock, notify, onBack }: {
  sessionPwd: string
  onUnlock: (pwd: string) => void
  notify: (msg: string) => void
  onBack: () => void
}) {
  const [pwdInput, setPwdInput] = useState('')
  const [bioOk, setBioOk] = useState(false)
  const [autoOn, setAutoOn] = useState(() => getAutoCheckinEnabled())
  const [poolStatuses, setPoolStatuses] = useState<PoolAccountStatus[]>([])
  const [mmStatuses, setMmStatuses] = useState<MmAccountStatus[]>([])
  const [mmAuth, setMmAuth] = useState<{ authUrl: string; userCode: string } | null>(null)
  const [lastRun, setLastRun] = useState<CheckinRun | null>(() => readLastCheckinRun())
  const [runOpen, setRunOpen] = useState(false)
  const [runGroups, setRunGroups] = useState<Record<string, boolean>>({})
  useEffect(() => { setRunGroups({}) }, [lastRun?.at])
  // 清空留痕二次确认（v0.1.426）：点一次变「确认清空？」，5 秒内不点第二下自动撤回
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => {
    if (!confirmClear) return
    const t = window.setTimeout(() => setConfirmClear(false), 5000)
    return () => window.clearTimeout(t)
  }, [confirmClear])
  const doClearLastRun = () => {
    if (!confirmClear) { setConfirmClear(true); return }
    setConfirmClear(false)
    clearLastCheckinRun()
    setLastRun(null)
    setRunOpen(false)
    notify(getAutoCheckinEnabled()
      ? '签到记录已清空（自动签到开着，今天会再跑一次，各平台会显示已领）'
      : '签到记录已清空')
  }
  const [wbEnabled, setWbEnabled] = useState(() => getPlatformEnabled('workbuddy'))
  const [mmEnabled, setMmEnabled] = useState(() => getPlatformEnabled('minimax'))
  const [busy, setBusy] = useState('')
  const [wbOpen, setWbOpen] = useState<boolean | null>(null)
  const [mmOpen, setMmOpen] = useState<boolean | null>(null)
  const pollRef = useRef<number | null>(null)
  // 横向页签（v0.1.403，同看剧 394 样式）：9 个平台各一个页签 + 国内外 × 功能两维筛选；
  // 页签切换状态本机记忆（acm.checkin.tab），筛选是临时的、切页不保存。
  const [activeTab, setActiveTab] = useState<CheckinPlatformId>(() => readSavedCheckinTab())
  const [regionFilter, setRegionFilter] = useState<CheckinRegionFilter>('全部')
  const [catFilter, setCatFilter] = useState('全部')
  const [tokenTick, setTokenTick] = useState(0)
  const categories = checkinTabCategories()
  const visibleTabs = visibleCheckinTabs(regionFilter, catFilter)
  const effectiveTab = resolveCheckinTab(activeTab, visibleTabs)
  const tokenCounts = useMemo(() => {
    const m: Partial<Record<CheckinPlatformId, number>> = {}
    for (const pid of TOKEN_PLATFORM_IDS) m[pid] = listTokenMeta(pid).length
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenTick])
  const countFor = (id: CheckinPlatformId) => id === 'workbuddy' ? poolStatuses.length : id === 'minimax' ? mmStatuses.length : tokenCounts[id] ?? 0
  const switchTab = (id: CheckinPlatformId) => { setActiveTab(id); saveCheckinTab(id) }

  useEffect(() => { void biometricAvailable().then(setBioOk).catch(() => setBioOk(false)) }, [])
  const bioUnlock = async () => {
    const pwd = await resolveBiometricVaultPassword('验证身份以解锁保险箱')
    if (pwd) onUnlock(pwd)
    else notify('未通过指纹验证，或还没开启指纹解锁（先输一次主密码，并在设置里开启指纹/生物解锁后再用）')
  }

  const refreshPool = useCallback(async () => {
    setBusy('wb-status')
    try { setPoolStatuses(await poolAccountStatuses(sessionPwd)) } finally { setBusy('') }
  }, [sessionPwd])

  const refreshMm = useCallback(async () => {
    setBusy('mm-status')
    try { setMmStatuses(await mmAccountStatuses(sessionPwd)) } finally { setBusy('') }
  }, [sessionPwd])

  useEffect(() => {
    if (!sessionPwd) return
    let dead = false
    void (async () => {
      await migrateLegacyWorkbuddyCred(sessionPwd).catch(() => false)
      await migrateLegacyMinimaxCred(sessionPwd).catch(() => false)
      if (dead) return
      if (listPoolMeta().length) void refreshPool()
      if (listMmMeta().length) void refreshMm()
    })()
    return () => { dead = true }
  }, [sessionPwd, refreshPool, refreshMm])

  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])

  // 与迷你窗/自动签到同步：窗口重新聚焦、或签到留痕被更新时，自动重查各账号状态
  useEffect(() => {
    if (!sessionPwd) return
    const onWake = () => {
      setLastRun(readLastCheckinRun())
      setTokenTick(t => t + 1)
      if (listPoolMeta().length) void refreshPool()
      if (listMmMeta().length) void refreshMm()
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'acm.checkin.lastRun.v1') onWake()
      // 菜单栏迷你窗里拨了自动签到开关 → 主页面实时跟上
      if (e.key === AUTO_KEY) setAutoOn(getAutoCheckinEnabled())
    }
    window.addEventListener('focus', onWake)
    window.addEventListener('storage', onStorage)
    window.addEventListener('acm-checkin-done', onWake)
    return () => {
      window.removeEventListener('focus', onWake)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('acm-checkin-done', onWake)
    }
  }, [sessionPwd, refreshPool, refreshMm])

  // ---------- MiniMax 添加账号（设备码授权） ----------
  const startMmAuth = async () => {
    setBusy('mm-auth')
    try {
      const flow: MinimaxDeviceFlow = await minimaxBeginDevice()
      setMmAuth({ authUrl: flow.authUrl, userCode: flow.userCode })
      await openExternal(flow.authUrl)
      const deadline = Date.now() + flow.expiresIn * 1000
      const timer = window.setInterval(() => {
        if (Date.now() > deadline) {
          window.clearInterval(timer); setMmAuth(null); notify('授权码已过期，请重新连接'); return
        }
        void minimaxPollDevice(flow).then(async cred => {
          if (!cred) return
          window.clearInterval(timer)
          const meta = await addMmAccount(cred, sessionPwd)
          setMmAuth(null)
          notify(`MiniMax 已添加：${meta.label}`)
          void refreshMm()
        }).catch(e => {
          window.clearInterval(timer); setMmAuth(null)
          notify(e instanceof Error ? e.message : '授权失败')
        })
      }, flow.intervalSecs * 1000)
      pollRef.current = timer
    } catch (e) { notify(e instanceof Error ? e.message : '发起授权失败') } finally { setBusy('') }
  }

  const claimPoolOne = async (id: string, label: string) => {
    setBusy(`wb-claim:${id}`)
    try {
      const r = await poolClaimOne(sessionPwd, id)
      recordCheckinOutcome({ label: `WorkBuddy · ${label}`, outcome: 'claimed', message: r.message, points: r.points })
      notify(`${label}：${r.message}`)
      void refreshPool()
    } catch (e) { notify(e instanceof Error ? e.message : '签到失败') } finally { setBusy('') }
  }

  const claimPoolAll = async () => {
    setBusy('wb-claim-all')
    let done = 0
    for (const s of poolStatuses) {
      if (s.status?.state !== 'claimable') continue
      try {
        const r = await poolClaimOne(sessionPwd, s.meta.id)
        recordCheckinOutcome({ label: `WorkBuddy · ${s.meta.label}`, outcome: 'claimed', message: r.message, points: r.points })
        done++
      } catch { /* 单个失败不阻塞其余 */ }
    }
    notify(done ? `已给 ${done} 个 WorkBuddy 账号签到` : '没有可签到的 WorkBuddy 账号')
    void refreshPool()
    setBusy('')
  }

  const claimMmOne = async (id: string, label: string) => {
    setBusy(`mm-claim:${id}`)
    try {
      const r = await mmClaimOne(sessionPwd, id)
      recordCheckinOutcome({ label: `MiniMax · ${label}`, outcome: 'claimed', message: r.message, points: r.points })
      notify(`${label}：${r.message}`)
      void refreshMm()
    } catch (e) { notify(e instanceof Error ? e.message : '签到失败') } finally { setBusy('') }
  }

  const claimMmAll = async () => {
    setBusy('mm-claim-all')
    let done = 0
    for (const s of mmStatuses) {
      if (s.status?.state !== 'claimable') continue
      try {
        const r = await mmClaimOne(sessionPwd, s.meta.id)
        recordCheckinOutcome({ label: `MiniMax · ${s.meta.label}`, outcome: 'claimed', message: r.message, points: r.points })
        done++
      } catch { /* 单个失败不阻塞其余 */ }
    }
    notify(done ? `已给 ${done} 个 MiniMax 账号签到` : '没有可签到的 MiniMax 账号')
    void refreshMm()
    setBusy('')
  }

  const wbClaimable = poolStatuses.filter(s => s.status?.state === 'claimable').length
  const mmClaimable = mmStatuses.filter(s => s.status?.state === 'claimable').length
  const wbDone = poolStatuses.filter(s => s.status?.state === 'claimed').length
  const mmDone = mmStatuses.filter(s => s.status?.state === 'claimed').length
  const wbShowList = wbOpen ?? (wbClaimable > 0 || poolStatuses.some(x => x.error))
  const mmShowList = mmOpen ?? (mmClaimable > 0 || mmStatuses.some(x => x.error) || !!mmAuth)
  const aggText = (total: number, done: number, claimable: number) =>
    !total ? '' : claimable > 0 ? `${total} 个账号 · ${claimable} 个待签到` : done === total ? `${total} 个账号 · 今日全部已签 ✓` : `${total} 个账号 · 已签 ${done}`

  return (
    <ToolShell title="每日签到" desc="各 AI 平台的每日签到领积分，按国内/国外与功能分组；每个平台可单独关掉自动签到。凭据加密只存本机。" onBack={onBack}>
      {!sessionPwd && (
        <div className="ws-result">
          保险箱还没解锁：签到凭据要用主密码加密保存，在这里直接解锁即可，不用去别的页面。
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input type="password" className="input" style={{ maxWidth: 240 }} placeholder="保险箱主密码"
              value={pwdInput} onChange={e => setPwdInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && pwdInput) { onUnlock(pwdInput); setPwdInput('') } }} />
            <button className="btn sm primary" disabled={!pwdInput} onClick={() => { onUnlock(pwdInput); setPwdInput('') }}>解锁</button>
            {bioOk && <button className="btn sm" onClick={() => void bioUnlock()}><Fingerprint size={14} /> 指纹解锁</button>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 14, padding: '10px 16px', background: 'var(--panel)', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 13.5 }}>自动签到</b>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)', marginLeft: 8 }}>开着时，App 运行中每天自动把所有账号签一遍（结果在菜单栏迷你窗能看到）；App 没运行则不会执行。</span>
        </div>
        <button className="btn sm" onClick={() => { const v = !autoOn; setAutoOn(v); setAutoCheckinEnabled(v); notify(v ? '自动签到已开启' : '自动签到已关闭') }}>
          {autoOn ? '已开启' : '已关闭'}
        </button>
      </div>

      {lastRun && (
        <div style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', background: 'var(--panel)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-3)' }}>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              最近一次签到：{new Date(lastRun.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {summarizeCheckinRun(lastRun)}
            </span>
            <button className="btn sm ghost" style={{ flexShrink: 0 }} onClick={() => setRunOpen(!runOpen)}>{runOpen ? '收起' : '看明细'}</button>
            <button className="btn sm ghost" style={{ flexShrink: 0, color: confirmClear ? 'var(--danger, #d33)' : undefined }} onClick={doClearLastRun}>{confirmClear ? '确认清空？' : '清空'}</button>
          </div>
          {runOpen && (() => {
            // 与菜单栏迷你窗同一套分组：失败组置顶展开，组头/组尾带本平台今日总积分
            const groups: { platform: string; items: CheckinRun['items']; sum: number; errors: number; done: number }[] = []
            for (const it of lastRun.items) {
              const platform = it.label.split(' · ')[0] || it.label
              let g = groups.find(x => x.platform === platform)
              if (!g) { g = { platform, items: [], sum: 0, errors: 0, done: 0 }; groups.push(g) }
              g.items.push(it)
              if (typeof it.points === 'number') g.sum += it.points
              if (it.outcome === 'error') g.errors++
              if (it.outcome !== 'error') g.done++
            }
            const tier = (g: typeof groups[number]) => g.errors > 0 ? 0 : g.items.some(i => i.outcome === 'claimed') ? 1 : 2
            const ordered = groups.map((g, i) => ({ g, i })).sort((a, b) => tier(a.g) - tier(b.g) || a.i - b.i).map(x => x.g)
            return (
              <div style={{ marginTop: 8, display: 'grid', gap: 2 }}>
                {ordered.map(g => {
                  const open = runGroups[g.platform] ?? g.errors > 0
                  return (
                    <div key={g.platform}>
                      <div onClick={() => setRunGroups(prev => ({ ...prev, [g.platform]: !open }))}
                        style={{ display: 'flex', gap: 7, fontSize: 13, alignItems: 'baseline', cursor: 'pointer', padding: '3px 0' }}>
                        <ChevronDown size={14} style={{ flexShrink: 0, alignSelf: 'center', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', color: 'var(--text-3)' }} />
                        <span style={{ fontWeight: 600 }}>{g.platform}</span>
                        {g.items.length > 1 && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>×{g.items.length} 个账号</span>}
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 9, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
                          {g.sum > 0 && <b style={{ color: 'var(--accent, #6c5ce7)' }}>今日 +{g.sum}</b>}
                          {g.errors > 0
                            ? <span style={{ color: 'var(--danger, #d33)', fontSize: 12.5 }}>失败 {g.errors}</span>
                            : <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{g.done === g.items.length ? '全部已签 ✓' : `已签 ${g.done}/${g.items.length}`}</span>}
                        </span>
                      </div>
                      {open && (
                        <div style={{ display: 'grid', gap: 4, padding: '2px 0 6px 21px' }}>
                          {g.items.map((it, i) => (
                            <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12.5, alignItems: 'baseline' }}>
                              <span style={{ flexShrink: 0 }}>{it.outcome === 'claimed' ? '✅' : it.outcome === 'already' ? '✓' : '⚠️'}</span>
                              <span style={{ color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label.includes(' · ') ? it.label.split(' · ').slice(1).join(' · ') : '账号'}</span>
                              <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', color: it.outcome === 'error' ? 'var(--danger, #d33)' : 'var(--text-2, inherit)' }}>{it.message}</span>
                            </div>
                          ))}
                          {g.sum > 0 && g.items.length > 1 && (
                            <div style={{ display: 'flex', fontSize: 12, color: 'var(--text-3)', borderTop: '1px dashed var(--border)', paddingTop: 4 }}>
                              <span>本平台今日合计</span>
                              <b style={{ marginLeft: 'auto', color: 'var(--accent, #6c5ce7)' }}>+{g.sum}</b>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {!lastRun && (
        <div style={{ marginBottom: 12, border: '1px dashed var(--border)', borderRadius: 12, padding: '10px 14px', background: 'var(--panel)', fontSize: 12.5, color: 'var(--text-3)' }}>
          还没有签到记录，签到后会在这里显示明细。
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '0 4px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', flex: 1, minWidth: 200 }}>凭据只存本机、不上云：点「导出凭据」生成加密文件，传到手机后在手机签到页点「导入凭据」选它即可（需同一主密码）。</span>
        <button className="btn sm" disabled={!sessionPwd} onClick={async () => {
          try { const text = await exportTokenCredentials(sessionPwd); await saveExportFile('ai-cube-checkin-credentials.json', text); notify('凭据文件已导出（主密码加密）：传到手机后在签到页导入') }
          catch (e) { notify(e instanceof Error ? e.message : '导出失败') }
        }}>导出凭据</button>
        <label className="btn sm" style={{ cursor: sessionPwd ? 'pointer' : 'not-allowed', opacity: sessionPwd ? 1 : 0.5 }}>
          导入凭据
          <input type="file" accept=".json,application/json" style={{ display: 'none' }} disabled={!sessionPwd} onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f || !sessionPwd) return
            try {
              const r = await importTokenCredentials(await f.text(), sessionPwd)
              window.dispatchEvent(new Event('acm-checkin-done'))
              notify(`导入完成：新增 ${r.added} 个账号${r.skipped ? `，跳过 ${r.skipped} 个（已存在或格式不对）` : ''}`)
            } catch (err) { notify(err instanceof Error ? err.message : '导入失败') }
          }} />
        </label>
      </div>

      {/* 筛选 + 横向页签（v0.1.403，同看剧 394 样式）：只改布局与页签组织，各平台签到功能原样在对应页签内 */}
      <div className="wt-chips" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>国内外：</span>
        {(['全部', '国内', '国外'] as const).map(r => (
          <button key={r} className={`wt-chip${regionFilter === r ? ' on' : ''}`} onClick={() => setRegionFilter(r)}>{r}</button>
        ))}
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', marginLeft: 10 }}>功能：</span>
        {['全部', ...categories].map(c => (
          <button key={c} className={`wt-chip${catFilter === c ? ' on' : ''}`} onClick={() => setCatFilter(c)}>{c}</button>
        ))}
      </div>
      <div className="wt-tabs" role="tablist">
        {visibleTabs.map(p => {
          const n = countFor(p.id)
          return (
            <button key={p.id} role="tab" aria-selected={effectiveTab === p.id} className={`wt-tab${effectiveTab === p.id ? ' on' : ''}`} onClick={() => switchTab(p.id)}>
              {CHECKIN_TAB_LABELS[p.id]}
              {n > 0 && <span className="wt-tab-count">{n} 个</span>}
            </button>
          )
        })}
      </div>

      {/* WorkBuddy：账号池 */}
      {effectiveTab === 'workbuddy' && (<>
      <PlatformGroupHead id="workbuddy" enabled={wbEnabled} onToggle={v => { setWbEnabled(v); setPlatformEnabled('workbuddy', v); notify(v ? 'WorkBuddy 已加入自动签到' : 'WorkBuddy 已移出自动签到（批量签到会跳过）') }} />
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'var(--panel)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PlatformIcon id="workbuddy" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>WorkBuddy（账号池）</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{aggText(poolStatuses.length, wbDone, wbClaimable) || '池里每个账号每天 100 积分，在工坊「WorkBuddy 账号池」里添加/管理账号'}</div>
          </div>
          {poolStatuses.length > 1 && (
            <button className="btn sm ghost" onClick={() => setWbOpen(!wbShowList)}>{wbShowList ? '收起' : '展开'}</button>
          )}
          {poolStatuses.length > 0 && (
            <button className="btn sm" disabled={!sessionPwd || busy === 'wb-status'} onClick={() => void refreshPool()}>
              {busy === 'wb-status' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} 刷新
            </button>
          )}
          {wbClaimable > 0 && (
            <button className="btn sm primary" disabled={busy === 'wb-claim-all'} onClick={() => void claimPoolAll()}>
              {busy === 'wb-claim-all' ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />} 全部签到（{wbClaimable}）
            </button>
          )}
        </div>
        <GuideFold id="workbuddy" />
        {poolStatuses.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 10 }}>
            {sessionPwd ? '账号池还是空的：去工坊主页打开「WorkBuddy 账号池」，添加账号后回到这里就能逐个签到。' : '解锁后显示池里账号的签到状态。'}
          </div>
        )}
        {wbShowList && (
          <div style={{ marginTop: 6 }}>
            {poolStatuses.map(s => (
              <div key={s.meta.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 2px', borderTop: '1px solid var(--border)' }}>
                <span style={{ flexShrink: 0, fontSize: 11, padding: '1px 8px', borderRadius: 999, background: 'var(--panel-2)', color: s.error ? 'var(--danger, #d33)' : s.status?.state === 'claimable' ? 'var(--accent, #6c5ce7)' : 'var(--text-3)' }}>
                  {s.error ? '异常' : s.status?.state === 'claimable' ? '待签到' : s.status?.state === 'claimed' ? '已签 ✓' : '…'}
                </span>
                <b style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '38%' }}>{s.meta.label}</b>
                <span style={{ fontSize: 12, color: s.error ? 'var(--danger, #d33)' : 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.error ? s.error : s.status ? `${s.status.message}${s.status.streakDays > 0 ? ` · 连签 ${s.status.streakDays} 天` : ''}` : '状态加载中…'}
                </span>
                {s.status?.state === 'claimable' && (
                  <button className="btn sm primary" style={{ marginLeft: 'auto', flexShrink: 0 }} disabled={busy === `wb-claim:${s.meta.id}`} onClick={() => void claimPoolOne(s.meta.id, s.meta.label)}>
                    {busy === `wb-claim:${s.meta.id}` ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />} 签到{s.status.points ? ` +${s.status.points}` : ''}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}

      {/* MiniMax：多账号 */}
      {effectiveTab === 'minimax' && (<>
      <div style={{ marginTop: 16 }}>
        <PlatformGroupHead id="minimax" enabled={mmEnabled} onToggle={v => { setMmEnabled(v); setPlatformEnabled('minimax', v); notify(v ? 'MiniMax 已加入自动签到' : 'MiniMax 已移出自动签到（批量签到会跳过）') }} />
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'var(--panel)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PlatformIcon id="minimax" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>MiniMax Code（多账号）</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{aggText(mmStatuses.length, mmDone, mmClaimable) || '每个账号每日签到基础 400 积分，第 4 / 7 天 1,000'}</div>
          </div>
          {mmStatuses.length > 1 && (
            <button className="btn sm ghost" onClick={() => setMmOpen(!mmShowList)}>{mmShowList ? '收起' : '展开'}</button>
          )}
          <button className="btn sm" disabled={!sessionPwd || busy === 'mm-auth' || !!mmAuth} onClick={() => void startMmAuth()}>
            {busy === 'mm-auth' ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} 添加账号
          </button>
          {mmStatuses.length > 0 && (
            <button className="btn sm" disabled={!sessionPwd || busy === 'mm-status'} onClick={() => void refreshMm()}>
              {busy === 'mm-status' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} 刷新
            </button>
          )}
          {mmClaimable > 0 && (
            <button className="btn sm primary" disabled={busy === 'mm-claim-all'} onClick={() => void claimMmAll()}>
              {busy === 'mm-claim-all' ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />} 全部签到（{mmClaimable}）
            </button>
          )}
        </div>

        {mmAuth && (
          <div className="ws-result" style={{ marginTop: 10 }}>
            <Loader2 size={14} className="spin" /> 在浏览器里确认授权（约 5 分钟内有效），本页会自动完成添加。要加另一个号，先在浏览器里切换成那个账号再确认。
            <div style={{ marginTop: 6 }}>授权码：<b style={{ fontSize: 16, letterSpacing: 2 }}>{mmAuth.userCode}</b>（页面若没自动带上，手动填它）</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={() => void openExternal(mmAuth.authUrl)}>重新打开授权页</button>
              <button className="btn sm ghost" onClick={() => { if (pollRef.current) window.clearInterval(pollRef.current); setMmAuth(null) }}>取消</button>
            </div>
          </div>
        )}

        <GuideFold id="minimax" />
        {mmStatuses.length === 0 && !mmAuth && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 10 }}>
            {sessionPwd ? '还没有 MiniMax 账号：点右上「添加账号」，在浏览器登录确认即可；多个号就重复添加（每次换号登录）。' : '解锁后显示各账号的签到状态。'}
          </div>
        )}

        {mmShowList && (
          <div style={{ marginTop: 6 }}>
            {mmStatuses.map(s => (
              <div key={s.meta.id} style={{ padding: '7px 2px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flexShrink: 0, fontSize: 11, padding: '1px 8px', borderRadius: 999, background: 'var(--panel-2)', color: s.error ? 'var(--danger, #d33)' : s.status?.state === 'claimable' ? 'var(--accent, #6c5ce7)' : 'var(--text-3)' }}>
                    {s.error ? '异常' : s.status?.state === 'claimable' ? '待签到' : s.status?.state === 'claimed' ? '已签 ✓' : '…'}
                  </span>
                  <b style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '34%' }}>{s.meta.label}</b>
                  <span style={{ fontSize: 12, color: s.error ? 'var(--danger, #d33)' : 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.error ? s.error : s.status ? <><Sparkles size={11} style={{ verticalAlign: -1 }} /> {s.status.message}{s.status.streakDays > 0 ? ` · 连签 ${s.status.streakDays} 天` : ''}{typeof s.status.balance === 'number' ? ` · 剩余 ${Math.round(s.status.balance)}` : ''}</> : '状态加载中…'}
                  </span>
                  {s.status?.state === 'claimable' && (
                    <button className="btn sm primary" style={{ marginLeft: 'auto', flexShrink: 0 }} disabled={busy === `mm-claim:${s.meta.id}`} onClick={() => void claimMmOne(s.meta.id, s.meta.label)}>
                      {busy === `mm-claim:${s.meta.id}` ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />} 签到{s.status.points ? ` +${s.status.points}` : ''}
                    </button>
                  )}
                  <button className="btn sm ghost" style={{ flexShrink: 0 }} onClick={() => { removeMmAccount(s.meta.id); void refreshMm(); notify('已移除该 MiniMax 账号（本机凭据已删除）') }}>
                    <LogOut size={14} /> 移除
                  </button>
                </div>
                {s.status?.days && s.status.days.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {s.status.days.map(d => (
                      <span key={d.dayNo} style={{
                        fontSize: 11, padding: '2px 7px', borderRadius: 999,
                        border: d.isToday ? '1.5px solid var(--accent, #6c5ce7)' : '1px solid var(--border)',
                        opacity: d.claimed ? 1 : 0.75, background: d.claimed ? 'var(--panel-2)' : 'transparent',
                      }}>
                        第{d.dayNo}天 · {d.points}{d.claimed ? ' ✓' : d.isToday ? ' · 今天' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}

      {effectiveTab && TOKEN_PLATFORM_IDS.includes(effectiveTab) && (
        <TokenPlatformSection key={effectiveTab} id={effectiveTab} sessionPwd={sessionPwd} notify={notify} onMetaChange={() => setTokenTick(t => t + 1)} />
      )}
      {!effectiveTab && (
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 12 }}>没有符合筛选的平台，换个筛选试试。</div>
      )}
    </ToolShell>
  )
}
