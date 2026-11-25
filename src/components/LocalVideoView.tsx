// AI 视频（本地）专业页面：ComfyUI / SD 风格节点式工作流布局。
// 文生视频 / 图生视频 / 首尾帧，正反向提示词、时长/分辨率/帧率/步数/CFG/种子/运动强度，
// 调用本机 OpenAI 兼容视频服务，任务进度与结果预览，全部本机运行。

import { useEffect, useRef, useState } from 'react'
import {
  Film, Sparkles, Loader2, Download, Trash2, Info, RefreshCw,
  Dices, Upload, X, Maximize2, Eraser, Zap, AppWindow, ChevronDown, SlidersHorizontal, History, Settings2, Workflow, Radar,
} from 'lucide-react'
import { callLocalVideo, queryLocalVideoTask, fetchLocalMediaModels } from '../core/providerCall'
import { externalOpenEnabled, openWithViewer } from '../core/viewerPrefs'
import { useHoverZoom, HoverZoomOverlay, spaceOpenProps, videoResumeProps } from './mediaPreview'
import { saveMedia, loadHistory, addHistory, removeHistory, clearHistory, newMediaId, errTextSafe, autoSaveGeneratedMedia, type MediaHistoryItem } from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import { extractTaskId } from '../core/mediaAdapters'
import { isComfyUIBase, fetchComfyCheckpoints, fetchComfyMotionModuleStatus, comfyGenerateAnimateDiff, stripComfyCategoryPrefix, type MotionModuleState } from '../core/comfyui'
import { fetchLocalModels, detectLocalServices } from '../core/localServices'
import { isMotionModule } from '../core/modelCapability'
import { ServiceSwitch } from './ServiceSwitch'
import { LocalModelInfoCard } from './LocalModelInfoCard'
import type { ServiceController } from '../core/useServiceController'
import { LOCAL_SERVICE_CHANGED_EVENT } from '../core/localServicesSettings'
import { GenProgressBar, useGenProgress } from './GenProgressBar'
import { t, locale } from '../core/i18n'

const RESOLUTIONS = ['480p', '576p', '720p', '768p', '1080p']
const RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9']

/** 分辨率+比例 → AnimateDiff 像素尺寸：SD1.5 训练尺寸约 512²，长边封顶 768、总像素保守封顶，边长对齐 8 */
function comfyVideoSize(resolution: string, ratio: string): { w: number; h: number } {
  const res = parseInt(resolution) || 512
  const [rw, rh] = ratio.split(':').map(Number)
  const longEdge = Math.min(res, 768)
  let w = rw >= rh ? longEdge : Math.round(longEdge * (rw / rh))
  let h = rw >= rh ? Math.round(longEdge * (rh / rw)) : longEdge
  const maxPx = 512 * 640
  if (w * h > maxPx) { const k = Math.sqrt(maxPx / (w * h)); w = Math.round(w * k); h = Math.round(h * k) }
  const align = (v: number) => Math.max(64, Math.round(v / 8) * 8)
  return { w: align(w), h: align(h) }
}
const DEFAULT_BASE = 'http://127.0.0.1:8188'  // ComfyUI 默认端口（旧版误用 Ollama 的 11434）

