// AI 视频生成模块：用自有视频账户的 API Key 调用 OpenAI 兼容视频生成接口。
// 支持文生视频 / 图生视频（上传首帧图）、时长与比例参数；异步任务提交后自动轮询状态，
// 拿到视频 URL 即可预览与下载；历史记录仅存本机 localStorage。

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Film, Sparkles, Loader2, Download, Trash2, Info, Eraser, AppWindow, KeyRound,
  ExternalLink, History, X, Upload, HardDrive, RefreshCw,
} from 'lucide-react'
import { callVideo, extractModelId, queryVideoTask, fetchProviderModels, filterMediaModels } from '../core/providerCall'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { ModelInfoCard } from './ModelInfoCard'
import { externalOpenEnabled, openWithViewer } from '../core/viewerPrefs'
import { useHoverZoom, HoverZoomOverlay, spaceOpenProps, videoResumeProps } from './mediaPreview'
import { GenProgressBar } from './GenProgressBar'
import { getGenTask, startGenTask, subscribeGenTask } from '../core/genTasks'
import { PROVIDER_MAP } from '../data/providers'
import { categoryFromNote } from '../core/modelCategories'
import {
  addHistory, clearHistory, loadHistory, newMediaId, removeHistory, saveMedia, errTextSafe, autoSaveGeneratedMedia,
  type MediaHistoryItem,
} from '../core/mediaGeneration'
import { HoldToConfirm } from './HoldToConfirm'
import type { Account, AppSettings } from '../core/types'
import { t, locale } from '../core/i18n'

const DURATIONS = [5, 10, 15]
const RATIOS = ['16:9', '9:16', '1:1']

