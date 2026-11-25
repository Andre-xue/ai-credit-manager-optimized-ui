import { httpCall, parseJson, type CheckinStatus } from './checkin'

/**
 * 令牌类平台的签到适配（v0.1.367）：豆包 / WPS 灵犀 / 百度 DuMate / 商汤小浣熊 /
 * 天翼 AI / Qoder（国内+国际）。凭据都是用户粘贴的 Cookie / Token / PAT 字符串。
 * 协议行为研读自公开项目 dsh-checkin-all（MIT）的各 provider 实现，独立实现。
 * 这些平台一律按北京时间算「今天」。
 */

export interface ClaimResult { message: string; points: number }

type Json = Record<string, unknown>

function beijingDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

async function callJson(method: string, url: string, headers: Record<string, string>, body?: string): Promise<{ status: number; json: Json | null }> {
  const r = await httpCall(method, url, headers, body)
  return { status: r.status, json: parseJson(r.text) }
}

function cookieValue(cookie: string, name: string): string {
  for (const part of cookie.split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

function normalizeCookie(raw: string): string {
  return raw.replace(/^\s*cookie\s*:\s*/i, '').replace(/[\r\n]+/g, ' ').replace(/\s*;\s*/g, '; ').replace(/;\s*$/, '').trim()
}

// ---------------- 豆包 ----------------

const DOUBAO_PARAMS: Record<string, string> = {
  version_code: '20800', language: 'zh', device_platform: 'web', doubao_device_platform: 'web',
  aid: '497858', real_aid: '497858', pkg_type: 'release_version', pc_version: '2.32.6',
  doubao_pc_version: '5.72.66', samantha_web: '1', web_platform: 'desktop', 'use-olympus-account': '1', web_tab_id: '0',
}
const DOUBAO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/2.32.6'
const DOUBAO_GROUP = 'pc_incentive_task_mvp_v3'

function doubaoUrl(base: string, secret: string): string {
  const h = String(hashStr(secret)).padStart(16, '7')
  const h2 = String(hashStr(secret + ':web')).padStart(16, '3')
  const params = new URLSearchParams({ ...DOUBAO_PARAMS, web_id: `76${h}${h2}`.slice(0, 19), tea_uuid: h.slice(0, 16), device_id: '', region: '', sys_region: '' })
  return `${base}?${params.toString()}`
}

async function doubaoPost(secret: string, base: string, body: Json): Promise<Json> {
  const { json } = await callJson('POST', doubaoUrl(base, secret), {
    Cookie: normalizeCookie(secret), 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*',
    Referer: 'chrome://doubao-chat/', 'User-Agent': DOUBAO_UA, 'Agw-Js-Conv': 'str',
  }, JSON.stringify(body))
  if (!json) throw new Error('豆包接口返回无法解析')
  return json
}

interface DoubaoState { checked: boolean; streak: number; reward: number; total: number; task: Json; data: Json; campaignCode: string; taskStatus: string; rewardMode: string }

async function doubaoState(secret: string): Promise<DoubaoState> {
  const body = await doubaoPost(secret, 'https://www.doubao.com/alice/ug/campaign/v3/detail/', { campaign_group_code: DOUBAO_GROUP })
  const code = num(body.code)
  if (code === 710012001) throw new Error('豆包登录已过期（Cookie 失效），重新复制一次 Cookie')
  if (code !== 0) throw new Error(`豆包任务面板返回异常：${str(body.msg ?? body.message)}（code ${code}）`)
  const data = (body.data ?? {}) as Json
  const tasks = Array.isArray(data.tasks) ? (data.tasks as Json[]) : []
  const task = tasks.find(t => t?.task_kind === 'daily_signin')
  if (!task) throw new Error('这个豆包账号没有「每日签到」任务（工作版/飞书企业账号没有这个玩法，换个人账号）')
  const c = (task.daily_checkin ?? task.daily_signin ?? {}) as Json
  const reward = (c.reward ?? {}) as Json
  const progress = (data.progress ?? {}) as Json
  return {
    checked: c.checked_in_today === true,
    streak: num(c.continuous_days),
    reward: num(reward.reward_amount),
    total: num(progress.total_amount),
    task, data,
    campaignCode: str(task.campaign_code),
    taskStatus: str(task.task_status),
    rewardMode: str(task.reward_mode),
  }
}

/** 状态读取 */
async function doubaoStatus(secret: string): Promise<CheckinStatus> {
  const st = await doubaoState(secret)
  if (st.checked) return { state: 'claimed', message: `今日已签到（连签 ${st.streak} 天）`, points: st.reward, streakDays: st.streak, balance: st.total || undefined }
  return { state: 'claimable', message: `可签到 +${st.reward || 200} 额度`, points: st.reward || 200, streakDays: st.streak, balance: st.total || undefined }
}

async function doubaoClaim(secret: string): Promise<ClaimResult> {
  const st = await doubaoState(secret)
  if (st.checked) return { message: '今日已签到', points: 0 }
  const body = await doubaoPost(secret, 'https://www.doubao.com/alice/ug/campaign/landing/checkin', { scene: DOUBAO_GROUP })
  const code = num(body.code)
  if (code === 710012001) throw new Error('豆包登录已过期（Cookie 失效），重新复制一次 Cookie')
  if (code === 710010702) throw new Error('豆包说这个账号没有可领的签到活动（企业 / 飞书登录的账号没有这个活动；个人账号请在豆包电脑版「免费用豆包」里确认活动还在）')
  if (code !== 0) throw new Error(`豆包签到失败：${str(body.msg ?? body.message)}（code ${code}）`)
  const d = (body.data ?? {}) as Json
  if (d.idempotent === true) return { message: '今日已签到', points: 0 }
  const credit = num(d.reward_amount) || st.reward
  return { message: `签到成功 +${credit} 额度`, points: credit }
}

// ---------------- WPS 灵犀 ----------------

const LINGXI_HOST = 'https://lingxi.wps.cn'
const LINGXI_HEADERS: Record<string, string> = {
  accept: 'application/json', 'content-type': 'application/json', referer: `${LINGXI_HOST}/`,
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) WPSLingxi/1.3.31 Chrome/120.0.0.0 Safari/537.36',
}

function lingxiSid(secret: string): string {
  const v = cookieValue(normalizeCookie(secret), 'wps_sid')
  return v || secret.trim()
}

async function lingxiCall(secret: string, method: string, path: string, body?: string): Promise<Json> {
  const { status, json } = await callJson(method, `${LINGXI_HOST}${path}`, { ...LINGXI_HEADERS, cookie: `wps_sid=${lingxiSid(secret)}` }, body)
  if (!json) throw new Error(`灵犀接口返回 HTTP ${status}`)
  if (json.result && json.result !== 'ok') throw new Error(str(json.hint || json.msg) || `灵犀接口报错（${str(json.result)}）`)
  return json
}

interface LingxiState { claimable: boolean; claimed: boolean; todayReward: number; streak: number; totalClaimed: number; dayNo: number }

async function lingxiState(secret: string): Promise<LingxiState> {
  const json = await lingxiCall(secret, 'GET', '/api/public/v1/tasks')
  const data = (json.data ?? {}) as Json
  const tasks = Array.isArray(data.tasks) ? (data.tasks as Json[]) : []
  const task = tasks.find(t => t?.task_key === 'daily_check_in')
  if (!task) throw new Error('灵犀的任务列表里没有每日签到（登录可能已失效）')
  const extra = (task.extra ?? {}) as Json
  const days = Array.isArray(extra.check_in_days) ? (extra.check_in_days as Json[]) : []
  const today = days.find(d => num(d.day) === num(extra.today_day))
  const taskStatus = str(task.status).toLowerCase()
  const claimedByTask = taskStatus === 'claimed' || taskStatus === 'done' || taskStatus === 'finished'
  const todayClaimed = today?.status === 'claimed'
  const claimable = !claimedByTask && !todayClaimed
  return {
    claimable,
    claimed: claimedByTask || todayClaimed,
    todayReward: num(extra.today_reward) || num(today?.reward),
    streak: num(extra.consecutive_days),
    totalClaimed: num(data.total_claimed_credits),
    dayNo: num(extra.today_day),
  }
}

async function lingxiStatus(secret: string): Promise<CheckinStatus> {
  const st = await lingxiState(secret)
  if (st.claimed) return { state: 'claimed', message: `今日已签到（连签 ${st.streak} 天）`, points: st.todayReward, streakDays: st.streak, balance: st.totalClaimed || undefined }
  return { state: 'claimable', message: `可签到 +${st.todayReward} 智点（第 ${st.dayNo} 天）`, points: st.todayReward, streakDays: st.streak, balance: st.totalClaimed || undefined }
}

async function lingxiClaim(secret: string): Promise<ClaimResult> {
  const before = await lingxiState(secret)
  if (before.claimed) return { message: '今日已签到', points: 0 }
  const json = await lingxiCall(secret, 'POST', '/api/public/v1/tasks/daily_check_in/claim', '{}')
  const data = (json.data ?? {}) as Json
  const points = num(data.reward_amount) || before.todayReward
  return { message: `签到成功 +${points} 智点`, points }
}

// ---------------- 百度 DuMate ----------------

const DUMATE_HOST = 'https://console.bce.baidu.com'
const DUMATE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) DuMate/1.0.89 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36'

