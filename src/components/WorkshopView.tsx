import { useEffect, useRef, useState } from 'react'
import {
  FolderCog, FileText, Languages, PenLine, Image as ImageIcon, Images, SearchCheck, Search, Table2, Mic,
  ArrowLeft, Copy, Loader2, Upload, Hammer, ChevronRight, ChevronDown, LayoutGrid,
} from 'lucide-react'
import type { Account } from '../core/types'
import { loadWorkshopRoutes, runWorkshopChat, type WorkshopRoute, type WorkshopRouteData } from '../core/workshopChat'
import { buildSearchContextCached } from '../core/webSearch'
import { needsBinaryParse, parseBinaryDocument } from '../core/documentParse'
import { FileManagerView } from './FileManagerView'
import { GalleryView } from './GalleryView'
import { CheckinTool } from './CheckinTool'
import { WbPoolTool } from './WbPoolTool'
import { FreeGamesTool } from './FreeGamesTool'
import { SteamDealsTool } from './SteamDealsTool'
import { WatchTool } from './WatchTool'
import { TranslationView } from './TranslationView'
import { ImageView } from './ImageView'
import { VideoView } from './VideoView'
import { DocQAView } from './DocQAView'
import type { AppSettings } from '../core/types'
import type { ServiceController } from '../core/useServiceController'
import { RefreshCw, Film, MessagesSquare, Download, CalendarCheck, Users, Gamepad2, Tv, BadgePercent } from 'lucide-react'

type ToolId = 'hub' | 'files' | 'summary' | 'polish' | 'webcheck' | 'table' | 'translate' | 'image' | 'video' | 'docqa' | 'gallery' | 'dailycheckin' | 'wbpool' | 'freegames' | 'watch' | 'steamdeals'

/** 工具页共用：加载可选对话路线（免费模型 + 自有账户） */
export function useRouteData(accounts: Account[]) {
  const [data, setData] = useState<WorkshopRouteData | null>(null)
  const [routeKey, setRouteKey] = useState('')
  useEffect(() => {
    let dead = false
    void loadWorkshopRoutes(accounts).then(d => {
      if (dead) return
      setData(d)
      setRouteKey(prev => (d.routes.some(r => r.key === prev) ? prev : d.routes[0]?.key ?? ''))
    })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length])
  const route: WorkshopRoute | null = data?.routes.find(r => r.key === routeKey) ?? null
  return { data, route, routeKey, setRouteKey }
}

export function RouteSelect({ data, routeKey, setRouteKey }: { data: WorkshopRouteData | null; routeKey: string; setRouteKey: (k: string) => void }) {
  return (
    <label className="ws-route">
      <span>使用模型</span>
      <select className="select" value={routeKey} onChange={e => setRouteKey(e.target.value)} disabled={!data || data.routes.length === 0}>
        {!data && <option value="">加载中…</option>}
        {data && data.routes.length === 0 && <option value="">无可用模型（先在 AI 助手登录云账号或添加账户）</option>}
        {data?.routes.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
      </select>
    </label>
  )
}

export function ToolShell({ title, desc, onBack, children }: { title: string; desc: string; onBack: () => void; children: React.ReactNode }) {
  const [nonce, setNonce] = useState(0)
  return (
    <div className="ws-tool">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn sm ghost" onClick={onBack}><ArrowLeft size={14} /> 返回工坊</button>
        <button className="btn sm ghost" title="刷新本页" onClick={() => setNonce(n => n + 1)}><RefreshCw size={14} /></button>
      </div>
      <h3 className="ws-tool-title">{title}</h3>
      <p className="ws-tool-desc">{desc}</p>
      <div key={nonce}>{children}</div>
    </div>
  )
}

function downloadTextFile(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

/** 按段落把长文切成约 size 字的块（长段落硬切），供分段总结 */
export function splitLongText(text: string, size = 6000): string[] {
  const paras = text.split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
  const chunks: string[] = []
  let cur = ''
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = '' }
  for (const para of paras) {
    if (para.length > size) {
      push()
      for (let i = 0; i < para.length; i += size) chunks.push(para.slice(i, i + size))
      continue
    }
    if (cur && cur.length + para.length + 2 > size) push()
    cur = cur ? `${cur}\n\n${para}` : para
  }
  push()
  return chunks.length ? chunks : [text]
}

function ResultBox({ text, busy, exportName }: { text: string; busy: boolean; exportName?: string }) {
  if (busy) return <div className="ws-result"><Loader2 size={16} className="spin" /> 正在生成…</div>
  if (!text) return null
  return (
    <div className="ws-result">
      <div className="ws-result-head">
        <span>结果</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {exportName && <button className="btn sm ghost" onClick={() => downloadTextFile(exportName, text)}><Download size={13} /> 导出</button>}
          <button className="btn sm ghost" onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}><Copy size={13} /> 复制</button>
        </span>
      </div>
      <div className="ws-result-text">{text}</div>
    </div>
  )
}

