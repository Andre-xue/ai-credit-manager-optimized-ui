// AI 图像（本地）专业页面：Stable Diffusion WebUI 风格。
// 文生图 / 图生图、正反向提示词、采样器/步数/CFG/种子/尺寸/批量等完整参数，
// 调用本机 OpenAI 兼容生图服务（ComfyUI 插件 / LocalAI / SD WebUI API 等），结果与参数存本机。

import { useEffect, useRef, useState } from 'react'
import {
  Image as ImageIcon, Sparkles, Loader2, Download, Trash2, Info, RefreshCw,
  Dices, Upload, X, Maximize2, Eraser, Zap, AppWindow, ChevronDown, SlidersHorizontal, History, Settings2, Radar,
} from 'lucide-react'
import { callLocalImage, fetchLocalMediaModels } from '../core/providerCall'
import { externalOpenEnabled, openWithViewer } from '../core/viewerPrefs'
import { useHoverZoom, HoverZoomOverlay, spaceOpenProps } from './mediaPreview'
import { isComfyUIBase, comfyGenerate, fetchComfyCheckpoints, stripComfyCategoryPrefix } from '../core/comfyui'
import { fetchLocalModels, detectLocalServices } from '../core/localServices'
import { isMotionModule } from '../core/modelCapability'
import { ServiceSwitch } from './ServiceSwitch'
import type { ServiceController } from '../core/useServiceController'
import { LOCAL_SERVICE_CHANGED_EVENT } from '../core/localServicesSettings'
import { saveMedia, loadHistory, addHistory, removeHistory, clearHistory, newMediaId, errTextSafe, urlToThumb, autoSaveGeneratedMedia, type MediaHistoryItem } from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import { GenProgressBar, useGenProgress } from './GenProgressBar'
import { SafeThumb } from './SafeThumb'
import { LocalModelInfoCard } from './LocalModelInfoCard'
import { t, locale } from '../core/i18n'

const SAMPLERS = ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ 2M', 'DPM++ SDE Karras', 'DDIM', 'UniPC', 'LMS', 'Heun']
const RATIOS = [
  { label: '1:1', w: 1024, h: 1024 }, { label: '3:4', w: 768, h: 1024 }, { label: '4:3', w: 1024, h: 768 },
  { label: '9:16', w: 576, h: 1024 }, { label: '16:9', w: 1024, h: 576 }, { label: '2:3', w: 832, h: 1248 },
]
const DEFAULT_BASE = 'http://127.0.0.1:8188'  // ComfyUI 默认端口

