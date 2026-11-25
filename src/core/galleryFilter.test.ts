import { describe, it, expect, beforeEach } from 'vitest'
import { loadFilterCollapsed, saveFilterCollapsed } from './galleryFilter'

function mockStorage() {
  const m = new Map<string, string>()
  ;(globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
}

describe('galleryFilter 折叠状态', () => {
  beforeEach(() => { mockStorage() })

  it('默认展开（未存过返回 false）', () => {
    expect(loadFilterCollapsed()).toBe(false)
  })

  it('保存收起后读回为 true，保存展开后读回为 false', () => {
    saveFilterCollapsed(true)
    expect(loadFilterCollapsed()).toBe(true)
    saveFilterCollapsed(false)
    expect(loadFilterCollapsed()).toBe(false)
  })
})