async function readDocFile(file: File): Promise<string> {
  if (needsBinaryParse(file.name)) {
    const parsed = await parseBinaryDocument(file.name, await file.arrayBuffer())
    return parsed.text
  }
  return await file.text()
}

// ---------------- 文档总结 ----------------
const SUMMARY_DEPTHS = {
  '简洁': '摘要 2-3 句、要点不超过 5 条、大纲只列一级标题，整体尽量短。',
  '标准': '摘要 3-5 句、要点完整条目式、大纲列到二级标题。',
  '详细': '摘要充分展开、要点详尽并保留关键数据与结论、大纲列到三级标题，另单列「关键数据与结论」。',
} as const
function SummaryTool({ accounts, sessionPwd, notify, onBack }: ToolProps) {
  const { data, route, routeKey, setRouteKey } = useRouteData(accounts)
  const [docName, setDocName] = useState('')
  const [docText, setDocText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState('')
  const [depth, setDepth] = useState<keyof typeof SUMMARY_DEPTHS>('标准')
  const [qa, setQa] = useState('')
  const [qaAnswer, setQaAnswer] = useState('')
  const [qaBusy, setQaBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const chat = (system: string, user: string) => runWorkshopChat({
    route: route!, freeOptions: data?.freeOptions ?? [], accounts, sessionPwd, system, user,
  })

  const run = async () => {
    if (!route) { notify('先选一个可用模型'); return }
    if (!docText.trim()) { notify('先上传文档或粘贴文本'); return }
    setBusy(true); setResult(''); setQaAnswer('')
    try {
      const chunks = splitLongText(docText, 6000)
      const finalSystem = `你是文档总结助手。输出结构：一、摘要；二、要点清单（条目式）；三、大纲（层级标题）。详细程度：${SUMMARY_DEPTHS[depth]}只依据文档内容，不编造。`
      if (chunks.length === 1) {
        setProgress('正在总结…')
        setResult(await chat(finalSystem, `文档《${docName || '粘贴文本'}》内容如下：\n\n${chunks[0]}`))
      } else {
        // 长文分段总结（map-reduce）：逐段提炼后合并成总总结，不再截断丢尾
        const partNotes: string[] = []
        for (let i = 0; i < chunks.length; i++) {
          setProgress(`文档较长（共 ${chunks.length} 段），正在总结第 ${i + 1}/${chunks.length} 段…`)
          const note = await chat('你是文档总结助手。提炼这一段的核心内容：用条目列出关键信息、数据与结论，不遗漏要点，不展开评论。', `文档《${docName || '粘贴文本'}》第 ${i + 1} 段：\n\n${chunks[i]}`)
          partNotes.push(`【第 ${i + 1} 段要点】\n${note}`)
        }
        setProgress('正在合并成总总结…')
        setResult(await chat(finalSystem, `文档《${docName || '粘贴文本'}》的分段要点如下，请据此生成全篇总结：\n\n${partNotes.join('\n\n').slice(0, 24000)}`))
      }
    } catch (e) { notify(e instanceof Error ? e.message : '生成失败') } finally { setBusy(false); setProgress('') }
  }

  const askDoc = async () => {
    if (!route) { notify('先选一个可用模型'); return }
    const q = qa.trim()
    if (!q) return
    setQaBusy(true); setQaAnswer('')
    try {
      const out = await chat('你是文档问答助手。只依据下面文档内容回答；文档里没有的明确说没提到，不要编造。',
        `文档《${docName || '粘贴文本'}》内容（节选）：\n\n${docText.slice(0, 14000)}\n\n问题：${q}`)
      setQaAnswer(out)
    } catch (e) { notify(e instanceof Error ? e.message : '提问失败') } finally { setQaBusy(false) }
  }

  return (
    <ToolShell title="文档总结" desc="上传 PDF / Word / 文本或粘贴长文：长文自动分段总结不丢尾，出摘要、要点和大纲，还能就文档继续追问。" onBack={onBack}>
      <RouteSelect data={data} routeKey={routeKey} setRouteKey={setRouteKey} />
      <div className="ws-actions">
        <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> 上传文档</button>
        {docName && <span className="ws-fname">{docName}（{docText.length} 字）</span>}
        <span className="ws-chips" style={{ margin: 0 }}>
          {(Object.keys(SUMMARY_DEPTHS) as (keyof typeof SUMMARY_DEPTHS)[]).map(d => (
            <button key={d} className={`chip-btn ${depth === d ? 'on' : ''}`} onClick={() => setDepth(d)}>{d}</button>
          ))}
        </span>
        <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,.md,.csv" onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          try { setDocText(await readDocFile(f)); setDocName(f.name) } catch { notify('文档解析失败') }
        }} />
      </div>
      <textarea className="input ws-textarea" rows={7} placeholder="或把文本粘贴到这里…" value={docName ? docText.slice(0, 4000) : docText} onChange={e => { setDocText(e.target.value); setDocName('') }} />
      <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={15} className="spin" /> : <FileText size={15} />} 生成总结</button>
      {busy && <div className="ws-result"><Loader2 size={16} className="spin" /> {progress || '正在生成…'}</div>}
      <ResultBox text={result} busy={false} exportName={`总结-${(docName || '粘贴文本').replace(/[\\/:*?"<>|]/g, '_')}.md`} />
      {result && (
        <div style={{ marginTop: 14 }}>
          <div className="fm-ask" style={{ margin: 0 }}>
            <input className="input" placeholder="就这篇文档继续追问：例如「作者的主要结论是什么？」" value={qa}
              onChange={e => setQa(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void askDoc() }} />
            <button className="btn primary" disabled={qaBusy} onClick={() => void askDoc()}>{qaBusy ? <Loader2 size={15} className="spin" /> : <Search size={15} />} 追问</button>
          </div>
          {qaAnswer && <div className="ws-result"><div className="ws-result-text">{qaAnswer}</div></div>}
        </div>
      )}
    </ToolShell>
  )
}

