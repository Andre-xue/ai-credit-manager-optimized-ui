// 云同步登录弹窗：手机号验证码 / 邮箱验证码 / 微信扫码 / WorkBuddy 账号
// 扫码类在桌面 WebView / 安卓 WebView 内可能受限，会给出提示引导用验证码登录。

import { useEffect, useState } from 'react'
import { X, Smartphone, Mail, QrCode, ShieldCheck, Loader2, KeyRound, Fingerprint } from 'lucide-react'
import { cloud, type CloudUser } from '../core/cloud'
import type { PasswordResetChallenge } from '@tencent-ai/workbuddy-cloud-sdk'
import { isDesktopApp, isNativeApp } from '../core/openExternal'
import { biometricAvailable, biometricBound, bindBiometricCredentials, readBiometricCredentials, unbindBiometric } from '../core/biometric'
import { t } from '../core/i18n'

/** 默认记住上次登录的账户（只记账号本身，不记密码/验证码），下次打开弹窗自动预填 */
const LAST_ACCOUNT_KEY = 'acm.cloud.lastAccount'
const LAST_METHOD_KEY = 'acm.cloud.lastMethod'
function loadLastLogin(): { account: string; method: Method } | null {
  try {
    const account = localStorage.getItem(LAST_ACCOUNT_KEY)
    const method = localStorage.getItem(LAST_METHOD_KEY) as Method | null
    if (account && method) return { account, method }
  } catch { /* 忽略 */ }
  return null
}
function saveLastLogin(account: string, method: Method): void {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, account)
    localStorage.setItem(LAST_METHOD_KEY, method)
  } catch { /* 忽略 */ }
}

type Method = 'phone' | 'email' | 'password' | 'wechat' | 'workbuddy'
const isMail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
const isMobile = (v: string) => /^1\d{10}$/.test(v)

/** 把云端英文报错翻译成可操作的中文提示 */
function friendlyAuthError(message: string): string {
  const m = String(message ?? '')
  if (/password not set|no password|password.*(not set|unset)/i.test(m)) {
    return t('这个手机号/账号没有设置过密码，所以密码登录一定失败。注意：密码是绑定在账号上的，换了新手机号不会自动带着旧密码。请用「手机号 + 验证码」登录（下方有一键切换）；想用密码登录，请用你当初设置过密码的邮箱账号。')
  }
  if (/invalid.*(password|credential)|wrong password|password.*incorrect/i.test(m)) {
    return t('密码错误。如果你刚换了新手机号：新号码是另一个账号，旧号码的密码不适用——请用「手机号 + 验证码」登录，或输入你当初设密码的那个邮箱。')
  }
  if (/user not found|no user|account not found|not registered/i.test(m)) {
    return t('这个账号不存在或未注册。换了新手机号的话，请先用「手机号 + 验证码」登录完成注册；旧账号的密码不能用于新号码。')
  }
  if (/too many|rate limit|429/i.test(m)) return t('尝试次数过多，请稍后再试')
  return m
}

