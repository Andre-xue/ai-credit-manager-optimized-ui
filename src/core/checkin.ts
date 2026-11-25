import { encryptSecret, decryptSecret } from './crypto'
import { isNativeApp } from './openExternal'

/**
 * 每日签到（v0.1.356）：WorkBuddy / MiniMax Code 的每日积分签到。
 * 协议为各平台客户端同款的公开行为（OAuth 授权 + Bearer 调用签到接口），本模块为独立实现：
 * - 授权：WorkBuddy 走 copilot.tencent.com 的 plugin auth（state + 浏览器确认 + 轮询 token）；
 *   MiniMax 走 account.minimax.cn 的设备码 OAuth（PKCE S256）。
 * - 凭据（access/refresh token）用保险箱主密码加密后只存本机 localStorage，不云同步。
 * - refresh token 会轮换：刷新成功必须回写本地存储（本模块内部统一处理）。
 * 接口均为平台非公开接口，平台变更时可能失效，错误会如实抛给界面显示。
 */

export type CheckinPlatform = 'workbuddy' | 'minimax'

export interface CheckinCred {
  accessToken: string
  refreshToken: string
  /** access token 过期时刻（ms epoch），0 = 未知 */
  expiresAt: number
  uid: string
  label: string
  /** WorkBuddy 网关域名（空 = www.codebuddy.cn） */
  domain?: string
}

export interface CheckinDay { dayNo: number; isToday: boolean; points: number; claimed: boolean }

export interface CheckinStatus {
  state: 'claimable' | 'claimed' | 'unavailable' | 'unknown'
  message: string
  /** 今日可领/已领积分 */
  points: number
  streakDays: number
  days?: CheckinDay[]
  /** 积分余额（仅 MiniMax 查得到时给出） */
  balance?: number
}

const STORE_KEY = 'acm.checkin.creds.v1'

// ---------------- 凭据存储（加密、仅本机） ----------------

type CredStore = Partial<Record<CheckinPlatform, string>>

function readStore(): CredStore {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as CredStore } catch { return {} }
}

export function hasCheckinCred(platform: CheckinPlatform): boolean {
  return !!readStore()[platform]
}

export async function loadCheckinCred(platform: CheckinPlatform, pwd: string): Promise<CheckinCred | null> {
  const cipher = readStore()[platform]
  if (!cipher || !pwd) return null
  try {
    const cred = JSON.parse(await decryptSecret(cipher, pwd)) as CheckinCred
    return cred && cred.accessToken ? cred : null
  } catch { return null }
}

export async function saveCheckinCred(platform: CheckinPlatform, cred: CheckinCred, pwd: string): Promise<void> {
  const store = readStore()
  store[platform] = await encryptSecret(JSON.stringify(cred), pwd)
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch { /* 忽略 */ }
}

export function clearCheckinCred(platform: CheckinPlatform): void {
  const store = readStore()
  delete store[platform]
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch { /* 忽略 */ }
}

// ---------------- HTTP 传输（桌面 Rust 通道 / 安卓原生 / 网页 fetch） ----------------

interface HttpResult { status: number; text: string }

export async function httpCall(method: string, url: string, headers: Record<string, string>, body?: string): Promise<HttpResult> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<string> } }
  if (w.__TAURI_INTERNALS__?.invoke) {
    const raw = await w.__TAURI_INTERNALS__.invoke('plugin_http', {
      url, method, headersJson: JSON.stringify(headers), body: body ?? null,
    })
    const parsed = JSON.parse(raw) as { status: number; body: string }
    return { status: parsed.status, text: parsed.body }
  }
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method, headers, data: body, responseType: 'text' })
    return { status: res.status, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '') }
  }
  const res = await fetch(url, { method, headers, body })
  return { status: res.status, text: await res.text() }
}

export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch { return null }
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  return 0
}
/** 在 body 与 body.data 两层里取字段 */
function pick(body: Json, ...keys: string[]): unknown {
  const data = obj(body.data)
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') return body[k]
    if (data[k] !== undefined && data[k] !== null && data[k] !== '') return data[k]
  }
  return undefined
}

// ---------------- MiniMax ----------------

const MM_TOKEN = 'https://account.minimax.cn/oauth2/token'
const MM_DEVICE = 'https://account.minimax.cn/oauth2/device/code'
const MM_BASE = 'https://agent.minimax.cn'
const MM_CLIENT_ID = 'mcode-public'

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface MinimaxDeviceFlow {
  authUrl: string
  userCode: string
  pollCode: string
  pollParam: string
  verifier: string
  intervalSecs: number
  expiresIn: number
}