// ---------------- 文案润色 ----------------
const POLISH_MODES = ['润色改写', '扩写', '缩写', '更正式', '更口语', '纠错'] as const
interface PolishHistoryItem { at: number; mode: string; src: string; out: string }
const POLISH_HIST_KEY = 'acm.workshop.polishHistory.v1'
function loadPolishHistory(): PolishHistoryItem[] {
  try { const v = JSON.parse(localStorage.getItem(POLISH_HIST_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function PolishTool({ accounts, sessionPwd, notify, onBack }: ToolProps) {
  const { data, route, routeKey, setRouteKey } = useRouteData(accounts)
  const [mode, setMode] = useState<(typeof POLISH_MODES)[number]>('润色改写')
  const [text, setText] = useState('')
  const [custom, setCustom] = useState('')
  const [targetWords, setTargetWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [history, setHistory] = useState<PolishHistoryItem[]>(loadPolishHistory)
  const run = async () => {
    if (!route) { notify('先选一个可用模型'); return }
    if (!text.trim()) { notify('先输入要处理的文案'); return }
    setBusy(true); setResult('')
    try {
      const extras: string[] = []
      if ((mode === '扩写' || mode === '缩写') && targetWords.trim()) extras.push(`目标字数约 ${targetWords.trim()} 字`)
      if (custom.trim()) extras.push(`附加要求：${custom.trim()}`)
      const out = await runWorkshopChat({
        route, freeOptions: data?.freeOptions ?? [], accounts, sessionPwd,
        system: '你是中文文案编辑。按用户要求处理文本，只输出处理后的正文，不要解释、不要加引号。',
        user: `处理方式：${mode}${extras.length ? `\n${extras.join('\n')}` : ''}\n\n原文：\n${text.slice(0, 8000)}`,
      })
      setResult(out)
      const item: PolishHistoryItem = { at: Date.now(), mode, src: text, out }
      setHistory(prev => {
        const next = [item, ...prev].slice(0, 10)
        try { localStorage.setItem(POLISH_HIST_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
        return next
      })
    } catch (e) { notify(e instanceof Error ? e.message : '处理失败') } finally { setBusy(false) }
  }
  return (
    <ToolShell title="文案润色" desc="改写、扩写、缩写、换语气、纠错——把草稿变成能直接发的成稿；可加附加要求与目标字数，结果能一轮轮接着改。" onBack={onBack}>
      <RouteSelect data={data} routeKey={routeKey} setRouteKey={setRouteKey} />
      <div className="ws-chips">
        {POLISH_MODES.map(m => <button key={m} className={`chip-btn ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{m}</button>)}
      </div>
      <textarea className="input ws-textarea" rows={7} placeholder="把草稿粘贴到这里…" value={text} onChange={e => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="附加要求（可选）：如 更幽默 / 面向宝妈 / 带 emoji"
          value={custom} onChange={e => setCustom(e.target.value)} />
        {(mode === '扩写' || mode === '缩写') && (
          <input className="input" style={{ width: 150 }} type="number" min={20} placeholder="目标字数（可选）"
            value={targetWords} onChange={e => setTargetWords(e.target.value)} />
        )}
      </div>
      <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={15} className="spin" /> : <PenLine size={15} />} 开始处理</button>
      {busy && <div className="ws-result"><Loader2 size={16} className="spin" /> 正在处理…</div>}
      {result && (
        <div className="ws-result">
          <div className="ws-result-head">
            <span>结果 · 原文 {text.length} 字 → 结果 {result.length} 字</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <button className="btn sm ghost" onClick={() => downloadTextFile(`润色-${mode}.md`, result)}><Download size={13} /> 导出</button>
              <button className="btn sm ghost" onClick={() => void navigator.clipboard?.writeText(result).catch(() => {})}><Copy size={13} /> 复制</button>
              <button className="btn sm ghost" onClick={() => { setText(result); setResult('') }}>以结果继续改</button>
            </span>
          </div>
          <div className="ws-result-text">{result}</div>
        </div>
      )}
      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>最近处理（本机保存）</span>
            <button className="btn sm ghost" onClick={() => { setHistory([]); try { localStorage.removeItem(POLISH_HIST_KEY) } catch { /* 忽略 */ } }}>清空</button>
          </div>
          {history.map((h, i) => (
            <button key={h.at + '-' + i} className="fm-hit" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}
              onClick={() => { setText(h.src); setResult(h.out); setMode(h.mode as (typeof POLISH_MODES)[number]) }}>
              <div className="fm-hit-name">{h.mode} <span className="fm-hit-via">{new Date(h.at).toLocaleString()}</span></div>
              <div className="fm-hit-snip">{h.src.slice(0, 80)}</div>
            </button>
          ))}
        </div>
      )}
    </ToolShell>
  )
}

// ---------------- 联网核查 ----------------
function WebCheckTool({ accounts, sessionPwd, notify, onBack }: ToolProps) {
  const { data, route, routeKey, setRouteKey } = useRouteData(accounts)
  const [claim, setClaim] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [sources, setSources] = useState<{ title: string; url: string }[]>([])
  const run = async () => {
    if (!route) { notify('先选一个可用模型'); return }
    if (!claim.trim()) { notify('先输入要核查的说法'); return }
    setBusy(true); setResult(''); setSources([])
    try {
      const ctx = await buildSearchContextCached(claim.trim())
      if (!ctx) { notify('没搜到相关资料，换个说法试试'); return }
      setSources(ctx.sources)
      const out = await runWorkshopChat({
        route, freeOptions: data?.freeOptions ?? [], accounts, sessionPwd,
        system: `你是事实核查员。下面是联网搜索到的资料：\n\n${ctx.block}\n\n核查要求：只依据资料判断，给出结论（属实 / 不实 / 证据不足），引用资料编号说明依据；资料没有提到的明确说证据不足，不许猜测。`,
        user: `核查这句话：${claim.trim()}`,
      })
      setResult(out)
    } catch (e) { notify(e instanceof Error ? e.message : '核查失败') } finally { setBusy(false) }
  }
  return (
    <ToolShell title="联网核查" desc="给一句话或一条消息，AI 联网搜证核实真假并附来源——聊天里联网搜索的独立版。" onBack={onBack}>
      <RouteSelect data={data} routeKey={routeKey} setRouteKey={setRouteKey} />
      <textarea className="input ws-textarea" rows={3} placeholder="例如：小米 SU8 汽车下个月上市，起售价 19 万" value={claim} onChange={e => setClaim(e.target.value)} />
      <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={15} className="spin" /> : <SearchCheck size={15} />} 开始核查</button>
      <ResultBox text={result} busy={false} />
      {busy && <div className="ws-result"><Loader2 size={16} className="spin" /> 正在联网核查…</div>}
      {sources.length > 0 && (
        <div className="ws-sources">
          <div>📎 信息来源</div>
          {sources.map((s, i) => <div key={i}>[{i + 1}] {s.title}</div>)}
        </div>
      )}
    </ToolShell>
  )
}

// ---------------- 表格问答 ----------------
function TableTool({ accounts, sessionPwd, notify, onBack }: ToolProps) {
  const { data, route, routeKey, setRouteKey } = useRouteData(accounts)
  const [tableName, setTableName] = useState('')
  const [tableText, setTableText] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const run = async () => {
    if (!route) { notify('先选一个可用模型'); return }
    if (!tableText.trim()) { notify('先上传表格文件'); return }
    if (!question.trim()) { notify('先输入问题'); return }
    setBusy(true); setResult('')
    try {
      const out = await runWorkshopChat({
        route, freeOptions: data?.freeOptions ?? [], accounts, sessionPwd,
        system: '你是表格数据分析助手。只依据给出的表格数据回答，给出具体数字与计算过程；数据里没有的明确说明。',
        user: `表格《${tableName}》内容（CSV/文本）：\n\n${tableText.slice(0, 14000)}\n\n问题：${question.trim()}`,
      })
      setResult(out)
    } catch (e) { notify(e instanceof Error ? e.message : '回答失败') } finally { setBusy(false) }
  }
  return (
    <ToolShell title="表格问答" desc="把 CSV / 文本表格丢进来，用问话查数、汇总、找异常，不用写公式。" onBack={onBack}>
      <RouteSelect data={data} routeKey={routeKey} setRouteKey={setRouteKey} />
      <div className="ws-actions">
        <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> 上传表格（CSV / TXT）</button>
        {tableName && <span className="ws-fname">{tableName}（{tableText.length} 字）</span>}
        <input ref={fileRef} type="file" hidden accept=".csv,.txt,.tsv,.md" onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          try { setTableText(await f.text()); setTableName(f.name) } catch { notify('读取失败') }
        }} />
      </div>
      <input className="input" placeholder="例如：哪个月销售额最高？华东区合计多少？" value={question} onChange={e => setQuestion(e.target.value)} />
      <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 size={15} className="spin" /> : <Table2 size={15} />} 提问</button>
      <ResultBox text={result} busy={false} />
      {busy && <div className="ws-result"><Loader2 size={16} className="spin" /> 正在分析…</div>}
    </ToolShell>
  )
}

interface ToolProps {
  accounts: Account[]
  sessionPwd: string
  notify: (m: string) => void
  onBack: () => void
}

// ---------------- 工坊主页 ----------------
export function WorkshopView({ accounts, sessionPwd, notify, onOpenTab, settings, serviceController, onUnlock, openSignal }: {
  accounts: Account[]
  sessionPwd: string
  notify: (m: string) => void
  onOpenTab: (tab: string) => void
  settings?: AppSettings
  serviceController?: ServiceController
  onUnlock?: (pwd: string) => void
  openSignal?: { tool: string; n: number } | null
}) {
  const [tool, setTool] = useState<ToolId>('hub')
  const back = () => setTool('hub')
  // 工坊主页分组折叠（v0.1.333 Ethan 要求，与插件页折叠同一处理）：点组标题收起该组卡片，状态存本机
  const [closedGroups, setClosedGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('acm.workshop.closedGroups') ?? '[]') as string[] } catch { return [] }
  })
  const toggleGroup = (title: string) => setClosedGroups(prev => {
    const next = prev.includes(title) ? prev.filter(x => x !== title) : [...prev, title]
    try { localStorage.setItem('acm.workshop.closedGroups', JSON.stringify(next)) } catch { /* 忽略 */ }
    return next
  })
  const toolProps: ToolProps = { accounts, sessionPwd, notify, onBack: back }

  // 外部直达信号（看板瓷砖等）：打开工坊时直达指定工具页
  useEffect(() => {
    if (openSignal?.tool) setTool(openSignal.tool as ToolId)
  }, [openSignal])

  if (tool === 'files') return <FileManagerView accounts={accounts} sessionPwd={sessionPwd} notify={notify} onBack={back} />
  if (tool === 'gallery') return <GalleryView accounts={accounts} sessionPwd={sessionPwd} notify={notify} onBack={back} />
  if (tool === 'dailycheckin') return <CheckinTool sessionPwd={sessionPwd} onUnlock={onUnlock ?? (() => {})} notify={notify} onBack={back} />
  if (tool === 'wbpool') return <WbPoolTool sessionPwd={sessionPwd} onUnlock={onUnlock ?? (() => {})} notify={notify} onBack={back} />
  if (tool === 'freegames') return <FreeGamesTool sessionPwd={sessionPwd} onUnlock={onUnlock ?? (() => {})} notify={notify} onBack={back} />
  if (tool === 'steamdeals') return <SteamDealsTool notify={notify} onBack={back} />
  if (tool === 'watch') return <WatchTool accounts={accounts} sessionPwd={sessionPwd} onUnlock={onUnlock ?? (() => {})} notify={notify} onBack={back} />
  if (tool === 'summary') return <SummaryTool {...toolProps} />
  if (tool === 'polish') return <PolishTool {...toolProps} />
  if (tool === 'webcheck') return <WebCheckTool {...toolProps} />
  if (tool === 'table') return <TableTool {...toolProps} />
  if (tool === 'translate') return (
    <ToolShell title="AI 翻译" desc="整篇文档或粘贴文本翻译，保留段落结构，可双语对照（原侧边栏 AI 翻译，已并入工坊）。" onBack={back}>
      <TranslationView accounts={accounts} notify={notify} settings={settings} serviceController={serviceController} onOpenChat={() => onOpenTab('chat-translate')} />
    </ToolShell>
  )
  if (tool === 'image') return (
    <ToolShell title="AI 图像" desc="云端生图（原侧边栏 AI 图像，已并入工坊）。" onBack={back}>
      <ImageView accounts={accounts} sessionPwd={sessionPwd} onUnlock={onUnlock ?? (() => {})} notify={notify} settings={settings} onOpenLocal={() => onOpenTab('local-image')} />
    </ToolShell>
  )
  if (tool === 'video') return (
    <ToolShell title="AI 视频" desc="云端生视频（原侧边栏 AI 视频，已并入工坊）。" onBack={back}>
      <VideoView accounts={accounts} sessionPwd={sessionPwd} onUnlock={onUnlock ?? (() => {})} notify={notify} settings={settings} onOpenLocal={() => onOpenTab('local-video')} />
    </ToolShell>
  )
  if (tool === 'docqa') return (
    <ToolShell title="文档问答" desc="导入文档，基于本地或云端模型问答 · 文档与向量只存此设备（原侧边栏文档问答，已并入工坊）。" onBack={back}>
      <DocQAView accounts={accounts} sessionPwd={sessionPwd} onUnlock={onUnlock ?? (() => {})} notify={notify} thinkingMode={settings?.thinkingMode} settings={settings} serviceController={serviceController} />
    </ToolShell>
  )

  const groups: { title: string; sub: string; cards: { id: string; name: string; desc: string; tag: string; tagClass?: string; grad: string; icon: React.ReactNode; action: () => void; isNew?: boolean }[] }[] = [
    {
      title: '文档与文件', sub: '找、读、理',
      cards: [
        { id: 'files', name: '文件管家', desc: '访达式浏览你的文件夹，本地索引加持，一句话找到文件、读出内容、直接预览。', tag: '本地索引', tagClass: 'local', grad: 'g1', icon: <FolderCog size={21} />, action: () => setTool('files'), isNew: true },
        { id: 'summary', name: '文档总结', desc: '丢进 PDF / Word / 长文，一键出摘要、要点清单和大纲。', tag: '文档解析', grad: 'g2', icon: <FileText size={21} />, action: () => setTool('summary') },
        { id: 'docqa', name: '文档问答', desc: '导入文档建本地知识库，围绕文档内容提问，答案带出处。', tag: '本地知识库', grad: 'g4', icon: <MessagesSquare size={21} />, action: () => setTool('docqa') },
        { id: 'translate', name: 'AI 翻译', desc: '整篇文档或粘贴文本翻译，保留段落结构，可双语对照。', tag: '整页翻译', grad: 'g5', icon: <Languages size={21} />, action: () => setTool('translate') },
      ],
    },
    {
      title: '创作生成', sub: '写、画、说',
      cards: [
        { id: 'polish', name: '文案润色', desc: '改写、扩写、缩写、换语气——把草稿变成能直接发的成稿。', tag: '免费模型可用', tagClass: 'free', grad: 'g3', icon: <PenLine size={21} />, action: () => setTool('polish') },
        { id: 'image', name: 'AI 图像', desc: '云端生图，生成完自动存进你的文件夹（本地生图在侧边栏本地生成里）。', tag: '云端生图', grad: 'g6', icon: <ImageIcon size={21} />, action: () => setTool('image') },
        { id: 'video', name: 'AI 视频', desc: '云端生视频，生成完自动存进你的文件夹（本地生视频在侧边栏本地生成里）。', tag: '云端生视频', grad: 'g5', icon: <Film size={21} />, action: () => setTool('video') },
        { id: 'gallery', name: 'AI 图库', desc: '苹果照片式图库：AI 生成与本地照片视频按日期成册，悬停播放、点开大图慢慢看。', tag: '照片式浏览', grad: 'g2', icon: <Images size={21} />, action: () => setTool('gallery'), isNew: true },
        { id: 'voice', name: '语音转写', desc: '录音、会议音频转文字稿——本地 whisper 引擎制作中，下一批上架。', tag: '第二批', grad: 'g4', icon: <Mic size={21} />, action: () => notify('语音转写在第二批：本地 whisper 引擎接入中') },
      ],
    },
    {
      title: '效率助理', sub: '杂活自动化',
      cards: [
        { id: 'webcheck', name: '联网核查', desc: '给一句话或一条消息，AI 联网搜证核实真假并附来源。', tag: '免 Key 搜索', tagClass: 'free', grad: 'g2', icon: <SearchCheck size={21} />, action: () => setTool('webcheck') },
        { id: 'table', name: '表格问答', desc: '把 CSV 丢进来，用问话查数、汇总、找异常，不用写公式。', tag: '文档解析', grad: 'g1', icon: <Table2 size={21} />, action: () => setTool('table') },
        { id: 'dailycheckin', name: '每日签到', desc: 'WorkBuddy、MiniMax Code 每日积分签到：授权一次，每天点一下领积分。', tag: '领积分', grad: 'g3', icon: <CalendarCheck size={21} />, action: () => setTool('dailycheckin'), isNew: true },
        { id: 'freegames', name: '免费游戏', desc: 'Epic 每周喜加一自动领取：绑定一次，定时自动领入库。', tag: '喜加一', grad: 'g3', icon: <Gamepad2 size={21} />, action: () => setTool('freegames'), isNew: true },
        { id: 'steamdeals', name: 'Steam 降价', desc: 'Steam 商店当前打折游戏：折扣、现价、原价、好评率，按折扣排序，大促期间列表更长。', tag: '免 Key', tagClass: 'free', grad: 'g3', icon: <BadgePercent size={21} />, action: () => setTool('steamdeals'), isNew: true },
        { id: 'watch', name: '看剧', desc: 'AI 找剧、热门推荐、直播、点播：App 内播放器直接看，直播多套源自动切换，点播带选集与续播；片单与追剧日历只存本机。', tag: '看剧追剧', grad: 'g6', icon: <Tv size={21} />, action: () => setTool('watch'), isNew: true },
        { id: 'wbpool', name: 'WorkBuddy 账号池', desc: '多个 WorkBuddy 账号授权入池成一个模型来源：对话自动轮换、限流自动切换，签到一并带上。', tag: '多账号池', grad: 'g2', icon: <Users size={21} />, action: () => setTool('wbpool'), isNew: true },
        { id: 'catalog', name: 'AI 工具大全', desc: '各平台 AI 工具目录与签到入口汇总，原侧边栏入口已并入工坊。', tag: '导航目录', grad: 'g4', icon: <LayoutGrid size={21} />, action: () => onOpenTab('checkin') },
      ],
    },
  ]

  return (
    <div className="ws-hub">
      <div className="ws-head">
        <div className="ws-title"><span className="ws-logo"><Hammer size={18} /></span>AI 工坊</div>
        <p className="ws-subtitle">每个工具一个独立页面，点开即用 · 用的都是你已配置的模型与账户</p>
      </div>
      {groups.map(g => (
        <div key={g.title}>
          <div className="ws-group-title" role="button" tabIndex={0} style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => toggleGroup(g.title)} title={closedGroups.includes(g.title) ? '展开分组' : '收起分组'}>
            {g.title} <small>{g.sub}</small>
            <ChevronDown size={14} style={{ marginLeft: 6, verticalAlign: -2, transform: closedGroups.includes(g.title) ? 'rotate(-90deg)' : undefined, transition: 'transform .2s' }} />
          </div>
          {!closedGroups.includes(g.title) && (
          <div className="ws-grid">
            {g.cards.map(c => (
              <button key={c.id} className="ws-card" onClick={c.action}>
                {c.isNew && <span className="ws-new">NEW</span>}
                <span className={`ws-tico ${c.grad}`}>{c.icon}</span>
                <span className="ws-tname">{c.name}</span>
                <span className="ws-tdesc">{c.desc}</span>
                <span className="ws-tfoot">
                  <span className={`ws-tag ${c.tagClass ?? ''}`}>{c.tag}</span>
                  <span className="ws-open">打开 <ChevronRight size={13} /></span>
                </span>
              </button>
            ))}
          </div>
          )}
        </div>
      ))}
    </div>
  )
}
