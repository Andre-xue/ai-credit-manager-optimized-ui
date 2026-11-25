// 对话式翻译：逐条输入文本，即时翻译成目标语言，以对话形式呈现。
// 翻译引擎复用 AI 翻译模块（免费 / 我的账户 / 本地 Ollama），语言、源/目标可切换。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Languages, Send, Copy, Trash2, RefreshCw, Loader2, Info } from 'lucide-react'
import {
  translateText, TARGET_LANGUAGES, SOURCE_LANGUAGES, FREE_ENGINES,
  type TranslateEngine, type FreeEngine,
} from '../core/translate'
import { fetchLocalChatModels, fetchProviderModels } from '../core/providerCall'
import { decryptSecret, getBiometricPassword } from '../core/crypto'
import { enginesFor, enginesFromRemote } from '../data/engines'
import { detectLocalServices } from '../core/localServices'
import { detectModelCapability, capabilityChatCapable } from '../core/modelCapability'
import { isVoiceConfigAccount, categoryFromNote } from '../core/modelCategories'
import { isAccountServiceEnabled, LOCAL_SERVICE_CHANGED_EVENT } from '../core/localServicesSettings'
import type { Account, AppSettings } from '../core/types'
import type { ServiceController } from '../core/useServiceController'
import { ServiceSwitch } from './ServiceSwitch'
import { useFreeAiOptions, FreeAiModelSelect } from './FreeAiModelField'
import { t } from '../core/i18n'

interface ChatMsg { id: string; role: 'user' | 'assistant'; text: string; at: number }

