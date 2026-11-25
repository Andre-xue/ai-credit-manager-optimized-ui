// 播放器附加工具（v0.1.409）：弹幕 + 投屏。直播 HlsPlayer、点播 VodPlayer 共用。
// 弹幕：DanDanPlay 协议的远程弹幕（需在设置里配 danmu_api 地址）+ 本地发送
// （只存本机）；投屏：DLNA（桌面端 Rust）+ 系统投屏（Remote Playback API）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cast, Loader2, MessageSquare, Pause, Play, Send, Square, X } from 'lucide-react'
import {
  fetchDanmakuFor,
  loadDanmuApiBase,
  loadDanmuOn,
  saveDanmuOn,
  loadLocalDanmu,
  addLocalDanmu,
  danmuKey,
  type DanmakuItem,
} from '../core/danmaku'
import {
  isDesktopCastAvailable,
  detectRemotePlayback,
  promptSystemCast,
  discoverDlnaDevices,
  dlnaPlay,
  dlnaPause,
  dlnaResume,
  dlnaStop,
  dlnaMediaNote,
  type DlnaDevice,
} from '../core/cast'

const DM_LANES = 6
const DM_SCROLL_MS = 9000
const DM_TOP_BOTTOM_MS = 4000

// ---------------- 弹幕 ----------------

export type DanmakuStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'nomatch' | 'error' | 'noconfig'

export interface UseDanmaku {
  enabled: boolean
  toggleEnabled: (v: boolean) => void
  status: DanmakuStatus
  statusText: string
  items: DanmakuItem[]
  sendDanmaku: (text: string) => boolean
  liveStartRef: React.MutableRefObject<number>
}

export function useDanmaku(
  title: string,
  episodeNo: number | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  live: boolean,
): UseDanmaku {
  const [enabled, setEnabled] = useState(loadDanmuOn)
  const [status, setStatus] = useState<DanmakuStatus>('idle')
  const [statusText, setStatusText] = useState('')
  const [remoteItems, setRemoteItems] = useState<DanmakuItem[]>([])
  const [localItems, setLocalItems] = useState<DanmakuItem[]>(() => loadLocalDanmu(danmuKey(title, episodeNo)))
  const liveStartRef = useRef(Date.now())

  useEffect(() => {
    liveStartRef.current = Date.now()
    setLocalItems(loadLocalDanmu(danmuKey(title, episodeNo)))
  }, [title, episodeNo])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      setStatusText('')
      setRemoteItems([])
      return
    }
    let dead = false
    const base = loadDanmuApiBase()
    if (!base) {
      setStatus('noconfig')
      setStatusText('未配置弹幕源：去「设置」页签填弹幕源地址（自部署的 danmu_api）；没配也能发本地弹幕')
      setRemoteItems([])
      return
    }
    setStatus('loading')
    setStatusText('正在弹幕库里找这集…')
    void fetchDanmakuFor(title, episodeNo, { base }).then(r => {
      if (dead) return
      if (r.status === 'ok') {
        setRemoteItems(r.items)
        setStatus('ok')
        setStatusText(`已加载 ${r.items.length} 条弹幕（${r.matched}）`)
      } else if (r.status === 'empty') {
        setRemoteItems([])
        setStatus('empty')
        setStatusText('该集在弹幕库里暂无弹幕')
      } else if (r.status === 'nomatch') {
        setRemoteItems([])
        setStatus('nomatch')
        setStatusText(r.reason)
      } else if (r.status === 'error') {
        setRemoteItems([])
        setStatus('error')
        setStatusText(r.reason)
      }
      // noconfig 在前面已拦截，不会到这里
    })
    return () => { dead = true }
  }, [title, episodeNo, enabled])

  const sendDanmaku = useCallback((text: string): boolean => {
    const t = text.trim()
    if (!t) return false
    const v = videoRef.current
    const time = live ? (Date.now() - liveStartRef.current) / 1000 : (v ? v.currentTime : 0)
    const item: DanmakuItem = { time, text: t.slice(0, 100), mode: 1, color: '#ffd166', local: true }
    const key = danmuKey(title, episodeNo)
    addLocalDanmu(key, item)
    setLocalItems(loadLocalDanmu(key))
    return true
  }, [title, episodeNo, live, videoRef])

  const toggleEnabled = useCallback((v: boolean) => {
    setEnabled(v)
    saveDanmuOn(v)
  }, [])

  const items = useMemo(
    () => [...remoteItems, ...localItems].sort((a, b) => a.time - b.time),
    [remoteItems, localItems],
  )

  return { enabled, toggleEnabled, status, statusText, items, sendDanmaku, liveStartRef }
}

