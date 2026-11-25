import { describe, it, expect } from 'vitest'
import { diffPrices } from './priceWatch'

describe('diffPrices 价格变动对比', () => {
  it('检出涨价与降价，忽略未变平台', () => {
    const changes = diffPrices(
      { deepseek: 0.001, kim: 0.002, glm: 0.0005 },
      { deepseek: 0.002, kim: 0.002, glm: 0.0002 },
      '2026-11-20T00:00:00.000Z',
    )
    expect(changes).toHaveLength(2)
    expect(changes.find(c => c.providerId === 'deepseek')).toMatchObject({ oldPrice: 0.001, newPrice: 0.002 })
    expect(changes.find(c => c.providerId === 'glm')).toMatchObject({ oldPrice: 0.0005, newPrice: 0.0002 })
  })

  it('新增/移除平台不算调价', () => {
    expect(diffPrices({ a: 1 }, { a: 1, b: 2 })).toHaveLength(0)
    expect(diffPrices({ a: 1, b: 2 }, { a: 1 })).toHaveLength(0)
  })

  it('浮点微差不误报', () => {
    expect(diffPrices({ a: 0.1 }, { a: 0.100001 })).toHaveLength(0)
  })
})