export function ChatTranslateView({ accounts, notify, settings, serviceController, onBack }: {
  accounts: Account[]; notify: (m: string) => void; settings?: AppSettings; serviceController?: ServiceController; onBack: () => void
}) {
  const [engine, setEngine] = useState<TranslateEngine>('free')
  const [freeEngine, setFreeEngine] = useState<FreeEngine>('google')
  const freeAi = useFreeAiOptions()
  const [source, setSource] = useState('auto')
  const [target, setTarget] = useState('zh-CN')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Ollama 开关状态
  const ollamaOn = settings?.localServices?.ollama !== false
  // 本地服务地址（探测 / 默认）
  const [localBase, setLocalBase] = useState('')
  const [detecting, setDetecting] = useState(false)
  useEffect(() => {
    if (!ollamaOn) { setLocalBase(''); return }
    let alive = true
    setDetecting(true)
    void detectLocalServices().then(r => {
      if (!alive) return
      const hit = r.services.find(s => /ollama/i.test(s.service)) ?? r.services[0]
      setLocalBase(hit?.url ?? 'http://127.0.0.1:11434')
      setDetecting(false)
    }).catch(() => { if (alive) { setLocalBase('http://127.0.0.1:11434'); setDetecting(false) } })
    return () => { alive = false }
  }, [ollamaOn])
  // 关闭 Ollama 时若停在 local 引擎则切回免费
  useEffect(() => {
    if (!ollamaOn && engine === 'local') setEngine('free')
  }, [ollamaOn, engine])
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; enabled: boolean }>).detail
      if (d?.key === 'ollama' && !d.enabled) { setEngine(prev => prev === 'local' ? 'free' : prev); setLocalBase('') }
    }
    window.addEventListener(LOCAL_SERVICE_CHANGED_EVENT, h)
    return () => window.removeEventListener(LOCAL_SERVICE_CHANGED_EVENT, h)
  }, [])

  // 本地翻译模型
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localModel, setLocalModel] = useState('')
  const loadLocal = async () => {
    if (!ollamaOn) { notify(t('请先开启 Ollama 服务')); return }
    const base = localBase || 'http://127.0.0.1:11434'
    try {
      const ids = await fetchLocalChatModels(base)
      setLocalModels(ids)
      setLocalModel(prev => ids.includes(prev) ? prev : (ids[0] ?? ''))
      notify(t('已找到 {n} 个本地文本模型', { n: ids.length }))
    } catch (e) { notify(t('拉取失败：{msg}', { msg: (e as Error)?.message ?? String(e) })) }
  }
  useEffect(() => { if (ollamaOn && localBase) void loadLocal() }, [ollamaOn, localBase])

  // 可用账户（文本用途）
  const usableAccounts = useMemo(() => accounts
    .filter(a => !!a.encryptedKey)
    .filter(a => !isVoiceConfigAccount(a.providerId, a.note))
    .filter(a => { const c = categoryFromNote(a.note); return c === '对话型' || c === '通用型' })
    .filter(a => {
      const live = detectModelCapability(a.label).capability
      return capabilityChatCapable(live) && (a.modelCapability === undefined || capabilityChatCapable(a.modelCapability))
    })
    .filter(a => isAccountServiceEnabled(settings, a.providerId)), [accounts, settings])
  const [accountId, setAccountId] = useState('')
  const account = usableAccounts.find(a => a.id === accountId) ?? usableAccounts[0] ?? null
  useEffect(() => { if (usableAccounts.length && !usableAccounts.some(a => a.id === accountId)) setAccountId(usableAccounts[0].id) }, [usableAccounts, accountId])
  // 账户引擎：选账户后自动拉取真实引擎，失败回退内置目录
  const [engineId, setEngineId] = useState('')
  const [remoteEngines, setRemoteEngines] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    setRemoteEngines(null)
    const pwd = getBiometricPassword()
    if (!account?.encryptedKey || !pwd) return () => { alive = false }
    ;(async () => {
      try {
        const key = await decryptSecret(account.encryptedKey!, pwd)
        const ids = await fetchProviderModels(account, key)
        if (alive) setRemoteEngines(ids)
      } catch { /* 回退内置目录 */ }
    })()
    return () => { alive = false }
  }, [account])
  const engines = useMemo(() => {
    if (!account) return []
    return remoteEngines?.length ? enginesFromRemote(account.providerId, remoteEngines) : enginesFor(account.providerId)
  }, [account, remoteEngines])
  useEffect(() => {
    setEngineId(prev => engines.some(e => e.id === prev) ? prev : (engines.find(e => e.flagship)?.id ?? engines[0]?.id ?? ''))
  }, [engines])

  // 只滚消息容器本身（scrollIntoView 会连带滚动侧边栏/整页，造成闪屏）
  useEffect(() => {
    const c = bottomRef.current?.parentElement
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    if (engine === 'freeai' && !freeAi.selected) { notify(t('暂无可用免费 AI 模型：云端免费需先在 AI 助手登录云账号；或检查网络后重试')); return }
    setInput('')
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', text, at: Date.now() }])
    setBusy(true)
    try {
      const opts: Parameters<typeof translateText>[1] = {
        engine, target, source, freeEngine, engineId,
        localBase: localBase || 'http://127.0.0.1:11434', localModel,
        freeAi: freeAi.selected,
        account: engine === 'account' ? account ?? undefined : undefined,
      }
      const out = await translateText(text, opts)
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: out || t('（翻译结果为空）'), at: Date.now() }])
    } catch (e) {
      notify(t('翻译失败：{msg}', { msg: (e as Error)?.message ?? String(e) }))
    } finally { setBusy(false) }
  }

  const clear = () => { setMessages([]); setInput('') }
  const targetName = t(TARGET_LANGUAGES.find(l => l.code === target)?.name ?? target)

  return (
    <div className="chat-translate">
      <div className="ct-topbar">
        <button className="btn sm ghost sd-back" onClick={onBack}><Languages size={15} /> {t('返回 AI 翻译')}</button>
        <div className="ct-topbar-title">{t('对话式翻译')} <span>· {t('逐条输入，即时译为{name}', { name: targetName })}</span></div>
      </div>

      {/* 配置区 */}
      <div className="ct-config">
        <div className="ct-config-row">
          <div className="tr-field">
            <label>{t('翻译引擎')}</label>
            <select className="select" value={engine} onChange={e => setEngine(e.target.value as TranslateEngine)} disabled={busy}>
              <option value="free">{t('免费公共 API（无需 Key）')}</option>
              <option value="account">{t('我的模型账户')}</option>
              <option value="freeai">{t('免费 AI 模型')}</option>
              {ollamaOn && <option value="local">{t('本地服务（Ollama）')}</option>}
            </select>
          </div>
          {engine === 'freeai' && (
            <FreeAiModelSelect options={freeAi.options} value={freeAi.key} onChange={freeAi.setKey} disabled={busy} />
          )}
          {engine === 'free' && (
            <div className="tr-field">
              <label>{t('免费引擎')}</label>
              <select className="select" value={freeEngine} onChange={e => setFreeEngine(e.target.value as FreeEngine)} disabled={busy}>
                {FREE_ENGINES.map(f => <option key={f.id} value={f.id}>{t(f.name)}</option>)}
              </select>
            </div>
          )}
          {engine === 'account' && (
            <>
              <div className="tr-field">
                <label>{t('模型账户')}</label>
                <select className="select" value={account?.id ?? ''} onChange={e => setAccountId(e.target.value)} disabled={busy}>
                  {usableAccounts.length === 0 && <option value="">{t('请先添加账户')}</option>}
                  {usableAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <div className="tr-field">
                <label>{t('模型引擎')}</label>
                <select className="select" value={engineId} onChange={e => setEngineId(e.target.value)} disabled={busy || engines.length === 0}>
                  {engines.length === 0 && <option value="">{account ? t('该账户暂无可用引擎') : t('请先选择账户')}</option>}
                  {engines.map(e => <option key={e.id} value={e.id}>{e.name}{e.tag ? ` · ${e.tag}` : ''}</option>)}
                </select>
              </div>
            </>
          )}
          {engine === 'local' && (
            <>
              <div className="tr-field">
                <label>{t('本地服务地址（自动探测）')}</label>
                <span className="tr-local-url" title={t('地址由后台自动探测')}>{detecting ? t('探测中…') : (localBase || t('未探测到 Ollama 服务'))}</span>
              </div>
              <div className="tr-field">
                <label>{t('翻译模型')}</label>
                <div className="tr-local-row">
                  <select className="select" value={localModel} onChange={e => setLocalModel(e.target.value)} disabled={busy || localModels.length === 0}>
                    {localModels.length === 0 && <option value="">{t('请先拉取模型')}</option>}
                    {localModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button className="btn sm ghost" onClick={() => void loadLocal()} disabled={busy} title={t('拉取本地文本模型')}><RefreshCw size={13} /> {t('拉取')}</button>
                </div>
              </div>
            </>
          )}
          <div className="tr-field">
            <label>{t('源语言')}</label>
            <select className="select" value={source} onChange={e => setSource(e.target.value)} disabled={busy}>
              {SOURCE_LANGUAGES.map(l => <option key={l.code} value={l.code}>{t(l.name)}</option>)}
            </select>
          </div>
          <div className="tr-field">
            <label>{t('目标语言')}</label>
            <select className="select" value={target} onChange={e => setTarget(e.target.value)} disabled={busy}>
              {TARGET_LANGUAGES.map(l => <option key={l.code} value={l.code}>{t(l.name)}</option>)}
            </select>
          </div>
        </div>
        {serviceController && (
          <div className="ct-service">
            <span className="docqa-service-hint">{t('本地服务')}</span>
            <ServiceSwitch controller={serviceController} serviceKey="ollama" />
            <span className="docqa-service-note">{t('仅「本地服务」引擎需要开启 Ollama；免费与账户引擎无需开启。')}</span>
          </div>
        )}
      </div>

      {/* 对话区 */}
      <div className="ai-messages ct-messages">
        {messages.length === 0 ? (
          <div className="ai-welcome">
            <div className="ai-welcome-mark"><Languages size={26} /></div>
            <h2>{t('对话式翻译')}</h2>
            <p className="ct-welcome-hint">{t('输入任意文本，逐条翻译成{name}。支持免费 / 自有账户 / 本地 Ollama 三种引擎。', { name: targetName })}</p>
          </div>
        ) : (
          <div className="ai-thread">
            {messages.map(m => (
              <div key={m.id} className={`ai-msg ${m.role}`}>
                <div className="ai-msg-body">
                  <div className="ai-bubble">{m.text}</div>
                  <div className="ai-msg-tools">
                    <button className="ai-copy" onClick={() => void navigator.clipboard.writeText(m.text)} title={t('复制')}><Copy size={13} /></button>
                    <span className="ct-msg-role">{m.role === 'user' ? t('原文') : t('译文 · {name}', { name: targetName })}</span>
                  </div>
                </div>
              </div>
            ))}
            {busy && <div className="ai-msg assistant"><div className="ai-msg-body"><div className="ai-bubble ai-thinking"><span /><span /><span /></div></div></div>}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="ai-compose ct-compose">
        <div className="ct-compose-row">
          <textarea className="input ct-input" placeholder={t('输入要翻译的文本，Enter 发送，Shift+Enter 换行')} value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} rows={2} disabled={busy} />
          <div className="ct-compose-actions">
            <button className="btn sm ghost" onClick={clear} disabled={busy || messages.length === 0} title={t('清空对话')}><Trash2 size={14} /> {t('清空')}</button>
            <button className="btn sm primary" onClick={() => void send()} disabled={busy || !input.trim()}>
              {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {busy ? t('翻译中…') : t('翻译')}
            </button>
          </div>
        </div>
        <div className="ct-compose-tip"><Info size={12} /> {t('逐条独立翻译，不保留上下文；长文本建议用「AI 翻译」的文档模式。')}</div>
      </div>
    </div>
  )
}
