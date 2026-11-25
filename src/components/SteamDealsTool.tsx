// 工坊 · Steam 降价（v0.1.399）：Steam 商店当前打折游戏，按折扣排序。
// 数据来源：Steam 商店公开接口（免 Key），价格以 Steam 返回的为准，不编造；
// 拉不到时明确显示原因，不静默兜底。样式沿用免费游戏卡片（fg-card 系）与看剧 chips。
import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Gamepad2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { ToolShell } from './WorkshopView'
import { Pager } from './Pager'
import {
  loadSteamCache, isSteamCacheFresh, loadSteamDeals, loadMoreSteamDeals,
  sortSteamDeals, enrichSteamPackages, dealKey,
  type SteamDeal, type SteamDealsCache, type SteamSort,
} from '../core/steamDeals'
import { openExternal, isDesktopApp } from '../core/openExternal'
import { steamClientUrlOfDeal, openViaClient } from '../core/clientLinks'

const PAGE_SIZE = 12

const SORTS: { key: SteamSort; label: string }[] = [
  { key: 'discount', label: '折扣最高' },
  { key: 'review', label: '好评最高' },
  { key: 'price', label: '价格最低' },
]

type KindFilter = 'all' | 'game' | 'package'

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function DealCard({ deal, onOpen }: { deal: SteamDeal; onOpen: (d: SteamDeal) => void }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <div className="sd-card" role="button" tabIndex={0} title="点击在 Steam 客户端打开商店页（没装客户端时走浏览器）"
      onClick={() => onOpen(deal)}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(deal) }}>
      <div className="sd-cover">
        {deal.imageUrl && imgOk
          ? <img src={deal.imageUrl} alt={deal.title} loading="lazy" onError={() => setImgOk(false)} />
          : <span className="sd-cover-fallback"><Gamepad2 size={26} /></span>}
        <span className="sd-badge">-{deal.discountPct}%</span>
        {deal.kind === 'package' && <span className="sd-badge-pkg">合集包</span>}
      </div>
      <div className="sd-card-body">
        <div className="sd-card-title">{deal.title}</div>
        {deal.kind === 'package' && deal.contents && deal.contents.length > 0 && (
          <div className="sd-card-meta">包含：{deal.contents.slice(0, 3).join('、')}{deal.contents.length > 3 ? ` 等 ${deal.contents.length} 款` : ''}</div>
        )}
        <div className="sd-card-meta">
          {deal.originalPrice && <s>{deal.originalPrice}</s>} <b className="sd-price">{deal.finalPrice}</b>
        </div>
        <div className="sd-card-meta">
          {deal.reviewPct !== undefined
            ? <span>好评率 {deal.reviewPct}%{deal.reviewLabel ? ` · ${deal.reviewLabel}` : ''}{deal.reviewCount !== undefined ? `（${deal.reviewCount.toLocaleString('zh-CN')} 篇评测）` : ''}</span>
            : <span>暂无评价</span>}
          {deal.released && <span> · {deal.released} 发售</span>}
        </div>
        <div className="sd-card-foot">
          <span className="fg-open"><ExternalLink size={12} /> 直达 Steam 商店</span>
        </div>
      </div>
    </div>
  )
}