export function LocalVideoView({ notify, serviceController }: { notify: (m: string) => void; serviceController?: ServiceController }) {
  // 地址自愈：11434 是 Ollama 对话服务端口，存量值一律纠正为 ComfyUI 8188
  const [base, setBase] = useState(() => {
    const old = localStorage.getItem('acm.local.vid.base')
    const next = !old || old.includes('11434') ? DEFAULT_BASE : old
    if (next !== old) localStorage.setItem('acm.local.vid.base', next)
    localStorage.setItem('acm.local.vid.migrated', '1')
    return next
  })
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [motionModels, setMotionModels] = useState<string[]>([])
  const [motionModel, setMotionModel] = useState('')
  const [motionState, setMotionState] = useState<MotionModuleState | ''>('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [mode, setMode] = useState<'t2v' | 'i2v' | 'flf2v'>('t2v')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [duration, setDuration] = useState(5)
  const [resolution, setResolution] = useState('768p')
  const [ratio, setRatio] = useState('16:9')
  const [fps, setFps] = useState(24)
  const [steps, setSteps] = useState(20)
  // 极速模式（本机偏好，两本地页共用）：生成时压分辨率/步数，M1 上更快、发热更低
  const [fastMode, setFastMode] = useState(() => { try { return localStorage.getItem('acm.local.fastMode') === '1' } catch { return false } })
  const toggleFastMode = (v: boolean) => { setFastMode(v); try { localStorage.setItem('acm.local.fastMode', v ? '1' : '0') } catch { /* 忽略 */ } }
  const [extOpen] = useState(() => externalOpenEnabled('video'))
  const hz = useHoverZoom()
  const [bigVideo, setBigVideo] = useState('')
  const [cfg, setCfg] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [motion, setMotion] = useState(0.7)
  const [firstFrame, setFirstFrame] = useState('')
  const [lastFrame, setLastFrame] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [lastParams, setLastParams] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('video'))
  const [detecting, setDetecting] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const lastRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const { progress, start: startProgress, advance: advanceProgress, done: doneProgress, fail: failProgress } = useGenProgress()
  useEffect(() => { alive.current = true; setHistory(loadHistory('video')); return () => { alive.current = false } }, [])
  useEffect(() => { localStorage.setItem('acm.local.vid.base', base) }, [base])
  // ComfyUI 服务被关闭时清空模型列表与选中值，避免下拉残留已关闭服务的模型
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; enabled: boolean }>).detail
      if (d?.key === 'comfyui' && !d.enabled) { setModels([]); setModel(''); setMotionModels([]); setMotionModel(''); setMotionState('') }
    }
    window.addEventListener(LOCAL_SERVICE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(LOCAL_SERVICE_CHANGED_EVENT, onChanged)
  }, [])

  // 进入页面自动探测本机服务：只认 ComfyUI（探测不到保留当前地址；
  // 旧版优先选非 ComfyUI 服务，会把 Ollama 对话服务误设进来，聊天模型随之混进视频下拉）
  const autoDetect = async (silent = false) => {
    if (!silent) setDetecting(true)
    try {
      const r = await detectLocalServices()
      if (!r.ok || r.services.length === 0) { if (!silent) notify(r.error ?? t('未探测到本机运行的服务')); return }
      const pick = r.services.find(s => /comfy/i.test(s.service))
      if (!pick) {
        if (!silent) notify(t('未探测到 ComfyUI，请先启动 ComfyUI，或在上方手动填写服务地址'))
        return
      }
      setBase(pick.url)
      if (!silent) notify(t('已自动探测到 {service}：{url}', { service: pick.service, url: pick.url }))
    } catch (e) { if (!silent) notify(t('探测失败：{msg}', { msg: errTextSafe(e) })) }
    finally { setDetecting(false) }
  }
  useEffect(() => { void autoDetect(true) }, [])

  const loadModels = async () => {
    // 地址纠错：Ollama（11434）是对话服务，不能生成视频；自动改回 ComfyUI 默认地址
    if (/:11434\b/.test(base)) {
      setBase(DEFAULT_BASE)
      notify(t('当前地址是 Ollama 的对话服务地址，不能用来生成媒体；已自动改回 ComfyUI 默认地址，请再点一次连接'))
      return
    }
    // 服务总闸：ComfyUI 地址且开关关闭时禁止连接，避免关了服务还能拉到模型
    if (isComfyUIBase(base) && serviceController && !serviceController.enabled('comfyui')) {
      setModels([]); setModel(''); setMotionModels([]); setMotionModel(''); setMotionState('')
      notify(t('ComfyUI 服务已关闭，请先开启服务后再连接。开关与设置页同步。'))
      return
    }
    setLoadingModels(true)
    try {
      let ids: string[]
      if (isComfyUIBase(base)) {
        // ComfyUI 无标准视频接口，只能列出 checkpoint 作为参考底模
        ids = await fetchComfyCheckpoints(base)
        if (ids.length === 0) {
          const r = await fetchLocalModels('comfyui', base)
          if (!r.ok) throw new Error(r.error ?? t('拉取失败'))
          ids = [...new Set(r.models.map(m => stripComfyCategoryPrefix(m, 'checkpoints')))]
        }
        // 运动模块走 ADE 节点的 object_info（即 animatediff_models 目录清单），并区分未装扩展/未扫到文件
        const mst = await fetchComfyMotionModuleStatus(base)
        setMotionModels(mst.models)
        setMotionState(mst.state)
        setMotionModel(prev => mst.models.includes(prev) ? prev : (mst.models[0] ?? ''))
        if (ids.length) notify(t('已连上 ComfyUI，列出 {n} 个 checkpoint；选好底模与运动模块后可通过 AnimateDiff 生成视频', { n: ids.length }))
      } else {
        ids = await fetchLocalMediaModels(base)
      }
      // 本页的「模型」指底模 checkpoint；运动模块是搭配件，不作为底模列出
      ids = ids.filter(m => !isMotionModule(m))
      setModels(ids)
      setModel(prev => ids.includes(prev) ? prev : (ids[0] ?? ''))
      if (!isComfyUIBase(base)) notify(t('已连接本地服务，找到 {n} 个模型', { n: ids.length }))
    } catch (e) {
      const msg = errTextSafe(e)
      notify(!isComfyUIBase(base) && /502|503|connection|refused|连接/i.test(msg)
        ? t('连接失败：{msg}。当前地址 {base} 可能不是视频服务；ComfyUI 默认 8188（但 ComfyUI 生视频需额外工作流）', { msg, base })
        : t('连接失败：{msg}', { msg }))
    }
    finally { setLoadingModels(false) }
  }
  const randomSeed = () => setSeed(Math.floor(Math.random() * 4294967295))
  const pick = (file: File | undefined, setter: (v: string) => void) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify(t('请选择图片文件')); return }
    const r = new FileReader(); r.onload = () => setter(String(r.result)); r.readAsDataURL(file)
  }

  const generate = async () => {
    if (serviceController && isComfyUIBase(base) && !serviceController.enabled('comfyui')) { notify(t('ComfyUI 服务已关闭，请先开启服务后再生成')); return }
    if (!prompt.trim()) { notify(t('请先输入提示词')); return }
    if (!model) { notify(t('请先连接本地服务并选择模型')); return }
    if ((mode === 'i2v' || mode === 'flf2v') && !firstFrame) { notify(t('该模式请先上传首帧图')); return }
    if (mode === 'flf2v' && !lastFrame) { notify(t('首尾帧模式请上传尾帧图')); return }
    if (busy) return
    setBusy(true); setResults([])
    const startedAt = Date.now()
    const finalSeed = seed < 0 ? Math.floor(Math.random() * 4294967295) : seed
    const effSteps = fastMode ? Math.min(steps, 20) : steps
    startProgress(t('正在提交本地任务…'))
    try {
      advanceProgress(25, t('本地服务响应中…'), 'queued')
      // ComfyUI 走内置 AnimateDiff 工作流（底模 + 运动模块 → mp4），不走通用视频接口
      if (isComfyUIBase(base)) {
        if (mode !== 't2v') { failProgress(t('生成失败')); notify(t('ComfyUI AnimateDiff 目前仅支持文生视频')); return }
        if (!motionModel) { failProgress(t('生成失败')); notify(motionState === 'no-extension' ? t('未安装 AnimateDiff 扩展：请先在 ComfyUI 的 Manager 里安装 ComfyUI-AnimateDiff-Evolved 与 VideoHelperSuite 并重启 ComfyUI') : t('未选择运动模块：请先点「连接」拉取；若列表为空，说明 ComfyUI 未安装 AnimateDiff 扩展，或 animatediff_models 目录里没有运动模块文件')); return }
        const rawSize = comfyVideoSize(resolution, ratio)
        const vScale = fastMode ? Math.min(1, 512 / Math.max(rawSize.w, rawSize.h)) : 1
        const size = { w: Math.max(256, Math.round(rawSize.w * vScale / 8) * 8), h: Math.max(256, Math.round(rawSize.h * vScale / 8) * 8) }
        const rv = await comfyGenerateAnimateDiff(base, model, motionModel, prompt.trim(), {
          negativePrompt: negative.trim() || undefined,
          width: size.w, height: size.h, steps: effSteps, cfgScale: cfg, seed: finalSeed, frames: 16, fps: 8,
        }, (pct, label) => advanceProgress(pct, label, 'generating'), () => alive.current)
        if (!alive.current) return
        if (!rv.ok) { failProgress(t('生成失败')); notify(rv.error ?? t('生成失败')); return }
        const vids = rv.images
        setResults(vids)
        const secsV = ((Date.now() - startedAt) / 1000).toFixed(1)
        doneProgress(t('生成完成 · 耗时 {secs}s', { secs: secsV }))
        const paramsV = t('AnimateDiff · {model} + {motion} · 16 帧 · 8fps · {w}×{h} · {steps}步 · CFG {cfg} · seed {seed}', { model, motion: motionModel, w: size.w, h: size.h, steps, cfg, seed: finalSeed })
        setLastParams(paramsV)
        setHistory(addHistory('video', {
          id: newMediaId(), kind: 'video', prompt: prompt.trim(), accountLabel: t('本地 · {model}', { model }),
          model, createdAt: Date.now(), results: vids, params: paramsV, note: '',
        }))
        notify(t('本地视频已生成'))
        if (vids.length) void autoSaveGeneratedMedia(vids, 'video').then(saved => { if (saved.length) notify(t('已自动保存 {n} 个文件到数据存储文件夹', { n: saved.length })) })
        return
      }
      const r = await callLocalVideo(base, model, prompt.trim(), {
        duration, ratio, resolution: fastMode ? '480p' : resolution,
        image: (mode === 'i2v' || mode === 'flf2v') ? firstFrame : undefined,
        lastFrame: mode === 'flf2v' ? lastFrame : undefined,
        negativePrompt: negative.trim() || undefined, steps: effSteps, cfgScale: cfg, seed: finalSeed,
        fps, motionStrength: motion,
      })
      if (!alive.current) return
      if (!r.ok) { failProgress(t('提交失败')); notify(r.error ?? t('提交失败')); return }
      let imgs = r.images ?? []
      const taskId = extractTaskId({ requestId: (r as { requestId?: string }).requestId })
      // 若返回任务 ID 而无视频，轮询查询
      if (imgs.length === 0 && taskId) {
        advanceProgress(35, t('任务排队中…'), 'queued')
        for (let i = 0; i < 24 && alive.current; i++) {
          await new Promise(res => setTimeout(res, 5000))
          if (!alive.current) return
          const q = await queryLocalVideoTask(base, taskId)
          if (q.ok && q.images?.length) { imgs = q.images; break }
          if (!q.ok && q.error) { failProgress(q.error); notify(q.error); break }
          advanceProgress(Math.min(85, 35 + (i + 1) * 3), q.text || t('本地视频生成中…'), 'generating')
        }
      }
      if (!alive.current) return
      setResults(imgs)
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      doneProgress(imgs.length ? t('生成完成 · 耗时 {secs}s', { secs }) : t('任务已提交 · 耗时 {secs}s', { secs }))
      const params = t('{mode} · {model} · {duration}s · {resolution} {ratio} · {fps}fps · {steps}步 · CFG {cfg} · seed {seed}', { mode, model, duration, resolution, ratio, fps, steps: effSteps, cfg, seed: finalSeed })
      setLastParams(params)
      setHistory(addHistory('video', {
        id: newMediaId(), kind: 'video', prompt: prompt.trim(), accountLabel: t('本地 · {model}', { model }),
        model, createdAt: Date.now(), results: imgs, params, note: imgs.length ? '' : r.text,
      }))
      notify(imgs.length ? t('本地视频已生成') : r.text)
      if (imgs.length) void autoSaveGeneratedMedia(imgs, 'video').then(saved => { if (saved.length) notify(t('已自动保存 {n} 个文件到数据存储文件夹', { n: saved.length })) })
    } catch (e) { if (alive.current) { failProgress(t('生成失败')); notify(errTextSafe(e)) } }
    finally { if (alive.current) setBusy(false) }
  }

  const download = async (url: string, idx: number) => {
    try { const loc = await saveMedia(url, 'video', `sd-video-${Date.now()}-${idx + 1}`); notify(t('已保存：{loc}', { loc })) }
    catch (e) { notify(errTextSafe(e)) }
  }
  const resetHistory = () => { clearHistory('video'); setHistory([]); notify(t('历史已清空')) }

  return (
    <div className="sd-page">
      <div className="sd-topbar">
        <div className="sd-brand"><span className="sd-brand-mark"><Workflow size={17} /></span><div><b>{t('AI 视频 · 本地')}</b><small>{t('ComfyUI 风格工作流 · 全流程本机运行')}</small></div></div>
        <div className="sd-top-actions">
          {serviceController && <ServiceSwitch controller={serviceController} serviceKey="comfyui" />}
          <div className="sd-conn">
          <span className="sd-conn-label">{t('本地服务')}</span>
          <span className="sd-conn-url" title={t('地址由后台自动探测，不可手动修改')}>{base || t('未探测到服务')}</span>
          <button className="btn sm ghost" onClick={() => void autoDetect()} disabled={detecting} title={t('重新探测本机服务')}><Radar size={14} className={detecting ? 'spin' : ''} /> {t('探测')}</button>
          <button className="btn sm ghost" onClick={() => void loadModels()} disabled={loadingModels}><RefreshCw size={14} className={loadingModels ? 'spin' : ''} /> {t('连接')}</button>
          </div>
        </div>
      </div>

      <div className="sd-layout">
        <section className="sd-control">
          <div className="sd-tabs">
            <button className={mode === 't2v' ? 'active' : ''} onClick={() => setMode('t2v')}><Sparkles size={15} /> {t('文生视频')}</button>
            <button className={mode === 'i2v' ? 'active' : ''} onClick={() => setMode('i2v')}><Film size={15} /> {t('图生视频')}</button>
            <button className={mode === 'flf2v' ? 'active' : ''} onClick={() => setMode('flf2v')}><Workflow size={15} /> {t('首尾帧')}</button>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><Settings2 size={15} /> {t('模型')}</div>
            {models.length > 0 ? (
              <select className="input" value={model} onChange={e => setModel(e.target.value)}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>
            ) : (
              <input className="input" placeholder={t('点顶部「连接」拉取本地视频模型')} value={model} onChange={e => setModel(e.target.value)} />
            )}
            <LocalModelInfoCard filename={model} />
          </div>

          {isComfyUIBase(base) && (
            <div className="sd-block">
              <div className="sd-block-title"><Film size={15} /> {t('运动模块')}</div>
              {motionModels.length > 0 ? (
                <select className="input" value={motionModel} onChange={e => setMotionModel(e.target.value)}>{motionModels.map(m => <option key={m} value={m}>{m}</option>)}</select>
              ) : (
                <input className="input" disabled placeholder={motionState === 'no-extension' ? t('未安装 AnimateDiff 扩展（ADE 节点不存在）') : motionState === 'no-files' ? t('扩展已就绪，但没扫到运动模块文件') : t('未检测到运动模块（先点顶部「连接」）')} value="" readOnly />
              )}
              {motionState === 'no-extension' ? (
                <div className="sd-tip" style={{ marginTop: 6 }}><Info size={13} /> {t('未检测到 AnimateDiff 扩展：请打开 ComfyUI → Manager → Custom Nodes Manager，搜索并安装 ComfyUI-AnimateDiff-Evolved 与 ComfyUI-VideoHelperSuite 两个扩展，重启 ComfyUI 后回到这里点「连接」')}</div>
              ) : motionState === 'no-files' ? (
                <div className="sd-tip" style={{ marginTop: 6 }}><Info size={13} /> {t('AnimateDiff 扩展已就绪，但它的清单里没有运动模块：请把运动模块文件（如 mm_sd_v15_v2.ckpt）放进 ComfyUI 的 models/animatediff_models 目录，重启 ComfyUI 后再点「连接」')}</div>
              ) : (
                <div className="sd-tip" style={{ marginTop: 6 }}><Info size={13} /> {t('AnimateDiff 运动模块与底模搭配生成视频，需 ComfyUI 已安装 AnimateDiff-Evolved 与 VideoHelperSuite 扩展；固定 16 帧 · 8fps，约 2 秒')}</div>
              )}
              <LocalModelInfoCard filename={motionModel} />
            </div>
          )}

          <div className="sd-fast-row">
            <Zap size={14} className="sd-fast-icon" />
            <div className="sd-fast-text"><b>{t('极速模式')}</b><span>{t('生成时自动把最长边压到 512、步数上限 20；速度明显更快、发热更低')}</span></div>
            <button className={`sd-fast-switch ${fastMode ? 'on' : ''}`} role="switch" aria-checked={fastMode} title={t('极速模式')} onClick={() => toggleFastMode(!fastMode)}><span className="sd-fast-dot" /></button>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">1</span> {t('提示词 Prompt')}<span className="sd-title-actions"><button className="sd-clear-btn" title={t('清空输入')} disabled={!prompt && !negative && !firstFrame && !lastFrame} onClick={() => { setPrompt(''); setNegative(''); setFirstFrame(''); setLastFrame('') }}><Eraser size={13} /></button></span></div>
            <textarea className="sd-prompt" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t('按时间顺序描述动作：主体、动作、环境、镜头、光线……（建议 200 字内）')} />
          </div>
          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">2</span> {t('反向提示词 Negative prompt')}</div>
            <textarea className="sd-prompt sd-prompt-neg" rows={2} value={negative} onChange={e => setNegative(e.target.value)} placeholder="low quality, blurry, distorted, watermark…" />
          </div>

          {(mode === 'i2v' || mode === 'flf2v') && (
            <div className="sd-block">
              <div className="sd-block-title"><Upload size={15} /> {t('参考帧')}</div>
              <div className="sd-frame-row">
                <div className="sd-frame-slot">
                  <span>{t('首帧')}</span>
                  <input ref={firstRef} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0], setFirstFrame)} />
                  {firstFrame ? <div className="sd-frame-thumb"><img src={firstFrame} alt={t('首帧')} /><button onClick={() => setFirstFrame('')}><X size={12} /></button></div> : <button className="sd-frame-add" onClick={() => firstRef.current?.click()}><Upload size={16} /></button>}
                </div>
                {mode === 'flf2v' && <div className="sd-frame-slot">
                  <span>{t('尾帧')}</span>
                  <input ref={lastRef} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0], setLastFrame)} />
                  {lastFrame ? <div className="sd-frame-thumb"><img src={lastFrame} alt={t('尾帧')} /><button onClick={() => setLastFrame('')}><X size={12} /></button></div> : <button className="sd-frame-add" onClick={() => lastRef.current?.click()}><Upload size={16} /></button>}
                </div>}
              </div>
            </div>
          )}

          <div className="sd-block">
            <div className="sd-block-title"><SlidersHorizontal size={15} /> {t('视频参数')}</div>
            <div className="sd-param-grid">
              <div className="sd-field"><label>{t('时长')} <b>{duration}s</b></label><input type="range" min={1} max={15} value={duration} onChange={e => setDuration(Number(e.target.value))} /></div>
              <div className="sd-field"><label>{t('分辨率')}</label><div className="sd-select-wrap"><select className="input" value={resolution} onChange={e => setResolution(e.target.value)}>{RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}</select><ChevronDown size={13} /></div></div>
              <div className="sd-field"><label>{t('画面比例')}</label><div className="sd-select-wrap"><select className="input" value={ratio} onChange={e => setRatio(e.target.value)}>{RATIOS.map(r => <option key={r} value={r}>{r}</option>)}</select><ChevronDown size={13} /></div></div>
              <div className="sd-field"><label>{t('帧率 FPS')} <b>{fps}</b></label><input type="range" min={8} max={60} value={fps} onChange={e => setFps(Number(e.target.value))} /></div>
              <div className="sd-field"><label>{t('采样步数')} <b>{steps}</b></label><input type="range" min={1} max={50} value={steps} onChange={e => setSteps(Number(e.target.value))} /></div>
              <div className="sd-field"><label>CFG Scale <b>{cfg}</b></label><input type="range" min={1} max={30} step={0.5} value={cfg} onChange={e => setCfg(Number(e.target.value))} /></div>
              <div className="sd-field"><label>{t('运动强度')} <b>{motion.toFixed(2)}</b></label><input type="range" min={0} max={1} step={0.05} value={motion} onChange={e => setMotion(Number(e.target.value))} /></div>
              <div className="sd-field sd-seed-field"><label>{t('种子 Seed')}</label><div className="sd-seed-row"><input className="input" type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /><button className="btn sm ghost" onClick={randomSeed} title={t('随机')}><Dices size={15} /></button></div></div>
            </div>
          </div>

          <button className="sd-generate" onClick={() => void generate()} disabled={busy || !prompt.trim()}>
            {busy ? <><Loader2 size={18} className="spin" /> {t('生成中…')}</> : <><Sparkles size={18} /> {t('生成视频')}</>}
          </button>
          <GenProgressBar progress={progress} />
          <div className="sd-tip"><Info size={13} /> {t('视频多为异步任务，提交后自动轮询进度。参数是否生效取决于本地服务接口实现；请确认已启动支持视频生成的本地服务。')}</div>
        </section>

        <section className="sd-result">
          <div className="sd-result-head">
            <div><b>{t('生成结果')}</b><small>{lastParams || t('等待生成')}</small></div>
            <div className="sd-result-actions">
              <button className="btn sm ghost" onClick={() => setShowHistory(v => !v)}><History size={14} /> {showHistory ? t('返回') : t('历史 {n}', { n: history.length })}</button>
            </div>
          </div>
          <div className="sd-gallery-wrap">
            {showHistory ? (
              <div className="sd-history">
                {history.length === 0 && <div className="sd-empty"><History size={40} /><p>{t('暂无历史')}</p></div>}
                {history.map(h => (
                  <div className="sd-hist-card" key={h.id}>
                    <div className="sd-hist-head"><span>{new Date(h.createdAt).toLocaleString(locale())}</span><HoldToConfirm title={t('删除')} onConfirm={() => setHistory(removeHistory('video', h.id))} /></div>
                    <div className="sd-hist-prompt">{h.prompt}</div>
                    <div className="sd-hist-params">{h.params}</div>
                    {h.results.length > 0 ? <div className="sd-hist-thumbs">{h.results.map((u, i) => <video key={i} src={u} muted onClick={() => setBigVideo(u)} style={{ cursor: 'zoom-in' }} />)}</div> : h.note ? <div className="sd-hist-note">{h.note}</div> : null}
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> {t('清空历史')}</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="sd-gallery">
                {results.map((u, i) => (
                  <div className="sd-gallery-item sd-video-item" key={i} {...spaceOpenProps(() => setBigVideo(u))} title={t('选中后按空格放大查看')}>
                    <video src={u} controls playsInline
                      onMouseEnter={e => { videoResumeProps.onMouseEnter(e); hz.enter(e, u, 'video') }}
                      onMouseLeave={e => { videoResumeProps.onMouseLeave(e); hz.leave() }} />
                    <div className="sd-gallery-bar"><span>{t('视频 #{n}', { n: i + 1 })}</span><a href={u} target="_blank" rel="noopener"><Maximize2 size={14} /></a><button onClick={() => void download(u, i)} title={t('下载')}><Download size={14} /></button>{extOpen && <button onClick={() => void openWithViewer(u, 'video', notify)} title={t('用外部软件打开')}><AppWindow size={14} /></button>}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sd-empty"><Film size={44} /><p>{t('还没有生成视频')}</p><span>{t('在左侧填写提示词，点击「生成视频」开始')}</span></div>
            )}
          </div>
        </section>
      </div>
      <HoverZoomOverlay hover={hz.hover} />
      {bigVideo && (
        <div className="sd-lightbox" onClick={() => setBigVideo('')}>
          <button className="sd-lightbox-close" onClick={() => setBigVideo('')}><X size={24} /></button>
          <video src={bigVideo} controls autoPlay playsInline onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
