// 单价自动校准：官方参考价与偏差判断
import { describe, it, expect } from 'vitest'
import { officialUnitPrice, priceDrifted, OFFICIAL_UNIT_PRICES } from './value'

describe('officialUnitPrice / priceDrifted', () => {
  it('收录平台返回官方价，未收录返回 undefined', () => {
    expect(officialUnitPrice('deepseek')).toBe(OFFICIAL_UNIT_PRICES.deepseek)
    expect(officialUnitPrice('no-such-provider')).toBeUndefined()
  })
  it('偏差 5% 内不算漂移，超过算漂移', () => {
    expect(priceDrifted(0.001, 0.001)).toBe(false)
    expect(priceDrifted(0.00104, 0.001)).toBe(false)
    expect(priceDrifted(0.002, 0.001)).toBe(true)
    expect(priceDrifted(0.5, undefined)).toBe(false)
  })
})
