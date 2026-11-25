// AI 语音通话模式：识别完整句 → AI 回复 → 语音朗读 → 自动继续聆听，形成实时对话闭环。
// 手机原生 App 用 Capacitor Speech Recognition；桌面/Web 用浏览器 SpeechRecognition；
// 都不支持时降级为文字输入（AI 仍会语音朗读回复）。

import { useEffect, useRef, useState } from 'react'
import {
  Phone, PhoneOff, Mic, MicOff, Volume2, Loader2, Keyboard, Send, ShieldCheck,
} from 'lucide-react'
import { t } from '../core/i18n'
import { speakAsync, stopSpeak, getSavedVoice, unlockTts } from '../core/tts'
import { isNativeApp, isDesktopApp, openMicSettings, openSpeechSettings } from '../core/openExternal'

type Engine = 'capacitor' | 'web' | 'none'
type MicPerm = 'unknown' | 'granted' | 'denied' | 'unsupported' | 'system'

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

/** 一句说完的静默判定：650ms 没有新的识别片段就当作说完（越快越跟手，太短会误断句） */
const UTTERANCE_SILENCE_MS = 650

function createWebRecognition(): RecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = 'zh-CN'
  r.continuous = false
  r.interimResults = false
  return r
}

export function VoiceCall({ onSend, onClose, notify, needPwd = false, onUnlock, voiceURI }: {
  /** 发送一句话，返回 AI 的回复文本 */
  onSend: (text: string) => Promise<string>
  onClose: () => void
  notify: (m: string) => void
  /** 自有模型尚未解锁时，弹窗内直接提供解锁入口 */
  needPwd?: boolean
  onUnlock?: (pwd: string) => Promise<boolean>
  /** AI 机器人音色（来自聊天页身份设置） */
  voiceURI?: string | null
}) {
  const [callPwd, setCallPwd] = useState('')
  const [callPwdBusy, setCallPwdBusy] = useState(false)
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')
  const [callError, setCallError] = useState('')
  const [permCode, setPermCode] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [engine, setEngine] = useState<Engine>('none')
  const [micPerm, setMicPerm] = useState<MicPerm>('unknown')
  const [fallbackText, setFallbackText] = useState('')
  // 默认尝试语音；只有识别引擎确实不可用时才在 init 里展开文字输入
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const recRef = useRef<RecognitionLike | null>(null)
  const capRecRef = useRef<any>(null)
  const capListenerRef = useRef<any>(null)
  const capTimerRef = useRef<number | null>(null)
  const capTextRef = useRef('')
  const wantListen = useRef(false)
  const timerRef = useRef<number | null>(null)
  const speakingRef = useRef(false)
  const busyRef = useRef(false)
  const sessionActive = useRef(true)
  const onSendRef = useRef(onSend)
  const notifyRef = useRef(notify)
  const handleTextRef = useRef<(text: string) => Promise<void>>(async () => {})
  const startListeningRef = useRef<() => Promise<void>>(async () => {})

  onSendRef.current = onSend
  notifyRef.current = notify

  /** 显式申请麦克风/语音识别权限，任何平台都有明确入口 */
  const ensurePermission = async (): Promise<boolean> => {
    if (isNativeApp() && capRecRef.current) {
      try {
        const cur = await capRecRef.current.checkPermissions()
        if (cur.speechRecognition === 'granted') { setMicPerm('granted'); return true }
        const asked = await capRecRef.current.requestPermissions()
        const ok = asked.speechRecognition === 'granted'
        setMicPerm(ok ? 'granted' : 'denied')
        if (!ok) notifyRef.current(t('麦克风/语音识别权限被拒绝，请在系统设置中允许，或改用文字输入'))
        return ok
      } catch {
        setMicPerm('denied')
        notifyRef.current(t('无法申请语音权限，请在系统设置中允许，或改用文字输入'))
        return false
      }
    }
    const md = navigator.mediaDevices as MediaDevices | undefined
    if (!md?.getUserMedia) {
      // Tauri WKWebView 不暴露 getUserMedia，但 Web Speech API 仍在。
      // 此时不能阻断：由 SpeechRecognition.start() 触发系统自己的麦克风授权弹窗。
      setMicPerm('system')
      return true
    }
    if (md?.getUserMedia) {
      try {
        const stream = await md.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
        setMicPerm('granted')
        return true
      } catch {
        setMicPerm('denied')
        notifyRef.current(t('麦克风权限被拒绝，请点击地址栏的授权图标允许，或改用文字输入'))
        return false
      }
    }
    setMicPerm('unsupported')
    notifyRef.current(t('当前环境不提供麦克风授权接口，请用文字输入通话'))
    return false
  }

  const clearCapTimer = () => {
    if (capTimerRef.current !== null) {
      window.clearTimeout(capTimerRef.current)
      capTimerRef.current = null
    }
  }

  const stopRecognizers = () => {
    try { recRef.current?.stop() } catch { /* ignore */ }
    if (capRecRef.current) { try { void capRecRef.current.stop() } catch { /* ignore */ } }
    clearCapTimer()
    capTextRef.current = ''
  }

  /** 一句话识别完成，交给 AI 并朗读回复；朗读结束后自动继续聆听 */
  const handleText = async (text: string) => {
    const clean = text.trim()
    if (!clean || busyRef.current || speakingRef.current || !sessionActive.current) return
    busyRef.current = true
    setBusy(true)
    setCallError('')
    wantListen.current = false
    stopRecognizers()
    setStatus('thinking')
    try {
      const reply = await onSendRef.current(clean)
      setStatus('speaking')
      speakingRef.current = true
      const ok = await speakAsync(reply, voiceURI ?? getSavedVoice(), (s) => {
        if (s === 'end' || s === 'error') {
          setStatus('idle')
          speakingRef.current = false
          // 实时通话：说完自动回到聆听，无需再次点麦克风
          if (s === 'end' && sessionActive.current) {
            window.setTimeout(() => { if (sessionActive.current) void startListeningRef.current() }, 350)
          }
        }
      }, (reason) => notifyRef.current(reason))
      if (!ok) {
        setStatus('idle')
        speakingRef.current = false
        notifyRef.current(t('当前环境不支持语音朗读，回复已显示为文字'))
        if (sessionActive.current) window.setTimeout(() => void startListeningRef.current(), 350)
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      const needUnlock = /NEED_AI_PWD|主密码|解锁/.test(msg)
      setCallError(needUnlock
        ? t('当前为自有模型，请先验证主密码后再说话')
        : t('回复失败：{msg}', { msg: msg.slice(0, 80) }))
      setStatus('idle')
      speakingRef.current = false
      notifyRef.current(needUnlock ? t('请先验证主密码') : t('回复失败：{msg}', { msg: msg.slice(0, 80) }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  handleTextRef.current = handleText

  const startListening = async () => {
    if (!sessionActive.current || busyRef.current) return
    // 用户手势内预热 TTS，否则 Android WebView 里后续 AI 回复常无法发声
    unlockTts()
    const ok = await ensurePermission()
    if (!ok) { setFallbackOpen(true); return }

    if (engine === 'capacitor' && capRecRef.current) {
      setStatus('listening')
      setCallError('')
      wantListen.current = true
      clearCapTimer()
      capTextRef.current = ''
      try {
        if (capListenerRef.current) { try { await capListenerRef.current.remove() } catch { /* ignore */ } }
        capListenerRef.current = await capRecRef.current.addListener('partialResults', (data: { matches: string[] }) => {
          const text = data.matches?.[0]?.trim() ?? ''
          if (!text || speakingRef.current || busyRef.current || !sessionActive.current) return
          // 只更新文字，等用户停顿后再作为完整一句发送，避免把"你"当成整句
          capTextRef.current = text
          clearCapTimer()
          capTimerRef.current = window.setTimeout(() => {
            const finalText = capTextRef.current.trim()
            capTextRef.current = ''
            capTimerRef.current = null
            if (finalText) void handleTextRef.current(finalText)
          }, UTTERANCE_SILENCE_MS)
        })
        await capRecRef.current.start({ language: 'zh-CN', partialResults: true, popup: false })
      } catch (e) {
        setStatus('idle')
        notifyRef.current(t('启动语音识别失败：{msg}，请用文字输入', { msg: (e as Error).message?.slice(0, 50) ?? t('未知') }))
        setFallbackOpen(true)
      }
      return
    }

    if (engine === 'web' && recRef.current) {
      wantListen.current = true
      setStatus('listening')
      setCallError('')
      try { recRef.current.start() } catch { /* 已在运行 */ }
      return
    }
    setFallbackOpen(true)
  }
  startListeningRef.current = startListening

  useEffect(() => {
    timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000)
    let alive = true

    const queryWebPermission = async () => {
      try {
        const p = await (navigator.permissions as any)?.query({ name: 'microphone' })
        if (!alive) return
        setMicPerm(p?.state === 'granted' ? 'granted' : p?.state === 'denied' ? 'denied' : 'unknown')
      } catch { if (alive) setMicPerm('unknown') }
    }

    const init = async () => {
      if (isNativeApp()) {
        try {
          const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
          const availRes = await SpeechRecognition.available() as { available: boolean } | boolean
          const isAvail = typeof availRes === 'boolean' ? availRes : availRes?.available
          if (alive && isAvail) {
            capRecRef.current = SpeechRecognition
            const perm = await SpeechRecognition.checkPermissions()
            if (alive) setMicPerm(perm.speechRecognition === 'granted' ? 'granted' : 'denied')
            if (alive) setEngine('capacitor')
            return
          }
        } catch { /* 插件不可用，回退 */ }
      }
      const r = createWebRecognition()
      if (r && alive) {
        recRef.current = r
        r.onresult = (e: any) => {
          const text = Array.from(e.results).map((res: any) => res[0]?.transcript ?? '').join('').trim()
          if (text) { void handleTextRef.current(text) }
        }
        r.onerror = (e: any) => {
          if (e?.error === 'no-speech' || e?.error === 'aborted') { setStatus('idle'); return }
          const code = e?.error ?? 'unknown'
          const hint = code === 'not-allowed' || code === 'service-not-allowed'
            ? (isDesktopApp()
              ? (code === 'service-not-allowed'
                ? t('语音识别服务被系统拒绝：请在「系统设置 → 隐私与安全性 → 语音识别」中允许本应用（麦克风之外还需这一项）')
                : t('麦克风权限被拒绝：请在「系统设置 → 隐私与安全性 → 麦克风」中允许本应用，或点下方按钮打开设置'))
              : t('语音识别权限被拒绝，请在系统设置中允许，或改用文字输入'))
            : code === 'network'
              ? t('语音识别需要联网，当前网络不可用，请改用文字输入')
              : t('语音识别在当前环境不可用，请改用文字输入')
          notifyRef.current(hint)
          setPermCode(code)
          setStatus('idle')
          setMicPerm('denied')
          setFallbackOpen(true)
          wantListen.current = false
        }
        r.onend = () => {
          if (wantListen.current && !busyRef.current && !speakingRef.current) {
            try { r.start() } catch { /* ignore */ }
          }
        }
        setEngine('web')
        void queryWebPermission()
        return
      }
      if (alive) { setEngine('none'); setFallbackOpen(true); void queryWebPermission() }
    }
    void init()
    return () => {
      alive = false
      sessionActive.current = false
      clearCapTimer()
      try { recRef.current?.stop() } catch { /* ignore */ }
      if (capRecRef.current) { try { void capRecRef.current.stop() } catch { /* ignore */ } }
      if (capListenerRef.current) { try { void capListenerRef.current.remove() } catch { /* ignore */ } }
      stopSpeak()
      speakingRef.current = false
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopListening = () => {
    wantListen.current = false
    stopRecognizers()
    setStatus('idle')
  }

  const submitFallback = () => {
    const text = fallbackText.trim()
    if (!text || busyRef.current) return
    setFallbackText('')
    void handleTextRef.current(text)
  }

  const toggleMic = () => {
    if (status === 'listening') stopListening()
    else if (status === 'idle' || status === 'speaking') {
      stopSpeak()
      speakingRef.current = false
      void startListening()
    }
  }

  const toggleUnlock = async () => {
    if (!callPwd || !onUnlock) return
    setCallPwdBusy(true)
    try {
      const ok = await onUnlock(callPwd)
      if (ok) { setCallPwd(''); setCallError(''); notifyRef.current(t('已验证，可继续语音通话')) }
      else notifyRef.current(t('主密码错误'))
    } finally { setCallPwdBusy(false) }
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const voiceAvailable = engine !== 'none'

  return (
    <div className="call-overlay">
      <div className="call-panel">
        <div className="call-title">{t('AI 语音通话')}</div>
        <div className="call-timer">{mm}:{ss}</div>
        <div className={`call-orb ${status}`}>
          {status === 'thinking' ? <Loader2 size={44} className="spin" />
            : status === 'speaking' ? <Volume2 size={44} />
              : status === 'listening' ? <Mic size={44} />
                : <Phone size={40} />}
        </div>
        <div className="call-status">
          {status === 'listening' ? t('正在聆听…') : status === 'thinking' ? t('思考中…') : status === 'speaking' ? t('正在说话')
            : voiceAvailable ? t('点击麦克风开始说话（说完自动回复）') : t('当前设备不支持语音识别，请用文字通话')}
        </div>

        {micPerm !== 'granted' && (
          <div className="call-perm">
            <div className="call-perm-text">
              {micPerm === 'denied' ? (isDesktopApp()
                ? t('麦克风权限被拒绝：请到「系统设置 → 隐私与安全性 → 麦克风」勾选本应用')
                : t('麦克风权限被拒绝，点击授权后再说话'))
                : micPerm === 'unsupported' ? t('当前环境无法申请麦克风权限，可用文字通话')
                  : micPerm === 'system' ? t('点击麦克风后由系统语音服务请求授权')
                    : t('首次使用需要授权麦克风')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {micPerm === 'denied' && isDesktopApp() && permCode === 'service-not-allowed' && (
                <button className="btn sm" onClick={() => void openSpeechSettings().then(ok => { if (!ok) notify(t('无法打开系统设置，请前往 系统设置→隐私与安全性→语音识别')) })}>
                  <ShieldCheck size={14} /> {t('语音识别设置')}
                </button>
              )}
              {micPerm === 'denied' && isDesktopApp() && permCode !== 'service-not-allowed' && (
                <button className="btn sm" onClick={() => void openMicSettings().then(ok => { if (!ok) notify(t('无法打开系统设置，请手动前往隐私设置')) })}>
                  <ShieldCheck size={14} /> {t('打开设置')}
                </button>
              )}
              {micPerm !== 'system' && micPerm !== 'unsupported' && micPerm !== 'denied' && (
                <button className="btn sm primary" onClick={() => void ensurePermission()}>
                  <ShieldCheck size={14} /> {t('授权麦克风')}
                </button>
              )}
            </div>
          </div>
        )}

        {needPwd && (
          <div className="call-unlock">
            <div className="call-unlock-label">{t('当前为自有模型，请先输入主密码（本次会话只需一次）')}</div>
            <div className="call-unlock-row">
              <input className="input" type="password" placeholder={t('主密码')} value={callPwd}
                onChange={e => setCallPwd(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void toggleUnlock() }} />
              <button className="btn sm primary" disabled={callPwdBusy || !callPwd || !onUnlock} onClick={() => void toggleUnlock()}>
                {callPwdBusy ? t('验证中') : t('验证')}
              </button>
            </div>
          </div>
        )}

        {callError && <div className="call-error">{callError}</div>}
        {/* 语音通话全程不展示文字：你说的话与 AI 的回复都只朗读，不落文字 */}

        <div className="call-controls">
          {voiceAvailable && (
            <button className={`call-btn mic ${status === 'listening' ? 'active' : ''}`} onClick={toggleMic} disabled={busy} title={status === 'listening' ? t('停止聆听') : t('开始说话')}>
              {status === 'listening' ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
          )}
          <button className={`call-btn mic ${fallbackOpen ? 'active' : ''}`} onClick={() => setFallbackOpen(v => !v)} title={t('文字输入通话')}>
            <Keyboard size={22} />
          </button>
          <button className="call-btn hangup" onClick={() => { stopRecognizers(); stopSpeak(); sessionActive.current = false; onClose() }} title={t('挂断')}>
            <PhoneOff size={26} />
          </button>
        </div>

        {fallbackOpen && (
          <div className="call-fallback">
            <input className="input" placeholder={t('输入你想说的话…')} value={fallbackText}
              onChange={e => setFallbackText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitFallback() }} />
            <button className="btn sm primary" disabled={!fallbackText.trim() || busy} onClick={submitFallback}><Send size={14} /></button>
          </div>
        )}
        <div className="call-hint">{isDesktopApp()
          ? t('点麦克风直接说话；若系统麦克风未授权，请先到隐私设置开启。也可随时用下方键盘图标切换文字输入')
          : voiceAvailable ? t('说完停顿一下即自动回复，并继续聆听 · 也可切换文字输入') : t('输入文字后 AI 会语音朗读回复')}</div>
      </div>
    </div>
  )
}