export function VideoView({ accounts, sessionPwd, onUnlock, notify, onOpenLocal }: {
  accounts: Account[]; sessionPwd: string; onUnlock: (pwd: string) => void; notify: (m: string) => void; settings?: AppSettings; onOpenLocal?: () => void
}) {
  // 可用于生视频的账户：严格按「备注/用途」分类筛选——只列出标记为「视频型」的账户
  const usable = useMemo(() => accounts
    .filter(a => !!a.encryptedKey && a.apiUrl && categoryFromNote(a.note) === '视频型'), [accounts])
  const [accountId, setAccountId] = useState('')
  const account = usable.find(a => a.id === accountId) ?? usable[0]

  // 云端账户：该 Key 实际可用的视频模型（从 /v1/models 拉取并筛选）
  const [cloudModels, setCloudModels] = useState<string[]>([])
  const [cloudModel, setCloudModel] = useState('')
  // 模型说明卡默认隐藏（Ethan 要求）：拉取后点选模型、或点「说明」才展开
  const [modelInfoOpen, setModelInfoOpen] = useState(false)
  const [extOpen] = useState(() => externalOpenEnabled('video'))
  const hz = useHoverZoom()
  const [bigVideo, setBigVideo] = useState('')
  const [loadingCloudModels, setLoadingCloudModels] = useState(false)
  const loadCloudModels = async () => {
    const pwd = getBiometricPassword() || sessionPwd
    if (!account) { notify(t('请先选择账户')); return }
    if (!pwd) { notify(t('请先在主密码框解锁密钥库')); return }
    setLoadingCloudModels(true)
    try {
      const key = await decryptSecret(account.encryptedKey!, pwd)
      const all = await fetchProviderModels(account, key)
      const vids = filterMediaModels(all, 'video')
      setCloudModels(vids)
      setCloudModel(prev => vids.includes(prev) ? prev : (vids[0] ?? ''))
      notify(vids.length ? t('找到 {n} 个视频模型（已从 {total} 个模型中筛选）', { n: vids.length, total: all.length }) : t('该 Key 的 {total} 个模型里未识别出视频模型', { total: all.length }))
    } catch (e) { notify(t('拉取模型失败：{msg}', { msg: errTextSafe(e) })) }
    finally { setLoadingCloudModels(false) }
  }

  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(5)
  const [ratio, setRatio] = useState('16:9')
  const [firstFrame, setFirstFrame] = useState<string>('')  // 图生视频首帧 data URL
  const [pwdInput, setPwdInput] = useState('')
  const [history, setHistory] = useState<MediaHistoryItem[]>(() => loadHistory('video'))
  const [showHistory, setShowHistory] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // 生成任务在模块层运行（genTasks）：切走页面轮询不中断，回来接着看进度/结果
  const task = useSyncExternalStore(cb => subscribeGenTask('video', cb), () => getGenTask('video'))
  const busy = task.status === 'running'
  const results = task.results
  const taskText = task.note
  const progress = task.progress
  useEffect(() => { setHistory(loadHistory('video')) }, [])
  useEffect(() => { if (task.status === 'done' || task.status === 'error') setHistory(loadHistory('video')) }, [task.status])

  const model = account ? extractModelId(account) : ''
  const activeModel = cloudModel || model
  const needPwd = !!account && !!account.encryptedKey && !getBiometricPassword() && !sessionPwd

  const onPickFrame = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify(t('请选择图片文件')); return }
    const reader = new FileReader()
    reader.onload = () => setFirstFrame(String(reader.result))
    reader.readAsDataURL(file)
  }

  const generate = () => {
    if (!prompt.trim()) { notify(t('请先输入画面描述')); return }
    if (!account) { notify(onOpenLocal ? t('请先在「API Key 管理」添加带视频 API 地址的账户；本地生成请点右上角「本地生成」') : t('请先在「API Key 管理」添加带视频 API 地址的账户')); return }
    const pwd = getBiometricPassword() || sessionPwd
    if (!pwd) { notify(t('请先解锁密钥库（本页下方输入主密码）')); return }
    const useAccount = account
    const text = prompt.trim()
    const opts = { duration, ratio, image: firstFrame || undefined, model: cloudModel || undefined }
    const params = `${t('{d}秒', { d: duration })} · ${ratio}${firstFrame ? t(' · 图生视频') : ''}`
    const startedAt = Date.now()
    // 任务交给模块层管理器：切走页面轮询不中断（此前靠组件存活，切页即丢），
    // 轮询上限 15 分钟（此前仅 60 秒，云端视频普遍要几分钟，注定拿不到结果）
    const started = startGenTask('video', text, async (rep) => {
      rep.setLabel(t('正在提交视频任务…'), 'submitting')
      rep.setNote(t('正在提交生成任务…'))
      rep.advance(25, t('等待服务商响应…'), 'queued')
      const apiKey = await decryptSecret(useAccount.encryptedKey!, pwd)
      const r = await callVideo(useAccount, apiKey, text, opts)
      if (!r.ok) { notify(r.error ?? t('提交失败')); throw new Error(r.error ?? t('提交失败')) }

      let imgs = r.images ?? []
      let finalNote = ''
      if (imgs.length > 0) {
        rep.setNote(t('视频已生成'))
      } else {
        const idMatch = r.text.match(/ID:\s*([^）)\s]+)/)
        const taskId = idMatch?.[1]
        if (taskId) {
          rep.setNote(t('任务已提交（{id}…），正在查询进度…', { id: String(taskId).slice(0, 16) }))
          rep.advance(35, t('任务排队中…'), 'queued')
          const deadline = Date.now() + 15 * 60 * 1000
          let consecutiveErrors = 0
          let lastStatus = ''
          for (let i = 0; Date.now() < deadline; i++) {
            await new Promise(res => setTimeout(res, 5000))
            const q = await queryVideoTask(useAccount, apiKey, taskId)
            if (q.ok && q.images?.length) { imgs = q.images; break }
            if (!q.ok && q.error) {
              // 平台明确终态失败才中止；单次查询的网络/超时错误容忍，继续轮询
              if (q.error.startsWith('视频生成失败')) throw new Error(q.error)
              consecutiveErrors++
              if (consecutiveErrors >= 6) throw new Error(q.error)
              continue
            }
            if (q.ok) {
              consecutiveErrors = 0
              lastStatus = q.text || t('任务处理中…')
              rep.setNote(lastStatus)
              rep.advance(Math.min(85, 35 + (i + 1) * 2), q.text || t('视频生成中…'), 'generating')
            }
          }
          if (imgs.length > 0) rep.setNote(t('视频已生成'))
          else finalNote = t('{text}（等待 15 分钟仍未拿到视频地址，任务可能仍在平台处理，可到官方平台查看）', { text: lastStatus || r.text })
        } else {
          finalNote = r.text
          rep.setNote(r.text)
        }
      }
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      addHistory('video', {
        id: newMediaId(), kind: 'video', prompt: text,
        accountLabel: useAccount.label,
        model: activeModel, createdAt: Date.now(), results: imgs, params,
        note: imgs.length ? '' : (finalNote || r.text),
      })
      notify(imgs.length ? t('视频已生成') : t('视频任务已提交'))
      if (imgs.length) void autoSaveGeneratedMedia(imgs, 'video').then(saved => { if (saved.length) notify(t('已自动保存 {n} 个文件到数据存储文件夹', { n: saved.length })) })
      return {
        results: imgs,
        note: imgs.length ? t('视频已生成') : (finalNote || r.text),
        doneLabel: imgs.length ? t('生成完成 · 耗时 {secs}s', { secs }) : t('任务已提交 · 耗时 {secs}s', { secs }),
      }
    })
    if (!started) notify(t('已有生成任务进行中，请等待完成'))
  }

  const download = async (url: string, idx: number) => {
    try { const loc = await saveMedia(url, 'video', `ai-video-${Date.now()}-${idx + 1}`); notify(t('已保存：{loc}', { loc })) }
    catch (e) { notify((e as Error)?.message ?? t('保存失败')) }
  }

  const resetHistory = () => { clearHistory('video'); setHistory([]); notify(t('历史已清空')) }

  return (
    <div className="set-content">
      <div className="gen-layout">
        <section className="gen-panel">
          <div className="gen-panel-head"><span className="gen-head-icon"><Film size={18} /></span><div><h3>{t('AI 视频生成')}</h3><p>{t('输入画面描述，用你自己的视频账户生成短片')}</p></div>
            {onOpenLocal && <button className="btn sm ghost gen-local-entry" onClick={onOpenLocal} title={t('打开 ComfyUI 风格的本地生成页面')}><HardDrive size={14} /> {t('本地生成')}</button>}
          </div>
          <div className="gen-body">
            <label className="gen-label">{t('视频账户')}</label>
                {usable.length === 0 ? (
                  <div className="gen-empty-hint"><KeyRound size={16} /> {t('没有「视频型」账户。请到「API Key 管理」把对应账户的备注/用途分类设为视频型（备注以 [视频型] 开头），并确保已填 API 地址与密钥。')}</div>
                ) : (
                  <div className="gen-select-wrap">
                    <select className="input" value={account?.id ?? ''} onChange={e => { setAccountId(e.target.value); setCloudModels([]); setCloudModel(''); setModelInfoOpen(false) }}>
                      {usable.map(a => <option key={a.id} value={a.id}>{a.label} · {PROVIDER_MAP[a.providerId]?.shortName ?? a.providerId}</option>)}
                    </select>
                    {account && <span className="gen-model-tag">{t('从备注识别：{model}', { model: model || t('未填（可点下方拉取自动选）') })}</span>}
                  </div>
                )}
                <label className="gen-label" style={{ marginTop: 12 }}>{t('视频模型（仅列出可生视频模型）')}</label>
                <div className="gen-local-row">
                  {cloudModels.length > 0 ? (
                    <select className="input" value={cloudModel} onChange={e => { setCloudModel(e.target.value); setModelInfoOpen(true) }}>
                      {cloudModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input className="input" placeholder={t('点右侧拉取，或手填模型ID（如 MiniMaxAI/MiniMax-H3）')} value={cloudModel} onChange={e => setCloudModel(e.target.value)} />
                  )}
                  <button className="btn sm ghost" onClick={() => void loadCloudModels()} disabled={loadingCloudModels || !account} title={t('从平台拉取并筛选视频模型')}>
                    {loadingCloudModels ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {t('拉取')}
                  </button>
                  {(cloudModel || model) && (
                    <button className={`btn sm ghost ${modelInfoOpen ? 'primary' : ''}`} onClick={() => setModelInfoOpen(v => !v)} title={t('查看所选模型的优缺点说明')}>
                      <Info size={14} /> {t('说明')}
                    </button>
                  )}
                </div>
                {modelInfoOpen && <ModelInfoCard modelId={cloudModel || model} kind="video" />}

            <div className="gen-label-row">
              <label className="gen-label">{t('画面描述（Prompt）')}</label>
              <button className="gen-clear-btn" title={t('清空输入')} disabled={!prompt || busy} onClick={() => setPrompt('')}><Eraser size={14} /></button>
            </div>
            <textarea className="input gen-prompt" rows={4} placeholder={t('例如：一只金毛犬在秋天的落叶中奔跑，阳光透过树叶洒下，电影质感，慢镜头')}
              value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} />

            <label className="gen-label">{t('首帧图片（可选，用于图生视频）')}</label>
            <div className="gen-frame-row">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => onPickFrame(e.target.files?.[0])} />
              <button className="btn sm ghost" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14} /> {t('上传首帧图')}</button>
              {firstFrame ? (
                <div className="gen-frame-preview">
                  <img src={firstFrame} alt={t('首帧预览')} />
                  <button title={t('移除')} onClick={() => setFirstFrame('')}><X size={14} /></button>
                </div>
              ) : <span className="gen-frame-hint">{t('不上传则为文生视频')}</span>}
            </div>

            <div className="gen-grid-2">
              <div>
                <label className="gen-label">{t('视频时长')}</label>
                <select className="input" value={duration} onChange={e => setDuration(Number(e.target.value))} disabled={busy}>
                  {DURATIONS.map(d => <option key={d} value={d}>{t('{d} 秒', { d })}</option>)}
                </select>
              </div>
              <div>
                <label className="gen-label">{t('画面比例')}</label>
                <select className="input" value={ratio} onChange={e => setRatio(e.target.value)} disabled={busy}>
                  {RATIOS.map(r => <option key={r} value={r}>{r}</option>)}
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
              {busy ? <><Loader2 size={16} className="spin" /> {t('生成中…')}</> : <><Sparkles size={16} /> {t('生成视频')}</>}
            </button>
            <GenProgressBar progress={progress} />
            <div className="gen-tip"><Info size={13} /> {t('视频多为异步任务制，提交后会尝试自动查询进度；若平台为私有协议无法自动拿到结果，界面会给出引导。')}{onOpenLocal ? t('本地生成请点右上角「本地生成」进入专业页面。') : ''}</div>
          </div>
        </section>

        <section className="gen-panel">
          <div className="gen-panel-head">
            <span className="gen-head-icon"><Sparkles size={18} /></span>
            <div><h3>{t('生成结果')}</h3><p>{taskText || t('生成后的视频会显示在这里')}</p></div>
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
                      <HoldToConfirm title={t('删除')} onConfirm={() => setHistory(removeHistory('video', h.id))} className="sm" />
                    </div>
                    <div className="gen-hist-prompt">{h.prompt}</div>
                    <div className="gen-hist-meta">{h.accountLabel} · {h.params}</div>
                    {h.results.length > 0 ? (
                      <div className="gen-thumbs">
                        {h.results.map((u, i) => <video key={i} src={u} className="gen-thumb" controls={false} muted onClick={() => setBigVideo(u)} />)}
                      </div>
                    ) : h.note ? <div className="gen-hist-note">{h.note}</div> : null}
                  </div>
                ))}
                {history.length > 0 && <button className="btn sm ghost" onClick={resetHistory}><Trash2 size={13} /> {t('清空历史')}</button>}
              </div>
            ) : results.length > 0 ? (
              <div className="gen-results">
                {results.map((u, i) => (
                  <div className="gen-result-card" key={i} {...spaceOpenProps(() => setBigVideo(u))} title={t('选中后按空格放大查看')}>
                    <video src={u} controls className="gen-result-video" playsInline
                      onMouseEnter={e => { videoResumeProps.onMouseEnter(e); hz.enter(e, u, 'video') }}
                      onMouseLeave={e => { videoResumeProps.onMouseLeave(e); hz.leave() }} />
                    <div className="gen-result-actions">
                      <button className="btn sm ghost" onClick={() => setBigVideo(u)} title={t('在应用内放大查看')}><ExternalLink size={13} /> {t('打开')}</button>
                      <button className="btn sm ghost" onClick={() => void download(u, i)}><Download size={13} /> {t('下载')}</button>
                      {extOpen && <button className="btn sm ghost" onClick={() => void openWithViewer(u, 'video', notify)}><AppWindow size={13} /> {t('外部打开')}</button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gen-empty">
                <Film size={40} />
                <p>{t('还没有生成视频')}</p>
                <span>{t('在左侧输入画面描述，点击「生成视频」即可开始')}</span>
              </div>
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
