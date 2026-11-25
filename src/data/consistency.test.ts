import { describe, it, expect } from 'vitest'
import { PROVIDERS } from './providers'
import { BENEFITS } from './benefits'
import { DEFAULT_UNIT_PRICES } from '../core/value'

describe('平台数据一致性', () => {
  it('平台 id 唯一', () => {
    const ids = PROVIDERS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('至少若干平台有福利/签到跳转链接（签到功能可用）', () => {
    const withCheckin = PROVIDERS.filter(p => p.checkinUrl)
    expect(withCheckin.length).toBeGreaterThanOrEqual(5)
    for (const p of withCheckin) expect(p.checkinUrl).toMatch(/^https:\/\//)
  })

  it('福利项引用的平台 id 都存在', () => {
    const ids = new Set(PROVIDERS.map(p => p.id))
    for (const b of BENEFITS) expect(ids.has(b.providerId)).toBe(true)
  })

  it('福利链接均为官方 https 域名', () => {
    for (const b of BENEFITS) expect(b.url).toMatch(/^https:\/\//)
  })

  it('所有平台都有默认单价或走 default 兜底', () => {
    expect(DEFAULT_UNIT_PRICES.default).toBeGreaterThan(0)
    for (const p of PROVIDERS) {
      expect(DEFAULT_UNIT_PRICES[p.id] ?? DEFAULT_UNIT_PRICES.default).toBeGreaterThan(0)
    }
  })

  it('Kimi 的 id 为 kim（与单价、福利表一致）', () => {
    expect(PROVIDERS.some(p => p.id === 'kim')).toBe(true)
    expect(DEFAULT_UNIT_PRICES.kim).toBeGreaterThan(0)
    expect(BENEFITS.some(b => b.providerId === 'kim')).toBe(true)
  })

  it('WorkBuddy 与豆包标记为官方签到，跳转官方域名', () => {
    const wb = PROVIDERS.find(p => p.id === 'workbuddy')
    const db = PROVIDERS.find(p => p.id === 'doubao')
    expect(wb).toBeDefined()
    expect(wb?.dailyCheckin).toBe(true)
    expect(wb?.checkinUrl).toBe('https://www.workbuddy.cn/')
    expect(db?.dailyCheckin).toBe(true)
    expect(db?.checkinUrl).toBe('https://www.doubao.com/')
  })
})
