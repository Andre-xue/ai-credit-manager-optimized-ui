import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { latestQuota, loadState } from '../core/store'
import { predictExhaustion } from '../core/forecast'
import { PROVIDER_MAP } from '../data/providers'
import { getBiometricPassword } from '../core/crypto'
import {
  readLastCheckinRun, runAllCheckins, summarizeCheckinRun, checkinRunIsToday,
  getAutoCheckinEnabled, setAutoCheckinEnabled, hasCheckinSources, clearLastCheckinRun, type CheckinRun,
} from '../core/checkinRun'
import type { AppState } from '../core/types'
import { t } from '../core/i18n'

/**
 * 菜单栏迷你窗（桌面端专用，独立窗口 #/mini）：
 * 读本机已保存状态（主窗口每次变更都会落盘，storage 事件可实时感知），
 * 展示今日待签到与各账户剩余额度，动作按钮通过 Rust 命令唤起主窗口对应页签。
 * 样式用内联 + 自带明暗调色板，不依赖主应用的 CSS 变量作用域。
 */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
function tauriInvoke(): InvokeFn | undefined {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } }
  return w.__TAURI_INTERNALS__?.invoke
}

function MiniJellyToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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
      className={`jelly-toggle ${checked ? 'is-on' : ''}`} aria-label={checked ? '关闭自动签到' : '开启自动签到'}
      style={{ transform: 'scale(0.82)', transformOrigin: 'right center' }}>
      <span className={`jelly-dot ${anim ? `anim-${anim}` : (checked ? 'static-on' : 'static-off')}`} />
    </button>
  )
}