export async function minimaxBeginDevice(): Promise<MinimaxDeviceFlow> {
  const rand = new Uint8Array(32)
  crypto.getRandomValues(rand)
  const verifier = b64url(rand)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = b64url(new Uint8Array(digest))
  const form = new URLSearchParams({
    client_id: MM_CLIENT_ID, scope: 'agent.default', audience: 'agent-backend',
    code_challenge: challenge, code_challenge_method: 'S256',
  })
  const res = await httpCall('POST', MM_DEVICE, { 'Content-Type': 'application/x-www-form-urlencoded' }, form.toString())
  const body = parseJson(res.text)
  if (!body) throw new Error(`设备授权接口返回异常（HTTP ${res.status}）`)
  const authUrl = str(body.verification_uri_complete) || str(body.verification_uri)
  const userCode = str(body.user_code)
  const deviceCode = str(body.device_code)
  if (!authUrl || (!userCode && !deviceCode)) throw new Error('设备授权接口没返回验证地址（上游可能已变更）')
  return {
    authUrl, userCode,
    pollCode: deviceCode || userCode,
    pollParam: deviceCode ? 'device_code' : 'user_code',
    verifier,
    intervalSecs: Math.max(1, num(body.interval) || 5),
    expiresIn: Math.max(30, num(body.expires_in) || 300),
  }
}

/** 轮询一次设备授权；返回 null = 用户还没在浏览器确认 */
export async function minimaxPollDevice(flow: MinimaxDeviceFlow): Promise<CheckinCred | null> {
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    [flow.pollParam]: flow.pollCode,
    client_id: MM_CLIENT_ID, code_verifier: flow.verifier,
  })
  const res = await httpCall('POST', MM_TOKEN, { 'Content-Type': 'application/x-www-form-urlencoded' }, form.toString())
  const body = parseJson(res.text) ?? {}
  const status = str(body.status)
  const error = str(body.error)
  if (status === 'pending' || status === 'authorization_pending' || status === 'slow_down'
    || error === 'authorization_pending' || error === 'slow_down') return null
  if (status === 'denied' || status === 'access_denied' || error === 'access_denied') throw new Error('授权被拒绝（浏览器里点了取消？）')
  if (error === 'expired_token' || error === 'expired') throw new Error('授权码已过期（有效期约 5 分钟），请重新发起')
  const access = str(body.access_token)
  if (!access) {
    if (res.status >= 400) throw new Error(`授权失败（HTTP ${res.status}${error ? ' ' + error : ''}）`)
    return null
  }
  const cred: CheckinCred = {
    accessToken: access,
    refreshToken: str(body.refresh_token),
    expiresAt: Date.now() + (num(body.expires_in) || 3600) * 1000,
    uid: '', label: 'MiniMax 账号',
  }
  // 尽力拿昵称/账号 id，失败不阻塞授权
  try {
    const info = await minimaxUserInfo(access)
    if (info.uid) cred.uid = info.uid
    if (info.name) cred.label = info.name
  } catch { /* 忽略 */ }
  return cred
}

async function minimaxUserInfo(access: string): Promise<{ uid: string; name: string }> {
  const url = `${MM_BASE}/v1/api/user/info?device_platform=mcode&biz_id=3&app_id=3001&version_code=22201&unix=${Math.floor(Date.now() / 1000)}&timezone_offset=-480`
  const res = await httpCall('GET', url, { Authorization: `Bearer ${access}`, accept: 'application/json' })
  const body = parseJson(res.text) ?? {}
  const data = obj(body.data)
  const uid = str(data.userID) || str(data.user_id) || str(data.uid) || str(data.id)
  const name = str(data.nickname) || str(data.nick_name) || str(data.user_name) || str(data.name)
  return { uid, name }
}

async function minimaxRefresh(cred: CheckinCred): Promise<CheckinCred> {
  if (!cred.refreshToken) throw new Error('凭据里没有 refresh token，请重新授权')
  const form = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: cred.refreshToken,
    client_id: MM_CLIENT_ID, scope: 'agent.default', audience: 'agent-backend',
  })
  const res = await httpCall('POST', MM_TOKEN, { 'Content-Type': 'application/x-www-form-urlencoded' }, form.toString())
  const body = parseJson(res.text) ?? {}
  const access = str(body.access_token)
  if (res.status >= 400 || !access) {
    throw new Error(`登录续期失败（HTTP ${res.status}${str(body.error) ? ' ' + str(body.error) : ''}），请重新授权`)
  }
  return {
    ...cred, accessToken: access,
    refreshToken: str(body.refresh_token) || cred.refreshToken,
    expiresAt: Date.now() + (num(body.expires_in) || 3600) * 1000,
  }
}

