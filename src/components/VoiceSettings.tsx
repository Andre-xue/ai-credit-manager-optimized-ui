// 「语音配置」独立模块：声音克隆（录音/音频文件 → AI 发音）、已保存音色管理、
// 语速、试听、声音服务目录、第三方 TTS 代理配置。
// 系统内置音色/拟真预设/方言已从界面移除；未克隆时底层仍用系统 TTS 兜底，避免 AI 完全无声。

import { useEffect, useState, useRef } from 'react'
import { Volume2, Play, Square, Trash2, Loader2, Info, Mic, Check, Pencil } from 'lucide-react'
import { HoldToConfirm } from './HoldToConfirm'
import {
  getRate, saveRate, stopSpeak, getSpeakSource, speakAsync, playAudioDataUrl,
} from '../core/tts'
import {
  loadVoiceSample, saveVoiceSample, deleteVoiceSample, recordVoiceSample,
  cloneVoiceFromSample, getClonedVoiceId, listClonedVoices, removeClonedVoice, addClonedVoice,
  setActiveClonedVoice, renameClonedVoice, blobToWav, trimAudioBlob, MAX_REF_AUDIO_SECONDS, type VoiceSample, type ClonedVoice,
  type CloneStage,
} from '../core/voiceClone'
import { isDesktopApp } from '../core/openExternal'
import { VOICE_PROVIDERS } from '../core/voiceProviders'
import {
  hasTtsConfig, getTtsConfig, saveTtsConfig, clearTtsConfig,
  type TtsProviderConfig,
} from '../core/voice-download'
import {
  getVolcConfig, saveVolcConfig, clearVolcConfig, type VolcConfig,
} from '../core/volcConfig'
import { ttsTestDirect, voicestudioTest, voicestudioList } from '../core/ttsDirect'
import { EDGE_VOICES, getEdgeVoiceId, setEdgeVoiceId, getSpeakPref, setSpeakPref } from '../core/edgeTts'
import { qwenTtsStatus, qwenTtsSetup, qwenTtsTest, qwenTtsWarmup, getQwenWarmupState, formatCloneElapsed, QWEN_CLONE_SLOW_HINT_S, deleteQwenVoiceRef, isQwenVoiceId, type QwenTtsStatus, type QwenWarmupState } from '../core/qwenTts'
import { transcribeWithDashScope, cloudAsrConfigured } from '../core/asr'
import { t } from '../core/i18n'
import { verifyVault, getBiometricPassword } from '../core/crypto'
import { voiceNeedsUnlock, setVoiceSessionPwd, hasVoiceCredential } from '../core/voiceKey'
import type { Account } from '../core/types'
import { ServiceSwitch } from './ServiceSwitch'
import type { ServiceController } from '../core/useServiceController'
import { LOCAL_SERVICE_CHANGED_EVENT } from '../core/localServicesSettings'
import { startLocalService } from '../core/localServices'

