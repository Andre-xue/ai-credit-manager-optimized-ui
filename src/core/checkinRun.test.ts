import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { webcrypto } from 'node:crypto'
import {
  resolveAutoCheckinPassword, autoCheckinTick, setAutoCheckinEnabled,
  getAutoCheckinEnabled, readLastCheckinRun, checkinRunIsToday, clearLastCheckinRun,
} from './checkinRun'
import { initVault, saveBiometricPassword, clearBiometricPassword } from './crypto'
import { addPoolAccount } from './wbPool'

// Node 环境 polyfill：WebCrypto + localStorage + window（httpCall 在 web 环境走 fetch）
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
  if (!(globalThis as unknown as Record<string, unknown>).localStorage) {
    const m = new Map<string, string>()
    ;(globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => m.clear(),
    }
  }
  if (!(globalThis as unknown as Record<string, unknown>).window) {
    ;(globalThis as unknown as Record<string, unknown>).window = {}
  }
})

const PWD = 'test1234'
const RUN_KEY = 'acm.checkin.lastRun.v1'

function seedLastRun(at: number): void {
  localStorage.setItem(RUN_KEY, JSON.stringify({ at, items: [] }))
}

/** 假 WorkBuddy 上游：状态可领、领取成功（走 fetch，httpCall 在 node 环境走 fetch 分支） */
function stubWorkbuddyFetch(): () => void {
  const origFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url)
    if (u.includes('checkin-activity-status')) {
      return { status: 200, text: async () => JSON.stringify({ data: { todayCheckedIn: false, active: true, streakDays: 5, dailyCredit: 100 } }) }
    }
    if (u.includes('daily-checkin')) {
      return { status: 200, text: async () => JSON.stringify({ data: { success: true, credit: 100 } }) }
    }
    return { status: 404, text: async () => '{}' }
  }) as typeof fetch
  return () => { globalThis.fetch = origFetch }
}

async function seedPoolAccount(): Promise<void> {
  await initVault(PWD)
  await addPoolAccount(
    { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600_000, uid: 'u1', label: '测试号' },
    PWD,
  )
}

describe('checkinRun.resolveAutoCheckinPassword (v0.1.421)', () => {
  beforeEach(() => { localStorage.clear(); clearBiometricPassword() })

  it('回归：空串会话密码时 ?? 不会落到指纹副本——旧写法返回空串，修好后返回副本', () => {
    saveBiometricPassword(PWD)
    // 旧代码：sessionPwdRef.current ?? getBiometricPassword()，锁定时 sessionPwd 是 ''，?? 不往下走
    const lockedSessionPwd: string = ''
    expect(lockedSessionPwd ?? 'copy-pwd').toBe('')
    expect(resolveAutoCheckinPassword('')).toBe(PWD)
  })

  it('锁定时没有指纹副本：返回 null（tick 会跳过）', () => {
    expect(resolveAutoCheckinPassword('')).toBeNull()
  })

  it('已解锁时会话密码优先，不用副本', () => {
    saveBiometricPassword(PWD)
    expect(resolveAutoCheckinPassword('session-pwd')).toBe('session-pwd')
  })

  it('会话密码与副本都为空：返回 null', () => {
    expect(resolveAutoCheckinPassword('')).toBeNull()
  })
})

