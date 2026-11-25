import { describe, it, expect, beforeEach } from 'vitest'
import {
  CHECKIN_TAB_KEY, CHECKIN_TAB_LABELS, checkinTabCategories, visibleCheckinTabs,
  readSavedCheckinTab, saveCheckinTab, resolveCheckinTab,
} from './checkinTabs'

// node 环境无 localStorage：内存版 polyfill（同 store.test.ts 的做法）
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

describe('checkinTabs（v0.1.403 签到页横向页签）', () => {
  beforeEach(() => { localStorage.clear() })

  it('9 个平台都有页签标签', () => {
    expect(Object.keys(CHECKIN_TAB_LABELS)).toHaveLength(9)
    expect(CHECKIN_TAB_LABELS['workbuddy']).toBe('WorkBuddy')
    expect(CHECKIN_TAB_LABELS['minimax']).toBe('MiniMax')
    expect(CHECKIN_TAB_LABELS['qoder-cn']).toBe('Qoder 国内')
    expect(CHECKIN_TAB_LABELS['qoder-intl']).toBe('Qoder 国际')
    expect(CHECKIN_TAB_LABELS['doubao']).toBe('豆包')
  })

  it('功能分类齐全', () => {
    expect(checkinTabCategories()).toEqual(['AI 编程工具', '大模型平台', 'AI 助手', 'AI 办公'])
  })

  it('不筛选时 9 个页签全可见（注册表顺序）', () => {
    const ids = visibleCheckinTabs('全部', '全部').map(p => p.id)
    expect(ids).toEqual(['workbuddy', 'qoder-cn', 'qoder-intl', 'minimax', 'doubao', 'xiaohuanxiong', 'teleagent', 'lingxi', 'dumate'])
  })

  it('国外筛选只剩 Qoder 国际', () => {
    expect(visibleCheckinTabs('国外', '全部').map(p => p.id)).toEqual(['qoder-intl'])
  })

  it('AI 助手筛选出豆包 / 商汤小浣熊 / 天翼 AI', () => {
    expect(visibleCheckinTabs('全部', 'AI 助手').map(p => p.id)).toEqual(['doubao', 'xiaohuanxiong', 'teleagent'])
  })

  it('国内 × AI 编程工具筛选出 WorkBuddy 与 Qoder 国内', () => {
    expect(visibleCheckinTabs('国内', 'AI 编程工具').map(p => p.id)).toEqual(['workbuddy', 'qoder-cn'])
  })

  it('国外 × AI 助手组合筛选一个不剩', () => {
    expect(visibleCheckinTabs('国外', 'AI 助手')).toEqual([])
  })

  it('没记过页签时回落 workbuddy', () => {
    expect(readSavedCheckinTab()).toBe('workbuddy')
  })

  it('保存并读回页签', () => {
    saveCheckinTab('doubao')
    expect(localStorage.getItem(CHECKIN_TAB_KEY)).toBe('doubao')
    expect(readSavedCheckinTab()).toBe('doubao')
  })

  it('记住的页签无效时回落 workbuddy', () => {
    localStorage.setItem(CHECKIN_TAB_KEY, 'not-a-platform')
    expect(readSavedCheckinTab()).toBe('workbuddy')
  })

  it('选中的页签可见时保持选中', () => {
    const visible = visibleCheckinTabs('全部', '全部')
    expect(resolveCheckinTab('minimax', visible)).toBe('minimax')
  })

  it('选中的页签被筛掉时落到第一个可见页签', () => {
    const visible = visibleCheckinTabs('国外', '全部')
    expect(resolveCheckinTab('doubao', visible)).toBe('qoder-intl')
  })

  it('筛后一个不剩时返回 null', () => {
    expect(resolveCheckinTab('doubao', [])).toBeNull()
  })
})