export function VoiceSettings({ notify, accounts, sessionPwd, onUnlock, serviceController }: {
  notify: (m: string) => void
  accounts: Account[]
  sessionPwd: string
  onUnlock: (pwd: string) => void
  serviceController?: ServiceController
}) {
  const [rate, setRate] = useState(getRate())
  const [ttsConfigured, setTtsConfigured] = useState(hasTtsConfig() || accounts.some(a => a.providerId === 'voice-config'))
  const [config, setConfig] = useState<TtsProviderConfig>(() => getTtsConfig())
  const [testingKey, setTestingKey] = useState(false)
  const [importingVoices, setImportingVoices] = useState(false)
  // 语音配置账户解锁（生物识别免密 / 本次会话密码）
  const [voicePwdInput, setVoicePwdInput] = useState('')
  const [voiceUnlocking, setVoiceUnlocking] = useState(false)
  const needVoiceUnlock = voiceNeedsUnlock(accounts, config.provider || undefined)
  const voiceUnlocked = hasVoiceCredential() || !!sessionPwd

  const unlockVoice = async () => {
    if (!voicePwdInput) { notify(t('请输入主密码')); return }
    setVoiceUnlocking(true)
    try {
      const ok = await verifyVault(voicePwdInput)
      if (!ok) { notify(t('主密码错误')); return }
      setVoiceSessionPwd(voicePwdInput)
      onUnlock(voicePwdInput)
      setVoicePwdInput('')
      notify(t('已解锁，本次会话语音功能可读取加密 Key'))
    } finally { setVoiceUnlocking(false) }
  }
  const [previewing, setPreviewing] = useState(false)
  // 试听合成进度（v0.1.428）：Qwen 合成进行中显示「合成中…已等待 X 秒」+可取消
  const [previewSynth, setPreviewSynth] = useState<number | null>(null)
  const previewCancelRef = useRef<{ cancelled: boolean } | null>(null)
  // 服务没开时试听横条（v0.1.428）：明确提示 + 一键开启入口
  const [qwenOff, setQwenOff] = useState(false)
  const previewHandledRef = useRef(false)
  // 克隆成功后播放试合成音频（v0.1.428）
  const [clonePreviewPlaying, setClonePreviewPlaying] = useState(false)
  const [sample, setSample] = useState<VoiceSample | null>(null)
  const [clonedId, setClonedId] = useState<string | null>(() => getClonedVoiceId())
  const [edgeVoice, setEdgeVoiceState] = useState<string>(() => getEdgeVoiceId())
  const [edgeActive, setEdgeActive] = useState<boolean>(() => getSpeakPref() === 'edge')
  const [edgePreviewing, setEdgePreviewing] = useState(false)
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>(() => listClonedVoices())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')
  // Qwen 克隆分阶段进度（v0.1.415）：真实阶段 + 已等待秒数，不假造百分比
  const [cloneStage, setCloneStage] = useState<CloneStage | null>(null)
  const [cloneElapsed, setCloneElapsed] = useState(0)
  const cloneTimerRef = useRef<number | null>(null)
  const cloneStartRef = useRef(0)
  const [volcConfig, setVolcConfig] = useState<VolcConfig>(() => getVolcConfig())
  // Qwen3-TTS 本地克隆（桌面端 Apple 芯片 Mac）：安装/运行状态、参考音频原文
  const [qwenStatus, setQwenStatus] = useState<QwenTtsStatus | null>(null)
  const [qwenLoading, setQwenLoading] = useState(false)
  const [qwenSettingUp, setQwenSettingUp] = useState(false)
  const [qwenTesting, setQwenTesting] = useState(false)
  const [qwenWarmup, setQwenWarmup] = useState<QwenWarmupState>(() => getQwenWarmupState())
  const [refText, setRefText] = useState('')
  const [refTranscribing, setRefTranscribing] = useState(false)
  // 横向标题页签（v0.1.401，同看剧 394 样式），切换状态记本机
  type VoiceTab = 'edge' | 'clone' | 'saved' | 'third' | 'volc'
  const [activeTab, setActiveTab] = useState<VoiceTab>(() => {
    try {
      const v = localStorage.getItem('acm.voice.tab')
      return v === 'clone' || v === 'saved' || v === 'third' || v === 'volc' ? v : 'edge'
    } catch { return 'edge' }
  })
  const switchTab = (tab: VoiceTab) => {
    setActiveTab(tab)
    try { localStorage.setItem('acm.voice.tab', tab) } catch { /* ignore */ }
  }
  const desktop = isDesktopApp()
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { void loadVoiceSample().then(setSample) }, [])
  useEffect(() => { if (desktop) { void qwenTtsStatus().then(setQwenStatus).catch(() => {}); setQwenWarmup(getQwenWarmupState()) } }, [])
  // 预热进行中时轮询模块状态，直到预热完成/失败（服务开关处后台触发的预热也会同步到这里）
  useEffect(() => {
    if (qwenWarmup !== 'warming') return
    const id = window.setInterval(() => {
      const s = getQwenWarmupState()
      setQwenWarmup(s)
      if (s !== 'warming') window.clearInterval(id)
    }, 2000)
    return () => window.clearInterval(id)
  }, [qwenWarmup])
  // 卸载时停掉克隆秒表
  useEffect(() => () => { if (cloneTimerRef.current) window.clearInterval(cloneTimerRef.current) }, [])

  const tryPreview = async () => {
    // 正在试听/合成中：再点一次即取消（v0.1.428：合成卡住时可取消，不干等）
    if (previewing) {
      if (previewCancelRef.current) previewCancelRef.current.cancelled = true
      stopSpeak()
      setPreviewing(false)
      setPreviewSynth(null)
      return
    }
    if (getSpeakSource() !== 'clone') {
      notify(t('当前没有可用的克隆音色，请先在下方导入声音样本并克隆'))
      return
    }
    // Qwen 音色：服务没开时先提示、不调合成、不播系统音色（v0.1.428）
    const activeId = getClonedVoiceId()
    if (activeId && isQwenVoiceId(activeId)) {
      const st = await qwenTtsStatus()
      setQwenStatus(st)
      if (!st.running) {
        if (!desktop) { notify('Qwen3-TTS 本地服务仅桌面端支持，手机上无法试听克隆音色'); return }
        setQwenOff(true)
        notify('Qwen3-TTS 服务没开：请先打开服务开关再试听')
        return
      }
    }
    setPreviewing(true)
    setQwenOff(false)
    previewHandledRef.current = false
    const token = { cancelled: false }
    previewCancelRef.current = token
    void speakAsync(t('你好，这是当前克隆音色的试听。'), null, (s) => {
      if (s === 'start') setPreviewSynth(null)
      if (s === 'end' || s === 'error') { setPreviewing(false); setPreviewSynth(null) }
    }, (reason) => { notify(reason); setPreviewing(false); setPreviewSynth(null) }, {
      onSynthProgress: (el) => setPreviewSynth(el),
      cancelToken: token,
      onQwenServiceOff: (msg) => {
        previewHandledRef.current = true
        setQwenOff(true)
        setPreviewing(false)
        setPreviewSynth(null)
        notify(msg)
      },
    }).then(ok => {
      if (!ok) {
        setPreviewing(false)
        setPreviewSynth(null)
        // 服务没开/用户取消已有专门提示，不再补一句笼统的「试听失败」
        if (!previewHandledRef.current && !token.cancelled) notify(t('克隆音色试听失败'))
      }
    })
  }

  /** 服务没开横条上的一键开启（v0.1.428）：开关没开就打开开关；开关开着但进程没跑就直接拉起 */
  const startQwenForPreview = async () => {
    if (!serviceController) {
      notify('请到「设置 → 本地模型服务」打开 Qwen3-TTS 开关')
      return
    }
    if (!serviceController.enabled('qwentts')) {
      await serviceController.toggle('qwentts')
    } else {
      const r = await startLocalService('qwentts')
      notify(r.message)
    }
    // 等服务真正监听上再收起横条（模型加载约 5~30 秒，轮询最多 60 秒）
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const st = await qwenTtsStatus()
      setQwenStatus(st)
      if (st.running) { setQwenOff(false); return }
    }
    await refreshQwenStatus()
  }

  const changeRate = (r: number) => { setRate(r); saveRate(r) }

  const isDirect = (config.mode ?? 'direct') === 'direct'
  const isVoiceStudio = config.provider === 'voicestudio'
  const isQwenTts = config.provider === 'qwentts'

  /** 刷新 Qwen3-TTS 本地服务状态（安装/Python/模型/运行）+ 同步预热状态 */
  const refreshQwenStatus = async () => {
    setQwenLoading(true)
    try {
      const st = await qwenTtsStatus()
      setQwenStatus(st)
      if (st.running) setQwenOff(false)
      setQwenWarmup(getQwenWarmupState())
    } finally { setQwenLoading(false) }
  }

  // 服务开关在别处（设置页）切换时，同步刷新本页的 Qwen 状态徽标（v0.1.427）
  useEffect(() => {
    const onSvc = (e: Event) => {
      if ((e as CustomEvent<{ key?: string }>).detail?.key === 'qwentts') void refreshQwenStatus()
    }
    window.addEventListener(LOCAL_SERVICE_CHANGED_EVENT, onSvc)
    return () => window.removeEventListener(LOCAL_SERVICE_CHANGED_EVENT, onSvc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Qwen3-TTS 首次安装（几分钟：建 venv → pip 装 mlx-tts-server → 预下载约 1GB 模型） */
  const doQwenSetup = async () => {
    setQwenSettingUp(true)
    try {
      notify(t('正在安装 Qwen3-TTS（首次需下载约 1GB 模型，请保持网络畅通、耐心等待几分钟）…'))
      const r = await qwenTtsSetup()
      notify(r.message)
      await refreshQwenStatus()
    } finally { setQwenSettingUp(false) }
  }

  const doQwenTest = async () => {
    setQwenTesting(true)
    try { const r = await qwenTtsTest(); notify(r.message) } finally { setQwenTesting(false) }
  }

  /** 手动预热模型：做一次空合成触发服务端首次加载，之后第一次真正的克隆就不再等加载 */
  const doQwenWarmup = async () => {
    setQwenWarmup('warming')
    const r = await qwenTtsWarmup()
    setQwenWarmup(getQwenWarmupState())
    notify(r.message)
  }

  /** 用百炼 ASR 识别样本说的内容，填入参考音频原文（需已配百炼 Key） */
  const doTranscribeRef = async () => {
    if (!sample) return
    setRefTranscribing(true)
    try {
      const text = await transcribeWithDashScope(sample.dataUrl)
      if (!text) { notify(t('未识别到内容，请手动填写')); return }
      setRefText(text)
      notify(t('已识别填入，请核对后使用'))
    } catch (e) { notify((e as Error)?.message ?? t('识别失败')) }
    finally { setRefTranscribing(false) }
  }
  const saveConfig = () => {
    if (!config.provider) { saveTtsConfig({ provider: '', endpoint: '', mode: 'direct' }); setTtsConfigured(false); notify(t('已清除语音服务配置')); return }
    if (isQwenTts) {
      // Qwen3-TTS 本地服务：无需 Key、无需端点，服务地址固定本机 :18123
      saveTtsConfig({ ...config, mode: 'direct' })
    } else if (isVoiceStudio) {
      // VoiceStudio：本机回环无需 Key，端点留空默认 http://127.0.0.1:3900
      saveTtsConfig({ ...config, mode: 'direct' })
    } else if (isDirect) {
      if (!config.apiKey?.trim()) { notify(t('请填写阿里云百炼 API Key')); return }
      saveTtsConfig(config)
    } else {
      if (!config.endpoint?.trim()) { notify(t('请填写服务端点')); return }
      saveTtsConfig(config)
    }
    setTtsConfigured(true)
    notify(t('语音服务配置已保存'))
  }

  const testDirect = async () => {
    setTestingKey(true)
    try {
      if (isQwenTts) {
        const r = await qwenTtsTest()
        notify(r.message)
      } else if (isVoiceStudio) {
        const r = await voicestudioTest(config)
        notify(r.message)
      } else {
        if (!config.apiKey?.trim()) { notify(t('请先填写 API Key')); return }
        const r = await ttsTestDirect(config.apiKey.trim(), config.provider || undefined)
        notify(r.message)
      }
    } finally { setTestingKey(false) }
  }

  /** 从 VoiceStudio 导入已克隆好的音色（按 profile_id 建立本机引用，不重复导入） */
  const importVoiceStudioVoices = async () => {
    if (getTtsConfig().provider !== 'voicestudio') { notify(t('请先把服务商设为 VoiceStudio')); return }
    setImportingVoices(true)
    try {
      const profiles = await voicestudioList(config)
      if (!profiles.length) { notify(t('VoiceStudio 里还没有音色，请先在其中克隆一个')); return }
      const existing = new Set(listClonedVoices().map(v => v.voiceId))
      let added = 0
      for (const p of profiles) {
        if (existing.has(p.id)) continue
        addClonedVoice(p.name, p.id, `VoiceStudio: ${p.name}`)
        added++
      }
      syncClonedVoices()
      notify(added ? t('已导入 {n} 个 VoiceStudio 音色', { n: added }) : t('VoiceStudio 音色都已导入过'))
    } catch (e) {
      notify(t('导入失败：{msg}', { msg: (e as Error)?.message ?? String(e) }))
    } finally { setImportingVoices(false) }
  }

  const doRecord = async () => {
    if (desktop) { notify(t('桌面端 WebView 不提供浏览器录音接口，请用「选择音频文件」导入样本')); return }
    try {
      notify(t('开始录音，请连续朗读 12 秒（10~20 秒最佳），自动结束…'))
      let blob = await recordVoiceSample(12)
      notify(t('录音完成，正在转换为兼容格式…'))
      const wav = await blobToWav(blob)
      if (wav) {
        blob = wav
      } else {
        // webm/opus 等转换失败时保留原样本（安卓 WebView 常见），交给代理端按 mime 处理。
        notify(t('格式转换未成功，将按原录音格式尝试克隆'))
      }
      setCloneError('')
      const mt = blob.type || 'audio/webm'
      const finalExt = mt.includes('wav') ? 'wav' : mt.includes('mp4') ? 'm4a'
        : mt.includes('mpeg') || mt.includes('mp3') ? 'mp3' : 'webm'
      const finalName = `录音样本.${finalExt}`
      setSample(await saveVoiceSample(blob, finalName))
      notify(t('声音样本已保存，可点击「克隆为 AI 发音」'))
    } catch (e) { notify((e as Error).message ?? t('录音失败')) }
  }

  const pickNativeAudio = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ multiple: false, filters: [{ name: t('音频文件'), extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'webm'] }] })
      if (typeof picked !== 'string') return
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const bytes = await readFile(picked)
      const ext = picked.split('.').pop()?.toLowerCase() ?? ''
      const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : `audio/${ext}`
      const blob = new Blob([bytes], { type: mime })
      // v0.1.428：参考音频过长会让服务端合成卡住，导入时只取前 15 秒；
      // 截取提示并进最后一条 toast（立即再 notify 会把这条顶掉）
      const trimmed = await trimAudioBlob(blob)
      const finalBlob = trimmed.blob
      const finalName = (trimmed.trimmed ? (picked.split('/').pop() ?? picked).replace(/\.[^.]+$/, '') + '.wav' : picked.split('/').pop() ?? picked)
      setSample(await saveVoiceSample(finalBlob, finalName))
      notify(trimmed.trimmed
        ? `音频样本已导入（原 ${Math.round(trimmed.originalDurationS)} 秒，已只取前 ${MAX_REF_AUDIO_SECONDS} 秒），可点击「克隆为 AI 发音」`
        : t('音频样本已导入，可点击「克隆为 AI 发音」'))
    } catch (e) { notify((e as Error)?.message ?? t('读取音频文件失败')) }
  }

  const doPickFile = async (file?: File) => {
    if (!file) return
    setCloneError('')
    // 安卓 WebView 里 file.type 常为空，不能只看 MIME；结合扩展名判断，空 MIME 也放行交给后续处理。
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    const looksAudio = file.type.startsWith('audio/') ||
      ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'webm', 'opus', '3gp', 'amr'].includes(ext) || !file.type
    if (!looksAudio) { notify(t('请选择音频文件（WAV / MP3 / M4A）')); return }
    let blob: Blob = file
    // WAV/MP3/M4A/AAC 原生支持；webm/ogg/3gp 等尽量转 WAV，转换失败也保留原文件（克隆前再按 mime 处理）。
    if (!/\.(wav|mp3|m4a|aac)$/i.test(file.name)) {
      notify(t('正在转换音频格式…'))
      const wav = await blobToWav(file)
      if (wav) {
        blob = wav
      } else {
        // 转换失败不阻断：保留原 blob，用正确的 mime 命名，交给代理端尝试。
        const fallbackMime = file.type || (ext === 'webm' ? 'audio/webm' : `audio/${ext || 'mp3'}`)
        blob = new Blob([file], { type: fallbackMime })
        notify(t('格式转换未成功，将按原格式尝试克隆'))
      }
    }
    // v0.1.428：参考音频过长会让服务端合成卡住，导入时只取前 15 秒；
    // 截取提示并进最后一条 toast（立即再 notify 会把这条顶掉）
    const trimmed = await trimAudioBlob(blob)
    let trimNote = ''
    if (trimmed.trimmed) {
      blob = trimmed.blob
      trimNote = `（原 ${Math.round(trimmed.originalDurationS)} 秒，已只取前 ${MAX_REF_AUDIO_SECONDS} 秒）`
    }
    const mime = blob.type || file.type || 'audio/wav'
    const finalExt = mime.includes('wav') ? 'wav' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
      : mime.includes('mp4') ? 'm4a' : ext || 'm4a'
    const name = file.name.replace(/\.[^.]+$/, '') + '.' + finalExt
    setSample(await saveVoiceSample(blob, name))
    setCloneError('')
    notify(trimNote ? `音频样本已保存${trimNote}，可点击「克隆为 AI 发音」` : t('音频样本已保存，可点击「克隆为 AI 发音」'))
  }

  /** 克隆音色增删改后：刷新本页列表 + 通知 AI 助手设置弹窗同步音色下拉 */
  const syncClonedVoices = () => {
    const list = listClonedVoices()
    setClonedVoices(list)
    setClonedId(getClonedVoiceId())
    window.dispatchEvent(new CustomEvent('acm:cloned-voices-changed', { detail: list }))
  }

  const doClone = async () => {
    if (!sample) { notify(t('请先录音或选择音频文件')); return }
    // Qwen3-TTS 本地克隆：服务没在跑时先提示去开开关，不直接调克隆（避免等半天才报错）
    if (isQwenTts) {
      const st = await qwenTtsStatus()
      setQwenStatus(st)
      if (!st.running) { notify(t('Qwen3-TTS 服务未运行：请先打开上方 Qwen3-TTS 服务开关（首次使用需先在上方完成安装）')); return }
    }
    setCloning(true)
    setCloneError('')
    // Qwen 分阶段进度（v0.1.415）：秒表每秒走字，阶段按真实回调推进；失败时停在出错阶段
    if (isQwenTts) {
      cloneStartRef.current = Date.now()
      setCloneElapsed(0)
      setCloneStage('convert')
      cloneTimerRef.current = window.setInterval(() => {
        setCloneElapsed(Math.floor((Date.now() - cloneStartRef.current) / 1000))
      }, 1000)
    }
    try {
      const r = await cloneVoiceFromSample(sample, undefined, isQwenTts ? refText : undefined,
        isQwenTts ? (stage) => setCloneStage(stage) : undefined)
      if (!r.ok) {
        const msg = r.error ?? t('克隆失败')
        setCloneError(msg)
        notify(msg)
        return
      }
      if (isQwenTts) setCloneStage('done')
      // v0.1.428 ⑥：克隆成功后立即把新音色写成当前使用中（显式激活；saveQwenVoice→
      // addClonedVoice 内部也会激活，这里再写一次是双保险，且保证 syncClonedVoices
      // 读到的就是新音色，不会被旧值覆盖）
      if (r.voiceId) setActiveClonedVoice(r.voiceId)
      setClonedId(r.voiceId ?? null)
      syncClonedVoices()
      notify(t('克隆成功，AI 回复将优先使用该音色'))
      // v0.1.428 ④：克隆成功后把试合成的那段音频真正放出来（不再验证完就丢弃）
      if (isQwenTts && r.audioDataUrl) {
        setClonePreviewPlaying(true)
        void playAudioDataUrl(r.audioDataUrl, (s) => {
          if (s === 'end' || s === 'error') setClonePreviewPlaying(false)
        }).catch(() => setClonePreviewPlaying(false))
      }
    } finally {
      if (cloneTimerRef.current) { window.clearInterval(cloneTimerRef.current); cloneTimerRef.current = null }
      setCloning(false)
    }
  }

  const removeSample = async () => {
    await deleteVoiceSample()
    setSample(null)
    notify(t('已删除临时声音样本（已保存的克隆音色不受影响）'))
  }

  const pickCloned = (v: ClonedVoice) => {
    setSpeakPref('')
    setEdgeActive(false)
    setActiveClonedVoice(v.voiceId)
    setClonedId(v.voiceId)
    syncClonedVoices()
    notify(t('已切换克隆音色：{name}', { name: v.name }))
  }

  const pickEdge = (id: string, name: string) => {
    setEdgeVoiceId(id)
    setSpeakPref('edge')
    setEdgeVoiceState(id)
    setEdgeActive(true)
    notify(t('已切换到 Edge 免费音色：{name}', { name }))
  }

  const previewEdge = (id: string, name: string) => {
    if (edgePreviewing) { stopSpeak(); setEdgePreviewing(false); return }
    setEdgeVoiceId(id)
    setSpeakPref('edge')
    setEdgeVoiceState(id)
    setEdgeActive(true)
    setEdgePreviewing(true)
    void speakAsync(`你好，我是${name}，很高兴认识你。`, null, (st) => {
      if (st === 'end' || st === 'error') setEdgePreviewing(false)
    }, (reason) => { notify(reason); setEdgePreviewing(false) }).then(ok => {
      if (!ok) setEdgePreviewing(false)
    })
  }

  const dropCloned = (v: ClonedVoice) => {
    removeClonedVoice(v.id)
    if (isQwenVoiceId(v.voiceId)) void deleteQwenVoiceRef(v.voiceId)
    syncClonedVoices()
    notify(t('已删除「{name}」；云端音色需到百炼控制台单独清理', { name: v.name }))
  }

  const commitRename = (v: ClonedVoice) => {
    if (!renameText.trim()) { setRenaming(null); return }
    renameClonedVoice(v.id, renameText)
    syncClonedVoices()
    setRenaming(null)
    notify(t('已重命名'))
  }

  // Qwen 克隆分阶段进度步骤（v0.1.415）：转换 → 合成 → 保存 → 完成
  const QWEN_CLONE_STEPS: { key: CloneStage; label: string }[] = [
    { key: 'convert', label: t('准备参考音频') },
    { key: 'synthesize', label: t('服务端加载模型并合成') },
    { key: 'save', label: t('保存音色') },
    { key: 'done', label: t('克隆完成') },
  ]

  return (
    <div className="voice-settings">
      {/* 当前朗读源标识 */}
      <div className={`voice-source-badge ${getSpeakSource() === 'clone' ? 'clone' : 'system'}`}>
        {getSpeakSource() === 'edge'
          ? <>{t('🎧 当前 AI 回复使用「Edge 免费音色」（微软云端音色，免费）——下方试听、聊天与通话朗读均走此音色')}</>
          : getSpeakSource() === 'clone'
            ? <>{t('🎙 当前 AI 回复使用「克隆音色」——下方试听、聊天与通话朗读均走此音色')}</>
            : <>{t('🔊 当前未设置克隆音色，AI 回复使用系统默认音色兜底。导入声音样本并克隆后即可用你自己的声音。')}</>}
      </div>

      <div className="voice-row">
        <div className="voice-row-label">{t('语速')} <span>{rate.toFixed(1)}×</span></div>
        <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={e => changeRate(Number(e.target.value))} className="voice-range" />
      </div>
      <button className="voice-preview" onClick={tryPreview}>
        {previewing ? <Square size={14} /> : <Play size={14} />} {previewSynth !== null ? `合成中…已等待 ${previewSynth} 秒（点此取消）` : previewing ? t('停止试听') : t('试听克隆音色')}
      </button>
      {qwenOff && (
        <div className="voice-clone-error">
          <Info size={14} />
          <span>Qwen3-TTS 服务没开，试听需要先启动服务</span>
          <button className="btn sm primary" onClick={() => void startQwenForPreview()}>立即开启服务</button>
          <button className="icon-btn" onClick={() => setQwenOff(false)}>×</button>
        </div>
      )}
      {clonePreviewPlaying && (
        <div className="voice-hint">正在播放克隆试听…</div>
      )}

      {/* 横向标题页签（v0.1.401，同看剧 394：标题栏吸顶、数量标在标题上、手机端自动换行） */}
      <div className="wt-tabs" role="tablist">
        <button role="tab" aria-selected={activeTab === 'edge'} className={`wt-tab${activeTab === 'edge' ? ' on' : ''}`} onClick={() => switchTab('edge')}>{t('Edge 免费音色')}<span className="wt-tab-count">{EDGE_VOICES.length} 个</span></button>
        <button role="tab" aria-selected={activeTab === 'clone'} className={`wt-tab${activeTab === 'clone' ? ' on' : ''}`} onClick={() => switchTab('clone')}>{t('声音克隆')}</button>
        <button role="tab" aria-selected={activeTab === 'saved'} className={`wt-tab${activeTab === 'saved' ? ' on' : ''}`} onClick={() => switchTab('saved')}>{t('已保存的克隆音色')}<span className="wt-tab-count">{clonedVoices.length} 个</span></button>
        <button role="tab" aria-selected={activeTab === 'third'} className={`wt-tab${activeTab === 'third' ? ' on' : ''}`} onClick={() => switchTab('third')}>{t('第三方语音服务')}{ttsConfigured ? <span className="wt-tab-count">{t('已配置')}</span> : null}</button>
        <button role="tab" aria-selected={activeTab === 'volc'} className={`wt-tab${activeTab === 'volc' ? ' on' : ''}`} onClick={() => switchTab('volc')}>{t('火山豆包语音')}</button>
      </div>

      {activeTab === 'edge' && <>
      <div className="wt-tab-sub">{t('Edge 免费音色（微软云端 · 免费）')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {EDGE_VOICES.map(v => (
          <div key={v.id} className="voice-row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <button className="btn sm" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => pickEdge(v.id, v.name)}>
              {v.name} · {v.desc}{edgeActive && edgeVoice === v.id ? ` · ${t('使用中')}` : ''}
            </button>
            <button className="btn sm" onClick={() => previewEdge(v.id, v.name)}>{edgePreviewing && edgeVoice === v.id ? t('停止试听') : t('试听')}</button>
          </div>
        ))}
      </div>
      </>}

      {activeTab === 'clone' && <>
      {/* Qwen3-TTS 本地克隆（仅桌面端，放在「声音克隆」页签内） */}
      {desktop && <>
      <div className="wt-tab-sub">{t('Qwen3-TTS 本地克隆（免费 · 本机）')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '2px 0 8px' }}>{t('阿里 Qwen3-TTS 开源模型在本机跑（MLX 加速）：3 秒参考音频克隆音色，不花钱、不上传。仅桌面端 Apple 芯片 Mac 可用。')}</div>
      <div className="voice-row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {serviceController && (
          <ServiceSwitch controller={serviceController} serviceKey="qwentts" />
        )}
        <span className={`local-status-badge ${qwenStatus?.running ? 'running' : ''}`}>
          {!qwenStatus ? t('未检测') : qwenStatus.running ? t('服务运行中') : qwenStatus.installed ? t('已安装 · 未运行') : t('未安装')}
        </span>
        <button className="btn sm" onClick={() => { void refreshQwenStatus(); serviceController?.refresh() }} disabled={qwenLoading}>{t('刷新状态')}</button>
        {!qwenStatus?.installed && (
          <button className="btn sm primary" onClick={() => void doQwenSetup()} disabled={qwenSettingUp}>
            {qwenSettingUp ? <><Loader2 size={14} className="spin" /> {t('安装中…')}</> : t('首次安装')}
          </button>
        )}
        {qwenStatus?.installed && (
          <button className="btn sm" onClick={() => void doQwenTest()} disabled={qwenTesting}>{qwenTesting ? t('测试中…') : t('测试连接')}</button>
        )}
        {qwenStatus?.installed && qwenStatus?.running && (
          <button className="btn sm" onClick={() => void doQwenWarmup()} disabled={qwenWarmup === 'warming'}>
            {qwenWarmup === 'warming' ? <><Loader2 size={14} className="spin" /> {t('预热中…')}</> : t('预热模型')}
          </button>
        )}
      </div>
      {qwenStatus && (
        <div className="voice-note">
          {qwenStatus.python
            ? t('Python {py} · {model}', { py: qwenStatus.python, model: qwenStatus.modelCached ? t('模型已下载') : t('模型未下载') })
            : t('未找到 Python 3.10+（需安装 Python 3.10 或以上，如 brew install python@3.12）')}
          {qwenStatus.running && qwenStatus.url ? ` · ${qwenStatus.url}` : ''}
          {qwenStatus.lastLog ? ` · ${qwenStatus.lastLog}` : ''}
          {qwenWarmup === 'warming' ? ` · ${t('模型预热中…')}` : qwenWarmup === 'ready' ? ` · ${t('模型已预热')}` : ''}
        </div>
      )}
      <div className="voice-note"><Info size={13} /> {t('首次安装会下载约 1GB 模型（mlx-community 4-bit 量化版），需 Python 3.10+，请保持网络畅通、耐心等待几分钟；安装只需做一次。服务开关就在上方（与「设置 → 本地模型服务 → Qwen3-TTS」同一个开关，状态联动），与 Ollama / ComfyUI 内存互斥（8G 一次只开一个）。')}</div>
      <div className="voice-note"><Info size={13} /> {t('安装后到「第三方语音服务」页签选 Qwen3-TTS，再导入声音样本克隆。克隆时请填写参考音频的原文（不填也能克隆，写上效果更好）。')}</div>
      </>}

      <div className="wt-tab-sub" style={{ marginTop: 14 }}>{t('声音克隆（录音 / 音频文件 → AI 发音）')}</div>
      <div className="voice-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn sm" disabled={desktop} title={desktop ? t('桌面 WebView 不支持浏览器录音') : t('连续朗读 12 秒（10~20 秒最佳）')} onClick={() => void doRecord()}><Mic size={14} /> {t('录音 12 秒')}</button>
        {desktop ? (
          <button className="btn sm primary" onClick={() => void pickNativeAudio()}><Volume2 size={14} /> {t('选择音频文件')}</button>
        ) : (
          <>
            <button className="btn sm" onClick={() => fileRef.current?.click()}><Volume2 size={14} /> {t('选择音频文件')}</button>
            <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={async e => {
              const f = e.target.files?.[0]
              await doPickFile(f)   // 先处理完，再清空，避免 File 失效竞态
              e.target.value = ''
            }} />
          </>
        )}
        <button className="btn sm primary" disabled={!sample || cloning} onClick={() => void doClone()}>
          {cloning ? <><Loader2 size={14} className="spin" /> {t('克隆中…')}</> : t('克隆为 AI 发音')}
        </button>
        {sample && <button className="btn sm ghost" onClick={() => void removeSample()}><Trash2 size={14} /> {t('删除样本')}</button>}
      </div>
      {/* Qwen 克隆分阶段进度（v0.1.415）：真实阶段 + 已等待秒数，不假造百分比 */}
      {isQwenTts && cloneStage && (
        <div className="qwen-clone-progress">
          <div className="qwen-clone-steps">
            {QWEN_CLONE_STEPS.map((s, i) => {
              const cur = QWEN_CLONE_STEPS.findIndex(x => x.key === cloneStage)
              const done = i < cur || cloneStage === 'done'
              const active = i === cur && cloning
              return (
                <div key={s.key} className={`qwen-clone-step${done ? ' done' : ''}${active ? ' active' : ''}`}>
                  {done ? <Check size={13} /> : active ? <Loader2 size={13} className="spin" /> : <span className="qwen-clone-dot" />}
                  <span>{s.label}</span>
                </div>
              )
            })}
          </div>
          <div className="qwen-clone-elapsed">{t('已等待 {elapsed}', { elapsed: formatCloneElapsed(cloneElapsed) })}</div>
          {cloneStage === 'synthesize' && cloning && (
            <div className="qwen-clone-hint">
              {cloneElapsed >= QWEN_CLONE_SLOW_HINT_S ? t('仍在等待…模型加载较慢是正常的，请继续等待，不要重复点击') : t('首次克隆需加载约 1GB 模型，M1 8GB 上可能需要几分钟，请耐心等待')}
            </div>
          )}
        </div>
      )}
      {isQwenTts && sample && (
        <>
          <label className="form-label" style={{ marginTop: 8 }}>{t('参考音频说的内容（写上克隆效果更好）')}
            <input className="input" value={refText} onChange={e => setRefText(e.target.value)} placeholder={t('如：你好，很高兴认识你')} />
          </label>
          {cloudAsrConfigured() && (
            <div style={{ marginTop: 6 }}>
              <button className="btn sm ghost" onClick={() => void doTranscribeRef()} disabled={refTranscribing}>
                {refTranscribing ? t('识别中…') : t('用百炼识别填入')}
              </button>
            </div>
          )}
        </>
      )}
      {sample && <div className="voice-hint">{t('样本：{name}（{size} KB）', { name: sample.name, size: (sample.size / 1024).toFixed(0) })}</div>}
      {sample && /\.(amr|3gpp)$/i.test(sample.name) && (
        <div className="voice-hint" style={{ color: 'var(--red)' }}>
          <Info size={13} /> {t('当前样本是 AMR 格式，语音服务不支持。请点「录音 12 秒」重新录，或从「选择音频文件」导入 WAV / MP3 / M4A。')}
        </div>
      )}
      {cloneError && <div className="voice-clone-error"><Info size={14} /> <span>{cloneError}</span>{isQwenTts && !cloning && <button className="btn sm" onClick={() => void doClone()}>{t('重新克隆')}</button>}<button className="icon-btn" onClick={() => setCloneError('')}>×</button></div>}
      {/* 语音配置(APP) 账户：加密 Key 解锁 */}
      {accounts.some(a => a.providerId === 'voice-config') && (
        <div className="voice-key-unlock">
          <div className="voice-unlock-row">
            <span>{t('🔐 语音配置账户 Key（加密保存）')}</span>
            <span className={`local-status-badge ${voiceUnlocked ? 'running' : ''}`}>{voiceUnlocked ? t('已解锁') : t('待解锁')}</span>
          </div>
          {needVoiceUnlock && !voiceUnlocked && (
            <>
              <div className="voice-unlock-desc">{t('该 Key 保存在保险箱中，验证主密码后本次会话可用（启用指纹则自动解锁）。')}</div>
              <div className="voice-unlock-actions">
                {getBiometricPassword() ? (
                  <button className="btn sm" onClick={() => { const bp = getBiometricPassword(); if (bp) { setVoiceSessionPwd(bp); onUnlock(bp); notify(t('已通过生物识别解锁')) } }}>{t('指纹解锁')}</button>
                ) : (
                  <input className="input" type="password" placeholder={t('输入主密码')} value={voicePwdInput} onChange={e => setVoicePwdInput(e.target.value)} />
                )}
                {!(getBiometricPassword()) && <button className="btn sm primary" disabled={voiceUnlocking} onClick={() => void unlockVoice()}>{voiceUnlocking ? t('解锁中…') : t('解锁')}</button>}
              </div>
            </>
          )}
          <div className="voice-unlock-note">{t('在「API Key 管理 → 添加账户 → 语音配置(APP)」保存 Key；清除配置后账户仍在，无需重新申请。')}</div>
        </div>
      )}
      {!ttsConfigured && <div className="voice-hint"><Info size={13} /> {t('声音克隆需配置语音服务：在「API Key 管理 → 添加账户 → 语音配置(APP)」保存 Key，或到「第三方语音服务」页签配置直连；内置免费模型不提供克隆能力。')}</div>}
      {desktop && <div className="voice-hint"><Info size={13} /> {t('桌面 WebView 不提供浏览器录音接口；请用「选择音频文件」导入样本（可先用 QuickTime 等工具录音）。')}</div>}
      </>}

      {activeTab === 'saved' && <>
      <div className="wt-tab-sub">{t('已保存的克隆音色（{n}）· 点击切换', { n: clonedVoices.length })}</div>
      {config.provider === 'voicestudio' && (
        <div style={{ margin: '6px 0' }}>
          <button className="btn sm ghost" onClick={() => void importVoiceStudioVoices()} disabled={importingVoices}>
            {importingVoices ? t('导入中…') : t('从 VoiceStudio 导入')}
          </button>
        </div>
      )}
      {clonedVoices.length > 0 ? (
        <div className="cloned-voice-list">
          {clonedVoices.map(v => {
            const active = v.voiceId === clonedId
            return (
              <div key={v.id} className={`cloned-voice-item ${active ? 'active' : ''}`}>
                <button className="cloned-voice-main" onClick={() => pickCloned(v)} title={t('点击切换为当前音色')}>
                  {active ? <Check size={14} /> : <Volume2 size={14} />}
                  <span>
                    <b>{v.name}</b>
                    <small>{active ? t('使用中') : `voiceId: ${v.voiceId.slice(-10)}`}</small>
                  </span>
                </button>
                <div className="cloned-voice-actions">
                  {renaming === v.id ? (
                    <>
                      <input className="input" style={{ width: 110 }} value={renameText} autoFocus
                        onChange={e => setRenameText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(v); if (e.key === 'Escape') setRenaming(null) }} />
                      <button className="icon-btn" onClick={() => commitRename(v)}><Check size={14} /></button>
                    </>
                  ) : (
                    <button className="icon-btn" title={t('重命名')} onClick={() => { setRenaming(v.id); setRenameText(v.name) }}><Pencil size={14} /></button>
                  )}
                  <HoldToConfirm title={t('删除此记录')} onConfirm={() => dropCloned(v)} />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="voice-empty">{t('还没有克隆音色。导入一段清晰人声（10~20 秒），点「克隆为 AI 发音」即可创建。')}</div>
      )}
      <div className="voice-hint">{t('克隆音色保存在本机；删除记录只移除本机引用，云端音色请到百炼控制台清理以释放配额。')}</div>
      </>}

      {activeTab === 'third' && <div className="voice-config">
        <label className="form-label">{t('连接模式')}
          <select className="select" value={config.mode ?? 'direct'} onChange={e => setConfig({ ...config, mode: e.target.value as 'direct' | 'proxy' })}>
            <option value="direct">{t('官方直连（推荐 · 无需部署，只需一个 API Key）')}</option>
            <option value="proxy">{t('自建服务端代理（高级 · 密钥放自己的服务端）')}</option>
          </select>
        </label>
        <label className="form-label">{t('服务商')}
          <select className="select" value={config.provider} onChange={e => setConfig({ ...config, provider: e.target.value as TtsProviderConfig['provider'] })}>
            <option value="">{t('未选择')}</option>
            {VOICE_PROVIDERS.filter(p => p.id !== 'system').map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {isQwenTts ? (
          <>
            <div className="voice-direct-guide">
              {t('1. 先到「声音克隆」页签，在「Qwen3-TTS 本地克隆」完成首次安装（下载约 1GB 模型）')}<br />
              {t('2. 在「声音克隆」页签打开上方 Qwen3-TTS 服务开关，服务在 127.0.0.1:18123 运行')}<br />
              {t('3. 点「测试连接」确认服务可用，再导入声音样本克隆')}
            </div>
            <div className="voice-config-actions">
              <button className="btn sm" onClick={() => void testDirect()} disabled={testingKey}>{testingKey ? t('测试中…') : t('测试连接')}</button>
            </div>
            <div className="voice-config-note">{t('Qwen3-TTS 权重开源免费（Apache-2.0），合成全在本机、不上传；克隆他人声音需获得授权。')}</div>
          </>
        ) : isVoiceStudio ? (
          <>
            <div className="voice-direct-guide">
              {t('1. 在本机运行')} <a href="https://github.com/debpalash/VoiceStudio" target="_blank" rel="noreferrer">VoiceStudio ↗</a>{t('（桌面端或 Docker，服务端口 3900）')}<br />
              {t('2. 在 VoiceStudio 里下载语音模型；克隆好的音色可直接选用')}<br />
              {t('3. 端点留空即默认')} <code>http://127.0.0.1:3900</code>{t('；若设了 API Key，填入下方，点「测试连接」')}
            </div>
            <label className="form-label">{t('VoiceStudio 服务地址')}
              <input className="input" value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e.target.value, provider: 'voicestudio' })} placeholder={t('http://127.0.0.1:3900（留空即用默认）')} />
            </label>
            <label className="form-label">{t('API Key（可选，本机回环可不填）')}
              <input className="input" type="password" value={config.apiKey ?? ''} onChange={e => setConfig({ ...config, apiKey: e.target.value, provider: 'voicestudio' })} placeholder={t('设置了 OMNIVOICE_API_KEY 才需要')} />
            </label>
            <div className="voice-config-actions">
              <button className="btn sm" onClick={() => void testDirect()} disabled={testingKey}>{testingKey ? t('测试中…') : t('测试连接')}</button>
            </div>
            <div className="voice-config-note">{t('VoiceStudio 开源免费(AGPL-3.0)，克隆与合成全在本机。音色 ID 由 VoiceStudio 管理，App 只保存引用。克隆他人声音需获得授权。')}</div>
          </>
        ) : isDirect ? (
          <>
            <div className="voice-direct-guide">
              {t('1. 打开')} <a href="https://bailian.console.aliyun.com/?tab=model#/api-key" target="_blank" rel="noreferrer">{t('阿里云百炼控制台 → API Key 管理 ↗')}</a><br />
              {t('2. 开通「语音合成 CosyVoice」并创建 API Key（创建音色免费）')}<br />
              {t('3. 复制 Key 粘贴到下方，点「测试连接」验证')}
            </div>
            <label className="form-label">{t('阿里云百炼 API Key（sk- 开头）')}
              <input className="input" type="password" value={config.apiKey ?? ''} onChange={e => setConfig({ ...config, apiKey: e.target.value, provider: config.provider || 'aliyun' })} placeholder="sk-xxxxxxxxxxxxxxxx" />
            </label>
            {config.provider !== 'aliyun' && config.provider && (
              <div className="voice-config-note">{t('直连模式目前支持阿里云百炼；已自动为你选中该服务商。')}</div>
            )}
            <div className="voice-config-actions">
              <button className="btn sm" onClick={() => void testDirect()} disabled={testingKey}>{testingKey ? t('测试中…') : t('测试连接')}</button>
            </div>
            <div className="voice-config-note">{t('Key 仅保存在本机（混淆存储），不上传、不进云同步/备份。直连由 App 后端转发调用，无需部署任何代理。')}</div>
          </>
        ) : (
          <>
            <label className="form-label">{t('服务端点（代理地址，密钥在服务端持有）')}
              <input className="input" value={config.endpoint} onChange={e => setConfig({ ...config, endpoint: e.target.value })} placeholder="https://your-tts-proxy.example.com" />
            </label>
            <div className="voice-config-note">{t('需自行部署云函数/代理，把 AccessKey 配在服务端。适合注重密钥隔离的高级用户。')}</div>
          </>
        )}
        <div className="voice-config-actions">
          <button className="btn sm primary" onClick={saveConfig}>{t('保存配置')}</button>
          {ttsConfigured && <button className="btn sm ghost" onClick={() => { clearTtsConfig(); setConfig({ provider: '', endpoint: '', mode: 'direct', apiKey: '' }); setTtsConfigured(false); notify(t('已清除配置')) }}>{t('清除')}</button>}
        </div>
      </div>}

      {activeTab === 'volc' && <div className="voice-config">
        <label className="form-label">APP ID
          <input className="input" value={volcConfig.appId} onChange={e => setVolcConfig({ ...volcConfig, appId: e.target.value })} placeholder={t('火山控制台的 APP ID')} />
        </label>
        <label className="form-label">Access Token
          <input className="input" type="password" value={volcConfig.accessToken} onChange={e => setVolcConfig({ ...volcConfig, accessToken: e.target.value })} placeholder={t('火山控制台的 Access Token')} />
        </label>
        <label className="form-label">{t('实时语音音色（可选）')}
          <input className="input" value={volcConfig.realtimeVoice} onChange={e => setVolcConfig({ ...volcConfig, realtimeVoice: e.target.value })} placeholder={t('如 zh_female_vv_jupiter_bigtts，留空用默认')} />
        </label>
        <div className="voice-config-note">
          {t('声音复刻：在上方「第三方语音服务配置」选「火山引擎 / 豆包声音复刻」并填代理端点（密钥配在云函数）。')}
          {t('端到端实时语音：需桌面端原生桥接，当前为骨架、未启用联调。凭据仅存本机、不进云同步。')}
        </div>
        <div className="voice-config-actions">
          <button className="btn sm primary" onClick={() => { saveVolcConfig(volcConfig); notify(t('火山引擎配置已保存')) }}>{t('保存')}</button>
          <button className="btn sm ghost" onClick={() => { clearVolcConfig(); const d = getVolcConfig(); setVolcConfig(d); notify(t('已清除火山配置')) }}>{t('清除')}</button>
        </div>
      </div>}
    </div>
  )
}