export function MiniView() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [lastRun, setLastRun] = useState<CheckinRun | null>(() => readLastCheckinRun())
  const [autoOn, setAutoOn] = useState(() => getAutoCheckinEnabled())
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  useEffect(() => { setOpenGroups({}) }, [lastRun?.at])
  const [checking, setChecking] = useState(false)
  const [checkMsg, setCheckMsg] = useState('')
  const [pwdInput, setPwdInput] = useState('')
  const [needPwd, setNeedPwd] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
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
    setDetailOpen(false)
    setCheckMsg(getAutoCheckinEnabled()
      ? '签到记录已清空（自动签到开着，今天会再跑一次，各平台会显示已领）'
      : '签到记录已清空')
  }
  const collapseRef = useRef<number | null>(null)
  const [updatedAt, setUpdatedAt] = useState(() => new Date())
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  const refresh = useCallback(() => {
    setState(loadState())
    const run = readLastCheckinRun()
    setLastRun(run)
    // 留痕超过 2 分钟就只显示一行摘要，明细不长期占着迷你窗
    if (run && Date.now() - run.at > 120_000 && !run.items.some(i => i.outcome === 'error')) setDetailOpen(false)
    setAutoOn(getAutoCheckinEnabled())
    setUpdatedAt(new Date())
  }, [])

  // 一键签到：全程在本窗完成。密码优先用指纹解锁留下的副本，没有就用本窗输入的主密码。
  const doCheckin = async () => {
    if (checking) return
    const pwd = getBiometricPassword() || pwdInput
    if (!pwd) { setNeedPwd(true); setCheckMsg('保险箱没解锁：输入主密码，或在主窗口开启指纹解锁后这里可免密签到'); return }
    setChecking(true); setCheckMsg('')
    if (collapseRef.current) window.clearTimeout(collapseRef.current)
    try {
      const run = await runAllCheckins(pwd)
      setLastRun(run)
      setNeedPwd(false); setPwdInput('')
      setCheckMsg(summarizeCheckinRun(run))
      // 签完先展开明细给用户看一眼，无失败时 6 秒后自动收起成一行摘要
      setDetailOpen(true)
      if (!run.items.some(i => i.outcome === 'error')) {
        collapseRef.current = window.setTimeout(() => { setDetailOpen(false); setCheckMsg('') }, 6000)
      }
    } catch (e) {
      setCheckMsg(e instanceof Error ? e.message : '签到失败')
    } finally { setChecking(false) }
  }

  useEffect(() => {
    // 主窗口落盘变更（storage 事件）/ 迷你窗重新聚焦 / 定时，三路刷新
    const onStorage = () => refresh()
    const onFocus = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    const t = window.setInterval(refresh, 30_000)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onMq = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onMq)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(t)
      mq.removeEventListener('change', onMq)
    }
  }, [refresh])

  const themePref = state.settings.theme ?? 'system'
  const dark = themePref === 'dark' || (themePref === 'system' && systemDark)

  const balances = useMemo(
    () =>
      state.accounts
        .map((a) => {
          const q = latestQuota(state.quotas, a.id)
          if (!q || q.unit !== 'currency') return null
          const remaining = Math.max(0, q.total - q.used)
          const fc = predictExhaustion(state, a.id)
          return {
            id: a.id, name: a.label || PROVIDER_MAP[a.providerId]?.name || a.providerId, remaining,
            low: remaining < (state.settings.lowBalanceThreshold ?? 10),
            daysLeft: fc.level !== 'insufficient' ? fc.daysLeft : undefined,
          }
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((x, y) => y.remaining - x.remaining),
    [state],
  )
  const totalRemaining = balances.reduce((s, b) => s + b.remaining, 0)

  const invoke = tauriInvoke()
  const goMain = (section?: string) => void invoke?.('show_main', { section: section ?? null })
  const hide = () => void invoke?.('mini_hide')
  const quit = () => void invoke?.('quit_app')

  const c = dark
    ? { bg: '#14161c', card: '#1d2027', border: '#2a2e38', text: '#e8eaee', sub: '#9aa1ad', faint: '#6b7280' }
    : { bg: '#ffffff', card: '#f6f6f8', border: '#e7e7ea', text: '#191a1e', sub: '#5f6368', faint: '#9aa0a6' }
  const card: React.CSSProperties = { background: c.card, border: `1px solid ${c.border}`, borderRadius: 14, padding: '12px 14px' }
  const btn: React.CSSProperties = { border: `1px solid ${c.border}`, background: c.card, color: c.text, borderRadius: 10, padding: '7px 10px', fontSize: 12.5, cursor: 'pointer' }
  const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

  return (
    <div
      onMouseEnter={() => void invoke?.('mini_hover', { inside: true })}
      onMouseLeave={() => void invoke?.('mini_hover', { inside: false })}
      onPointerDownCapture={() => void invoke?.('mini_interacted')}
      onKeyDownCapture={() => void invoke?.('mini_interacted')}
      style={{ height: '100vh', overflowY: 'auto', background: c.bg, color: c.text, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#6d28d9,#9333ea)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>✦</span>
        <b style={{ fontSize: 14 }}>{t('AI 魔方')}</b>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: c.faint }}>{t('更新于 {time}', { time: updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })}</span>
        <button onClick={hide} title={t('收起')} style={{ ...btn, padding: '2px 8px', fontSize: 13 }}>×</button>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 13.5 }}>每日签到</b>
          <span style={{ fontSize: 11, color: autoOn ? c.sub : c.faint }}>自动签到</span>
          <MiniJellyToggle checked={autoOn} onChange={v => { setAutoOn(v); setAutoCheckinEnabled(v) }} />
          <span style={{ marginLeft: 'auto', fontSize: 11, color: c.faint }}>
            {lastRun ? `${checkinRunIsToday(lastRun) ? '今天' : new Date(lastRun.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${new Date(lastRun.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '还没签过'}
          </span>
          {lastRun && (
            <button onClick={doClearLastRun} style={{ ...btn, padding: '2px 8px', fontSize: 11, color: confirmClear ? '#dc2626' : c.sub }}>
              {confirmClear ? '确认清空？' : '清空'}
            </button>
          )}
        </div>
        {lastRun && lastRun.items.length > 0 && !detailOpen && (
          <div onClick={() => setDetailOpen(true)} style={{ marginTop: 6, fontSize: 12, color: c.sub, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {summarizeCheckinRun(lastRun)} <span style={{ color: c.faint }}>· 看明细</span>
          </div>
        )}
        {lastRun && lastRun.items.length > 0 && detailOpen && (() => {
          // 按平台分组：失败组置顶展开，全签组折叠沉底；组头与组尾都给出本平台今日总积分
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
            <div style={{ marginTop: 7, display: 'grid', gap: 2, maxHeight: 196, overflowY: 'auto' }}>
              {ordered.map(g => {
                const open = openGroups[g.platform] ?? g.errors > 0
                return (
                  <div key={g.platform}>
                    <div onClick={() => setOpenGroups(prev => ({ ...prev, [g.platform]: !open }))}
                      style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'baseline', cursor: 'pointer', padding: '2.5px 0' }}>
                      <span style={{ flexShrink: 0, color: c.faint, fontSize: 10 }}>{open ? '▾' : '▸'}</span>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{g.platform}</span>
                      {g.items.length > 1 && <span style={{ color: c.faint, fontSize: 11 }}>×{g.items.length}</span>}
                      <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: 7, alignItems: 'baseline' }}>
                        {g.sum > 0 && <b style={{ color: '#7c3aed' }}>今日 +{g.sum}</b>}
                        {g.errors > 0
                          ? <span style={{ color: '#dc2626' }}>失败 {g.errors}</span>
                          : <span style={{ color: c.faint }}>{g.done === g.items.length ? '全部已签 ✓' : `已签 ${g.done}/${g.items.length}`}</span>}
                      </span>
                    </div>
                    {open && (
                      <div style={{ display: 'grid', gap: 3, padding: '1px 0 4px 14px' }}>
                        {g.items.map((it, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'baseline' }}>
                            <span style={{ flexShrink: 0 }}>{it.outcome === 'claimed' ? '✅' : it.outcome === 'already' ? '✓' : '⚠️'}</span>
                            <span style={{ color: c.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label.includes(' · ') ? it.label.split(' · ').slice(1).join(' · ') : '账号'}</span>
                            <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', color: it.outcome === 'error' ? '#dc2626' : c.text }}>{it.message}</span>
                          </div>
                        ))}
                        {g.sum > 0 && g.items.length > 1 && (
                          <div style={{ display: 'flex', fontSize: 11.5, color: c.sub, borderTop: `1px dashed ${c.border}`, paddingTop: 3 }}>
                            <span>本平台今日合计</span>
                            <b style={{ marginLeft: 'auto', color: '#7c3aed' }}>+{g.sum}</b>
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
        {!lastRun && hasCheckinSources() && <div style={{ marginTop: 6, fontSize: 12, color: c.sub }}>点下面「一键签到」，WorkBuddy 池和 MiniMax 一起签，不用打开主窗口。</div>}
        {!hasCheckinSources() && <div style={{ marginTop: 6, fontSize: 12, color: c.sub }}>还没连接签到账号（在主窗口工坊「每日签到 / 账号池」里添加）。</div>}
        {checkMsg && <div style={{ marginTop: 6, fontSize: 12, color: c.text }}>{checkMsg}</div>}
        {needPwd && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input type="password" placeholder="保险箱主密码" value={pwdInput} onChange={(e) => setPwdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doCheckin() }}
              style={{ flex: 1, minWidth: 0, border: `1px solid ${c.border}`, background: c.bg, color: c.text, borderRadius: 10, padding: '7px 10px', fontSize: 12.5 }} />
            <button onClick={() => void doCheckin()} style={{ ...btn, fontWeight: 600 }}>解锁并签到</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => void doCheckin()} disabled={checking} style={{ ...btn, flex: 1, background: 'linear-gradient(135deg,#6d28d9,#9333ea)', color: '#fff', border: 'none', fontWeight: 600, opacity: checking ? 0.6 : 1 }}>
            {checking ? '签到中…' : '一键签到'}
          </button>
          <button onClick={refresh} style={{ ...btn, flex: 1 }}>刷新</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: c.sub }}>{t('剩余额度合计')}</span>
          <b style={{ fontSize: 17 }}>¥{fmt(totalRemaining)}</b>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
          {balances.slice(0, 5).map((b) => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12.5, gap: 8 }}>
              <span style={{ color: c.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
              <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <b style={b.low ? { color: '#dc2626' } : undefined}>¥{fmt(b.remaining)}</b>
                {b.daysLeft !== undefined && b.daysLeft <= 60 && (
                  <span style={{ display: 'block', fontSize: 10.5, color: b.daysLeft <= 7 ? '#dc2626' : c.faint }}>{t('约 {days} 天后耗尽', { days: Math.max(0, Math.ceil(b.daysLeft)) })}</span>
                )}
              </span>
            </div>
          ))}
          {balances.length === 0 && <div style={{ fontSize: 12, color: c.faint }}>{t('暂无额度数据，去主窗口添加账户或刷新余额')}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button onClick={() => goMain('ai')} style={{ ...btn, flex: 1 }}>{t('AI 助手')}</button>
        <button onClick={() => goMain()} style={{ ...btn, flex: 1 }}>{t('打开主界面')}</button>
        <button onClick={quit} style={{ ...btn, flex: 1 }}>{t('退出应用')}</button>
      </div>
    </div>
  )
}
