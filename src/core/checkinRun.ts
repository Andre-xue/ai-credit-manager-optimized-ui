import {
  hasCheckinCred, loadCheckinCred, getCheckinStatus, claimCheckin,
  getWorkbuddyStatus, claimWorkbuddy, getMinimaxStatus, claimMinimax,
} from './checkin'
import { listPoolMeta, poolCredBox, migrateLegacyWorkbuddyCred } from './wbPool'
import { listMmMeta, mmCredBox, migrateLegacyMinimaxCred } from './mmPool'
import { getPlatformEnabled, platformMeta, TOKEN_PLATFORM_IDS } from './checkinPlatforms'
import { listTokenMeta, loadTokenSecret, hasAnyTokenAccounts } from './tokenPool'
import { getTokenStatus, claimToken } from './tokenCheckin'
import { getBiometricPassword } from './crypto'

/**
 * 一键签到 / 自动签到（v0.1.362）：把所有已连接来源（MiniMax 单账号 + WorkBuddy
 * 账号池每个号）逐个查状态、可领就领，结果汇总并留痕到本机存储——
 * 菜单栏迷你窗直接读留痕展示，也可自己发起（全程不打开主窗口）。
 * 自动签到偏好只存本机；执行需要保险箱已解锁（主密码在内存或指纹密码副本可用）。
 */

export interface CheckinRunItem {
  label: string
  outcome: 'claimed' | 'already' | 'error'
  message: string
  points?: number
}

export interface CheckinRun { at: number; items: CheckinRunItem[] }

const RUN_KEY = 'acm.checkin.lastRun.v1'
export const AUTO_KEY = 'acm.checkin.auto.v1'

export function readLastCheckinRun(): CheckinRun | null {
  try {
    const v = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as CheckinRun | null
    return v && typeof v.at === 'number' && Array.isArray(v.items) ? v : null
  } catch { return null }
}

/**
 * 清空本机签到留痕（v0.1.426）：只清 acm.checkin.lastRun.v1 这一条显示记录，
 * 不碰任何凭据与账号。两处（签到页 / 迷你窗）同读同一份记录：跨窗靠
 * localStorage 的 storage 事件，同窗靠 'acm-checkin-done'，清一处两处都空。
 * 注意：清空后今日守卫 checkinRunIsToday 读不到记录，自动签到下一 tick 会
 * 重新跑一次当天签到——各平台只会返回「已领」，不会重复领积分，留痕会以
 * 「已签到」的形式重新出现。这是清留痕的固有后果，不是 bug。
 */
export function clearLastCheckinRun(): void {
  try { localStorage.removeItem(RUN_KEY) } catch { /* 忽略 */ }
  try { window.dispatchEvent(new CustomEvent('acm-checkin-done')) } catch { /* 忽略 */ }
}

