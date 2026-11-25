import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Folder, File as FileIcon, Loader2, Plug, RefreshCw, Search, Copy,
  LayoutGrid, List as ListIcon, ChevronRight, Database, Sparkles, Eye, EyeOff, ExternalLink,
} from 'lucide-react'
import type { Account } from '../core/types'
import { loadMcpServers, getMcpConnection, connectMcpServer, callMcpTool, callMcpToolRaw, MCP_EVENT, type McpServerConfig } from '../core/mcp'
import { isDesktopApp } from '../core/openExternal'
import { fetchLocalModels } from '../core/localServices'
import { filterEmbeddingModels, embedText } from '../core/docQA'
import {
  TEXT_EXTS, extOf, loadFileRecords, upsertFileRecord, indexFileText, searchFileIndex, fileChunksForQa,
  removeFileIndex, parseFileInfo, shouldReindex,
  type FileSearchHit,
} from '../core/fileIndex'
import { Pager } from './Pager'
import { runWorkshopChat } from '../core/workshopChat'
import { useRouteData, RouteSelect } from './WorkshopView'

interface Entry { name: string; isDir: boolean }

function findFilesystemServer(): McpServerConfig | null {
  const list = loadMcpServers()
  return list.find(s => (s.args ?? []).some(a => a.includes('server-filesystem'))) ?? null
}

function parseAllowedDirs(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.startsWith('/'))
}

function parseListDir(text: string): Entry[] {
  const out: Entry[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(DIR|FILE)\]\s+(.+)$/)
    if (m) out.push({ isDir: m[1] === 'DIR', name: m[2].trim() })
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