describe('checkinRun.autoCheckinTick (v0.1.421)', () => {
  let restoreFetch: () => void
  beforeEach(async () => {
    localStorage.clear()
    clearBiometricPassword()
    restoreFetch = stubWorkbuddyFetch()
    await seedPoolAccount()
    setAutoCheckinEnabled(true)
    seedLastRun(Date.now() - 86400_000) // 昨天签过，今天还没签
  })
  afterEach(() => { restoreFetch() })

  it('Bug 1 修好：锁定时（会话密码为空串）有指纹副本，tick 真跑并签到成功', async () => {
    saveBiometricPassword(PWD)
    const notes: string[] = []
    const r = await autoCheckinTick('', (m) => notes.push(m))
    expect(r).toBe('ran')
    const run = readLastCheckinRun()
    expect(run && checkinRunIsToday(run)).toBe(true)
    expect(run?.items).toHaveLength(1)
    expect(run?.items[0].outcome).toBe('claimed')
    expect(run?.items[0].label).toContain('WorkBuddy')
    // 锁定时静默签，不弹通知
    expect(notes).toHaveLength(0)
  })

  it('锁定时没有指纹副本：tick 跳过，不跑签到、不留今日记录', async () => {
    const r = await autoCheckinTick('')
    expect(r).toBe('skipped-nopwd')
    expect(checkinRunIsToday(readLastCheckinRun())).toBe(false)
  })

  it('已解锁时 tick 跑并弹通知', async () => {
    const notes: string[] = []
    const r = await autoCheckinTick(PWD, (m) => notes.push(m))
    expect(r).toBe('ran')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('自动签到完成')
    expect(readLastCheckinRun()?.items[0].outcome).toBe('claimed')
  })

  it('今日已签过：解锁后 tick 也不重复跑（守卫钉住）', async () => {
    seedLastRun(Date.now())
    const before = readLastCheckinRun()?.at
    const r = await autoCheckinTick(PWD)
    expect(r).toBe('skipped-today')
    expect(readLastCheckinRun()?.at).toBe(before)
  })

  it('连续调两次：第一次跑，第二次跳过（不重复跑）', async () => {
    saveBiometricPassword(PWD)
    expect(await autoCheckinTick('')).toBe('ran')
    expect(await autoCheckinTick('')).toBe('skipped-today')
    expect(await autoCheckinTick(PWD)).toBe('skipped-today')
  })

  it('自动签到开关关掉：tick 跳过', async () => {
    setAutoCheckinEnabled(false)
    expect(await autoCheckinTick(PWD)).toBe('skipped-disabled')
    expect(checkinRunIsToday(readLastCheckinRun())).toBe(false)
  })

  it('没有已连接的签到来源：tick 跳过', async () => {
    localStorage.removeItem('acm.wbpool.v1')
    expect(await autoCheckinTick(PWD)).toBe('skipped-nosource')
  })

  it('凭据解不开（副本密码不对）：tick 抛错，由调用方静默吞掉，不留今日记录', async () => {
    saveBiometricPassword('wrong-pwd')
    await expect(autoCheckinTick('')).rejects.toThrow(/主密码不正确/)
    expect(checkinRunIsToday(readLastCheckinRun())).toBe(false)
  })
})

describe('checkinRun.clearLastCheckinRun (v0.1.426)', () => {
  beforeEach(() => { localStorage.clear(); clearBiometricPassword() })

  it('清掉留痕：readLastCheckinRun 读不到，今日守卫随之失效（下一 tick 会重跑当天签到）', () => {
    seedLastRun(Date.now())
    expect(readLastCheckinRun()).not.toBeNull()
    expect(checkinRunIsToday(readLastCheckinRun())).toBe(true)
    clearLastCheckinRun()
    expect(readLastCheckinRun()).toBeNull()
    expect(checkinRunIsToday(readLastCheckinRun())).toBe(false)
  })

  it('没有留痕时清空也不报错', () => {
    expect(() => clearLastCheckinRun()).not.toThrow()
    expect(readLastCheckinRun()).toBeNull()
  })

  it('只清留痕键：自动签到开关等其他键不受影响', () => {
    seedLastRun(Date.now())
    setAutoCheckinEnabled(true)
    clearLastCheckinRun()
    expect(getAutoCheckinEnabled()).toBe(true)
  })

  it('清掉后重新签到能再写一条新留痕（不影响后续签到）', () => {
    seedLastRun(Date.now())
    clearLastCheckinRun()
    seedLastRun(Date.now())
    expect(checkinRunIsToday(readLastCheckinRun())).toBe(true)
  })
})