export function checkinRunIsToday(run: CheckinRun | null): boolean {
  if (!run) return false
  const d = new Date(run.at)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function getAutoCheckinEnabled(): boolean {
  try { return localStorage.getItem(AUTO_KEY) === '1' } catch { return false }
}

export function setAutoCheckinEnabled(v: boolean): void {
  try { localStorage.setItem(AUTO_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

/**
 * 自动签到取密码（v0.1.421）：会话密码优先；锁定时会话密码是 ''（不是 null），
 * 必须用 `||` 而非 `??` 落到指纹副本——`'' ?? copy` 仍是 ''，372「锁定也能签」
 * 在自动路径上就是这么坏的。迷你窗手动签到一直用的就是 `||`。
 */
export function resolveAutoCheckinPassword(sessionPwd: string): string | null {
  return sessionPwd || getBiometricPassword()
}

export type AutoCheckinTickResult = 'ran' | 'skipped-disabled' | 'skipped-nosource' | 'skipped-today' | 'skipped-nopwd'

/**
 * 自动签到 tick 一次（v0.1.421：从 App.tsx 抽出，便于单测钉住守卫与密码来源）。
 * 抛错时由调用方静默吞掉（失败原因在迷你窗/签到页手动刷新时呈现），与旧行为一致；
 * 通知只在保险箱已解锁时弹（锁定时用指纹副本静默签，不弹通知），与旧行为一致。
 */
export async function autoCheckinTick(sessionPwd: string, notify?: (msg: string) => void): Promise<AutoCheckinTickResult> {
  if (!getAutoCheckinEnabled()) return 'skipped-disabled'
  if (!hasCheckinSources()) return 'skipped-nosource'
  if (checkinRunIsToday(readLastCheckinRun())) return 'skipped-today'
  const pwd = resolveAutoCheckinPassword(sessionPwd)
  if (!pwd) return 'skipped-nopwd'
  const run = await runAllCheckins(pwd)
  if (sessionPwd && notify) notify(`自动签到完成：${summarizeCheckinRun(run)}`)
  return 'ran'
}

/** 有没有任何已连接的签到来源 */
export function hasCheckinSources(): boolean {
  return hasCheckinCred('minimax') || hasCheckinCred('workbuddy')
    || listPoolMeta().length > 0 || listMmMeta().length > 0 || hasAnyTokenAccounts()
}

/**
 * 逐个来源签到。密码不对（凭据全部解不开）时整体抛错，不产生误导性的逐项失败。
 */
export async function runAllCheckins(pwd: string): Promise<CheckinRun> {
  if (!pwd) throw new Error('保险箱未解锁')
  // 旧单账号凭据先迁进多账号存储（签到页/池页没打开过时自动签到也能覆盖到）
  await migrateLegacyWorkbuddyCred(pwd).catch(() => false)
  await migrateLegacyMinimaxCred(pwd).catch(() => false)
  // 先探一次密码对不对：任一已存凭据能解开即视为正确
  let probed = false
  if (hasCheckinCred('minimax')) {
    if (await loadCheckinCred('minimax', pwd)) probed = true
  }
  if (!probed) {
    for (const meta of listPoolMeta()) {
      if (await poolCredBox(meta.id, pwd).load()) { probed = true; break }
    }
  }
  if (!probed) {
    for (const meta of listMmMeta()) {
      if (await mmCredBox(meta.id, pwd).load()) { probed = true; break }
    }
  }
  if (!probed) {
    outer: for (const pid of TOKEN_PLATFORM_IDS) {
      for (const meta of listTokenMeta(pid)) {
        if (await loadTokenSecret(pid, meta.id, pwd)) { probed = true; break outer }
      }
    }
  }
  if (!probed && hasCheckinSources()) throw new Error('主密码不正确，凭据解不开')

  const items: CheckinRunItem[] = []
  // MiniMax 多账号（平台开关关掉时批量签到跳过该平台）
  if (getPlatformEnabled('minimax')) for (const meta of listMmMeta()) {
    const box = mmCredBox(meta.id, pwd)
    const label = `MiniMax · ${meta.label}`
    try {
      const st = await getMinimaxStatus(box)
      if (st.state === 'claimable') {
        const r = await claimMinimax(box)
        items.push({ label, outcome: 'claimed', message: r.message, points: r.points })
      } else if (st.state === 'claimed') {
        items.push({ label, outcome: 'already', message: st.message })
      } else {
        items.push({ label, outcome: 'error', message: st.message })
      }
    } catch (e) {
      items.push({ label, outcome: 'error', message: e instanceof Error ? e.message : '签到失败' })
    }
  }
  // 迁移没成功时兜底走旧单账号路径
  if (getPlatformEnabled('minimax') && !listMmMeta().length && hasCheckinCred('minimax')) {
    try {
      const st = await getCheckinStatus('minimax', pwd)
      if (st.state === 'claimable') {
        const r = await claimCheckin('minimax', pwd)
        items.push({ label: 'MiniMax Code', outcome: 'claimed', message: r.message, points: r.points })
      } else if (st.state === 'claimed') {
        items.push({ label: 'MiniMax Code', outcome: 'already', message: st.message })
      } else {
        items.push({ label: 'MiniMax Code', outcome: 'error', message: st.message })
      }
    } catch (e) {
      items.push({ label: 'MiniMax Code', outcome: 'error', message: e instanceof Error ? e.message : '签到失败' })
    }
  }
  if (getPlatformEnabled('workbuddy')) for (const meta of listPoolMeta()) {
    const box = poolCredBox(meta.id, pwd)
    const label = `WorkBuddy · ${meta.label}`
    try {
      const st = await getWorkbuddyStatus(box)
      if (st.state === 'claimable') {
        const r = await claimWorkbuddy(box)
        items.push({ label, outcome: 'claimed', message: r.message, points: r.points })
      } else if (st.state === 'claimed') {
        items.push({ label, outcome: 'already', message: st.message })
      } else {
        items.push({ label, outcome: 'error', message: st.message })
      }
    } catch (e) {
      items.push({ label, outcome: 'error', message: e instanceof Error ? e.message : '签到失败' })
    }
  }
  // 令牌类平台（豆包 / 灵犀 / DuMate / 小浣熊 / 天翼 AI / Qoder 等）
  for (const pid of TOKEN_PLATFORM_IDS) {
    if (!getPlatformEnabled(pid)) continue
    const meta0 = platformMeta(pid)
    for (const meta of listTokenMeta(pid)) {
      const label = `${meta0.name} · ${meta.label}`
      try {
        const secret = await loadTokenSecret(pid, meta.id, pwd)
        if (!secret) { items.push({ label, outcome: 'error', message: '凭据解不开（主密码不对或凭据损坏）' }); continue }
        const st = await getTokenStatus(pid, secret)
        if (st.state === 'claimable') {
          const r = await claimToken(pid, secret)
          items.push({ label, outcome: 'claimed', message: r.message, points: r.points })
        } else if (st.state === 'claimed') {
          items.push({ label, outcome: 'already', message: st.message })
        } else {
          items.push({ label, outcome: 'error', message: st.message })
        }
      } catch (e) {
        items.push({ label, outcome: 'error', message: e instanceof Error ? e.message : '签到失败' })
      }
    }
  }
  const run: CheckinRun = { at: Date.now(), items }
  saveCheckinRun(run)
  return run
}

function saveCheckinRun(run: CheckinRun): void {
  try { localStorage.setItem(RUN_KEY, JSON.stringify(run)) } catch { /* 忽略 */ }
  // 跨窗靠 localStorage 的 storage 事件；同窗（主窗口内自动签到完成时签到页正开着）靠这个自定义事件
  try { window.dispatchEvent(new CustomEvent('acm-checkin-done')) } catch { /* 忽略 */ }
}

/**
 * 把一次手动领取的结果并入今日留痕：主页面里逐个签、全部签也走这里，
 * 这样菜单栏迷你窗和签到页看到的是同一份记录，双向同步。
 */
export function recordCheckinOutcome(item: CheckinRunItem): void {
  const prev = readLastCheckinRun()
  const base: CheckinRun = checkinRunIsToday(prev) && prev ? prev : { at: Date.now(), items: [] }
  const items = base.items.filter(i => i.label !== item.label)
  items.push(item)
  saveCheckinRun({ at: Date.now(), items })
}

/** 一行摘要，给通知/迷你窗标题用 */
export function summarizeCheckinRun(run: CheckinRun): string {
  const claimed = run.items.filter(i => i.outcome === 'claimed')
  const points = claimed.reduce((s, i) => s + (i.points ?? 0), 0)
  const errors = run.items.filter(i => i.outcome === 'error').length
  if (!run.items.length) return '没有已连接的签到账号'
  const parts: string[] = []
  if (claimed.length) parts.push(`新领 ${claimed.length} 个${points ? `（+${points} 积分）` : ''}`)
  const already = run.items.length - claimed.length - errors
  if (already) parts.push(`${already} 个已签到`)
  if (errors) parts.push(`${errors} 个失败`)
  return parts.join('，') || '签到完成'
}