/** 弹幕渲染层：盖在视频上（pointer-events: none，不挡点击）；按视频时间逐条放出 */
export function DanmakuLayer({ videoRef, items, enabled, resetKey, live, liveStartRef }: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  items: DanmakuItem[]
  enabled: boolean
  /** 切片/切集时重头 */
  resetKey: string
  live: boolean
  liveStartRef: React.MutableRefObject<number>
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const spawnedRef = useRef(0)
  const lastTimeRef = useRef(0)
  const lanesRef = useRef<number[]>([])

  // 切片/切集/开关变化：清屏重头
  useEffect(() => {
    spawnedRef.current = 0
    lastTimeRef.current = 0
    lanesRef.current = []
    wrapRef.current?.replaceChildren()
  }, [resetKey, enabled])

  // 远程弹幕后到：跳过已过期的，只从当前时间附近开始放
  useEffect(() => {
    const idx = items.findIndex(it => it.time >= lastTimeRef.current - 1.5)
    spawnedRef.current = idx < 0 ? items.length : idx
  }, [items])

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      const wrap = wrapRef.current
      if (!wrap) return
      const v = videoRef.current
      const now = live ? (Date.now() - liveStartRef.current) / 1000 : (v ? v.currentTime : 0)
      if (!Number.isFinite(now)) return
      if (now < lastTimeRef.current - 1) spawnedRef.current = 0
      lastTimeRef.current = now
      let spawned = 0
      while (spawnedRef.current < items.length && items[spawnedRef.current].time <= now) {
        const it = items[spawnedRef.current]
        spawnedRef.current++
        if (it.time < now - 1.5) continue
        if (spawned >= 8) continue
        spawned++
        spawnOne(wrap, it, lanesRef)
      }
    }, 120)
    return () => window.clearInterval(id)
  }, [enabled, items, live, videoRef, liveStartRef])

  return <div ref={wrapRef} className="wt-dm-layer" aria-hidden="true" />
}