function dumateSession(secret: string): { cookie: string; csrf: string } {
  const cookie = normalizeCookie(secret)
  const csrf = cookieValue(cookie, 'bce-user-info').replace(/^["']+|["']+$/g, '')
  if (!csrf) throw new Error('这个 Cookie 里没有 bce-user-info，领不了（复制时要带上它）')
  return { cookie, csrf }
}

async function dumateCall(secret: string, method: string, path: string, body?: string): Promise<Json> {
  const { cookie, csrf } = dumateSession(secret)
  const { status, json } = await callJson(method, `${DUMATE_HOST}${path}`, {
    accept: 'application/json', 'content-type': 'application/json', 'x-dumate-client-type': 'web',
    origin: DUMATE_HOST, referer: `${DUMATE_HOST}/`, 'user-agent': DUMATE_UA, cookie, csrftoken: csrf,
  }, body)
  if (!json) throw new Error(`DuMate 接口返回 HTTP ${status}`)
  if (json.success === false) {
    const m = json.message
    const text = typeof m === 'string' ? m : str((m as Json)?.global) || '未知错误'
    throw new Error(text)
  }
  return json
}

interface DumateState { issued: boolean; totalPoints: number; totalTimes: number }

async function dumateState(secret: string): Promise<DumateState> {
  const json = await dumateCall(secret, 'GET', '/api/dumate/points/loginBonusInfo')
  const r = (json.result ?? {}) as Json
  return { issued: r.hasIssued === true, totalPoints: num(r.totalPoints), totalTimes: num(r.totalTimes) }
}

async function dumateStatus(secret: string): Promise<CheckinStatus> {
  const st = await dumateState(secret)
  if (st.issued) return { state: 'claimed', message: `今日已签到（累计 ${st.totalPoints} 积分）`, points: 0, streakDays: 0, balance: st.totalPoints || undefined }
  return { state: 'claimable', message: '可签到', points: 0, streakDays: 0, balance: st.totalPoints || undefined }
}

async function dumateClaim(secret: string): Promise<ClaimResult> {
  const before = await dumateState(secret)
  if (before.issued) return { message: '今日已签到', points: 0 }
  await dumateCall(secret, 'POST', '/api/dumate/points/loginBonus', '{}')
  let gained = 0
  try {
    const after = await dumateState(secret)
    gained = Math.max(0, after.totalPoints - before.totalPoints)
  } catch { /* 读不到增量不影响结果 */ }
  return { message: gained ? `签到成功 +${gained} 积分` : '签到成功', points: gained }
}

// ---------------- 商汤小浣熊 ----------------

const XHX_HOST = 'https://xiaohuanxiong.com'
const XHX_HEADERS: Record<string, string> = {
  accept: 'application/json', 'accept-language': 'zh-CN,zh;q=0.9', origin: XHX_HOST, referer: `${XHX_HOST}/work/home`,
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

function xhxAuth(secret: string): { cookie: string; token: string } {
  const raw = secret.trim().replace(/^Bearer\s+/i, '')
  if (raw.includes('=')) {
    const cookie = normalizeCookie(raw)
    let token = cookieValue(cookie, 'xhx_token')
    if (!token) {
      for (const part of cookie.split(/;\s*/)) {
        const i = part.indexOf('=')
        if (i > 0 && /raccoon_token$/.test(part.slice(0, i).trim())) { token = part.slice(i + 1).trim(); break }
      }
    }
    return { cookie, token }
  }
  return { cookie: `xhx_token=${raw}`, token: raw }
}

async function xhxCall(secret: string, method: string, path: string, extraHeaders: Record<string, string> = {}, body?: string): Promise<Json> {
  const auth = xhxAuth(secret)
  const headers: Record<string, string> = { ...XHX_HEADERS, ...extraHeaders }
  if (auth.cookie) headers.cookie = auth.cookie
  if (auth.token) headers.authorization = `Bearer ${auth.token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const { status, json } = await callJson(method, `${XHX_HOST}${path}`, headers, body)
  if (!json) throw new Error(`小浣熊接口返回 HTTP ${status}`)
  const code = num(json.code)
  if (status === 401 || code === 200001 || code === 200003) throw new Error('小浣熊登录已失效：重新打开 xiaohuanxiong.com 登录，把 Cookie 里的 xhx_token 复制过来')
  return json
}

async function xhxTodayGrant(secret: string): Promise<{ grant: Json | null; balance: number }> {
  const balJson = await xhxCall(secret, 'GET', '/api/web/points/v1/balance')
  const bal = (balJson.data ?? balJson) as Json
  const billsJson = await xhxCall(secret, 'GET', '/api/web/points/v2/bills?paging.limit=20&type=all')
  const bills = (billsJson.data ?? billsJson) as Json
  const items = Array.isArray(bills.items) ? (bills.items as Json[]) : []
  const today = beijingDayKey()
  const grant = items.find(it => {
    if (it?.biz_type !== 'daily_grant') return false
    const at = str(it.grant_at || it.created_at)
    const ms = Date.parse(at)
    return Number.isFinite(ms) && beijingDayKey(new Date(ms)) === today
  }) ?? null
  return { grant, balance: num(bal.available_points) }
}

async function xhxStatus(secret: string): Promise<CheckinStatus> {
  const { grant, balance } = await xhxTodayGrant(secret)
  if (grant) return { state: 'claimed', message: `今日已到账 +${num(grant.points)} 积分`, points: num(grant.points), streakDays: 0, balance }
  return { state: 'claimable', message: '今日积分待确认（点签到确认到账并续期）', points: 300, streakDays: 0, balance }
}

async function xhxClaim(secret: string): Promise<ClaimResult> {
  const before = await xhxTodayGrant(secret)
  if (before.grant) return { message: '今日已到账', points: 0 }
  const auth = xhxAuth(secret)
  const deviceId = (() => {
    const h = hashStr(auth.token || auth.cookie).toString(16).padStart(8, '0')
    return `${h.slice(0, 8)}-${h.slice(0, 4)}-4${h.slice(1, 4)}-a${h.slice(1, 4)}-${h}${h.slice(0, 4)}`
  })()
  await xhxCall(secret, 'POST', '/api/web/auth/v1/devices_current_heartbeat', {
    'x-client-platform': 'web', 'x-client-version': '', 'x-client-device-id': deviceId,
  }, '{}').catch(() => null)
  const after = await xhxTodayGrant(secret)
  if (after.grant) return { message: `签到成功：今日 +${num(after.grant.points)} 积分`, points: num(after.grant.points) }
  throw new Error('每日积分还没到账（服务端 00:00 自动发放，登录已续期），稍后再试')
}

// ---------------- 天翼 AI TeleAgent ----------------

const TA_ORIGIN = 'https://agent.teleai.com.cn'
const TA_PREFIXES = ['/meter/super-agent/user/portal', '/superCowork/sapi/user/portal']

function taAuth(secret: string): { cookie: string; token: string } {
  const raw = secret.trim().replace(/^Bearer\s+/i, '')
  if (raw.includes('=')) {
    const cookie = normalizeCookie(raw)
    let token = ''
    for (const name of ['operationToken', 'operToken', 'X-Token', 'user_token']) {
      token = cookieValue(cookie, name)
      if (token) break
    }
    return { cookie, token }
  }
  return { cookie: `operationToken=${raw}`, token: raw }
}

function taHeaders(secret: string): Record<string, string> {
  const auth = taAuth(secret)
  const headers: Record<string, string> = {
    accept: 'application/json', 'accept-language': 'zh-CN,zh;q=0.9', origin: TA_ORIGIN, referer: `${TA_ORIGIN}/teleagent`,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'x-app-version': '1.0.0', 'x-os-type': 'web', 'x-channel-id': 'web', 'x-runtime-env': 'prod',
    'x-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-nonce': `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`,
  }
  if (auth.cookie) headers.cookie = auth.cookie
  if (auth.token) headers['x-token'] = auth.token
  return headers
}

async function taCallBoth(secret: string, rest: string): Promise<Json> {
  let lastErr: Error | null = null
  for (const prefix of TA_PREFIXES) {
    try {
      const { status, json } = await callJson('GET', `${TA_ORIGIN}${prefix}${rest}`, taHeaders(secret))
      if (!json) { lastErr = new Error(`TeleAgent 接口返回 HTTP ${status}`); continue }
      const code = json.code ?? json.status
      if (status === 401 || String(code) === '4001') throw new Error('TeleAgent 登录已失效：重新登录后把 operationToken 复制过来')
      return json
    } catch (e) {
      if (e instanceof Error && /登录已失效/.test(e.message)) throw e
      lastErr = e instanceof Error ? e : new Error('请求失败')
    }
  }
  throw lastErr ?? new Error('TeleAgent 接口不可达')
}

const TA_CLAIMABLE = ['incomplete', 'not_joined', 'fixed']
const TA_CLAIMED = ['completed', 'claimed', 'received', 'done']

function taStatusOf(item: Json): 'claimable' | 'claimed' | 'other' {
  const s = str(item.action_status || item.status_text || item.status).toLowerCase()
  if (TA_CLAIMABLE.includes(s)) return 'claimable'
  if (TA_CLAIMED.includes(s)) return 'claimed'
  if (item.claimed === true) return 'claimed'
  const text = str(item.action_text || item.button_text)
  if (/已领|已领取|已完成|明日再来/.test(text)) return 'claimed'
  if (/立即领取|领取|未领取/.test(text)) return 'claimable'
  return 'other'
}

function taPointsOf(item: Json): number {
  for (const v of [item.points_amount, item.points, item.reward_points, item.points_value, item.amount]) {
    const n = num(v)
    if (n > 0) return n
  }
  return 0
}

function taClaimPath(jumpUrl: string): string {
  let path = jumpUrl.trim()
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) {
    try { const u = new URL(path); path = `${u.pathname}${u.search}` } catch { /* 保持原样 */ }
  }
  if (!path.startsWith('/')) path = `/${path}`
  if (path.startsWith('/superCowork/sapi/')) path = path.slice('/superCowork/sapi'.length)
  return path
}

interface TaState { claimable: Json[]; balance: number; activityCount: number; expected: number }

async function taState(secret: string): Promise<TaState> {
  const center = await taCallBoth(secret, '/companyStore/userCenter')
  const centerData = (center.data ?? {}) as Json
  const dayJson = await taCallBoth(secret, '/companyStore/v3/checkDayTask?theme=light')
  const dayData = (dayJson.data ?? {}) as Json
  const activities = (Array.isArray(dayData.activity_data) ? dayData.activity_data : Array.isArray(dayData.activityData) ? dayData.activityData : []) as Json[]
  const visible = activities.filter(a => a && a.visible !== false)
  const claimable = visible.filter(a => str(a.action_type).toLowerCase() !== 'web' && taStatusOf(a) === 'claimable' && taClaimPath(str(a.jump_url)))
  return {
    claimable,
    balance: num(centerData.current_points_balance ?? centerData.points_balance),
    activityCount: visible.length,
    expected: claimable.reduce((sum, a) => sum + taPointsOf(a), 0),
  }
}

async function taStatus(secret: string): Promise<CheckinStatus> {
  const st = await taState(secret)
  if (st.claimable.length) return { state: 'claimable', message: `福利社有 ${st.claimable.length} 个奖励可领（约 ${st.expected} 积分）`, points: st.expected, streakDays: 0, balance: st.balance || undefined }
  if (st.activityCount) return { state: 'claimed', message: `今日奖励已领完（余额 ${st.balance} 积分）`, points: 0, streakDays: 0, balance: st.balance || undefined }
  return { state: 'unavailable', message: '今天暂时没有可领的活动', points: 0, streakDays: 0, balance: st.balance || undefined }
}

async function taClaim(secret: string): Promise<ClaimResult> {
  const before = await taState(secret)
  if (!before.claimable.length) return { message: '今日奖励已领完', points: 0 }
  let points = 0
  let okCount = 0
  const failures: string[] = []
  for (const item of before.claimable) {
    const path = taClaimPath(str(item.jump_url))
    const candidates = [`${TA_ORIGIN}/superCowork/sapi${path}`, `${TA_ORIGIN}/meter/super-agent${path}`, `${TA_ORIGIN}${path}`]
    let done = false
    for (const url of candidates) {
      const { json } = await callJson('GET', url, taHeaders(secret))
      if (!json) continue
      const code = json.code ?? json.status
      if (json.success === true || code === 0 || code === 200 || code === '0' || code === '200') { done = true; break }
    }
    if (done) { okCount++; points += taPointsOf(item) } else failures.push(str(item.activity_title || item.title) || '每日奖励')
  }
  if (!okCount) throw new Error(`奖励没领到：${failures.join('、')}，稍后再试`)
  return { message: `签到成功：领到 ${okCount} 个奖励${points ? ` +${points} 积分` : ''}`, points }
}

// ---------------- Qoder（国内 / 国际） ----------------

const QODER_BASES: Record<string, string> = {
  'qoder-cn': 'https://openapi.qoder.com.cn',
  'qoder-intl': 'https://openapi.qoder.sh',
}

async function qoderExchange(base: string, pat: string): Promise<string> {
  const { status, json } = await callJson('POST', `${base}/api/v1/jobToken/exchange`, {
    accept: 'application/json', 'content-type': 'application/json', 'cosy-clienttype': '5', 'cosy-version': '1.0.1', 'user-agent': 'Qoder',
  }, JSON.stringify({ personal_token: pat.trim() }))
  const token = str(json?.token)
  if (status >= 400 || !token) throw new Error(`Qoder 个人访问令牌无效或已过期（HTTP ${status}）`)
  return token
}

function qoderEpoch(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v >= 1e12 ? v : v * 1000
  if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isNaN(t) ? undefined : t }
  return undefined
}

/** 当前这一轮（北京时间 10:00 → 次日 09:59）的起点 */
function qoderRoundStart(now = Date.now()): number {
  const utc8 = new Date(now + 8 * 3600_000)
  const dayStart = Date.UTC(utc8.getUTCFullYear(), utc8.getUTCMonth(), utc8.getUTCDate()) - 8 * 3600_000
  return utc8.getUTCHours() >= 10 ? dayStart + 10 * 3600_000 : dayStart - 86_400_000 + 10 * 3600_000
}

interface QoderState { kind: 'claimable' | 'claimed' | 'not-refreshed' | 'none'; campaign?: Json; amount: number }

async function qoderState(platform: string, pat: string): Promise<QoderState> {
  const base = QODER_BASES[platform]
  const token = await qoderExchange(base, pat)
  const { status, json } = await callJson('GET', `${base}/sash/api/v1/me/campaigns`, {
    accept: 'application/json', authorization: `Bearer ${token}`, 'cosy-clienttype': '10', 'user-agent': 'Qoder',
  })
  if (status === 401 || status === 403) throw new Error(`Qoder 登录无效（HTTP ${status}）`)
  if (status >= 400 || !json) throw new Error(`Qoder 活动列表 HTTP ${status}`)
  const list = ((json.campaigns ?? (json.data as Json)?.campaigns) ?? []) as Json[]
  const now = Date.now()
  const inWindow = (c: Json) => {
    if (c?.actionType !== 'CLAIM_BENEFIT') return false
    const start = qoderEpoch(c.startAt ?? c.beginAt)
    const end = qoderEpoch(c.endAt)
    if (start !== undefined && now < start) return false
    if (end !== undefined && now > end) return false
    return true
  }
  const claimable = list.find(c => inWindow(c) && (!c.claimStatus || c.claimStatus === 'CLAIMABLE'))
  if (claimable) return { kind: 'claimable', campaign: claimable, amount: num((claimable.benefit as Json)?.amount) }
  const today = list.find(inWindow)
  if (today) {
    const start = qoderEpoch(today.startAt ?? today.beginAt)
    if (start !== undefined && start < qoderRoundStart(now)) return { kind: 'not-refreshed', amount: 0 }
    return { kind: 'claimed', campaign: today, amount: num((today.benefit as Json)?.amount) }
  }
  return { kind: 'none', amount: 0 }
}

async function qoderStatus(platform: string, pat: string): Promise<CheckinStatus> {
  const st = await qoderState(platform, pat)
  if (st.kind === 'claimable') return { state: 'claimable', message: `可领取 +${st.amount || 100} Credits`, points: st.amount || 100, streakDays: 0 }
  if (st.kind === 'claimed') return { state: 'claimed', message: '今日已领取', points: st.amount, streakDays: 0 }
  if (st.kind === 'not-refreshed') return { state: 'unavailable', message: '今日活动 10:00 后刷新，到点自动签', points: 0, streakDays: 0 }
  return { state: 'unavailable', message: '这个账号没有可领取的签到活动（先在 Qoder 客户端登录一次该账号）', points: 0, streakDays: 0 }
}

async function qoderClaim(platform: string, pat: string): Promise<ClaimResult> {
  const base = QODER_BASES[platform]
  const st = await qoderState(platform, pat)
  if (st.kind === 'claimed') return { message: '今日已领取', points: 0 }
  if (st.kind === 'not-refreshed') throw new Error('Qoder 今天的活动还没开始（每天 10:00 换新一轮），到点后会自动签')
  if (st.kind === 'none' || !st.campaign) throw new Error('这个 Qoder 账号没有可领取的签到活动')
  const token = await qoderExchange(base, pat)
  const id = encodeURIComponent(str(st.campaign.campaignId ?? st.campaign.id))
  const { status, json } = await callJson('POST', `${base}/sash/api/v1/me/campaigns/${id}/claim`, {
    accept: 'application/json', authorization: `Bearer ${token}`, 'cosy-clienttype': '10', 'user-agent': 'Qoder', 'content-type': 'application/json',
  }, '{}')
  if (status >= 400 || !json) throw new Error(`Qoder 领取失败（HTTP ${status}）`)
  const body = (typeof json.data === 'object' && json.data !== null ? json.data : json) as Json
  if (body.replayed === true) return { message: '今日已领取', points: 0 }
  if (body.status !== 'CLAIMED' && body.success !== true) throw new Error(`Qoder 签到返回异常：${JSON.stringify(json).slice(0, 120)}`)
  const amount = num((body.benefit as Json)?.amount) || st.amount
  return { message: `签到成功 +${amount} Credits`, points: amount }
}

// ---------------- 分发 ----------------

const STATUS_FNS: Record<string, (secret: string) => Promise<CheckinStatus>> = {
  doubao: doubaoStatus,
  lingxi: lingxiStatus,
  dumate: dumateStatus,
  xiaohuanxiong: xhxStatus,
  teleagent: taStatus,
  'qoder-cn': s => qoderStatus('qoder-cn', s),
  'qoder-intl': s => qoderStatus('qoder-intl', s),
}

const CLAIM_FNS: Record<string, (secret: string) => Promise<ClaimResult>> = {
  doubao: doubaoClaim,
  lingxi: lingxiClaim,
  dumate: dumateClaim,
  xiaohuanxiong: xhxClaim,
  teleagent: taClaim,
  'qoder-cn': s => qoderClaim('qoder-cn', s),
  'qoder-intl': s => qoderClaim('qoder-intl', s),
}

export function isTokenPlatform(platform: string): boolean {
  return platform in STATUS_FNS
}

export async function getTokenStatus(platform: string, secret: string): Promise<CheckinStatus> {
  const fn = STATUS_FNS[platform]
  if (!fn) return { state: 'unknown', message: '未知平台', points: 0, streakDays: 0 }
  try {
    return await fn(secret)
  } catch (e) {
    return { state: 'unknown', message: e instanceof Error ? e.message : '查询失败', points: 0, streakDays: 0 }
  }
}

export async function claimToken(platform: string, secret: string): Promise<ClaimResult> {
  const fn = CLAIM_FNS[platform]
  if (!fn) throw new Error('未知平台')
  return fn(secret)
}