function mmCheckBase(body: Json): void {
  const base = obj(body.base_resp)
  const code = num(base.status_code)
  if (base.status_code !== undefined && code !== 0) {
    throw new Error(`上游返回错误 ${code}：${str(base.status_msg) || '未知错误'}`)
  }
}

const mmTz = () => encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')

export function parseMinimaxStatus(body: Json): CheckinStatus {
  mmCheckBase(body)
  const daysRaw = obj(body.data).days
  const daysArr = Array.isArray(daysRaw) ? daysRaw.map(d => obj(d)) : []
  const panel: CheckinDay[] = daysArr.map(d => ({
    dayNo: num(d.day_no),
    isToday: d.is_today === true,
    points: num(d.points) + num(d.bonus_points),
    claimed: num(d.status) === 3,
  }))
  const today = daysArr.find(d => d.is_today === true)
  if (!today) return { state: 'unavailable', message: '上游没有返回今天的签到信息', points: 0, streakDays: 0, days: panel }
  const points = num(today.points) + num(today.bonus_points)
  const st = num(today.status)
  // 连续签到：从今天（未领则从昨天）往前数已领天数
  let streak = 0
  const sorted = [...panel].sort((a, b) => a.dayNo - b.dayNo)
  const todayIdx = sorted.findIndex(d => d.isToday)
  for (let i = todayIdx; i >= 0; i--) {
    if (sorted[i].claimed) streak++
    else if (i !== todayIdx) break
  }
  if (st === 2) return { state: 'claimable', message: `可签到 +${points} 积分`, points, streakDays: streak, days: panel }
  if (st === 3) return { state: 'claimed', message: '今日已签到', points, streakDays: streak, days: panel }
  if (st === 1) return { state: 'unavailable', message: '今日暂不可签', points, streakDays: streak, days: panel }
  return { state: 'unknown', message: '签到状态未知', points, streakDays: streak, days: panel }
}

async function minimaxApi(cred: CheckinCred, path: string, method: 'GET' | 'POST'): Promise<Json> {
  const res = await httpCall(method, `${MM_BASE}${path}?timezone_id=${mmTz()}`, {
    Authorization: `Bearer ${cred.accessToken}`, accept: 'application/json',
  })
  const body = parseJson(res.text)
  if (res.status === 401 || res.status === 403) throw new Error('__UNAUTHORIZED__')
  if (!body) throw new Error(`接口返回异常（HTTP ${res.status}）`)
  if (res.status >= 400) throw new Error(`接口返回 HTTP ${res.status}`)
  return body
}

async function minimaxBalance(cred: CheckinCred): Promise<number | undefined> {
  try {
    const body = await minimaxApi(cred, '/minimax-cloud/api/v1/credit/details', 'GET')
    const raw = obj(body.data).details ?? body.details
    if (!Array.isArray(raw)) return undefined
    return raw.reduce((sum, d) => sum + num(obj(d).remaining_amount), 0)
  } catch { return undefined }
}

// ---------------- WorkBuddy ----------------

const WB_AUTH = 'https://copilot.tencent.com'

export interface WorkbuddyFlow { state: string; authUrl: string }

export async function workbuddyBegin(): Promise<WorkbuddyFlow> {
  const res = await httpCall('POST', `${WB_AUTH}/v2/plugin/auth/state?platform=workbuddy`, {
    accept: 'application/json', 'X-Domain': 'copilot.tencent.com', 'Content-Type': 'application/json',
  }, '{}')
  const body = parseJson(res.text)
  if (!body) throw new Error(`授权接口返回异常（HTTP ${res.status}）`)
  const state = str(pick(body, 'state'))
  const authUrl = str(pick(body, 'authUrl', 'auth_url', 'url'))
  if (!state || !authUrl) throw new Error('授权接口没返回 state/授权地址（上游可能已变更）')
  return { state, authUrl }
}