export function LocalImageView({ notify, serviceController }: { notify: (m: string) => void; serviceController?: ServiceController }) {
  // 地址自愈：11434 是 Ollama 对话服务端口，存量值（含被旧版自动探测误写的值）一律纠正为 ComfyUI 8188
  const [base, setBase] = useState(() => {
    const old = localStorage.getItem('acm.local.img.base')
    const next = !old || old.includes('11434') ? DEFAULT_BASE : old
    if (next !== old) localStorage.setItem('acm.local.img.base', next)
    localStorage.setItem('acm.local.img.migrated', '1')
    return next
  })
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [mode, setMode] = useState<'txt2img' | 'img2img'>('txt2img')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [sampler, setSampler] = useState('DPM++ 2M Karras')
  const [steps, setSteps] = useState(20)
  const [cfg, setCfg] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [width, setWidth] = useState(1024)
  const [height, setHeight] = useState(1024)
  const [batch, setBatch] = useState(1)
  // 极速模式（本机偏好，两本地页共用）：生成时压分辨率/步数，M1 上更快、发热更低
  const [fastMode, setFastMode] = useState(() => { try { return localStorage.getItem('acm.local.fastMode') === '1' } catch { return false } })
  const toggleFastMode = (v: boolean) => { setFastMode(v); try { localStorage.setItem('acm.local.fastMode', v ? '1' : '0') } catch { /* 忽略 */ } }
  const [extOpen] = useState(() => externalOpenEnabled('image'))
  const hz = useHoverZoom()
  const [strength, setStrength] = useState(0.7)
  const [sourceImage, setSourceImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<string[]>([])
  const [lastParams, setLastParams] = useState('')
  const [lightbox, setLightbox] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('image'))
  const [detecting, setDetecting] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const { progress, start: startProgress, advance: advanceProgress, done: doneProgress, fail: failProgress } = useGenProgress()
  const fileRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; setHistory(loadHistory('image')); return () => { alive.current = false } }, [])
  useEffect(() => { localStorage.setItem('acm.local.img.base', base) }, [base])
  // ComfyUI 服务被关闭时清空模型列表与选中值，避免下拉残留已关闭服务的模型
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; enabled: boolean }>).detail
      if (d?.key === 'comfyui' && !d.enabled) { setModels([]); setModel('') }
    }
    window.addEventListener(LOCAL_SERVICE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(LOCAL_SERVICE_CHANGED_EVENT, onChanged)
  }, [])

  // 进入页面自动从后台探测本机已运行的生图服务（ComfyUI 优先），免手填地址
  const autoDetect = async (silent = false) => {
    if (!silent) setDetecting(true)
    try {
      const r = await detectLocalServices()
      if (!r.ok || r.services.length === 0) {
        if (!silent) notify(r.error ?? t('未探测到本机运行的服务，请先启动 ComfyUI'))
        return
      }
      // 生图只认 ComfyUI：探测不到就保留当前地址（绝不回退到 Ollama/LM Studio 这类对话服务，
      // 否则会把聊天模型误列进生图下拉，且错误地址会被持久化）
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
    // 地址纠错：Ollama（11434）是对话服务，列不出图像模型；自动改回 ComfyUI 默认地址
    if (/:11434\b/.test(base)) {
      setBase(DEFAULT_BASE)
      notify(t('当前地址是 Ollama 的对话服务地址，不能用来生成媒体；已自动改回 ComfyUI 默认地址，请再点一次连接'))
      return
    }
    // 服务开关是功能总闸：ComfyUI 关闭时禁止连接/拉取，避免关了服务还能加载模型
    if (isComfyUIBase(base) && serviceController && !serviceController.enabled('comfyui')) {
      setModels([]); setModel('')
      notify(t('ComfyUI 服务已关闭，请先开启服务后再连接。开关与设置页同步。'))
      return
    }
    setLoadingModels(true)
    try {
      let ids: string[]
      if (isComfyUIBase(base)) {
        // 优先用 ComfyUI 实时 API 拿 checkpoint（最准确），失败回退到本地目录扫描
        ids = await fetchComfyCheckpoints(base)
        if (ids.length === 0) {
          const r = await fetchLocalModels('comfyui', base)
          if (!r.ok) throw new Error(r.error ?? t('拉取失败'))
          // 扫盘命名带 checkpoints/ 前缀，与服务器合法值不一致（提交会被拒）：统一剥掉并去重
          ids = [...new Set(r.models.map(m => stripComfyCategoryPrefix(m, 'checkpoints')))]
        }
      } else {
        ids = await fetchLocalMediaModels(base)
      }
      // 运动模块（AnimateDiff）不能出图，不进图像模型列表
      ids = ids.filter(m => !isMotionModule(m))
      setModels(ids)
      setModel(prev => ids.includes(prev) ? prev : (ids[0] ?? ''))
      notify(isComfyUIBase(base)
        ? t('已连接本地服务，找到 {n} 个模型（ComfyUI）', { n: ids.length })
        : t('已连接本地服务，找到 {n} 个模型', { n: ids.length }))
    } catch (e) {
      const msg = errTextSafe(e)
      notify(!isComfyUIBase(base) && /502|503|connection|refused|连接/i.test(msg)
        ? t('连接失败：{msg}。当前地址 {base} 可能不是生图服务，ComfyUI 请用 http://127.0.0.1:8188', { msg, base })
        : t('连接失败：{msg}', { msg }))
    }
    finally { setLoadingModels(false) }
  }

  const randomSeed = () => setSeed(Math.floor(Math.random() * 4294967295))
  const onPickImage = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify(t('请选择图片文件')); return }
    const r = new FileReader()
    r.onload = () => setSourceImage(String(r.result))
    r.readAsDataURL(file)
  }

  const generate = async () => {
    if (serviceController && !serviceController.enabled('comfyui')) { notify(t('ComfyUI 服务已关闭，请先开启服务后再生成')); return }
    if (!prompt.trim()) { notify(t('请先输入提示词')); return }
    if (!model) { notify(t('请先连接本地服务并选择模型')); return }
    if (mode === 'img2img' && !sourceImage) { notify(t('图生图模式请先上传源图')); return }
    if (busy) return
    setBusy(true); setResults([])
    const startedAt = Date.now()
    const finalSeed = seed < 0 ? Math.floor(Math.random() * 4294967295) : seed
    const effScale = fastMode ? Math.min(1, 640 / Math.max(width, height)) : 1
    const effW = Math.max(256, Math.round(width * effScale / 8) * 8)
    const effH = Math.max(256, Math.round(height * effScale / 8) * 8)
    const effSteps = fastMode ? Math.min(steps, 20) : steps
    startProgress(t('正在连接本地模型…'))
    try {
      const opts = {
        n: fastMode ? 1 : batch, size: `${effW}x${effH}`, width: effW, height: effH, sampler, steps: effSteps, cfgScale: cfg,
        seed: finalSeed, negativePrompt: negative.trim() || undefined,
        sourceImage: mode === 'img2img' ? sourceImage : undefined,
        strength: mode === 'img2img' ? strength : undefined,
      }
      let imgs: string[]
      if (isComfyUIBase(base)) {
        advanceProgress(20, t('正在构造 ComfyUI 工作流…'))
        const cr = await comfyGenerate(base, model, prompt.trim(), opts,
          (pct, label) => advanceProgress(pct, label, pct >= 40 ? 'generating' : 'queued'),
          () => alive.current)
        if (!alive.current) return
        if (!cr.ok) { failProgress(t('生成失败')); notify(cr.error ?? t('生成失败')); return }
        imgs = cr.images
      } else {
        advanceProgress(30, t('本地模型正在绘制…'))
        const r = await callLocalImage(base, model, prompt.trim(), opts)
        if (!alive.current) return
        if (!r.ok) { failProgress(t('生成失败')); notify(r.error ?? t('生成失败')); return }
        imgs = r.images ?? []
      }
      // 远程临时链接转本地缩略图（ComfyUI 返回的是 data URL，本身即本地副本）
      const thumbs = await Promise.all(imgs.map(u => urlToThumb(u)))
      setResults(imgs.map((u, i) => thumbs[i] || u))
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      doneProgress(t('生成完成 · 耗时 {secs}s', { secs }))
      const params = t('{mode} · {model} · {w}x{h} · {sampler} · {steps}步 · CFG {cfg} · seed {seed}', { mode, model, w: effW, h: effH, sampler, steps: effSteps, cfg, seed: finalSeed })
        + (mode === 'img2img' ? t(' · 重绘 {strength}', { strength }) : '')
      setLastParams(params)
      setHistory(addHistory('image', {
        id: newMediaId(), kind: 'image', prompt: prompt.trim(), accountLabel: t('本地 · {model}', { model }),
        model, createdAt: Date.now(), results: imgs, thumbs, params,
      }))
      notify(imgs.length ? t('已生成 {n} 张图片', { n: imgs.length }) : t('生成完成但未返回图片'))
      if (imgs.length) void autoSaveGeneratedMedia(imgs, 'image').then(saved => { if (saved.length) notify(t('已自动保存 {n} 个文件到数据存储文件夹', { n: saved.length })) })
    } catch (e) { if (alive.current) { failProgress(t('生成失败')); notify(errTextSafe(e)) } }
    finally { if (alive.current) setBusy(false) }
  }

  const download = async (url: string, idx: number) => {
    try { const loc = await saveMedia(url, 'image', `sd-local-${Date.now()}-${idx + 1}`); notify(t('已保存：{loc}', { loc })) }
    catch (e) { notify(errTextSafe(e)) }
  }
  const resetHistory = () => { clearHistory('image'); setHistory([]); notify(t('历史已清空')) }

  return (
    <div className="sd-page">
      {/* 顶部服务栏 */}
      <div className="sd-topbar">
        <div className="sd-brand"><span className="sd-brand-mark"><Sparkles size={17} /></span><div><b>{t('AI 图像 · 本地')}</b><small>{t('Stable Diffusion 风格 · 全流程本机运行')}</small></div></div>
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
        {/* 左：控制区 */}
        <section className="sd-control">
          <div className="sd-tabs">
            <button className={mode === 'txt2img' ? 'active' : ''} onClick={() => setMode('txt2img')}><Sparkles size={15} /> {t('文生图 txt2img')}</button>
            <button className={mode === 'img2img' ? 'active' : ''} onClick={() => setMode('img2img')}><ImageIcon size={15} /> {t('图生图 img2img')}</button>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><Settings2 size={15} /> {t('模型')}</div>
            {models.length > 0 ? (
              <select className="input" value={model} onChange={e => setModel(e.target.value)}>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="input" placeholder={t('点顶部「连接」拉取本地模型，或手填模型名')} value={model} onChange={e => setModel(e.target.value)} />
            )}
            <LocalModelInfoCard filename={model} />
          </div>

          <div className="sd-fast-row">
            <Zap size={14} className="sd-fast-icon" />
            <div className="sd-fast-text"><b>{t('极速模式')}</b><span>{t('生成时自动把最长边压到 640、步数上限 20、单张生成；M1 上明显更快、发热更低')}</span></div>
            <button className={`sd-fast-switch ${fastMode ? 'on' : ''}`} role="switch" aria-checked={fastMode} title={t('极速模式')} onClick={() => toggleFastMode(!fastMode)}><span className="sd-fast-dot" /></button>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">1</span> {t('提示词 Prompt')}<span className="sd-title-actions"><button className="sd-clear-btn" title={t('清空输入')} disabled={!prompt && !negative && !sourceImage} onClick={() => { setPrompt(''); setNegative(''); setSourceImage('') }}><Eraser size={13} /></button></span></div>
            <textarea className="sd-prompt" rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t('描述你想生成的画面：主体、动作、环境、镜头、光线、风格……')} />
            <div className="sd-prompt-hint">{t('支持英文标签权重，如 (masterpiece:1.2), best quality')}</div>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><span className="sd-num">2</span> {t('反向提示词 Negative prompt')}</div>
            <textarea className="sd-prompt sd-prompt-neg" rows={3} value={negative} onChange={e => setNegative(e.target.value)} placeholder={t('不想出现的元素：lowres, bad anatomy, watermark, text…')} />
          </div>

          {mode === 'img2img' && (
            <div className="sd-block">
              <div className="sd-block-title"><Upload size={15} /> {t('源图与重绘幅度')}</div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onPickImage(e.target.files?.[0])} />
              <div className="sd-img2img-row">
                <button className="btn sm ghost" onClick={() => fileRef.current?.click()}><Upload size={14} /> {t('上传源图')}</button>
                {sourceImage && <div className="sd-src-thumb"><img src={sourceImage} alt={t('源图')} /><button onClick={() => setSourceImage('')} title={t('移除')}><X size={13} /></button></div>}
              </div>
              <div className="sd-slider-row">
                <label>{t('重绘幅度')} <b>{strength.toFixed(2)}</b></label>
                <input type="range" min={0} max={1} step={0.05} value={strength} onChange={e => setStrength(Number(e.target.value))} />
                <div className="sd-slider-tips"><span>{t('低=保留原图')}</span><span>{t('高=自由发挥')}</span></div>
              </div>
            </div>
          )}

          <div className="sd-block">
            <div className="sd-block-title"><SlidersHorizontal size={15} /> {t('采样与参数')}</div>
            <div className="sd-param-grid">
              <div className="sd-field">
                <label>{t('采样方法')}</label>
                <div className="sd-select-wrap"><select className="input" value={sampler} onChange={e => setSampler(e.target.value)}>{SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}</select><ChevronDown size={13} /></div>
              </div>
              <div className="sd-field sd-seed-field">
                <label>{t('种子 Seed')}</label>
                <div className="sd-seed-row"><input className="input" type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /><button className="btn sm ghost" onClick={randomSeed} title={t('随机种子')}><Dices size={15} /></button></div>
              </div>
              <div className="sd-field">
                <label>{t('采样步数')} <b>{steps}</b></label>
                <input type="range" min={1} max={50} value={steps} onChange={e => setSteps(Number(e.target.value))} />
              </div>
              <div className="sd-field">
                <label>CFG Scale <b>{cfg}</b></label>
                <input type="range" min={1} max={30} step={0.5} value={cfg} onChange={e => setCfg(Number(e.target.value))} />
              </div>
              <div className="sd-field">
                <label>{t('生成张数')}</label>
                <select className="input" value={batch} onChange={e => setBatch(Number(e.target.value))}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{t('{n} 张', { n })}</option>)}</select>
              </div>
            </div>
          </div>

          <div className="sd-block">
            <div className="sd-block-title"><Maximize2 size={15} /> {t('尺寸')}</div>
            <div className="sd-ratio-row">{RATIOS.map(r => <button key={r.label} className={(width === r.w && height === r.h) ? 'active' : ''} onClick={() => { setWidth(r.w); setHeight(r.h) }}>{r.label}</button>)}</div>
            <div className="sd-size-row">
              <div className="sd-field"><label>{t('宽度')}</label><input className="input" type="number" step={64} value={width} onChange={e => setWidth(Number(e.target.value))} /></div>
              <span className="sd-size-x">×</span>
              <div className="sd-field"><label>{t('高度')}</label><input className="input" type="number" step={64} value={height} onChange={e => setHeight(Number(e.target.value))} /></div>
            </div>
          </div>

          <button className="sd-generate" onClick={() => void generate()} disabled={busy || !prompt.trim()}>
            {busy ? <><Loader2 size={18} className="spin" /> {t('生成中…')}</> : <><Sparkles size={18} /> {t('生成图片')}</>}
          </button>
          <GenProgressBar progress={progress} />
          <div className="sd-tip"><Info size={13} /> {t('自动识别服务类型：地址含 8188 或 comfyui 时走 ComfyUI 原生工作流（/prompt + /history），其余走 OpenAI 兼容接口。ComfyUI 需在桌面端使用。')}</div>
        </section>

        {/* 右：结果区 */}
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
                    <div className="sd-hist-head"><span>{new Date(h.createdAt).toLocaleString(locale())}</span><HoldToConfirm title={t('删除')} onConfirm={() => setHistory(removeHistory('image', h.id))} /></div>
                    <div className="sd-hist-prompt">{h.prompt}</div>
                    <div className="sd-hist-params">{h.params}</div>
                    <div className="sd-hist-thumbs">{h.results.map((u, i) => <SafeThumb key={i} src={h.thumbs?.[i] || u} fallbackSrc={u} className="gen-thumb" onClick={() => setLightbox(u)} />)}</div>
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> {t('清空历史')}</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="sd-gallery">
                {results.map((u, i) => (
                  <div className="sd-gallery-item" key={i} {...spaceOpenProps(() => setLightbox(u))} title={t('选中后按空格放大查看')}>
                    {/^data:|^https?:/.test(u) ? <img src={u} alt={t('结果 {n}', { n: i + 1 })} onMouseEnter={e => hz.enter(e, u, 'image')} onMouseLeave={hz.leave} /> : <div className="sd-gallery-text">{u}</div>}
                    <div className="sd-gallery-bar">
                      <span>#{i + 1}</span>
                      <button onClick={() => setLightbox(u)} title={t('放大')}><Maximize2 size={14} /></button>
                      <button onClick={() => void download(u, i)} title={t('下载')}><Download size={14} /></button>
                      {extOpen && <button onClick={() => void openWithViewer(u, 'image', notify)} title={t('用外部软件打开')}><AppWindow size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sd-empty"><ImageIcon size={44} /><p>{t('还没有生成图片')}</p><span>{t('在左侧填写提示词，点击「生成图片」开始')}</span></div>
            )}
          </div>
        </section>
      </div>

      <HoverZoomOverlay hover={hz.hover} />
      {lightbox && (() => {
        const idx = results.indexOf(lightbox)
        return (
          <div className="sd-lightbox" onClick={() => setLightbox('')}>
            <button className="sd-lightbox-close" onClick={() => setLightbox('')}><X size={24} /></button>
            <img src={lightbox} alt={t('大图预览')} onClick={e => e.stopPropagation()} />
            {idx >= 0 && <button className="sd-lightbox-dl" onClick={() => void download(lightbox, idx)}><Download size={15} /> {t('下载')}</button>}
          </div>
        )
      })()}
    </div>
  )
}
