import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Play, Heart, FolderPlus, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ExternalLink, Copy, Loader2, Image as ImageIcon, Film,
  Sparkles, Images, Clapperboard, FolderOpen, Folder, Search, ScanSearch, Square, Cloud, SlidersHorizontal,
} from 'lucide-react'
import { loadStoragePrefs, storageDir } from '../core/storagePrefs'
import { loadFilterCollapsed, saveFilterCollapsed } from '../core/galleryFilter'
import { isDesktopApp, openExternal as openExternalUrl } from '../core/openExternal'
import type { Account } from '../core/types'
import { loadWorkshopRoutes, type WorkshopRoute, type WorkshopRouteData } from '../core/workshopChat'
import { loadCaptions, saveCaption, visionTagImage, isVisionModelId, captionMatches, accountVisionRoutes, dedupeVisionRoutes, describeVisionModel, visionRouteModelId, type CaptionRec } from '../core/galleryIndex'
import { isVoiceConfigAccount } from '../core/modelCategories'
import { PROVIDER_MAP } from '../data/providers'
import { fetchProviderModels } from '../core/providerCall'
import { decryptSecret } from '../core/crypto'
import { ToolShell } from './WorkshopView'
import { Pager } from './Pager'

/**
 * AI 图库（v0.1.339 起；v0.1.343 加 AI 索引/搜索 + 侧边栏改首页样式）：苹果照片式图库。
 * 默认看 AI 生成（数据存储·图像/视频文件夹），可切换全部本地媒体；来源含生成目录、
 * Mac 照片图库（.photoslibrary/originals）与自加文件夹。Rust gallery_scan 枚举，
 * qlmanage 出封面，asset 协议播视频。AI 索引：看图模型给缩略图打中文描述+标签存本机
 * IndexedDB，搜索按描述命中。仅桌面端；文件夹/收藏/路线只存本机。
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'dng', 'tif', 'tiff', 'cr2', 'cr3', 'nef', 'arw', 'rw2', 'orf'])
const PLAY_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v'])
const FOLDERS_KEY = 'acm.gallery.folders.v1'
const FAVS_KEY = 'acm.gallery.favs.v1'
const PHOTOS_ON_KEY = 'acm.gallery.photosLib'
const TAG_ROUTE_KEY = 'acm.gallery.tagRoute'

interface GItem { path: string; name: string; size: number; mtime: number; kind: 'image' | 'video'; source: string; ai: boolean; cloud?: boolean; dur?: number }
type GalView = 'ai' | 'all' | 'video' | 'fav'
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
function getInvoke(): InvokeFn | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } }
  return w.__TAURI_INTERNALS__?.invoke ?? null
}
const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : '' }

// ---- 扫描缓存（v0.1.348）：进图库先用上次扫描结果秒开，后台全量刷新完成再替换 ----
const SCAN_DB = 'acm-gallery-scan'
function openScanDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SCAN_DB, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('snap')) req.result.createObjectStore('snap', { keyPath: 'key' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function loadScanCache(key: string): Promise<GItem[] | null> {
  try {
    const db = await openScanDb()
    return await new Promise<GItem[] | null>((resolve) => {
      const rq = db.transaction('snap', 'readonly').objectStore('snap').get(key)
      rq.onsuccess = () => resolve((rq.result as { items?: GItem[] } | undefined)?.items ?? null)
      rq.onerror = () => resolve(null)
    })
  } catch { return null }
}
async function saveScanCache(key: string, items: GItem[]): Promise<void> {
  try {
    const db = await openScanDb()
    db.transaction('snap', 'readwrite').objectStore('snap').put({ key, items, at: Date.now() })
  } catch { /* 缓存失败不影响功能 */ }
}
const baseName = (p: string) => p.split('/').pop() ?? p
function loadList(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}
function saveList(key: string, v: string[]) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 忽略 */ } }
const dayKeyOf = (secs: number) => { const d = new Date(secs * 1000); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
function dayLabelOf(secs: number): string {
  const now = Date.now() / 1000
  if (dayKeyOf(secs) === dayKeyOf(now)) return '今天'
  if (dayKeyOf(secs) === dayKeyOf(now - 86400)) return '昨天'
  const d = new Date(secs * 1000)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`)
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function GalleryView({ accounts, sessionPwd, notify, onBack }: {
  accounts: Account[]
  sessionPwd: string
  notify: (msg: string) => void
  onBack: () => void
}) {
  const desktop = isDesktopApp()
  const mediaDir = useMemo(() => { try { return storageDir('media', loadStoragePrefs()) } catch { return null } }, [])
  const [folders, setFolders] = useState<string[]>(() => loadList(FOLDERS_KEY))
  const [photosDir, setPhotosDir] = useState<string | null>(null)
  const [photosOn, setPhotosOn] = useState(() => { try { return localStorage.getItem(PHOTOS_ON_KEY) !== '0' } catch { return true } })
  const [favs, setFavs] = useState<Set<string>>(() => new Set(loadList(FAVS_KEY)))
  const [items, setItems] = useState<GItem[]>([])
  const [scanning, setScanning] = useState(false)
  const [view, setView] = useState<GalView>(mediaDir ? 'ai' : 'all')
  const [zoom, setZoom] = useState<'s' | 'm' | 'l'>('m')
  const [galPage, setGalPage] = useState(1)
  const galMainRef = useRef<HTMLDivElement>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const thumbBusy = useRef(new Set<string>())
  const thumbCache = useRef(new Map<string, string>())
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(new Map())
  const assetBusy = useRef(new Set<string>())
  const [hoverVideo, setHoverVideo] = useState<{ path: string; x: number; y: number } | null>(null)
  const hoverTimer = useRef<number | null>(null)
  // AI 索引/搜索
  const [captions, setCaptions] = useState<Map<string, CaptionRec>>(new Map())
  const [routeData, setRouteData] = useState<WorkshopRouteData | null>(null)
  const [tagRouteKey, setTagRouteKey] = useState(() => { try { return localStorage.getItem(TAG_ROUTE_KEY) ?? '' } catch { return '' } })
  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null)
  const cancelRef = useRef(false)
  const [query, setQuery] = useState('')
  const [photosDbFailed, setPhotosDbFailed] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  // 横向筛选条折叠（v0.1.388）：收起后只剩开关 + 类型 chips，本机记忆
  const [filterCollapsed, setFilterCollapsed] = useState(() => loadFilterCollapsed())
  const toggleFilterCollapsed = () => {
    setFilterCollapsed(prev => { const next = !prev; saveFilterCollapsed(next); return next })
  }

  const scan = useCallback(async () => {
    const invoke = getInvoke()
    if (!invoke) return
    setScanning(true)
    try {
      const sources: { dir: string; label: string; ai: boolean }[] = []
      if (mediaDir) sources.push({ dir: mediaDir, label: 'AI 生成', ai: true })
      for (const f of folders) if (f !== mediaDir && f !== photosDir) sources.push({ dir: f, label: baseName(f), ai: false })
      const byPath = new Map<string, GItem>()
      // 照片图库：优先读 Photos 数据库全量列出（含只在 iCloud 云端的项），读不到再回退扫 originals 文件夹
      let photosDbOk = false
      if (photosDir && photosOn && photosDir !== mediaDir) {
        try {
          const res = (await invoke('photos_db_assets')) as { assets?: { name: string; dir: string; created: number; kind: string; dur: number; local: boolean; size: number }[] }
          if (res && Array.isArray(res.assets) && res.assets.length > 0) {
            photosDbOk = true
            for (const a of res.assets) {
              const path = `${photosDir}/${a.dir}/${a.name}`
              if (byPath.has(path)) continue
              byPath.set(path, {
                path, name: a.name, size: a.size || 0, mtime: a.created,
                kind: a.kind === 'video' ? 'video' : 'image',
                source: '照片图库', ai: false, cloud: !a.local, dur: a.dur || 0,
              })
            }
          }
        } catch { /* 回退文件夹扫描 */ }
        if (!photosDbOk) sources.push({ dir: photosDir, label: '照片图库', ai: false })
      }
      setPhotosDbFailed(!!(photosDir && photosOn && !photosDbOk))
      for (const src of sources) {
        try {
          const raw = (await invoke('gallery_scan', { dir: src.dir })) as { path: string; size: number; mtime: number }[]
          for (const r of raw) {
            if (byPath.has(r.path)) continue
            const name = baseName(r.path)
            byPath.set(r.path, {
              path: r.path, name, size: r.size, mtime: r.mtime,
              kind: IMAGE_EXTS.has(extOf(name)) ? 'image' : 'video',
              source: src.label, ai: src.ai,
            })
          }
        } catch { /* 单个来源失败忽略 */ }
      }
      const merged = [...byPath.values()].sort((a, b) => b.mtime - a.mtime)
      setItems(merged)
      fullScannedRef.current = true
      void saveScanCache(scanKey, merged)
    } finally { setScanning(false) }
  }, [folders, mediaDir, photosDir, photosOn])

  const scanKey = useMemo(() => [mediaDir ?? '', photosOn ? (photosDir ?? '') : '', ...folders].join('|'),
    [mediaDir, photosDir, photosOn, folders])
  const fullScannedRef = useRef(false)
  useEffect(() => {
    if (!desktop) return
    let dead = false
    void loadScanCache(scanKey).then(cached => {
      // 全量扫描还没回来时，先用缓存秒开
      if (!dead && cached && cached.length > 0 && !fullScannedRef.current) {
        setItems([...cached].sort((a, b) => b.mtime - a.mtime))
      }
    })
    return () => { dead = true }
  }, [desktop, scanKey])
  useEffect(() => { if (desktop) void scan() }, [desktop, scan])
  useEffect(() => {
    if (!desktop) return
    const invoke = getInvoke()
    if (!invoke) return
    void invoke('photos_library_dir').then(v => setPhotosDir(typeof v === 'string' ? v : null)).catch(() => {})
  }, [desktop])
  useEffect(() => { setGalPage(1) }, [view, query, photosOn, folders])
  useEffect(() => { void loadCaptions().then(setCaptions) }, [])
  useEffect(() => {
    let dead = false
    void loadWorkshopRoutes(accounts).then(d => { if (!dead) setRouteData(d) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length])

  const [acctVisionRoutes, setAcctVisionRoutes] = useState<WorkshopRoute[]>([])
  const [acctEnum, setAcctEnum] = useState<{ loading: boolean; errors: string[] }>({ loading: false, errors: [] })
  const acctFetchedRef = useRef(new Set<string>())
  const acctFailedRef = useRef(new Set<string>())
  // 自有账户看图模型枚举（v0.1.355 重做）：不再套工坊账户的分类/能力门槛——
  // 只要有保存的密钥、非本地非语音配置就逐个拉模型列表，能不能看图由模型名决定；
  // 拉取状态与失败原因直接显示在弹层里，不再静默跳过；失败的账户下次打开弹层自动重试。
  const enumerateAcctModels = useCallback(async (retryFailed: boolean) => {
    if (!sessionPwd) return
    const candidates = accounts.filter(a =>
      !!a.encryptedKey && !a.providerId?.startsWith('local-') && !isVoiceConfigAccount(a.providerId, a.note)
      && !acctFetchedRef.current.has(a.id) && (retryFailed || !acctFailedRef.current.has(a.id)))
    if (!candidates.length) return
    setAcctEnum(e => ({ ...e, loading: true }))
    const errors: string[] = []
    for (const acct of candidates) {
      try {
        const key = await decryptSecret(acct.encryptedKey!, sessionPwd)
        const models = await fetchProviderModels(acct, key)
        acctFetchedRef.current.add(acct.id)
        acctFailedRef.current.delete(acct.id)
        const routes = accountVisionRoutes(acct, models)
        if (routes.length) setAcctVisionRoutes(prev => [...prev.filter(r => r.kind !== 'account' || r.accountId !== acct.id), ...routes])
      } catch (e) {
        acctFailedRef.current.add(acct.id)
        errors.push(`${PROVIDER_MAP[acct.providerId]?.name ?? acct.providerId}：${((e as Error)?.message ?? String(e)).slice(0, 60)}`)
      }
    }
    setAcctEnum({ loading: false, errors })
  }, [accounts, sessionPwd])
  useEffect(() => { void enumerateAcctModels(false) }, [enumerateAcctModels])
  useEffect(() => { if (aiPanelOpen) void enumerateAcctModels(true) }, [aiPanelOpen, enumerateAcctModels])

  const visionRoutes = useMemo<WorkshopRoute[]>(() => {
    if (!routeData) return []
    const base = routeData.routes.filter(r => {
      if (r.kind === 'free') {
        const opt = routeData.freeOptions.find(o => `free:${o.key}` === r.key)
        return !!opt && opt.source !== 'cloud' && isVisionModelId(opt.modelId)
      }
      if (r.kind !== 'account') return false
      const acct = accounts.find(a => a.id === r.accountId)
      return !!acct && isVisionModelId(acct.label)
    })
    // v0.1.393：基础路线与逐账户枚举可能列出同一模型（或同一账户被加两次），按 label 去重
    return dedupeVisionRoutes([...base, ...acctVisionRoutes])
  }, [routeData, accounts, acctVisionRoutes])
  const tagRoute: WorkshopRoute | null = visionRoutes.find(r => r.key === tagRouteKey) ?? visionRoutes[0] ?? null
  const visionData: WorkshopRouteData | null = routeData ? { routes: visionRoutes, freeOptions: routeData.freeOptions } : null
  // 菜单里去重后的自有看图模型数（v0.1.393：提示文案用去重后的数，别把重复的也算进去）
  const acctVisionShown = visionRoutes.filter(r => r.kind === 'account').length

  const viewFiltered = useMemo(() => items.filter(i =>
    view === 'all' ? true : view === 'ai' ? i.ai : view === 'video' ? i.kind === 'video' : favs.has(i.path),
  ), [items, view, favs])
  const searching = query.trim().length > 0
  const displayItems = useMemo(() => searching
    ? items.filter(i => captionMatches(i.name, captions.get(i.path)?.text, query))
    : viewFiltered, [searching, items, captions, query, viewFiltered])
  const GAL_PAGE_SIZE = 120
  const galPageCount = Math.max(1, Math.ceil(displayItems.length / GAL_PAGE_SIZE))
  const safeGalPage = Math.min(galPage, galPageCount)
  const visible = displayItems.slice((safeGalPage - 1) * GAL_PAGE_SIZE, safeGalPage * GAL_PAGE_SIZE)
  const groups = useMemo(() => {
    const out: { key: string; label: string; entries: { item: GItem; idx: number }[] }[] = []
    visible.forEach(item => {
      const idx = displayItems.indexOf(item)
      const key = searching ? 'search' : dayKeyOf(item.mtime)
      const last = out[out.length - 1]
      if (last && last.key === key) last.entries.push({ item, idx })
      else out.push({ key, label: searching ? `搜索「${query.trim()}」` : dayLabelOf(item.mtime), entries: [{ item, idx }] })
    })
    return out
  }, [visible, displayItems, searching, query])

  const indexedCount = useMemo(() => items.filter(i => !i.cloud && captions.get(i.path)?.mtime === i.mtime).length, [items, captions])
  const pendingCount = useMemo(() => items.filter(i => !i.cloud && captions.get(i.path)?.mtime !== i.mtime).length, [items, captions])

  const ensureThumb = useCallback(async (path: string) => {
    if (thumbs.has(path) || thumbBusy.current.has(path)) return
    thumbBusy.current.add(path)
    try {
      const invoke = getInvoke()
      if (!invoke) return
      const url = (await invoke('media_thumb', { path })) as string
      if (url) { thumbCache.current.set(path, url); setThumbs(prev => new Map(prev).set(path, url)) }
    } catch { /* 生成失败回落占位 */ } finally { thumbBusy.current.delete(path) }
  }, [thumbs])

  const ensureAssetUrl = useCallback(async (path: string) => {
    if (assetUrls.has(path) || assetBusy.current.has(path)) return
    assetBusy.current.add(path)
    try {
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      setAssetUrls(prev => new Map(prev).set(path, convertFileSrc(path)))
    } catch { /* 非桌面端忽略 */ } finally { assetBusy.current.delete(path) }
  }, [assetUrls])

  const getThumbDataUrl = useCallback(async (path: string): Promise<string> => {
    const hit = thumbCache.current.get(path) ?? thumbs.get(path)
    if (hit) return hit
    const invoke = getInvoke()
    if (!invoke) throw new Error('仅桌面端可用')
    const url = (await invoke('media_thumb', { path })) as string
    if (!url) throw new Error('取不到这张图的缩略图')
    thumbCache.current.set(path, url)
    return url
  }, [thumbs])

  /** 索引：all=false 只跑一批 60 个；all=true 自动分批跑完剩余全部（v0.1.350）：
   * 连续失败先退避等待 20 秒再继续（多半是免费模型限流），退避 3 轮仍不行才停 */
  const runIndex = async (all: boolean) => {
    if (!tagRoute || !routeData) { notify('先选一个能看图的模型（带看图能力的免费模型或自有账户）'); return }
    const pendingAll = items.filter(i => !i.cloud && captions.get(i.path)?.mtime !== i.mtime)
    const pending = all ? pendingAll : pendingAll.slice(0, 60)
    if (pending.length === 0) { notify('都索引过了，没有新增或变化的'); return }
    cancelRef.current = false
    setIndexing({ done: 0, total: pending.length })
    let ok = 0
    let fail = 0
    let consec = 0
    let backoffs = 0
    let lastErr = ''
    // 3 路并行（v0.1.353）：单张要等一次模型往返，串行太慢；3 个 worker 抢同一队列。
    // 限流退避改为全局暂停点：任一 worker 触发，所有 worker 一起等，避免越限越狠。
    let cursor = 0
    let stopAll = false
    let pauseUntil = 0
    const sleepCancellable = async (ms: number) => {
      for (let t = 0; t < ms && !cancelRef.current; t += 500) {
        await new Promise(r => setTimeout(r, Math.min(500, ms - t)))
      }
    }
    const worker = async () => {
      for (;;) {
        if (cancelRef.current || stopAll) return
        const wait = pauseUntil - Date.now()
        if (wait > 0) { await sleepCancellable(wait); continue }
        const idx = cursor++
        if (idx >= pending.length) return
        const item = pending[idx]
        try {
          const url = await getThumbDataUrl(item.path)
          const text = await visionTagImage({ route: tagRoute, freeOptions: routeData.freeOptions, accounts, sessionPwd, imageDataUrl: url })
          const rec: CaptionRec = { path: item.path, mtime: item.mtime, text, model: tagRoute.label, at: Date.now() }
          await saveCaption(rec)
          setCaptions(prev => new Map(prev).set(item.path, rec))
          ok++
          consec = 0
        } catch (e) {
          fail++
          consec++
          lastErr = (e as Error)?.message ?? String(e)
          if (consec >= 5) {
            if (!all || backoffs >= 3) stopAll = true
            else {
              backoffs++
              consec = 0
              pauseUntil = Date.now() + 20000
              notify(`模型可能被限流，暂停 20 秒后继续（第 ${backoffs} 次退避）`)
            }
          }
        }
        setIndexing({ done: ok + fail, total: pending.length })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setIndexing(null)
    if (cancelRef.current) notify(`已停止：这次索引了 ${ok} 个`)
    else if (ok === 0 && fail > 0) notify(`索引失败：${lastErr.slice(0, 70)}`)
    else notify(`AI 索引完成：新增 ${ok} 个${fail ? `，失败 ${fail} 个` : ''}`)
  }

  const toggleFav = (path: string) => setFavs(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path); else next.add(path)
    saveList(FAVS_KEY, [...next])
    return next
  })

  const addFolder = async () => {
    const invoke = getInvoke()
    if (!invoke) return
    try {
      const picked = (await invoke('choose_save_dir')) as string | null
      if (!picked || folders.includes(picked) || picked === mediaDir) return
      const next = [...folders, picked]
      setFolders(next)
      saveList(FOLDERS_KEY, next)
    } catch { /* 取消选择忽略 */ }
  }
  const removeFolder = (dir: string) => {
    const next = folders.filter(f => f !== dir)
    setFolders(next)
    saveList(FOLDERS_KEY, next)
  }

  const counts = useMemo(() => ({
    ai: items.filter(i => i.ai).length,
    all: items.length,
    video: items.filter(i => i.kind === 'video').length,
    fav: items.filter(i => favs.has(i.path)).length,
  }), [items, favs])

  if (!desktop) {
    return (
      <ToolShell title="AI 图库" desc="苹果照片式的本地图库：AI 生成与本地照片视频按日期浏览。" onBack={onBack}>
        <div className="ws-result">AI 图库看的是这台电脑上的本地文件，仅桌面端可用。</div>
      </ToolShell>
    )
  }

  const lbItem = lightbox !== null ? displayItems[lightbox] : undefined
  const viewTitle = searching ? '搜索结果' : view === 'ai' ? 'AI 生成' : view === 'all' ? '全部媒体' : view === 'video' ? '视频' : '收藏'

  return (
    <ToolShell title="AI 图库" desc="苹果照片式图库：默认看 AI 生成的图和视频，也能把任意本地文件夹加进来一起看；建好 AI 索引后能按画面内容搜。" onBack={onBack}>
      <div className="gal-wrap">

        <div className="gal-main" ref={galMainRef}>
          <div className="gal-bar">
            <span className="gal-bar-title">
              {viewTitle}
              <small>{displayItems.length} 项{scanning ? ' · 扫描中…' : ''}</small>
            </span>
            <span className="gal-search">
              <Search size={14} />
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="搜文件名，或 AI 描述（如：海边 日落）" />
              {query && <button className="gal-search-x" onClick={() => setQuery('')}><X size={13} /></button>}
            </span>
            <span className="gal-zoom">
              {(['s', 'm', 'l'] as const).map(z => (
                <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>{z === 's' ? '小' : z === 'm' ? '中' : '大'}</button>
              ))}
            </span>
            <button className={`gal-ai-chip ${aiPanelOpen ? 'on' : ''}`} onClick={() => setAiPanelOpen(o => !o)}>
              <Sparkles size={13} /> AI 索引{indexing ? ` · ${indexing.done}/${indexing.total}` : ''}
            </button>
          </div>
          <div className="gal-filter">
            <div className="gal-filter-scroll">
              <button className="gal-filter-toggle" onClick={toggleFilterCollapsed} title={filterCollapsed ? '展开筛选条' : '收起筛选条'}>
                <SlidersHorizontal size={13} /> 筛选 {filterCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
              <div className="gal-filter-seg">
                {([
                  { id: 'ai' as GalView, label: 'AI 生成', n: counts.ai, icon: <Sparkles size={14} /> },
                  { id: 'all' as GalView, label: '全部媒体', n: counts.all, icon: <Images size={14} /> },
                  { id: 'video' as GalView, label: '视频', n: counts.video, icon: <Clapperboard size={14} /> },
                  { id: 'fav' as GalView, label: '收藏', n: counts.fav, icon: <Heart size={14} /> },
                ]).map(v => (
                  <button key={v.id} className={`gal-chip ${view === v.id && !searching ? 'on' : ''}`} onClick={() => { setView(v.id); setQuery('') }}>
                    {v.icon}<span>{v.label}</span><span className="gal-chip-n">{v.n}</span>
                  </button>
                ))}
              </div>
              {!filterCollapsed && (
                <>
                  <span className="gal-filter-sep" />
                  <div className="gal-filter-seg gal-filter-seg-src">
                    <span className="gal-filter-seg-t">来源</span>
                    {mediaDir
                      ? (
                        <span className="gal-src2" title={mediaDir}>
                          <span className="gal-side-ico sm"><FolderOpen size={14} /></span>
                          <span className="gal-src-main">生成保存目录<span className="gal-src-path2">{baseName(mediaDir)}</span></span>
                        </span>
                      )
                      : <span className="gal-src-none">未设置生成保存目录</span>}
                    {photosDir ? (
                      <span className="gal-src2" title={photosDir}>
                        <span className="gal-side-ico sm"><Images size={14} /></span>
                        <span className="gal-src-main">Mac 照片图库<span className="gal-src-path2">{baseName(photosDir)}</span></span>
                        <button className={`gal-switch ${photosOn ? 'on' : ''}`} title={photosOn ? '点击关闭这个来源' : '点击启用这个来源'}
                          onClick={() => { const next = !photosOn; setPhotosOn(next); try { localStorage.setItem(PHOTOS_ON_KEY, next ? '1' : '0') } catch { /* 忽略 */ } }}>
                          <span className="gal-switch-dot" />
                        </button>
                      </span>
                    ) : (
                      <span className="gal-src-none">未找到 Mac 照片图库</span>
                    )}
                    {folders.filter(f => f !== mediaDir && f !== photosDir).map(f => (
                      <span key={f} className="gal-src2" title={f}>
                        <span className="gal-side-ico sm"><Folder size={14} /></span>
                        <span className="gal-src-main">{baseName(f)}</span>
                        <button className="gal-src-x" title="移除这个来源" onClick={() => removeFolder(f)}><X size={12} /></button>
                      </span>
                    ))}
                    <button className="btn sm ghost" onClick={() => void addFolder()}>
                      <FolderPlus size={13} /> 添加文件夹
                    </button>
                  </div>
                  <span className="gal-filter-sep" />
                  <div className="gal-ai-mini" onClick={() => setAiPanelOpen(o => !o)} role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAiPanelOpen(o => !o) } }}>
                    <span className="gal-ai-mini-main">
                      <span className="gal-ai-mini-t"><Sparkles size={13} /> AI 索引</span>
                      <span className="gal-ai-mini-s">{indexing ? `正在索引 ${indexing.done} / ${indexing.total}` : `已索引 ${indexedCount} / ${items.length}`}</span>
                      <span className="gal-prog"><i style={{ width: `${indexing && indexing.total ? (indexing.done / indexing.total) * 100 : items.length ? (indexedCount / items.length) * 100 : 0}%` }} /></span>
                    </span>
                    <button className="btn sm" disabled={items.length === 0 || (!indexing && !tagRoute)}
                      onClick={e => { e.stopPropagation(); if (indexing) cancelRef.current = true; else void runIndex(false) }}>
                      {indexing ? '停止' : '更新 AI 索引'}
                    </button>
                  </div>
                </>
              )}
            </div>
          {aiPanelOpen && (
            <div className="gal-ai-pop">
              <div className="gal-ai-pop-t">
                <Sparkles size={14} /> AI 索引
                <button className="gal-ai-pop-x" onClick={() => setAiPanelOpen(false)}><X size={14} /></button>
              </div>
              <GalModelSelect routes={visionRoutes} freeOptions={visionData?.freeOptions ?? []}
                routeKey={tagRoute?.key ?? ''} setRouteKey={k => {
                  setTagRouteKey(k)
                  try { localStorage.setItem(TAG_ROUTE_KEY, k) } catch { /* 忽略 */ }
                }} />
              {routeData && visionRoutes.length === 0 && (
                <div className="gal-idx-hint">没有能看图的模型：免费模型里挑带「看图」的，或用支持多模态的自有账户。</div>
              )}
              {routeData && !sessionPwd && (
                <div className="gal-idx-hint">想用自有账户：先解锁保险箱，这里会自动列出你每个账户下能看图的模型（逐个模型可选）。</div>
              )}
              {routeData && sessionPwd && acctEnum.loading && (
                <div className="gal-idx-hint">正在读取自有账户的模型列表…</div>
              )}
              {routeData && sessionPwd && !acctEnum.loading && acctVisionShown > 0 && (
                <div className="gal-idx-hint">已列出自有账户的看图模型 {acctVisionShown} 个，在上方菜单里选「自有 · …」即可用。</div>
              )}
              {routeData && sessionPwd && !acctEnum.loading && acctEnum.errors.length > 0 && (
                <div className="gal-idx-hint">有账户的模型列表没拉到：{acctEnum.errors.join('；')}</div>
              )}
              <div className="gal-idx-status">
                已索引 {indexedCount} / {items.length} 个
                {pendingCount > 0 && indexing === null ? `，待索引 ${pendingCount} 个` : ''}
              </div>
              {indexing
                ? (
                  <>
                    <div className="gal-prog"><i style={{ width: `${indexing.total ? (indexing.done / indexing.total) * 100 : 0}%` }} /></div>
                    <button className="btn" onClick={() => { cancelRef.current = true }}>
                      <Square size={12} /> 停止（{indexing.done}/{indexing.total}）
                    </button>
                  </>
                )
                : (
                  <button className="btn primary gal-ai-pop-btn" onClick={() => void runIndex(false)} disabled={items.length === 0 || !tagRoute}>
                    <ScanSearch size={13} /> {indexedCount === 0 ? '建立 AI 索引' : '更新 AI 索引'}
                  </button>
                )}
              {!indexing && pendingCount > 60 && (
                <button className="btn gal-ai-pop-btn" onClick={() => void runIndex(true)} disabled={items.length === 0 || !tagRoute}>
                  索引全部（还剩 {pendingCount} 个，自动分批跑完）
                </button>
              )}
              <div className="gal-idx-hint">用看图模型给每张图/视频首帧写描述和标签，之后搜「海边」「猫」就能按画面内容找。普通更新每次 60 个；「索引全部」自动一批接一批，3 个同时进行，模型限流时自动等 20 秒再继续。云端项需先下载到本机。</div>
            </div>
          )}
          </div>
          {photosDbFailed && (
            <div className="gal-search-hint">
              没读到照片数据库（多半是还没给 AI 魔方照片权限），现在只显示本地已下载的文件。
              <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => void openExternalUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_Photos')}>打开照片权限设置</button>
            </div>
          )}
          {searching && indexedCount === 0 && (
            <div className="gal-search-hint">还没有 AI 索引，现在只能按文件名搜。点右上角「AI 索引」建好后，就能按画面内容搜了。</div>
          )}

          {scanning && items.length === 0 && <div className="ws-result"><Loader2 size={16} className="spin" /> 正在扫描文件夹…</div>}
          {!scanning && displayItems.length === 0 && (
            <div className="ws-result">
              {searching
                ? '没有找到匹配的照片或视频。换个词试试，或先把 AI 索引建全。'
                : view === 'ai'
                  ? '还没有 AI 生成保存下来的文件。生图/生视频后会自动存到生成保存目录，这里就会出现。'
                  : view === 'fav' ? '还没有收藏。点开任意图片/视频，点爱心就能收进来。'
                    : '这个视图暂时是空的。点上方筛选条里的「添加文件夹」把有照片视频的文件夹加进来。'}
            </div>
          )}

          {groups.map(g => (
            <div key={g.key}>
              <div className="gal-dhead">{g.label}<span>{g.entries.length} 项</span></div>
              <div className={`gal-grid z${zoom}`}>
                {g.entries.map(({ item, idx }) => (
                  <GalTile key={item.path} item={item} fav={favs.has(item.path)}
                    thumb={thumbs.get(item.path)} assetUrl={assetUrls.get(item.path)}
                    ensureThumb={ensureThumb} ensureAssetUrl={ensureAssetUrl}
                    onOpen={() => setLightbox(idx)}
                    onHoverVideo={(path, x, y) => {
                      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
                      hoverTimer.current = window.setTimeout(() => setHoverVideo({ path, x, y }), 200)
                    }}
                    onHoverEnd={() => {
                      if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null }
                      setHoverVideo(null)
                    }} />
                ))}
              </div>
            </div>
          ))}
          <div className="gal-pager-sticky">
            <Pager page={safeGalPage} pageCount={galPageCount} total={displayItems.length}
              onPage={n => { setGalPage(n); galMainRef.current?.scrollIntoView({ block: 'start' }) }} />
          </div>
        </div>
      </div>

      {hoverVideo && assetUrls.get(hoverVideo.path) && (
        <video className="fm-hover-video" src={assetUrls.get(hoverVideo.path)} autoPlay muted loop playsInline
          style={{ left: hoverVideo.x, top: hoverVideo.y }} />
      )}

      {lbItem && (
        <GalLightbox item={lbItem} index={lightbox!} total={displayItems.length} fav={favs.has(lbItem.path)}
          caption={captions.get(lbItem.path)?.mtime === lbItem.mtime ? captions.get(lbItem.path)?.text : undefined}
          assetUrl={assetUrls.get(lbItem.path)} thumb={thumbs.get(lbItem.path)}
          ensureAssetUrl={ensureAssetUrl} ensureThumb={ensureThumb}
          onClose={() => setLightbox(null)}
          onNav={d => setLightbox(i => (i === null ? null : Math.min(displayItems.length - 1, Math.max(0, i + d))))}
          onToggleFav={() => toggleFav(lbItem.path)}
          notify={notify} />
      )}
    </ToolShell>
  )
}

/** AI 索引模型选择（v0.1.393）：原生 <select> 的选项放不下简介，改自定义下拉，
 * 每行同时显示模型名与一句话简介；收起时也在下方显示已选模型的简介。 */
function GalModelSelect({ routes, freeOptions, routeKey, setRouteKey }: {
  routes: WorkshopRoute[]
  freeOptions: WorkshopRouteData['freeOptions']
  routeKey: string
  setRouteKey: (k: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cur = routes.find(r => r.key === routeKey) ?? null
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="gal-modelsel" ref={wrapRef}>
      <span className="gal-modelsel-l">使用模型</span>
      <button type="button" className="gal-modelsel-btn" disabled={routes.length === 0}
        aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="gal-modelsel-cur">{cur ? cur.label : routes.length === 0 ? '无可用模型（先在 AI 助手登录云账号或添加账户）' : '请选择模型'}</span>
        <ChevronDown size={14} className={open ? 'gal-modelsel-chev open' : 'gal-modelsel-chev'} />
      </button>
      {cur && <div className="gal-model-intro">{describeVisionModel(visionRouteModelId(cur, freeOptions))}</div>}
      {open && routes.length > 0 && (
        <div className="gal-modelsel-list" role="listbox" aria-label="看图模型">
          {routes.map(r => (
            <button type="button" key={r.key} role="option" aria-selected={r.key === routeKey}
              className={`gal-modelsel-opt ${r.key === routeKey ? 'on' : ''}`}
              onClick={() => { setRouteKey(r.key); setOpen(false) }}>
              <span className="gal-modelsel-opt-l">{r.label}</span>
              <span className="gal-modelsel-opt-d">{describeVisionModel(visionRouteModelId(r, freeOptions))}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GalTile({ item, fav, thumb, assetUrl, ensureThumb, ensureAssetUrl, onOpen, onHoverVideo, onHoverEnd }: {
  item: GItem
  fav: boolean
  thumb?: string
  assetUrl?: string
  ensureThumb: (p: string) => void
  ensureAssetUrl: (p: string) => void
  onOpen: () => void
  onHoverVideo: (path: string, x: number, y: number) => void
  onHoverEnd: () => void
}) {
  const [dur, setDur] = useState(0)
  const playable = !item.cloud && item.kind === 'video' && PLAY_VIDEO_EXTS.has(extOf(item.name))
  useEffect(() => {
    if (item.cloud) return
    ensureThumb(item.path)
    if (playable) ensureAssetUrl(item.path)
  }, [item.path, item.cloud, playable, ensureThumb, ensureAssetUrl])

  return (
    <button className="gal-tile" onClick={onOpen}
      onMouseEnter={ev => {
        if (!playable) return
        ensureAssetUrl(item.path)
        const r = ev.currentTarget.getBoundingClientRect()
        onHoverVideo(item.path, Math.min(r.right + 10, window.innerWidth - 372), Math.max(8, r.top - 10))
      }}
      onMouseLeave={() => { if (playable) onHoverEnd() }}>
      {item.cloud
        ? <span className="gal-ph"><Cloud size={26} /></span>
        : thumb
        ? <img className="gal-media" src={thumb} alt={item.name} loading="lazy" />
        : playable && assetUrl
          ? <video className="gal-media" src={assetUrl} preload="metadata" muted playsInline
              onLoadedMetadata={e => { setDur(e.currentTarget.duration || 0); try { e.currentTarget.currentTime = 0.1 } catch { /* 忽略 */ } }} />
          : <span className="gal-ph">{item.kind === 'video' ? <Film size={26} /> : <ImageIcon size={26} />}</span>}
      {playable && assetUrl && thumb && (
        <video src={assetUrl} preload="metadata" muted playsInline style={{ display: 'none' }}
          onLoadedMetadata={e => setDur(e.currentTarget.duration || 0)} />
      )}
      {item.kind === 'video' && (
        <span className="gal-bdg"><Play size={10} /> {dur > 0 ? fmtDur(dur) : item.dur ? fmtDur(item.dur) : '视频'}</span>
      )}
      {item.cloud && <span className="gal-cloud-bdg"><Cloud size={10} /> iCloud 云端</span>}
      {item.ai && <span className="gal-src-tag">AI</span>}
      {fav && <span className="gal-fav"><Heart size={12} fill="currentColor" /></span>}
    </button>
  )
}

function GalLightbox({ item, index, total, fav, caption, assetUrl, thumb, ensureAssetUrl, ensureThumb, onClose, onNav, onToggleFav, notify }: {
  item: GItem
  index: number
  total: number
  fav: boolean
  caption?: string
  assetUrl?: string
  thumb?: string
  ensureAssetUrl: (p: string) => void
  ensureThumb: (p: string) => void
  onClose: () => void
  onNav: (d: number) => void
  onToggleFav: () => void
  notify: (m: string) => void
}) {
  const playable = !item.cloud && item.kind === 'video' && PLAY_VIDEO_EXTS.has(extOf(item.name))
  useEffect(() => {
    if (item.cloud) return
    if (item.kind === 'image' || playable) ensureAssetUrl(item.path)
    else ensureThumb(item.path)
  }, [item.path, item.kind, item.cloud, playable, ensureAssetUrl, ensureThumb])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onNav(-1)
      else if (e.key === 'ArrowRight') onNav(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNav])

  const openExternal = async () => {
    const invoke = getInvoke()
    if (!invoke) return
    try { await invoke('open_external_path', { path: item.path }) } catch { notify('打开失败') }
  }

  return (
    <div className="gal-lb" onClick={onClose}>
      <div className="gal-lb-top" onClick={e => e.stopPropagation()}>
        <span>{index + 1} / {total} · {item.name}</span>
        <button className="gal-lb-x" onClick={onClose}><X size={18} /></button>
      </div>
      <button className="gal-lb-nav left" onClick={e => { e.stopPropagation(); onNav(-1) }} disabled={index <= 0}><ChevronLeft size={22} /></button>
      <div className="gal-lb-body" onClick={e => e.stopPropagation()}>
        {item.cloud ? (
          <div className="gal-lb-wait" style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.7 }}>
            <Cloud size={28} style={{ display: 'block', margin: '0 auto 8px' }} />
            这一项只在 iCloud 云端，本机还没有原文件。<br />
            在照片 App 里打开它一次（照片会自动下载原图），回到图库点刷新就能看了。
          </div>
        ) : (
        item.kind === 'image'
          ? (assetUrl
            ? <img className="gal-lb-media" src={assetUrl} alt={item.name} />
            : <div className="gal-lb-wait"><Loader2 size={20} className="spin" /> 加载中…</div>)
          : playable
            ? (assetUrl
              ? <video className="gal-lb-media" src={assetUrl} controls autoPlay />
              : <div className="gal-lb-wait"><Loader2 size={20} className="spin" /> 正在准备播放…</div>)
            : (thumb
              ? <img className="gal-lb-media" src={thumb} alt={item.name} />
              : <div className="gal-lb-wait">此格式应用内不能直接播放，点下方「打开」用系统播放器看</div>))}
      </div>
      <button className="gal-lb-nav right" onClick={e => { e.stopPropagation(); onNav(1) }} disabled={index >= total - 1}><ChevronRight size={22} /></button>
      <div className="gal-lb-bar" onClick={e => e.stopPropagation()}>
        <span className="gal-lb-info">
          {new Date(item.mtime * 1000).toLocaleString()} · {fmtSize(item.size)} · 来源：{item.source}
          {caption && <span className="gal-lb-cap">AI 描述：{caption.replace(/\n/g, ' ')}</span>}
          <span className="gal-lb-path">{item.path}</span>
        </span>
        <span className="gal-lb-actions">
          <button className={`btn sm ${fav ? 'primary' : ''}`} onClick={onToggleFav}>
            <Heart size={13} fill={fav ? 'currentColor' : 'none'} /> {fav ? '已收藏' : '收藏'}
          </button>
          <button className="btn sm" onClick={() => void navigator.clipboard?.writeText(item.path).then(() => notify('路径已复制')).catch(() => {})}>
            <Copy size={13} /> 复制路径
          </button>
          <button className="btn sm" onClick={() => void openExternal()}><ExternalLink size={13} /> 打开</button>
        </span>
      </div>
    </div>
  )
}