/** 轮询一次 WorkBuddy 授权；返回 null = 还没确认 */
export async function workbuddyPoll(flow: WorkbuddyFlow): Promise<CheckinCred | null> {
  const res = await httpCall('GET', `${WB_AUTH}/v2/plugin/auth/token?state=${encodeURIComponent(flow.state)}`, {
    accept: 'application/json',
    'X-No-Authorization': 'true', 'X-No-User-Id': 'true', 'X-No-Enterprise-Id': 'true', 'X-No-Department-Info': 'true',
  })
  if (res.status === 202 || res.status === 404) return null
  if (res.status >= 400) throw new Error(`授权轮询失败（HTTP ${res.status}）`)
  const body = parseJson(res.text)
  if (!body) return null
  const access = str(pick(body, 'accessToken', 'access_token', 'token'))
  if (!access) return null
  const expiresAtRaw = num(pick(body, 'expiresAt', 'expires_at'))
  const expiresIn = num(pick(body, 'expiresIn', 'expires_in'))
  const cred: CheckinCred = {
    accessToken: access,
    refreshToken: str(pick(body, 'refreshToken', 'refresh_token')),
    expiresAt: expiresAtRaw > 0 ? expiresAtRaw : (expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0),
    uid: str(pick(body, 'uid')),
    label: 'WorkBuddy 账号',
    domain: str(pick(body, 'domain')) || undefined,
  }
  // 尽力拿昵称，失败不阻塞
  try {
    const prof = await httpCall('GET', `${WB_AUTH}/v2/plugin/account`, {
      Authorization: `Bearer ${access}`, accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest', 'X-Domain': cred.domain || 'copilot.tencent.com',
    })
    const pbody = parseJson(prof.text)
    if (pbody) {
      const name = str(pick(pbody, 'nickname', 'nickName', 'name'))
      const uid = str(pick(pbody, 'uid', 'userId', 'id'))
      if (name) cred.label = name
      if (uid && !cred.uid) cred.uid = uid
    }
  } catch { /* 忽略 */ }
  return cred
}

function wbBase(cred: CheckinCred): string {
  return cred.domain ? `https://${cred.domain}` : 'https://www.codebuddy.cn'
}

