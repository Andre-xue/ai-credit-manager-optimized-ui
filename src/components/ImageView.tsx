// AI 图像生成模块：用自有生图账户的 API Key 调用 OpenAI 兼容 /images/generations。
// 支持文生图参数（尺寸/数量/质量/风格），结果预览与下载，历史记录仅存本机 localStorage。

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Image as ImageIcon, Sparkles, Loader2, Download, Trash2, Info, Eraser, AppWindow, KeyRound,
  ExternalLink, History, HardDrive, RefreshCw, ChevronDown, X,
} from 'lucide-react'
import { callImage, extractModelId, fetchProviderModels, filterMediaModels } from '../core/providerCall'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { ModelInfoCard } from './ModelInfoCard'
import { externalOpenEnabled, openWithViewer } from '../core/viewerPrefs'
import { useHoverZoom, HoverZoomOverlay, spaceOpenProps } from './mediaPreview'
import { GenProgressBar } from './GenProgressBar'
import { getGenTask, startGenTask, subscribeGenTask } from '../core/genTasks'
import { SafeThumb } from './SafeThumb'
import { PROVIDER_MAP } from '../data/providers'
import { categoryFromNote } from '../core/modelCategories'
import {
  addHistory, clearHistory, loadHistory, newMediaId, removeHistory, saveMedia, errTextSafe, urlsToThumbs, autoSaveGeneratedMedia,
  type MediaHistoryItem,
} from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import type { Account, AppSettings } from '../core/types'
import { t, locale } from '../core/i18n'

const SIZES = ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '512x512']
const QUALITIES = ['', 'standard', 'hd']
const STYLES = ['', 'vivid', 'natural']