const joinPath = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`)

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'heic', 'dng', 'tif', 'tiff', 'cr2', 'cr3', 'nef', 'arw', 'rw2', 'orf'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'mpg', 'mpeg', 'flv', 'wmv'])
/** WebView 能直接播放的视频格式（走 Tauri asset 协议流式播放，不整文件读进内存） */
const PLAY_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v'])
const HIDDEN_KEY = 'acm.filemgr.showHidden'
const loadShowHidden = () => { try { return localStorage.getItem(HIDDEN_KEY) === '1' } catch { return false } }

/** 用系统默认应用打开本机文件（仅桌面端，Rust open_external_path） */
async function openExternalPath(path: string): Promise<boolean> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
  const invoke = w.__TAURI_INTERNALS__?.invoke
  if (!invoke) return false
  await invoke('open_external_path', { path })
  return true
}

/** 探测本机 Ollama 的嵌入模型（与文档问答同口径）；没有则返回 null，走关键词模式 */
async function detectEmbedModel(): Promise<{ base: string; model: string } | null> {
  try {
    const r = await fetchLocalModels('ollama', 'http://127.0.0.1:11434')
    if (!r.ok) return null
    const em = filterEmbeddingModels(r.models)
    return em.length ? { base: 'http://127.0.0.1:11434', model: em[0] } : null
  } catch { return null }
}

export function FileManagerView({ accounts, sessionPwd, notify, onBack }: {
  accounts: Account[]
  sessionPwd: string
  notify: (m: string) => void
  onBack: () => void
}) {
  const desktop = isDesktopApp()
  const [server, setServer] = useState<McpServerConfig | null>(() => findFilesystemServer())
  const [, setTick] = useState(0)
  const [roots, setRoots] = useState<string[]>([])
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loadingDir, setLoadingDir] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<string>('')
  const [preview, setPreview] = useState('')
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [hits, setHits] = useState<FileSearchHit[]>([])
  const [nameHits, setNameHits] = useState<FileSearchHit[]>([])
  const [foundPage, setFoundPage] = useState(1)
  const [answer, setAnswer] = useState('')
  const [indexing, setIndexing] = useState('')
  const [indexNote, setIndexNote] = useState('')
  const [showHidden, setShowHidden] = useState<boolean>(loadShowHidden)
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const thumbBusy = useState(() => new Set<string>())[0]
  const [videoUrls, setVideoUrls] = useState<Map<string, string>>(new Map())
  const videoUrlBusy = useState(() => new Set<string>())[0]
  const [hoverImg, setHoverImg] = useState<{ src: string; x: number; y: number } | null>(null)
  // 悬浮播放（v0.1.338）：悬停可播视频 200ms 后出浮动播放器自动播放，移开即停
  const [hoverVideo, setHoverVideo] = useState<{ path: string; x: number; y: number } | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const [previewImg, setPreviewImg] = useState('')
  const [page, setPage] = useState(1)
  const { data: routeData, route, routeKey, setRouteKey } = useRouteData(accounts)

  const conn = server ? getMcpConnection(server.id) : null
  const ready = conn?.status === 'ready'

  const visibleEntries = useMemo(
    () => (showHidden ? entries : entries.filter(e => !e.name.startsWith('.'))),
    [entries, showHidden],
  )
  // 分页（v0.1.331）：大目录按页浏览，每页 60 项
  const PAGE_SIZE = 60
  const pageCount = Math.max(1, Math.ceil(visibleEntries.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedEntries = useMemo(
    () => visibleEntries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visibleEntries, safePage],
  )

  /** 读图片为 data URL（Filesystem 的 read_media_file 返回 base64 内容块）；失败静默回落图标 */
  const ensureThumb = useCallback(async (path: string) => {
    if (!server || thumbs.has(path) || thumbBusy.has(path)) return
    thumbBusy.add(path)
    try {
      const r = await callMcpToolRaw(server.id, 'read_media_file', { path })
      const img = r.content.find(c => c.type === 'image' && c.data)
      if (img?.data) {
        const url = `data:${img.mimeType ?? 'image/png'};base64,${img.data}`
        setThumbs(prev => new Map(prev).set(path, url))
      }
    } catch { /* 旧版服务器无此工具时静默 */ } finally { thumbBusy.delete(path) }
  }, [server, thumbs, thumbBusy])

  /** 可播视频：经 Tauri convertFileSrc 拿 asset 流地址（支持大文件边播边读） */
  const ensureVideoUrl = useCallback(async (path: string) => {
    if (videoUrls.has(path) || videoUrlBusy.has(path)) return
    videoUrlBusy.add(path)
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      const url = convertFileSrc(path)
      setVideoUrls(prev => new Map(prev).set(path, url))
    } catch { /* 非桌面端忽略 */ } finally { videoUrlBusy.delete(path) }
  }, [videoUrls, videoUrlBusy])

  /** 其他格式视频（ts/mkv 等）：经 Rust qlmanage 生成缩略图（macOS），存进 thumbs 与图片共用展示 */
  const ensureVideoThumb = useCallback(async (path: string) => {
    if (thumbs.has(path) || thumbBusy.has(path)) return
    thumbBusy.add(path)
    try {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<string> } }
      const invoke = w.__TAURI_INTERNALS__?.invoke
      if (!invoke) return
      const url = await invoke('video_thumb', { path })
      if (url) setThumbs(prev => new Map(prev).set(path, url))
    } catch { /* 生成失败回落图标 */ } finally { thumbBusy.delete(path) }
  }, [thumbs, thumbBusy])

  // 当前目录的媒体自动备好：图片缩略图（≤80）、可播视频的流地址、其他视频的 ql 缩略图（≤12，防大目录刷爆）
  useEffect(() => {
    if (!ready || !cwd) return
    let n = 0
    let q = 0
    let v = 0
    for (const e of pagedEntries) {
      if (e.isDir) continue
      const ext = extOf(e.name)
      const p = joinPath(cwd, e.name)
      if (IMAGE_EXTS.has(ext)) { if (n < 80) { n++; void ensureThumb(p) } }
      else if (PLAY_VIDEO_EXTS.has(ext)) { void ensureVideoUrl(p); if (v < 24) { v++; void ensureVideoThumb(p) } }
      else if (VIDEO_EXTS.has(ext)) { if (q < 12) { q++; void ensureVideoThumb(p) } }
    }
  }, [pagedEntries, cwd, ready, ensureThumb, ensureVideoUrl, ensureVideoThumb])

  useEffect(() => {
    const on = () => { setServer(findFilesystemServer()); setTick(x => x + 1) }
    window.addEventListener(MCP_EVENT, on)
    return () => window.removeEventListener(MCP_EVENT, on)
  }, [])

  const loadDir = useCallback(async (srv: McpServerConfig, path: string) => {
    setLoadingDir(true)
    try {
      const r = await callMcpTool(srv.id, 'list_directory', { path })
      if (r.isError) throw new Error(r.text)
      setEntries(parseListDir(r.text))
      setCwd(path)
      setPage(1)
      setSelected('')
      setPreview('')
    } catch (e) { notify(e instanceof Error ? e.message : '读取目录失败') } finally { setLoadingDir(false) }
  }, [notify])

  useEffect(() => {
    if (!server || !ready) return
    let dead = false
    void (async () => {
      try {
        const r = await callMcpTool(server.id, 'list_allowed_directories', {})
        if (dead || r.isError) return
        const dirs = parseAllowedDirs(r.text)
        setRoots(dirs)
        if (dirs.length && !cwd) void loadDir(server, dirs[0])
      } catch { /* 未连接时忽略 */ }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, ready])

  const crumbs = useMemo(() => {
    if (!cwd) return []
    const parts = cwd.split('/').filter(Boolean)
    return parts.map((p, i) => ({ label: p, path: '/' + parts.slice(0, i + 1).join('/') }))
  }, [cwd])

  /** 按完整路径预览一个文件（选中 + 右侧预览栏出图/视频/文本） */
  const previewFile = (p: string) => {
    if (!server) return
    const name = p.split('/').pop() ?? p
    setSelected(p)
    setPreview('')
    setPreviewImg('')
    if (IMAGE_EXTS.has(extOf(name))) {
      const cached = thumbs.get(p)
      if (cached) setPreviewImg(cached)
      else void ensureThumb(p).then(() => setThumbs(prev => { const u = prev.get(p); if (u) setPreviewImg(u); return prev }))
    }
    if (PLAY_VIDEO_EXTS.has(extOf(name))) void ensureVideoUrl(p)
    else if (VIDEO_EXTS.has(extOf(name))) {
      const cached = thumbs.get(p)
      if (cached) setPreviewImg(cached)
      else void ensureVideoThumb(p).then(() => setThumbs(prev => { const u = prev.get(p); if (u) setPreviewImg(u); return prev }))
    }
    if (TEXT_EXTS.has(extOf(name))) {
      void callMcpTool(server.id, 'read_text_file', { path: p }).then(r => {
        if (!r.isError) setPreview(r.text.slice(0, 6000))
      }).catch(() => {})
    }
  }

  const openEntry = (e: Entry) => {
    if (!server) return
    const p = joinPath(cwd, e.name)
    if (e.isDir) { void loadDir(server, p); return }
    previewFile(p)
  }

  /** 搜索结果定位：跳到文件所在文件夹并选中预览；无扩展名的按文件夹处理 */
  const locateFile = async (path: string) => {
    if (!server) return
    const name = path.split('/').pop() ?? path
    if (!name.includes('.')) { await loadDir(server, path); return }
    const parent = path.slice(0, path.lastIndexOf('/')) || '/'
    await loadDir(server, parent)
    previewFile(path)
  }

  /**
   * 建立/更新索引（v0.1.335 增量版）：遍历放行目录登记文件；文本文件先取大小/修改时间与上次索引比对，
   * 没变的直接跳过，只重读新增/改过的文件；已删除的文件自动清出索引。auto=true 为打开页面时静默更新。
   */
  const buildIndex = async (opts?: { auto?: boolean }) => {
    if (!server || !ready) { if (!opts?.auto) notify('先连接 Filesystem 服务'); return }
    const auto = !!opts?.auto
    setIndexing(auto ? '正在自动更新索引…' : '正在探测嵌入模型…')
    try {
      const embed = await detectEmbedModel()
      const embedBase = embed?.base ?? ''
      const embedModel = embed?.model ?? ''
      const maxText = embedModel ? 150 : 400
      const records = new Map(loadFileRecords().map(r => [r.path, r]))
      const seenPaths = new Set<string>()
      let seen = 0
      let processed = 0
      let skipped = 0
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 6 || seen > 3000) return
        let list: Entry[] = []
        try {
          const r = await callMcpTool(server.id, 'list_directory', { path: dir })
          if (r.isError) return
          list = parseListDir(r.text)
        } catch { return }
        for (const e of list) {
          if (!showHidden && e.name.startsWith('.')) continue // 隐藏文件/目录默认不进索引（多为应用配置与缓存）
          const p = joinPath(dir, e.name)
          if (e.isDir) { await walk(p, depth + 1); continue }
          seen++
          seenPaths.add(p)
          const ext = extOf(e.name)
          if (!TEXT_EXTS.has(ext)) {
            upsertFileRecord({ path: p, name: e.name, ext, indexed: false, chunkCount: 0, indexedAt: 0 })
            continue
          }
          // 增量判定：先 stat 比对，没变跳过（不占本次读取上限）
          let stat = null as ReturnType<typeof parseFileInfo>
          try {
            const sr = await callMcpTool(server.id, 'get_file_info', { path: p })
            if (!sr.isError) stat = parseFileInfo(sr.text)
          } catch { /* 旧版服务器无此工具时 stat 为空 */ }
          if (!shouldReindex(records.get(p), stat, embedModel, !auto)) { skipped++; continue }
          if (processed >= maxText) continue
          try {
            const r = await callMcpTool(server.id, 'read_text_file', { path: p })
            if (r.isError || !r.text.trim()) continue
            await indexFileText({
              path: p, text: r.text.slice(0, 60000),
              embedBase: embedBase || undefined, embedModel: embedModel || undefined,
              size: stat?.size, mtime: stat?.mtime,
            })
            processed++
            setIndexing(`${auto ? '正在自动更新索引' : '正在建索引'}… 已登记 ${seen} 个文件，本次更新 ${processed} 个${embedModel ? '（语义）' : '（关键词）'}`)
          } catch { /* 单个文件失败跳过 */ }
        }
      }
      for (const root of roots) await walk(root, 0)
      // 清理已删除文件（遍历被 3000 上限截断时不清理，避免误删未扫到的记录）
      let pruned = 0
      if (seen <= 3000) {
        for (const rec of loadFileRecords()) {
          if (!roots.some(r => rec.path === r || rec.path.startsWith(r + '/'))) continue
          if (!showHidden && rec.path.split('/').some(seg => seg.startsWith('.') && seg.length > 1)) continue
          if (!seenPaths.has(rec.path)) { await removeFileIndex(rec.path); pruned++ }
        }
      }
      try { localStorage.setItem('acm.filemgr.lastIndexAt', String(Date.now())) } catch { /* 忽略 */ }
      const mode = embedModel ? '语义模式' : '关键词模式'
      if (auto) {
        setIndexNote(processed === 0 && pruned === 0
          ? `索引已是最新（${mode}）`
          : `已自动更新：新增/更新 ${processed} 个${pruned ? `，清理已删除 ${pruned} 个` : ''}（${mode}）`)
      } else {
        notify(`索引更新完成：新增/更新 ${processed} 个，跳过未变 ${skipped} 个${pruned ? `，清理已删除 ${pruned} 个` : ''}（${mode}）`)
        setIndexNote('')
      }
    } catch (e) {
      if (!auto) notify(e instanceof Error ? e.message : '建索引失败')
    } finally { setIndexing('') }
  }
  const buildIndexRef = useRef(buildIndex)
  buildIndexRef.current = buildIndex
  const autoIndexRanRef = useRef(false)

  // 打开文件管家自动增量更新（每 5 分钟最多一次；手动刚建过也不会重复跑）
  useEffect(() => {
    if (!ready || !server || roots.length === 0 || autoIndexRanRef.current) return
    let last = 0
    try { last = Number(localStorage.getItem('acm.filemgr.lastIndexAt') ?? 0) } catch { /* 忽略 */ }
    autoIndexRanRef.current = true
    if (Date.now() - last < 5 * 60_000) return
    void buildIndexRef.current({ auto: true })
  }, [ready, server, roots.length])

  const ask = async () => {
    const q = question.trim()
    if (!q) { notify('先输入问题'); return }
    if (!server || !ready) { notify('先连接 Filesystem 服务'); return }
    setAsking(true); setHits([]); setNameHits([]); setAnswer(''); setFoundPage(1)
    try {
      // 意图判断：带扩展名的文件名、或「找/在哪/打开」类措辞 = 找文件；其余 = 内容提问
      const fileToken = q.match(/[\w\-.\u4e00-\u9fa5]+\.[a-zA-Z0-9]{2,5}/)?.[0]
      const findIntent = !!fileToken || /找|在哪|定位|打开|有没有|存在|搜索/.test(q)
      const filler = /帮我|帮忙|找下|找一下|找|这个|那个|文件|请|一下|在哪|哪里|里面|的|了|吗|呢/g
      const keywords = q.replace(/[？?。！!，,、\s]+/g, ' ').replace(filler, ' ').split(' ').map(t => t.trim()).filter(t => t.length >= 2 && !/[*?]/.test(t))
      const patterns = [...new Set(fileToken ? [fileToken] : keywords.sort((a, b) => b.length - a.length).slice(0, 3))]
      // 文件名搜索（Filesystem 实时搜全部放行目录）
      const foundMap = new Map<string, FileSearchHit>()
      for (const pattern of patterns) {
        for (const root of roots) {
          try {
            const r = await callMcpTool(server.id, 'search_files', { path: root, pattern: `*${pattern}*` })
            if (!r.isError) {
              for (const line of r.text.split('\n').map(l => l.trim()).filter(l => l.startsWith('/')).slice(0, 200)) {
                if (foundMap.has(line)) continue
                const name = line.split('/').pop() ?? line
                const score = fileToken && name === fileToken ? 1 : name.toLowerCase().includes(pattern.toLowerCase()) ? 0.95 : 0.9
                foundMap.set(line, { path: line, name, score, snippet: '文件名命中（实时搜索）', via: '文件名' })
              }
            }
          } catch { /* 单根失败忽略 */ }
        }
      }
      const found = [...foundMap.values()].sort((a, b) => b.score - a.score)
      if (findIntent) {
        // 找文件：只给文件结果，不跑内容问答；唯一命中直接定位预览，多个列出来筛选
        setNameHits(found.slice(0, 200))
        if (found.length === 1) {
          setAnswer(`找到了，已在下方文件窗定位并预览：${found[0].path}`)
          await locateFile(found[0].path)
        } else if (found.length > 1) {
          setAnswer(`按文件名找到 ${found.length} 个${found.length >= 200 ? '（结果较多，只列前 200 个）' : ''}，点任意一个的「定位预览」查看，或点「打开」直接打开。`)
        } else {
          setAnswer(`按文件名没找到「${fileToken ?? keywords[0] ?? q}」。它可能不在放行目录里，或名字记错了——换个关键词试试，或先在下方文件窗确认它大概在哪个文件夹。`)
        }
        return
      }
      // 内容提问：文件名命中照样列出，下面再走内容索引 + AI 问答
      setNameHits(found.slice(0, 10))
      let queryVector: number[] | undefined
      const embed = await detectEmbedModel()
      if (embed) {
        try { queryVector = await embedText(embed.base, embed.model, q) } catch { /* 降级关键词 */ }
      }
      const idxHits = await searchFileIndex({ query: q, queryVector, topK: 8 }).catch(() => [] as FileSearchHit[])
      const merged = new Map<string, FileSearchHit>()
      for (const h of idxHits) merged.set(h.path, h)
      setHits([...merged.values()].sort((a, b) => b.score - a.score).slice(0, 10))
      const qaChunks = await fileChunksForQa(q).catch(() => [])
      if (qaChunks.length && route) {
        const ctx = qaChunks.map((c, i) => `[${i + 1}] 文件：${c.path}\n${c.text}`).join('\n\n')
        const out = await runWorkshopChat({
          route, freeOptions: routeData?.freeOptions ?? [], accounts, sessionPwd,
          system: `你是文件管家助手。下面是从用户本地文件索引中检索到的原文片段：\n\n${ctx}\n\n依据片段回答问题，并注明出自哪个文件；片段里没有的不要编造，明确说明没找到。`,
          user: q,
        })
        setAnswer(out)
      } else if (!found.length && ![...merged.values()].length) {
        notify('没找到相关文件（可先点「建立索引」扩大内容搜索范围）')
      }
    } catch (e) { notify(e instanceof Error ? e.message : '搜索失败') } finally { setAsking(false) }
  }

  const indexedCount = useMemo(() => loadFileRecords().filter(r => r.indexed).length, [indexing, hits])
  const FOUND_PAGE_SIZE = 10
  const foundPageCount = Math.max(1, Math.ceil(nameHits.length / FOUND_PAGE_SIZE))
  const safeFoundPage = Math.min(foundPage, foundPageCount)
  const foundSlice = nameHits.slice((safeFoundPage - 1) * FOUND_PAGE_SIZE, safeFoundPage * FOUND_PAGE_SIZE)

  return (
    <div className="ws-tool fm">
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn sm ghost" onClick={onBack}><ArrowLeft size={14} /> 返回工坊</button>
        <button className="btn sm ghost" title="刷新：重载当前目录，并清掉搜索结果与回答" onClick={() => { setQuestion(''); setHits([]); setNameHits([]); setAnswer(''); if (server && cwd) void loadDir(server, cwd) }}><RefreshCw size={14} /></button>
      </div>
      <h3 className="ws-tool-title">文件管家</h3>
      <p className="ws-tool-desc">访达式浏览 + AI 问答 · 通过插件页的 Filesystem 服务访问你放行的目录，索引只存本机。</p>

      {!desktop && <div className="fm-note">文件管家依赖本地文件服务，仅桌面端可用。</div>}
      {desktop && !server && (
        <div className="fm-note">还没添加 Filesystem 服务。去「插件」页点预设「Filesystem 文件系统」添加并连接，再回来用文件管家。</div>
      )}
      {desktop && server && !ready && (
        <div className="fm-note">
          Filesystem 服务未连接。
          <button className="btn sm primary" style={{ marginLeft: 10 }} disabled={conn?.status === 'connecting'}
            onClick={() => void connectMcpServer(server).catch(e => notify(e instanceof Error ? e.message : '连接失败'))}>
            <Plug size={13} /> {conn?.status === 'connecting' ? '连接中…' : '连接'}
          </button>
        </div>
      )}

      {ready && (
        <>
          <div className="fm-ask">
            <Sparkles size={17} className="fm-ask-icon" />
            <input className="input" placeholder="找文件直接说名字（如 报价单.xlsx），问内容如：那份报价单里海运多少钱？" value={question}
              onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void ask() }} />
            <RouteSelect data={routeData} routeKey={routeKey} setRouteKey={setRouteKey} />
            <button className="btn primary" disabled={asking} onClick={() => void ask()}>
              {asking ? <Loader2 size={15} className="spin" /> : <Search size={15} />} 问文件
            </button>
          </div>

          {(answer || hits.length > 0 || nameHits.length > 0) && (
            <div className="fm-answer">
              {answer && <div className="fm-answer-text">{answer}</div>}
              {nameHits.length > 0 && (
                <>
                  <div className="fm-found-title">找到的文件（{nameHits.length}）</div>
                  <div className="fm-hits">
                    {foundSlice.map(h => (
                      <div key={h.path} className="fm-hit">
                        <div className="fm-hit-name">{h.name}</div>
                        <div className="fm-hit-path">{h.path}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          <button className="btn sm primary" onClick={() => void locateFile(h.path)}>定位预览</button>
                          <button className="btn sm" onClick={() => void openExternalPath(h.path).then(ok => { if (!ok) notify('打开失败') }).catch(() => notify('打开失败'))}>打开</button>
                          <button className="btn sm ghost" onClick={() => void navigator.clipboard?.writeText(h.path).catch(() => {})}><Copy size={12} /> 复制路径</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {nameHits.length > 0 && (
                <Pager page={safeFoundPage} pageCount={foundPageCount} total={nameHits.length} unit="个" onPage={setFoundPage} />
              )}
              {hits.length > 0 && <div className="fm-found-title">相关内容片段</div>}
              <div className="fm-hits">
                {hits.map(h => (
                  <div key={h.path} className="fm-hit">
                    <div className="fm-hit-name">{h.name} <span className="fm-hit-via">{h.via} · {Math.round(h.score * 100)}%</span></div>
                    <div className="fm-hit-path">{h.path}</div>
                    <div className="fm-hit-snip">{h.snippet}</div>
                    <button className="btn sm ghost" onClick={() => void navigator.clipboard?.writeText(h.path).catch(() => {})}><Copy size={12} /> 复制路径</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="fm-window">
            <div className="fm-titlebar">
              <span className="fm-lights"><i style={{ background: '#ff5f57' }} /><i style={{ background: '#febc2e' }} /><i style={{ background: '#28c840' }} /></span>
              <div className="fm-crumbs">
                {crumbs.map((c, i) => (
                  <span key={c.path}>
                    {i > 0 && <ChevronRight size={12} className="fm-crumb-sep" />}
                    <button className="fm-crumb" onClick={() => server && void loadDir(server, c.path)}>{c.label}</button>
                  </span>
                ))}
              </div>
              <button className="btn sm ghost" title={showHidden ? '隐藏以 . 开头的文件' : '显示以 . 开头的隐藏文件'}
                onClick={() => { const v = !showHidden; setShowHidden(v); try { localStorage.setItem(HIDDEN_KEY, v ? '1' : '0') } catch { /* 忽略 */ } }}>
                {showHidden ? <Eye size={13} /> : <EyeOff size={13} />} 隐藏文件
              </button>
              <div className="fm-seg">
                <button className={viewMode === 'grid' ? 'on' : ''} onClick={() => setViewMode('grid')}><LayoutGrid size={13} /> 图标</button>
                <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')}><ListIcon size={13} /> 列表</button>
              </div>
              <button className="btn sm ghost" onClick={() => server && cwd && void loadDir(server, cwd)}><RefreshCw size={13} /></button>
              <span className="fm-count">共 {visibleEntries.length} 项{pageCount > 1 ? ` · 第 ${safePage} / ${pageCount} 页` : ''}</span>
            </div>
            <div className="fm-body">
              <div className="fm-side">
                <div className="fm-side-title">放行目录</div>
                {roots.map(r => (
                  <button key={r} className={`fm-side-item ${cwd.startsWith(r) ? 'on' : ''}`} onClick={() => server && void loadDir(server, r)}>
                    <Folder size={14} /> <span>{r.split('/').pop() || r}</span>
                  </button>
                ))}
                <div className="fm-side-title" style={{ marginTop: 14 }}>本地索引</div>
                <div className="fm-side-meta">已索引 {indexedCount} 个文本文件</div>
                <button className="btn sm" disabled={!!indexing} onClick={() => void buildIndex()}>
                  <Database size={13} /> {indexing ? '建索引中…' : '建立 / 更新索引'}
                </button>
                {indexing && <div className="fm-side-meta">{indexing}</div>}
                {!indexing && indexNote && <div className="fm-side-meta">{indexNote}</div>}
              </div>
              <div className="fm-main">
                {pageCount > 1 && !loadingDir && (
                  <div className="fm-pager-top">
                    <Pager page={safePage} pageCount={pageCount} total={visibleEntries.length} onPage={setPage} />
                  </div>
                )}
                {loadingDir ? <div className="fm-empty"><Loader2 size={16} className="spin" /> 读取中…</div>
                  : visibleEntries.length === 0 ? <div className="fm-empty">这个文件夹是空的（或只有隐藏文件）</div>
                    : viewMode === 'grid' ? (
                      <div className="fm-grid">
                        {pagedEntries.map(e => {
                          const p = joinPath(cwd, e.name)
                          const thumb = !e.isDir && (IMAGE_EXTS.has(extOf(e.name)) || VIDEO_EXTS.has(extOf(e.name))) ? thumbs.get(p) : undefined
                          return (
                            <button key={e.name} className={`fm-file ${selected === p ? 'sel' : ''} ${e.name.startsWith('.') ? 'fm-dot' : ''}`}
                              onClick={() => openEntry(e)} onDoubleClick={() => openEntry(e)}
                              onMouseEnter={ev => {
                                const r = ev.currentTarget.getBoundingClientRect()
                                if (thumb) setHoverImg({ src: thumb, x: r.right + 10, y: Math.max(8, r.top - 10) })
                                if (PLAY_VIDEO_EXTS.has(extOf(e.name))) {
                                  void ensureVideoUrl(p)
                                  const x = Math.min(r.right + 10, window.innerWidth - 372)
                                  const y = Math.max(8, r.top - 10)
                                  hoverTimer.current = window.setTimeout(() => setHoverVideo({ path: p, x, y }), 200)
                                }
                              }}
                              onMouseLeave={() => {
                                setHoverImg(null)
                                if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null }
                                setHoverVideo(null)
                              }}>
                              {e.isDir ? <Folder size={38} className="fm-folder-ico" />
                                : thumb ? <img className="fm-thumb" src={thumb} alt={e.name} />
                                  : !e.isDir && PLAY_VIDEO_EXTS.has(extOf(e.name)) && videoUrls.get(p)
                                    ? <video className="fm-thumb" src={videoUrls.get(p)} preload="metadata" muted playsInline />
                                    : <FileIcon size={34} className="fm-file-ico" />}
                              <span>{e.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="fm-list">
                        {pagedEntries.map(e => (
                          <button key={e.name} className={`fm-row ${selected === joinPath(cwd, e.name) ? 'sel' : ''}`}
                            onClick={() => openEntry(e)} onDoubleClick={() => openEntry(e)}>
                            {e.isDir ? <Folder size={16} className="fm-folder-ico" /> : <FileIcon size={15} className="fm-file-ico" />}
                            <span>{e.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                {pageCount > 1 && (
                  <div className="fm-pager-sticky">
                    <Pager page={safePage} pageCount={pageCount} total={visibleEntries.length} onPage={setPage} />
                  </div>
                )}
              </div>
              {selected && (
                <div className="fm-preview">
                  <div className="fm-pv-name">{selected.split('/').pop()}</div>
                  <div className="fm-pv-path">{selected}</div>
                  {PLAY_VIDEO_EXTS.has(extOf(selected)) && videoUrls.get(selected)
                    ? <video className="fm-pv-video" src={videoUrls.get(selected)} controls preload="metadata" />
                    : previewImg
                      ? <img className="fm-pv-img" src={previewImg} alt={selected.split('/').pop()} />
                      : preview
                        ? <pre className="fm-pv-text">{preview}</pre>
                        : <div className="fm-pv-meta">{TEXT_EXTS.has(extOf(selected)) || IMAGE_EXTS.has(extOf(selected))
                          ? '正在读取…'
                          : PLAY_VIDEO_EXTS.has(extOf(selected)) ? '正在准备播放…'
                            : VIDEO_EXTS.has(extOf(selected)) ? '此格式应用内不能直接播放（已尽量显示缩略图），点下方「打开」用系统播放器看' : '此类型暂不支持内容预览（文本与图片可预览）'}</div>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(selected).catch(() => {})}><Copy size={12} /> 复制路径</button>
                    {desktop && <button className="btn sm" onClick={() => void openExternalPath(selected).then(ok => { if (!ok) notify('打开失败') }).catch(() => notify('打开失败'))}><ExternalLink size={12} /> 打开</button>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {hoverImg && <img className="fm-hover-img" src={hoverImg.src} alt="" style={{ left: hoverImg.x, top: hoverImg.y }} />}
      {hoverVideo && videoUrls.get(hoverVideo.path) && (
        <video className="fm-hover-video" src={videoUrls.get(hoverVideo.path)} autoPlay muted loop playsInline
          style={{ left: hoverVideo.x, top: hoverVideo.y }} />
      )}
    </div>
  )
}