function wbHeaders(cred: CheckinCred): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${cred.accessToken}`, accept: 'application/json', 'Content-Type': 'application/json',
  }
  if (cred.uid) h['X-User-Id'] = cred.uid
  h['X-Domain'] = cred.domain || 'www.codebuddy.cn'
  return h
}

export async function workbuddyRefresh(cred: CheckinCred): Promise<CheckinCred> {
  if (!cred.refreshToken) throw new Error('凭据里没有 refresh token，请重新授权')
  const res = await httpCall('POST', `${wbBase(cred)}/v2/plugin/auth/token/refresh`, {
    Authorization: `Bearer ${cred.accessToken}`,
    'X-Refresh-Token': cred.refreshToken,
    'X-Auth-Refresh-Source': 'ide-main', accept: 'application/json',
  })
  const body = parseJson(res.text) ?? {}
  const access = str(pick(body, 'accessToken', 'access_token'))
  if (res.status >= 400 || !access) throw new Error(`登录续期失败（HTTP ${res.status}），请重新授权`)
  return {
    ...cred, accessToken: access,
    refreshToken: str(pick(body, 'refreshToken', 'refresh_token')) || cred.refreshToken,
  }
}

export function parseWorkbuddyStatus(body: Json): CheckinStatus {
  const data = obj(body.data)
  const checked = data.todayCheckedIn === true || data.today_checked_in === true || data.todayChecked === true
  const active = data.active !== false
  const streak = num(data.streakDays ?? data.streak_days)
  const daily = num(data.dailyCredit ?? data.daily_credit)
  const todayCredit = num(data.todayCredit ?? data.today_credit)
  const points = Math.max(daily, todayCredit)
  if (!active) return { state: 'unavailable', message: '签到活动未开启', points: 0, streakDays: streak }
  if (checked) return { state: 'claimed', message: '今日已签到', points, streakDays: streak }
  return { state: 'claimable', message: `可签到 +${points} 积分`, points, streakDays: streak }
}

async function wbPost(cred: CheckinCred, path: string): Promise<{ status: number; body: Json }> {
  const res = await httpCall('POST', `${wbBase(cred)}${path}`, wbHeaders(cred), '{}')
  return { status: res.status, body: parseJson(res.text) ?? {} }
}

// ---------------- 统一入口（自动续期 + 401 重试一次） ----------------

/** 凭据盒：抽象凭据的读写位置（签到页用单账号存储，账号池用池存储） */
export interface CredBox {
  load(): Promise<CheckinCred | null>
  save(cred: CheckinCred): Promise<void>
}

export function singleCredBox(platform: CheckinPlatform, pwd: string): CredBox {
  return {
    load: () => loadCheckinCred(platform, pwd),
    save: cred => saveCheckinCred(platform, cred, pwd),
  }
}

async function withFreshCred<T>(
  platform: CheckinPlatform, box: CredBox,
  run: (cred: CheckinCred) => Promise<T>,
): Promise<T> {
  let cred = await box.load()
  if (!cred) throw new Error('还没连接账号，先点「连接账号」授权')
  const refresh = platform === 'minimax' ? minimaxRefresh : workbuddyRefresh
  if (cred.refreshToken && cred.expiresAt > 0 && cred.expiresAt - Date.now() < 120_000) {
    try {
      cred = await refresh(cred)
      await box.save(cred)
    } catch { /* 续期失败先用旧 token 试一次，下面 401 逻辑会再处理 */ }
  }
  try {
    return await run(cred)
  } catch (e) {
    if ((e as Error)?.message !== '__UNAUTHORIZED__') throw e
    if (!cred.refreshToken) throw new Error('登录已过期，请重新授权')
    const fresh = await refresh(cred)
    await box.save(fresh)
    return await run(fresh)
  }
}

/** WorkBuddy 签到状态（凭据盒版，供账号池逐个账号调用） */
export async function getWorkbuddyStatus(box: CredBox): Promise<CheckinStatus> {
  return withFreshCred('workbuddy', box, async cred => {
    let r = await wbPost(cred, '/v2/billing/meter/checkin-activity-status')
    if (r.status === 401 || r.status === 403) throw new Error('__UNAUTHORIZED__')
    if (r.status >= 400) r = await wbPost(cred, '/v2/billing/meter/checkin-status')
    if (r.status === 401 || r.status === 403) throw new Error('__UNAUTHORIZED__')
    if (r.status >= 400) throw new Error(`签到状态接口返回 HTTP ${r.status}`)
    return parseWorkbuddyStatus(r.body)
  })
}

/** WorkBuddy 签到领取（凭据盒版） */
export async function claimWorkbuddy(box: CredBox): Promise<{ message: string; points: number }> {
  return withFreshCred('workbuddy', box, async cred => {
    const r = await wbPost(cred, '/v2/billing/meter/daily-checkin')
    if (r.status === 401 || r.status === 403) throw new Error('__UNAUTHORIZED__')
    if (r.status >= 400) {
      const msg = str(r.body.message) || str(r.body.msg)
      throw new Error(`签到失败 HTTP ${r.status}${msg ? ' ' + msg : ''}`)
    }
    const data = obj(r.body.data)
    const success = data.success !== false
    const credit = num(data.credit ?? data.reward)
    if (success) return { message: `签到成功 +${credit} 积分`, points: credit }
    return { message: str(data.message) || '今日已签到', points: credit }
  })
}

/** MiniMax 签到状态（凭据盒版，供多账号逐个调用） */
export async function getMinimaxStatus(box: CredBox): Promise<CheckinStatus> {
  return withFreshCred('minimax', box, async cred => {
    const body = await minimaxApi(cred, '/minimax-cloud/api/v1/signin/status', 'GET')
    const status = parseMinimaxStatus(body)
    status.balance = await minimaxBalance(cred)
    return status
  })
}

/** MiniMax 签到领取（凭据盒版） */
export async function claimMinimax(box: CredBox): Promise<{ message: string; points: number }> {
  return withFreshCred('minimax', box, async cred => {
    const body = await minimaxApi(cred, '/minimax-cloud/api/v1/signin/claim', 'POST')
    mmCheckBase(body)
    const data = obj(body.data)
    const result = num(data.claim_result)
    const points = num(data.points)
    if (result === 1) return { message: `签到成功 +${points} 积分`, points }
    if (result === 2) return { message: '今日已签到', points }
    throw new Error(str(data.claim_id) ? '上游未确认领取结果，请稍后刷新状态' : '签到失败，请稍后重试')
  })
}

export async function getCheckinStatus(platform: CheckinPlatform, pwd: string): Promise<CheckinStatus> {
  if (platform === 'workbuddy') return getWorkbuddyStatus(singleCredBox(platform, pwd))
  return getMinimaxStatus(singleCredBox(platform, pwd))
}

export async function claimCheckin(platform: CheckinPlatform, pwd: string): Promise<{ message: string; points: number }> {
  if (platform === 'workbuddy') return claimWorkbuddy(singleCredBox(platform, pwd))
  return claimMinimax(singleCredBox(platform, pwd))
}
