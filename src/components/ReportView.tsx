// 月度报告：选定月份的消费/签到/预算汇总，可复制为文本分享。
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ClipboardCopy, FileBarChart } from 'lucide-react'
import type { AppState } from '../core/types'
import { buildMonthlyReport, buildYearReport, reportToText, yearReportToText } from '../core/monthlyReport'
import { shiftMonth } from '../core/calendar'
import { t } from '../core/i18n'

export function ReportView({ state, notify }: { state: AppState; notify: (msg: string) => void }) {
  const now = new Date()
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(curMonth)
  const [mode, setMode] = useState<'month' | 'year'>('month')
  const [year, setYear] = useState(curMonth.slice(0, 4))
  const r = useMemo(() => buildMonthlyReport(state, month), [state, month])
  const yr = useMemo(() => buildYearReport(state, year), [state, year])

  const copy = async () => {
    try { await navigator.clipboard.writeText(mode === 'year' ? yearReportToText(yr) : reportToText(r)); notify(t('报告文本已复制')) }
    catch { notify(t('复制失败，请检查浏览器权限')) }
  }

  if (mode === 'year') {
    const maxMonthCost = Math.max(1, ...yr.byMonth.map((m) => m.cost))
    return (
      <div>
        <div className="section-head">
          <h2><FileBarChart size={17} style={{ verticalAlign: -3, marginRight: 6 }} />{t('年度总结')}</h2>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm ghost" onClick={() => setMode('month')}>{t('月报')}</button>
            <button className="btn sm primary">{t('年报')}</button>
            <button className="btn sm ghost" onClick={() => setYear((y) => String(Number(y) - 1))}><ChevronLeft size={14} /></button>
            <b style={{ fontSize: 13.5, minWidth: 56, textAlign: 'center' }}>{t('{year} 年', { year })}</b>
            <button className="btn sm ghost" disabled={year >= curMonth.slice(0, 4)} onClick={() => setYear((y) => String(Number(y) + 1))}><ChevronRight size={14} /></button>
            <button className="btn sm" onClick={() => void copy()}><ClipboardCopy size={13} /> {t('复制总结')}</button>
          </div>
        </div>
        <div className="bento-grid">
          <div className="bento-tile">
            <div className="bento-label">{t('全年总消费')}</div>
            <div className="bento-num">¥{yr.totalCost.toFixed(2)}</div>
            <div className="bento-sub">{t('{count} 条记录 · 活跃 {days} 天', { count: yr.recordCount, days: yr.activeDays })}</div>
          </div>
          <div className="bento-tile">
            <div className="bento-label">{t('总 Tokens')}</div>
            <div className="bento-num">{yr.totalTokens.toLocaleString()}</div>
            <div className="bento-sub">{t('账户 {count} 个', { count: yr.accountCount })}</div>
          </div>
          <div className="bento-tile">
            <div className="bento-label">{t('签到')}</div>
            <div className="bento-num">{t('{count} 次', { count: yr.checkinCount })}</div>
            <div className="bento-sub">{t('覆盖 {days} 天', { days: yr.checkinDays })}</div>
          </div>
          <div className="bento-tile">
            <div className="bento-label">{t('年度之最')}</div>
            <div className="bento-sub" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
              {yr.topPlatform ? <>{t('平台：{name}（¥{cost}）', { name: yr.topPlatform.name, cost: yr.topPlatform.cost.toFixed(2) })}<br /></> : t('暂无数据')}
              {yr.topModel && <>{t('模型：{name}（¥{cost}）', { name: yr.topModel.name, cost: yr.topModel.cost.toFixed(2) })}<br /></>}
              {yr.bestMonth && <>{t('最烧钱的月份：{month}（¥{cost}）', { month: yr.bestMonth.month, cost: yr.bestMonth.cost.toFixed(2) })}</>}
            </div>
          </div>
        </div>
        <div className="section-head"><h2>{t('分月消费')}</h2></div>
        <div className="panel" style={{ padding: 18 }}>
          {yr.byMonth.length === 0
            ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('这一年暂无用量记录。')}</div>
            : yr.byMonth.map((m) => (
              <div key={m.month} className="row" style={{ gap: 10, padding: '5px 0', alignItems: 'center' }}>
                <span style={{ fontSize: 13, minWidth: 74 }}>{m.month}</span>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((m.cost / maxMonthCost) * 100)}%`, background: 'var(--primary)', borderRadius: 4 }} />
                </div>
                <b style={{ fontSize: 13, minWidth: 84, textAlign: 'right' }}>¥{m.cost.toFixed(2)}</b>
              </div>
            ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="section-head">
        <h2><FileBarChart size={17} style={{ verticalAlign: -3, marginRight: 6 }} />{t('月度报告')}</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm primary">{t('月报')}</button>
          <button className="btn sm ghost" onClick={() => setMode('year')}>{t('年报')}</button>
          <button className="btn sm ghost" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={14} /></button>
          <b style={{ fontSize: 13.5, minWidth: 74, textAlign: 'center' }}>{t('{year} 年 {month} 月', { year: month.split('-')[0], month: month.split('-')[1] })}</b>
          <button className="btn sm ghost" disabled={month >= curMonth} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={14} /></button>
          <button className="btn sm" onClick={() => void copy()}><ClipboardCopy size={13} /> {t('复制报告')}</button>
        </div>
      </div>

      <div className="bento-grid">
        <div className="bento-tile">
          <div className="bento-label">{t('总消费')}</div>
          <div className="bento-num">¥{r.totalCost.toFixed(2)}</div>
          <div className="bento-sub">
            {r.costDeltaPct !== null
              ? t('环比上月 {arrow} {pct}%（上月 ¥{prev}）', { arrow: r.costDeltaPct >= 0 ? '↑' : '↓', pct: Math.abs(r.costDeltaPct * 100).toFixed(0), prev: r.prevCost.toFixed(2) })
              : t('上月 ¥{prev}', { prev: r.prevCost.toFixed(2) })}
          </div>
        </div>
        <div className="bento-tile">
          <div className="bento-label">{t('总 Tokens')}</div>
          <div className="bento-num">{r.totalTokens.toLocaleString()}</div>
          <div className="bento-sub">{t('{count} 条记录 · 活跃 {days} 天', { count: r.recordCount, days: r.activeDays })}</div>
        </div>
        <div className="bento-tile">
          <div className="bento-label">{t('签到')}</div>
          <div className="bento-num">{t('{count} 次', { count: r.checkinCount })}</div>
          <div className="bento-sub">{t('覆盖 {days} 天', { days: r.checkinDays })}</div>
        </div>
        <div className="bento-tile">
          <div className="bento-label">{t('预算使用')}</div>
          <div className="bento-num">{r.budgetRate !== null ? `${(r.budgetRate * 100).toFixed(0)}%` : t('未设置')}</div>
          <div className="bento-sub">{r.budgetRate !== null ? t('月预算 ¥{budget}', { budget: r.budget.toFixed(0) }) : t('在用量页或设置里设置月预算')}</div>
        </div>
      </div>

      <div className="section-head"><h2>{t('分平台消费')}</h2></div>
      <div className="panel" style={{ padding: 18 }}>
        {r.byPlatform.length === 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('这个月暂无用量记录')}</div>
          : r.byPlatform.map((p) => (
            <div key={p.providerId} style={{ marginBottom: 13 }}>
              <div className="row between" style={{ fontSize: 12.5, marginBottom: 6 }}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span style={{ color: 'var(--text-2)' }}>¥{p.cost.toFixed(2)} · {(p.share * 100).toFixed(0)}% · {p.tokens.toLocaleString()} Tokens</span>
              </div>
              <div className="progress"><div style={{ width: `${Math.max(2, p.share * 100)}%`, background: 'var(--primary)' }} /></div>
            </div>
          ))}
      </div>

      {r.topModels.length > 0 && <>
        <div className="section-head"><h2>{t('模型消费 Top')}</h2></div>
        <div className="panel" style={{ padding: 18 }}>
          {r.topModels.map((m) => (
            <div key={m.model} className="row between" style={{ fontSize: 13, padding: '5px 0' }}>
              <span className="mono">{m.model}</span>
              <span style={{ color: 'var(--text-2)' }}>¥{m.cost.toFixed(2)} · {m.tokens.toLocaleString()} Tokens</span>
            </div>
          ))}
        </div>
      </>}
    </div>
  )
}