export function CloudLoginModal({ onClose, onSuccess }: {
  onClose: () => void
  onSuccess: (user: CloudUser) => void
}) {
  const [method, setMethod] = useState<Method>('phone')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<{ verificationId: string; isExistingUser: boolean; target: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [password, setPassword] = useState('')
  const [account, setAccount] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [showReset, setShowReset] = useState(false)
  const [resetChallenge, setResetChallenge] = useState<PasswordResetChallenge | null>(null)
  const [resetCode, setResetCode] = useState('')
  const [resetNewPwd, setResetNewPwd] = useState('')
  const [bioReady, setBioReady] = useState(false)
  const [bioBoundState, setBioBoundState] = useState(false)
  const oauthBlocked = isDesktopApp() || isNativeApp()

  // 打开弹窗：预填上次登录的账户；原生端检测指纹登录可用性（已绑定则默认切到密码页签展示指纹入口）
  useEffect(() => {
    const last = loadLastLogin()
    if (last) {
      if (last.method === 'password') { setMethod('password'); setAccount(last.account) }
      else { setMethod(last.method); setIdentifier(last.account) }
    }
    if (isNativeApp()) {
      void biometricAvailable().then(ok => {
        setBioReady(ok)
        if (ok && biometricBound()) { setBioBoundState(true); setMethod('password') }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isPhone = method === 'phone'

  const sendCode = async () => {
    setErr('')
    const value = identifier.trim()
    if (isPhone && !/^1\d{10}$/.test(value)) { setErr(t('请输入正确的 11 位手机号')); return }
    if (!isPhone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setErr(t('请输入正确的邮箱地址')); return }
    setBusy(true)
    try {
      const sent = await cloud.auth.sendOtp(isPhone ? { phone: value } : { email: value })
      if (sent.error) { setErr(sent.error.message); return }
      setPending({ verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser, target: value })
      setCountdown(60)
      const timer = window.setInterval(() => {
        setCountdown(c => { if (c <= 1) { window.clearInterval(timer); return 0 } return c - 1 })
      }, 1000)
    } finally { setBusy(false) }
  }

  const submitCode = async () => {
    setErr('')
    if (!pending) { setErr(t('请先获取验证码')); return }
    if (pending.target !== identifier.trim()) { setErr(t('请先获取当前账号的验证码')); return }
    if (!code.trim()) { setErr(t('请输入验证码')); return }
    if (!pending.isExistingUser && regPassword && regPassword.length < 6) { setErr(t('密码至少 6 位，或留空仅用验证码登录')); return }
    setBusy(true)
    try {
      const done = await cloud.auth.verifyOtp({
        ...(isPhone ? { phone: pending.target } : { email: pending.target }),
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code.trim(),
        ...(!pending.isExistingUser && regPassword ? { password: regPassword } : {}),
      } as Parameters<typeof cloud.auth.verifyOtp>[0])
      if (done.error) { setErr(done.error.message); return }
      setRegPassword('')
      saveLastLogin(pending.target, isPhone ? 'phone' : 'email')
      onSuccess(done.data.user as CloudUser)
    } finally { setBusy(false) }
  }

  const signInPassword = async (creds?: { account: string; password: string }) => {
    setErr('')
    const v = (creds?.account ?? account).trim()
    const pwd = creds?.password ?? password
    if (!isMail(v) && !isMobile(v)) { setErr(t('请输入邮箱地址或 11 位手机号')); return }
    if (!pwd) { setErr(t('请输入密码')); return }
    setBusy(true)
    try {
      const done = isMobile(v)
        ? await cloud.auth.signInWithPassword({ phone: v, password: pwd })
        : await cloud.auth.signInWithPassword({ email: v, password: pwd })
      if (done.error) {
        // 指纹回放的密码已失效（比如改过密码）：解除绑定，避免下次继续拿旧密码撞
        if (creds) { await unbindBiometric(); setBioBoundState(false); setErr(t('保存的密码已失效，已解除指纹绑定，请用当前密码登录一次重新绑定')); return }
        setErr(friendlyAuthError(done.error.message)); return
      }
      saveLastLogin(v, 'password')
      // 原生端且支持指纹：静默把账号密码存进系统钥匙串，下次可指纹登录（密码不落本地存储/云端）
      if (!creds && bioReady) void bindBiometricCredentials(v, pwd).then(ok => { if (ok) setBioBoundState(true) })
      onSuccess(done.data.user as CloudUser)
    } finally { setBusy(false) }
  }

  /** 指纹登录：系统生物识别通过后，从钥匙串取回账号密码自动完成密码登录 */
  const signInBiometric = async () => {
    setErr('')
    setBusy(true)
    try {
      const creds = await readBiometricCredentials()
      if (!creds) { setErr(t('指纹验证已取消或失败，可改用密码登录')); return }
      setAccount(creds.username)
      setPassword(creds.password)
      await signInPassword({ account: creds.username, password: creds.password })
    } finally { setBusy(false) }
  }

  /** 邮箱账号设置/找回密码：先发重置验证码（PASSWORD_RESET），再用验证码 + 新密码完成 */
  const startReset = async () => {
    setErr('')
    const v = account.trim()
    if (!isMail(v)) { setErr(t('设置密码需要邮箱地址；手机号账号请改用验证码登录')); return }
    setBusy(true)
    try {
      const r = await cloud.auth.resetPasswordForEmail(v)
      if (r.error) { setErr(friendlyAuthError(r.error.message)); return }
      setResetChallenge(r.data)
      setErr(t('重置验证码已发送到邮箱，请查收后填写下方验证码与新密码'))
    } finally { setBusy(false) }
  }

  const finishReset = async () => {
    setErr('')
    if (!resetChallenge) { setErr(t('请先获取邮箱重置验证码')); return }
    if (!resetCode.trim()) { setErr(t('请输入邮箱收到的验证码')); return }
    if (resetNewPwd.length < 6) { setErr(t('新密码至少 6 位')); return }
    setBusy(true)
    try {
      const r = await resetChallenge.updateUser({ nonce: resetCode.trim(), password: resetNewPwd })
      if (r.error) { setErr(friendlyAuthError(r.error.message)); return }
      setShowReset(false)
      setResetChallenge(null)
      setPassword(resetNewPwd)
      setErr('')
      saveLastLogin(account.trim(), 'password')
      onSuccess(r.data.user as CloudUser)
    } finally { setBusy(false) }
  }


  const oauth = async (provider: 'wechat' | 'workbuddy') => {
    setErr('')
    if (oauthBlocked) {
      setErr(t('当前是桌面/原生客户端，网页授权无法回到本应用，请使用手机号或邮箱验证码登录。'))
      return
    }
    setBusy(true)
    try {
      // 回调地址必须与已注册域名完全一致：不要改写 pathname（GitHub Pages 部署在 /ai-credit-manager/ 子路径）
      const back = new URL(location.href)
      for (const key of ['code', 'state', 'provider']) back.searchParams.delete(key)
      const { data, error } = await cloud.auth.signInWithOAuth({ provider, redirectTo: back.toString() })
      if (error) { setErr(error.message); return }
      location.assign(data.url)
    } finally { setBusy(false) }
  }

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h3>{t('登录以开启云同步')}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="notice-box" style={{ marginBottom: 16 }}>
            <ShieldCheck size={15} />
            <div>{t('登录后用同一账号，在 Web / 桌面 / 安卓 / 小程序任意端的数据都会自动同步。未登录也可继续本地使用。')}</div>
          </div>

          <div className="login-methods">
            <button className={`login-method ${method === 'phone' ? 'active' : ''}`} onClick={() => { setMethod('phone'); setErr(''); setPending(null) }}>
              <Smartphone size={16} /> {t('手机号')}
            </button>
            <button className={`login-method ${method === 'email' ? 'active' : ''}`} onClick={() => { setMethod('email'); setErr(''); setPending(null) }}>
              <Mail size={16} /> {t('邮箱')}
            </button>
            <button className={`login-method ${method === 'password' ? 'active' : ''}`} onClick={() => { setMethod('password'); setErr(''); setPending(null) }}>
              <KeyRound size={16} /> {t('密码登录')}
            </button>
            {!oauthBlocked && (<>
              <button className={`login-method ${method === 'wechat' ? 'active' : ''}`} onClick={() => { setMethod('wechat'); setErr('') }}>
                <QrCode size={16} /> {t('微信扫码')}
              </button>
              <button className={`login-method ${method === 'workbuddy' ? 'active' : ''}`} onClick={() => { setMethod('workbuddy'); setErr('') }}>
                <ShieldCheck size={16} /> WorkBuddy
              </button>
            </>)}
          </div>
          {oauthBlocked && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
              {t('微信扫码 / WorkBuddy 登录属于网页授权，仅网页版可用；桌面与手机客户端请用手机号或邮箱验证码登录，数据同样全端同步。')}
            </div>
          )}

          {(method === 'phone' || method === 'email') && <>
            <label className="form-label" style={{ marginTop: 18 }}>
              {isPhone ? t('手机号') : t('邮箱地址')}
              <input className="input" value={identifier} onChange={e => { setIdentifier(e.target.value); setErr('') }}
                placeholder={isPhone ? t('11 位手机号') : 'name@example.com'} disabled={busy} />
            </label>
            <label className="form-label" style={{ marginTop: 12 }}>
              {t('验证码')}
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" value={code} onChange={e => { setCode(e.target.value); setErr('') }} placeholder={t('6 位验证码')} disabled={busy} />
                <button className="btn" type="button" onClick={sendCode} disabled={busy || countdown > 0} style={{ whiteSpace: 'nowrap' }}>
                  {countdown > 0 ? t('{n}s 后重发', { n: countdown }) : pending ? t('重新发送') : t('获取验证码')}
                </button>
              </div>
            </label>
            {pending && !pending.isExistingUser && (
              <label className="form-label" style={{ marginTop: 12 }}>
                {t('设置密码（可选，至少 6 位）')}
                <input className="input" type="password" value={regPassword} onChange={e => { setRegPassword(e.target.value); setErr('') }}
                  placeholder={t('设置后可用账号密码登录；留空则仅验证码登录')} disabled={busy} />
              </label>
            )}
            {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{err}</div>}
            <button className="btn primary" style={{ width: '100%', marginTop: 18, justifyContent: 'center' }} onClick={submitCode} disabled={busy}>
              {busy ? <><Loader2 size={14} className="spin" /> {t('处理中…')}</> : t('登录 / 注册')}
            </button>
          </>}

          {method === 'password' && <>
            <label className="form-label" style={{ marginTop: 18 }}>
              {t('邮箱或手机号')}
              <input className="input" value={account} onChange={e => { setAccount(e.target.value); setErr('') }} placeholder={t('邮箱地址或 11 位手机号')} disabled={busy} />
            </label>
            <label className="form-label" style={{ marginTop: 12 }}>
              {t('密码')}
              <input className="input" type="password" value={password} onChange={e => { setPassword(e.target.value); setErr('') }} placeholder={t('账号密码')} disabled={busy} />
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
              {t('只有设置过密码的账号才能用密码登录。早期用手机号验证码注册的账号没有密码，请切回「手机号」用验证码登录；邮箱账号可点下方「设置 / 找回密码」设好后即可用密码登录。')}
            </div>
            {err && <div style={{ color: err === t('重置验证码已发送到邮箱，请查收后填写下方验证码与新密码') ? 'var(--green)' : 'var(--red)', fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>{err}</div>}
            {bioBoundState && (
              <button className="btn" style={{ width: '100%', marginTop: 18, justifyContent: 'center' }} onClick={() => void signInBiometric()} disabled={busy}>
                <Fingerprint size={15} /> {t('指纹登录')}
              </button>
            )}
            <button className="btn primary" style={{ width: '100%', marginTop: bioBoundState ? 10 : 18, justifyContent: 'center' }} onClick={() => void signInPassword()} disabled={busy}>
              {busy ? <><Loader2 size={14} className="spin" /> {t('登录中…')}</> : t('密码登录')}
            </button>
            {bioReady && !bioBoundState && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.6 }}>
                {t('本机支持指纹识别：用密码登录成功后将自动绑定，下次可指纹登录（密码只存本机系统钥匙串，不经过本地存储、不上传云端）。')}
              </div>
            )}
            {/* 换了新手机号后用密码登录失败：一键带着号码切到验证码登录 */}
            {isMobile(account.trim()) && (
              <button className="form-link" style={{ marginTop: 10 }} onClick={() => {
                setIdentifier(account.trim()); setMethod('phone'); setErr(''); setCode(''); setPending(null)
              }}>
                {t('这个手机号用不了密码？改用验证码登录 →')}
              </button>
            )}
            <button className="form-link" style={{ marginTop: 12 }} onClick={() => { setShowReset(v => !v); setErr(''); setResetChallenge(null); setResetCode(''); setResetNewPwd('') }}>
              {showReset ? t('收起') : t('邮箱账号设置 / 找回密码')}
            </button>
            {showReset && <>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.6 }}>
                {t('仅支持邮箱：向注册邮箱发送重置验证码，验证后设置新密码并自动登录。手机号账号无法使用此功能。')}
              </div>
              <label className="form-label" style={{ marginTop: 10 }}>
                {t('新密码（至少 6 位）')}
                <input className="input" type="password" value={resetNewPwd} onChange={e => { setResetNewPwd(e.target.value); setErr('') }} placeholder={t('设置新密码')} disabled={busy} />
              </label>
              <label className="form-label" style={{ marginTop: 10 }}>
                {t('邮箱验证码')}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" value={resetCode} onChange={e => { setResetCode(e.target.value); setErr('') }} placeholder={t('邮箱收到的验证码')} disabled={busy} />
                  <button className="btn" type="button" onClick={() => void startReset()} disabled={busy} style={{ whiteSpace: 'nowrap' }}>
                    {resetChallenge ? t('重新发送') : t('发送验证码')}
                  </button>
                </div>
              </label>
              <button className="btn primary" style={{ width: '100%', marginTop: 12, justifyContent: 'center' }} onClick={() => void finishReset()} disabled={busy}>
                {busy ? <><Loader2 size={14} className="spin" /> {t('处理中…')}</> : t('设置密码并登录')}
              </button>
            </>}
          </>}

          {method === 'wechat' && <>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '18px 0' }}>
              {oauthBlocked
                ? t('微信扫码属于网页授权，回调必须回到已登记的 https 域名。桌面客户端与手机 App 的内置页面不是登记域名，授权后会无法返回，因此这两个端暂不支持扫码登录。请改用手机号或邮箱验证码登录（同样开启云同步）。网页版可使用微信扫码。')
                : t('点击下方按钮将跳转到微信授权页，可用微信扫码或快捷登录。登录完成后自动返回本应用。')}
            </p>
            {err && <div style={{ color: 'var(--amber)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => oauth('wechat')} disabled={busy || oauthBlocked}>
              <QrCode size={15} /> {t('使用微信登录')}
            </button>
          </>}

          {method === 'workbuddy' && <>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7, margin: '18px 0' }}>
              {oauthBlocked
                ? t('WorkBuddy 账号登录属于网页授权（带一次性校验），回调必须回到已登记的 https 域名，桌面客户端与手机 App 内置页面无法完成回调。请改用手机号或邮箱验证码登录，数据同样全端同步；网页版可使用 WorkBuddy 登录。')
                : t('使用你的 WorkBuddy 账号登录，授权后自动返回本应用。')}
            </p>
            {err && <div style={{ color: 'var(--amber)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => oauth('workbuddy')} disabled={busy || oauthBlocked}>
              <ShieldCheck size={15} /> {t('使用 WorkBuddy 登录')}
            </button>
          </>}

          <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '16px 0 0', lineHeight: 1.6 }}>
            {t('支持手机号 / 邮箱验证码、邮箱密码（需先设置）、网页版微信扫码与 WorkBuddy 账号。手机号老账号请用验证码登录，无法补设密码。QQ / 抖音 / 支付宝扫码暂未开放。')}
          </p>
        </div>
      </div>
    </div>
  )
}