function spawnOne(wrap: HTMLElement, it: DanmakuItem, lanesRef: React.MutableRefObject<number[]>) {
  if (wrap.childElementCount > 150) return
  const el = document.createElement('div')
  el.className = 'wt-dm-item' + (it.local ? ' local' : '')
  el.textContent = it.text
  el.style.color = it.color || '#ffffff'
  if (it.mode === 5) {
    el.classList.add('top')
    wrap.appendChild(el)
    window.setTimeout(() => el.remove(), DM_TOP_BOTTOM_MS)
    return
  }
  if (it.mode === 4) {
    el.classList.add('bottom')
    wrap.appendChild(el)
    window.setTimeout(() => el.remove(), DM_TOP_BOTTOM_MS)
    return
  }
  const now = performance.now()
  let lane = 0
  let best = Infinity
  for (let i = 0; i < DM_LANES; i++) {
    const free = lanesRef.current[i] ?? 0
    if (free < best) { best = free; lane = i }
  }
  lanesRef.current[lane] = now + DM_SCROLL_MS
  el.style.top = `${4 + lane * 15}%`
  wrap.appendChild(el)
  const w = wrap.clientWidth
  const tw = el.offsetWidth
  const anim = el.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(-${w + tw + 8}px)` }],
    { duration: DM_SCROLL_MS, easing: 'linear' },
  )
  anim.onfinish = () => el.remove()
}

// ---------------- 投屏 ----------------

export interface UseCast {
  mode: 'idle' | 'searching' | 'casting'
  device: DlnaDevice | null
  devices: DlnaDevice[]
  error: string
  paused: boolean
  searchDevices: () => Promise<void>
  castTo: (dev: DlnaDevice) => Promise<void>
  pauseCast: () => Promise<void>
  resumeCast: () => Promise<void>
  stopCast: () => Promise<void>
  recastIfActive: (mediaUrl: string) => Promise<void>
}

export function useCast(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  getMediaUrl: () => string | undefined,
  getTitle: () => string,
): UseCast {
  const [mode, setMode] = useState<'idle' | 'searching' | 'casting'>('idle')
  const [device, setDevice] = useState<DlnaDevice | null>(null)
  const [devices, setDevices] = useState<DlnaDevice[]>([])
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const stateRef = useRef({ mode, device, paused })
  stateRef.current = { mode, device, paused }

  // 播放器关闭时停掉投屏，不让电视一直播
  useEffect(() => () => {
    const s = stateRef.current
    if (s.mode === 'casting' && s.device) void dlnaStop(s.device).catch(() => {})
  }, [])

  const searchDevices = useCallback(async () => {
    setMode('searching')
    setError('')
    try {
      const devs = await discoverDlnaDevices()
      setDevices(devs)
      setMode('idle')
      if (devs.length === 0) {
        setError('局域网里没搜到支持 DLNA 的电视/盒子：确认电视和这台设备在同一个 Wi-Fi，且电视的 DLNA / 投屏接收已打开')
      }
    } catch (e) {
      setMode('idle')
      setError(`搜索失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const castTo = useCallback(async (dev: DlnaDevice) => {
    const url = getMediaUrl()
    if (!url) { setError('当前没有可投的播放地址'); return }
    try {
      await dlnaPlay(dev, url, getTitle())
      videoRef.current?.pause()
      setDevice(dev)
      setMode('casting')
      setPaused(false)
      const note = dlnaMediaNote(url)
      setError(note ? `已投屏到 ${dev.name}（提示：${note}）` : '')
    } catch (e) {
      setError(`投屏失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [getMediaUrl, getTitle, videoRef])

  const pauseCast = useCallback(async () => {
    const s = stateRef.current
    if (s.mode !== 'casting' || !s.device) return
    try {
      await dlnaPause(s.device)
      setPaused(true)
    } catch (e) {
      setError(`暂停失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const resumeCast = useCallback(async () => {
    const s = stateRef.current
    if (s.mode !== 'casting' || !s.device) return
    try {
      await dlnaResume(s.device)
      setPaused(false)
    } catch (e) {
      setError(`继续失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const stopCast = useCallback(async () => {
    const s = stateRef.current
    if (s.mode !== 'casting' || !s.device) return
    try { await dlnaStop(s.device) } catch { /* 停不掉也算停 */ }
    setMode('idle')
    setDevice(null)
    setPaused(false)
    setError('')
  }, [])

  const recastIfActive = useCallback(async (mediaUrl: string) => {
    const s = stateRef.current
    if (s.mode !== 'casting' || !s.device) return
    try { await dlnaPlay(s.device, mediaUrl, getTitle()) } catch { /* 切源失败时电视停在旧源，错误写进状态 */ setError('切源后投屏失败：新源电视播不了，可点停止投屏回来看') }
  }, [getTitle])

  return { mode, device, devices, error, paused, searchDevices, castTo, pauseCast, resumeCast, stopCast, recastIfActive }
}

// ---------------- 工具栏 ----------------

export function PlayerToolsBar({ danmaku, cast, videoRef, mediaUrl }: {
  danmaku: UseDanmaku
  cast: UseCast
  videoRef: React.RefObject<HTMLVideoElement | null>
  mediaUrl: string | undefined
}) {
  const [sendText, setSendText] = useState('')
  const [castOpen, setCastOpen] = useState(false)
  const [sysCastMsg, setSysCastMsg] = useState('')
  const remote = detectRemotePlayback(videoRef.current)
  const isDesktop = isDesktopCastAvailable()
  const mediaNote = mediaUrl ? dlnaMediaNote(mediaUrl) : null

  const send = () => {
    if (danmaku.sendDanmaku(sendText)) setSendText('')
  }

  const systemCast = async () => {
    setSysCastMsg('')
    try {
      await promptSystemCast(videoRef.current)
    } catch (e) {
      setSysCastMsg(`系统投屏没打开：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="wt-tools">
      <div className="wt-tools-row">
        <button
          className={`wt-chip${danmaku.enabled ? ' on' : ''}`}
          onClick={() => danmaku.toggleEnabled(!danmaku.enabled)}
          title="弹幕开关"
        >
          <MessageSquare size={13} /> 弹幕 {danmaku.enabled ? '开' : '关'}
        </button>
        <span className="fg-muted wt-dm-status">{danmaku.enabled ? danmaku.statusText : '弹幕已关'}</span>
        <input
          className="input wt-dm-input"
          placeholder="发一条弹幕…（只存本机）"
          value={sendText}
          disabled={!danmaku.enabled}
          onChange={e => setSendText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
        />
        <button className="btn sm" disabled={!danmaku.enabled || !sendText.trim()} onClick={send}>
          <Send size={13} /> 发送
        </button>
      </div>
      <div className="wt-tools-row">
        <button className="btn sm" onClick={() => setCastOpen(o => !o)} title="投屏到局域网设备">
          <Cast size={13} /> 投屏{cast.mode === 'casting' && cast.device ? ` · ${cast.device.name}` : ''}
        </button>
        {cast.mode === 'casting' && (
          <>
            <button className="btn sm" onClick={() => void (cast.paused ? cast.resumeCast() : cast.pauseCast())}>
              {cast.paused ? <Play size={13} /> : <Pause size={13} />} {cast.paused ? '继续' : '暂停'}
            </button>
            <button className="btn sm ghost" onClick={() => void cast.stopCast()}>
              <Square size={13} /> 停止投屏
            </button>
          </>
        )}
        {cast.error && <span className="fg-muted">{cast.error}</span>}
      </div>
      {castOpen && (
        <div className="wt-cast-pop">
          <div className="wt-cast-head">
            <span>投屏</span>
            <button className="btn sm ghost" onClick={() => setCastOpen(false)} title="关闭"><X size={13} /></button>
          </div>
          {mediaNote && <div className="fg-muted">{mediaNote}</div>}
          {isDesktop ? (
            <>
              <div className="fg-muted">DLNA：搜同一 Wi-Fi 下的电视 / 盒子，直接投过去播。</div>
              <button className="btn sm" disabled={cast.mode === 'searching'} onClick={() => void cast.searchDevices()}>
                {cast.mode === 'searching' ? <Loader2 size={13} className="spin" /> : <Cast size={13} />}
                {cast.mode === 'searching' ? '正在搜索…' : '搜索局域网设备'}
              </button>
              {cast.devices.map(d => (
                <button
                  key={d.location}
                  className={`wt-cast-dev${cast.device?.location === d.location ? ' on' : ''}`}
                  onClick={() => void cast.castTo(d)}
                >
                  <Cast size={13} /> {d.name}
                  {cast.device?.location === d.location && cast.mode === 'casting' ? '（正在投）' : ''}
                </button>
              ))}
            </>
          ) : (
            <div className="fg-muted">DLNA 局域网投屏只在桌面端提供；网页 / 手机端用下面的系统投屏。</div>
          )}
          {(remote.cast || remote.airplay) ? (
            <>
              <div className="fg-muted">系统投屏：用浏览器自带的投屏选择器。</div>
              <button className="btn sm" onClick={() => void systemCast()}>
                <Cast size={13} /> 用系统投屏（{remote.cast ? 'Chromecast' : ''}{remote.cast && remote.airplay ? ' / ' : ''}{remote.airplay ? 'AirPlay' : ''}）
              </button>
            </>
          ) : (
            <div className="fg-muted">当前浏览器不支持系统投屏（Chrome 支持 Chromecast，Safari 支持 AirPlay）。</div>
          )}
          {sysCastMsg && <div className="fg-muted">{sysCastMsg}</div>}
          <div className="fg-muted">投屏后本机播放器暂停，暂停 / 切源仍在上面控制；切源后会自动重投新源。</div>
        </div>
      )}
    </div>
  )
}