export function SteamDealsTool({ notify, onBack }: {
  notify: (m: string, kind?: 'ok' | 'err') => void
  onBack: () => void
}) {
  const [cache, setCache] = useState<SteamDealsCache | null>(() => loadSteamCache())
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SteamSort>('discount')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [page, setPage] = useState(1)
  const [enriching, setEnriching] = useState(false)
  const [enrichFailed, setEnrichFailed] = useState(false)
  const enrichRunning = useRef(false)

  // v0.1.413：卡片直达 Steam 客户端（steam://store/<appid>，合集包走
  // steam://openurl/<sub 页>）；没装客户端或打不开时回落浏览器并报真实原因，
  // 网页/安卓本来就走浏览器，不弹失败提示。
  const openDeal = async (deal: SteamDeal) => {
    const clientUrl = steamClientUrlOfDeal(deal)
    if (!clientUrl) { void openExternal(deal.url); return }
    const res = await openViaClient(clientUrl, deal.url)
    if (res.via === 'web' && isDesktopApp()) {
      notify(res.browserOpened === false
        ? `Steam 客户端直达失败（${res.reason}），浏览器也没打开，请手动打开 Steam 商店`
        : `Steam 客户端直达失败（${res.reason}），已在浏览器打开商店页`, 'err')
    }
  }

  const refresh = async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const c = await loadSteamDeals(force)
      setCache(c)
      setPage(1)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      notify(msg, 'err')
    } finally {
      setLoading(false)
    }
  }

  // 首屏：缓存新鲜（1 小时内）直接用，否则拉第一页
  useEffect(() => {
    const cached = loadSteamCache()
    if (cached && isSteamCacheFresh(cached)) return
    void refresh(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 后台补齐合集包（v0.1.412）：搜索接口不收录的合集包（如战地风云 5 决定版）
  // 靠本体反查补进来；跑在后台不挡首屏，查过的本体记进缓存不再重复查。
  useEffect(() => {
    if (!cache || enrichRunning.current) return
    // 没有未查过的本体就不跑（补齐后 checkedAppids 已记全，避免重复触发）
    const checked = new Set(cache.checkedAppids ?? [])
    if (!cache.items.some(d => d.kind === 'game' && !checked.has(d.appid))) return
    void (async () => {
      enrichRunning.current = true
      setEnriching(true)
      setEnrichFailed(false)
      try {
        const r = await enrichSteamPackages(cache)
        if (r.added > 0) setCache(r.cache)
        if (r.failed) setEnrichFailed(true)
      } catch {
        setEnrichFailed(true)
      } finally {
        setEnriching(false)
        enrichRunning.current = false
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache?.at, cache?.items.length])

  const packageCount = useMemo(() => (cache ? cache.items.filter(d => d.kind === 'package').length : 0), [cache])
  const gameCount = useMemo(() => (cache ? cache.items.filter(d => d.kind === 'game').length : 0), [cache])
  const sorted = useMemo(() => {
    if (!cache) return []
    const list = sortSteamDeals(cache.items, sort)
    return kindFilter === 'all' ? list : list.filter(d => d.kind === kindFilter)
  }, [cache, sort, kindFilter])
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const searchFetched = cache?.searchFetched ?? cache?.items.length ?? 0
  const hasMore = !!cache && searchFetched < cache.total

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const c = await loadMoreSteamDeals()
      setCache(c)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      notify(msg, 'err')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <ToolShell title="Steam 降价" desc="Steam 商店当前打折的游戏本体与合集包：折扣、现价、原价、好评率，按折扣排序；合集包带「合集包」标记，大促期间列表更长，平时也有常驻折扣。" onBack={onBack}>
      <div className="sd-bar">
        <div className="wt-chips" role="tablist" aria-label="排序">
          {SORTS.map(s => (
            <button key={s.key} className={`wt-chip ${sort === s.key ? 'on' : ''}`}
              onClick={() => { setSort(s.key); setPage(1) }}>{s.label}</button>
          ))}
        </div>
        <button className="btn sm ghost" disabled={loading} onClick={() => void refresh(true)}>
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 刷新
        </button>
      </div>

      <div className="sd-bar">
        <div className="wt-chips" role="tablist" aria-label="类型">
          {([
            { key: 'all', label: `全部（${cache ? cache.items.length : 0}）` },
            { key: 'game', label: `游戏本体（${gameCount}）` },
            { key: 'package', label: `合集包（${packageCount}）` },
          ] as { key: KindFilter; label: string }[]).map(f => (
            <button key={f.key} className={`wt-chip ${kindFilter === f.key ? 'on' : ''}`}
              onClick={() => { setKindFilter(f.key); setPage(1) }}>{f.label}</button>
          ))}
        </div>
      </div>

      {cache && (
        <div className="sd-source">
          Steam 商店公开接口 · 更新于 {fmtTime(cache.at)}
          · 共 {cache.total.toLocaleString('zh-CN')} 款打折中，已拉 {searchFetched.toLocaleString('zh-CN')} 款
          {packageCount > 0 && `，其中 ${packageCount} 款为合集包`}
          {enriching && ' · 正在补齐合集包…'}
          {enrichFailed && ' · 合集包补齐失败（网络原因，主列表不受影响，刷新可再试）'}
        </div>
      )}

      {loading && !cache && (
        <div className="fg-empty"><Loader2 size={14} className="spin" /> 正在拉 Steam 打折列表…</div>
      )}

      {error && !cache && (
        <div className="fg-empty" style={{ borderColor: 'rgba(220,38,38,.4)' }}>
          <TriangleAlert size={14} color="#dc2626" />
          <span>{error}</span>
          <button className="btn sm primary" disabled={loading} onClick={() => void refresh(true)}>重试</button>
        </div>
      )}

      {error && cache && (
        <div className="fg-empty" style={{ borderColor: 'rgba(220,38,38,.4)' }}>
          <TriangleAlert size={14} color="#dc2626" />
          <span>刷新失败，显示的是上次拉到的数据：{error}</span>
        </div>
      )}

      {cache && pageItems.length === 0 && !loading && (
        <div className="fg-empty">{kindFilter === 'package' ? '当前已拉到的列表里还没有合集包，点「加载更多」继续拉，或等后台补齐。' : 'Steam 当前没有打折游戏（或返回为空），过会儿再刷新看看。'}</div>
      )}

      {pageItems.length > 0 && (
        <div className="sd-grid">
          {pageItems.map(d => <DealCard key={dealKey(d)} deal={d} onOpen={openDeal} />)}
        </div>
      )}

      {cache && sorted.length > PAGE_SIZE && (
        <Pager page={safePage} pageCount={pageCount} total={sorted.length} unit="款" onPage={setPage} />
      )}

      {cache && hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
          <button className="btn" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? <Loader2 size={14} className="spin" /> : null} 加载更多（已拉 {searchFetched.toLocaleString('zh-CN')} / {cache.total.toLocaleString('zh-CN')} 款）
          </button>
        </div>
      )}
    </ToolShell>
  )
}