export function ImageView({ accounts, sessionPwd, onUnlock, notify, onOpenLocal }: {
  accounts: Account[]; sessionPwd: string; onUnlock: (pwd: string) => void; notify: (m: string) => void; settings?: AppSettings; onOpenLocal?: () => void
}) {
  // 可用于生图的账户：严格按「备注/用途」分类筛选——只列出标记为「生图型」的账户
  const usable = useMemo(() => accounts
    .filter(a => !!a.encryptedKey && a.apiUrl && categoryFromNote(a.note) === '生图型'), [accounts])
  const [accountId, setAccountId] = useState('')
  const account = usable.find(a => a.id === accountId) ?? usable[0]

  // 云端账户：该 Key 实际可用的生图模型（从 /v1/models 拉取并筛选）
  const [cloudModels, setCloudModels] = useState<string[]>([])
  const [cloudModel, setCloudModel] = useState('')
  // 模型说明卡默认隐藏（Ethan 要求）：拉取后点选模型、或点「说明」才展开
  const [modelInfoOpen, setModelInfoOpen] = useState(false)
  const [extOpen] = useState(() => externalOpenEnabled('image'))
  const hz = useHoverZoom()
  const [lightbox, setLightbox] = useState('')
  const [loadingCloudModels, setLoadingCloudModels] = useState(false)
  const loadCloudModels = async () => {
    const pwd = getBiometricPassword() || sessionPwd
    if (!account) { notify(t('请先选择账户')); return }
    if (!pwd) { notify(t('请先在主密码框解锁密钥库')); return }
    setLoadingCloudModels(true)
    try {
      const key = await decryptSecret(account.encryptedKey!, pwd)
      const all = await fetchProviderModels(account, key)
      const imgs = filterMediaModels(all, 'image')
      setCloudModels(imgs)
      setCloudModel(prev => imgs.includes(prev) ? prev : (imgs[0] ?? ''))
      notify(imgs.length ? t('找到 {n} 个生图模型（已从 {total} 个模型中筛选）', { n: imgs.length, total: all.length }) : t('该 Key 的 {total} 个模型里未识别出生图模型', { total: all.length }))
    } catch (e) { notify(t('拉取模型失败：{msg}', { msg: errTextSafe(e) })) }
    finally { setLoadingCloudModels(false) }
  }

  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [quality, setQuality] = useState('')
  const [style, setStyle] = useState('')
  const [count, setCount] = useState(1)
  const [pwdInput, setPwdInput] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('image'))
  const [showHistory, setShowHistory] = useState(false)
  // 生成任务在模块层运行（genTasks）：切走页面不中断，回来接着看进度/结果
  const task = useSyncExternalStore(cb => subscribeGenTask('image', cb), () => getGenTask('image'))
  const busy = task.status === 'running'
  const results = task.results
  const lastNote = task.note
  const progress = task.progress

  useEffect(() => { setHistory(loadHistory('image')) }, [])
  // 任务在别处（切走期间）完成时，回到页面刷新历史列表
  useEffect(() => { if (task.status === 'done' || task.status === 'error') setHistory(loadHistory('image')) }, [task.status])

  const model = account ? extractModelId(account) : ''
  const activeModel = cloudModel || model
  const needPwd = !!account && !!account.encryptedKey && !getBiometricPassword() && !sessionPwd

  const generate = () => {
    if (!prompt.trim()) { notify(t('请先输入画面描述')); return }
    if (!account) { notify(onOpenLocal ? t('请先在「API Key 管理」添加带生图 API 地址的账户；本地生图请点右上角「本地生成」') : t('请先在「API Key 管理」添加带生图 API 地址的账户')); return }
    const pwd = getBiometricPassword() || sessionPwd
    if (!pwd) { notify(t('请先解锁密钥库（本页下方输入主密码）')); return }
    const useAccount = account
    const text = prompt.trim()
    const opts = { size, n: count, quality: quality || undefined, style: style || undefined, model: cloudModel || undefined }
    const startedAt = Date.now()
    // 任务交给模块层管理器：切走页面继续跑，完成自动落历史，回来能看到结果
    const started = startGenTask('image', text, async (rep) => {
      rep.setLabel(t('正在提交生成请求…'), 'submitting')
      rep.advance(30, t('服务商正在生成图片…'))
      const r = await callImage(useAccount, await decryptSecret(useAccount.encryptedKey!, pwd), text, opts)
      if (!r.ok) { notify(r.error ?? t('生成失败')); throw new Error(r.error ?? t('生成失败')) }
      const imgs = r.images ?? []
      const thumbs = await urlsToThumbs(imgs)
      const params = [size, quality || '', style || '', t('{count}张', { count })].filter(Boolean).join(' · ')
      addHistory('image', {
        id: newMediaId(), kind: 'image', prompt: text,
        accountLabel: useAccount.label, model: activeModel, createdAt: Date.now(), results: imgs, thumbs, params,
      })
      notify(imgs.length ? t('已生成 {n} 张图片', { n: imgs.length }) : r.text)
      if (imgs.length) void autoSaveGeneratedMedia(imgs, 'image').then(saved => { if (saved.length) notify(t('已自动保存 {n} 个文件到数据存储文件夹', { n: saved.length })) })
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      // 展示用本地缩略图副本（不依赖可能过期的远程链接），失败回退原 URL
      return { results: imgs.map((u, i) => thumbs[i] || u), note: r.text, doneLabel: t('生成完成 · 耗时 {secs}s', { secs }) }
    })
    if (!started) notify(t('已有生成任务进行中，请等待完成'))
  }

  const download = async (url: string, idx: number) => {
    try {
      const loc = await saveMedia(url, 'image', `ai-image-${Date.now()}-${idx + 1}`)
      notify(t('已保存：{loc}', { loc }))
    } catch (e) { notify((e as Error)?.message ?? t('保存失败')) }
  }

  const resetHistory = () => { clearHistory('image'); setHistory([]); notify(t('历史已清空')) }

  return (
    <div className="set-content">
      <div className="gen-layout">
        {/* 左：生成控制 */}
        <section className="gen-panel">
          <div className="gen-panel-head"><span className="gen-head-icon"><ImageIcon size={18} /></span><div><h3>{t('AI 图像生成')}</h3><p>{t('输入画面描述，用你自己的生图账户生成图片')}</p></div>
            {onOpenLocal && <button className="btn sm ghost gen-local-entry" onClick={onOpenLocal} title={t('打开 SD 风格的本地生成页面')}><HardDrive size={14} /> {t('本地生成')}</button>}
          </div>
          <div className="gen-body">
            <label className="gen-label">{t('生图账户')}</label>
                {usable.length === 0 ? (
                  <div className="gen-empty-hint"><KeyRound size={16} /> {t('没有「生图型」账户。请到「API Key 管理」把对应账户的备注/用途分类设为生图型（备注以 [生图型] 开头），并确保已填 API 地址与密钥。')}</div>
                ) : (
                  <div className="gen-select-wrap">
                    <select className="input" value={account?.id ?? ''} onChange={e => { setAccountId(e.target.value); setCloudModels([]); setCloudModel(''); setModelInfoOpen(false) }}>
                      {usable.map(a => <option key={a.id} value={a.id}>{a.label} · {PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId}</option>)}
                    </select>
                    {account && <span className="gen-model-tag">{t('从备注识别：{model}', { model: model || t('未填（可点下方拉取自动选）') })}</span>}
                  </div>
                )}
                <label className="gen-label" style={{ marginTop: 12 }}>{t('生图模型（仅列出可生图模型）')}</label>
                <div className="gen-local-row">
                  {cloudModels.length > 0 ? (
                    <select className="input" value={cloudModel} onChange={e => { setCloudModel(e.target.value); setModelInfoOpen(true) }}>
                      {cloudModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input className="input" placeholder={t('点右侧拉取，或手填模型ID（如 Kwai-Kolors/Kolors）')} value={cloudModel} onChange={e => setCloudModel(e.target.value)} />
                  )}
                  <button className="btn sm ghost" onClick={() => void loadCloudModels()} disabled={loadingCloudModels || !account} title={t('从平台拉取并筛选生图模型')}>
                    {loadingCloudModels ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {t('拉取')}
                  </button>
                  {(cloudModel || model) && (
                    <button className={`btn sm ghost ${modelInfoOpen ? 'primary' : ''}`} onClick={() => setModelInfoOpen(v => !v)} title={t('查看所选模型的优缺点说明')}>
                      <Info size={14} /> {t('说明')}
                    </button>
                  )}
                </div>
                {modelInfoOpen && <ModelInfoCard modelId={cloudModel || model} kind="image" />}

            <div className="gen-label-row">
              <label className="gen-label">{t('画面描述（Prompt）')}</label>
              <button className="gen-clear-btn" title={t('清空输入')} disabled={!prompt || busy} onClick={() => setPrompt('')}><Eraser size={14} /></button>
            </div>
            <textarea className="input gen-prompt" rows={4} placeholder={t('例如：赛博朋克风格的城市夜景，霓虹灯倒映在雨后的街道，电影质感')}
              value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} />

            <div className="gen-grid-2">
              <div>
                <label className="gen-label">{t('图片尺寸')}</label>
                <div className="gen-select-wrap">
                  <select className="input" value={size} onChange={e => setSize(e.target.value)} disabled={busy}>
                    {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <ChevronDown size={14} className="gen-select-chevron" />
                </div>
              </div>
              <div>
                <label className="gen-label">{t('生成张数')}</label>
                <select className="input" value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy}>
                  {[1, 2, 3, 4].map(n => <option key={n} value={n}>{t('{n} 张', { n })}</option>)}
                </select>
              </div>
              <div>
                <label className="gen-label">{t('质量（可选）')}</label>
                <select className="input" value={quality} onChange={e => setQuality(e.target.value)} disabled={busy}>
                  {QUALITIES.map(q => <option key={q} value={q}>{q || t('默认')}</option>)}
                </select>
              </div>
              <div>
                <label className="gen-label">{t('风格（可选）')}</label>
                <select className="input" value={style} onChange={e => setStyle(e.target.value)} disabled={busy}>
                  {STYLES.map(s => <option key={s} value={s}>{s || t('默认')}</option>)}
                </select>
              </div>
            </div>

            {needPwd && (
              <div className="gen-pwd-gate">
                <Info size={14} /> {t('该账户密钥已加密，请输入主密码解锁本次会话：')}
                <div className="gen-pwd-row">
                  <input className="input" type="password" placeholder={t('主密码')} value={pwdInput} onChange={e => setPwdInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && pwdInput) onUnlock(pwdInput) }} />
                  <button className="btn sm" disabled={!pwdInput} onClick={() => { onUnlock(pwdInput); setPwdInput('') }}>{t('解锁')}</button>
                </div>
              </div>
            )}

            <button className="btn primary gen-generate" onClick={() => void generate()} disabled={busy || !prompt.trim() || !account}>
              {busy ? <><Loader2 size={16} className="spin" /> {t('正在生成…')}</> : <><Sparkles size={16} /> {t('生成图片')}</>}
            </button>
            <GenProgressBar progress={progress} />
            <div className="gen-tip"><Info size={13} /> <span>{t('生图走账户 API 地址对应的 OpenAI 兼容 images/generations 接口；若平台为私有协议会返回错误提示。')}{onOpenLocal ? t('本地生图请点右上角「本地生成」进入专业页面。') : ''}</span></div>
          </div>
        </section>

        {/* 右：结果 + 历史 */}
        <section className="gen-panel">
          <div className="gen-panel-head">
            <span className="gen-head-icon"><Sparkles size={18} /></span>
            <div><h3>{t('生成结果')}</h3><p>{lastNote || t('生成后的图片会显示在这里')}</p></div>
            <button className="btn sm ghost gen-hist-btn" onClick={() => setShowHistory(v => !v)}><History size={14} /> {showHistory ? t('返回预览') : t('历史 ({n})', { n: history.length })}</button>
          </div>
          <div className="gen-body">
            {showHistory ? (
              <div className="gen-history">
                {history.length === 0 && <div className="gen-empty">{t('暂无历史记录')}</div>}
                {history.map(h => (
                  <div className="gen-hist-item" key={h.id}>
                    <div className="gen-hist-top">
                      <span className="gen-hist-time">{new Date(h.createdAt).toLocaleString(locale())}</span>
                      <HoldToConfirm title={t('删除')} onConfirm={() => setHistory(removeHistory('image', h.id))} className="sm" />
                    </div>
                    <div className="gen-hist-prompt">{h.prompt}</div>
                    <div className="gen-hist-meta">{h.accountLabel} · {h.params}</div>
                    <div className="gen-thumbs">
                      {h.results.map((u, i) => <SafeThumb key={i} src={h.thumbs?.[i] || u} fallbackSrc={u} className="gen-thumb" onClick={() => setLightbox(u)} />)}
                    </div>
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> {t('清空历史')}</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="gen-results">
                {results.map((u, i) => (
                  <div className="gen-result-card" key={i} {...spaceOpenProps(() => setLightbox(u))} title={t('选中后按空格放大查看')}>
                    {u.startsWith('data:') || /^https?:\/\//.test(u)
                      ? <img src={u} alt={t('生成图片 {n}', { n: i + 1 })} className="gen-result-img" style={{ cursor: 'zoom-in' }} onClick={() => setLightbox(u)} onMouseEnter={e => hz.enter(e, u, 'image')} onMouseLeave={hz.leave} />
                      : <div className="gen-result-text">{u}</div>}
                    <div className="gen-result-actions">
                      <button className="btn sm ghost" onClick={() => setLightbox(u)} title={t('在应用内放大查看')}><ExternalLink size={13} /> {t('打开')}</button>
                      <button className="btn sm ghost" onClick={() => void download(u, i)}><Download size={13} /> {t('下载')}</button>
                      {extOpen && <button className="btn sm ghost" onClick={() => void openWithViewer(u, 'image', notify)}><AppWindow size={13} /> {t('外部打开')}</button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gen-empty">
                <ImageIcon size={40} />
                <p>{t('还没有生成图片')}</p>
                <span>{t('在左侧输入画面描述，点击「生成图片」即可开始')}</span>
              </div>
            )}
          </div>
        </section>
      </div>
      <HoverZoomOverlay hover={hz.hover} />
      {lightbox && (
        <div className="sd-lightbox" onClick={() => setLightbox('')}>
          <button className="sd-lightbox-close" onClick={() => setLightbox('')}><X size={24} /></button>
          <img src={lightbox} alt={t('大图预览')} onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
