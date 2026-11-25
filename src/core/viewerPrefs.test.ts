import { describe, it, expect, beforeEach } from 'vitest'
import { loadViewerPrefs, saveViewerPrefs } from './viewerPrefs'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

describe('viewerPrefs 阅览方式（本机偏好）', () => {
  beforeEach(() => localStorage.clear())
  it('默认视频/图片都是应用内', () => {
    expect(loadViewerPrefs()).toEqual({ video: 'internal', image: 'internal' })
  })
  it('保存后可读回，两个选项互相独立', () => {
    saveViewerPrefs({ video: '/Applications/IINA.app', image: 'system' })
    expect(loadViewerPrefs()).toEqual({ video: '/Applications/IINA.app', image: 'system' })
  })
  it('坏数据回退默认', () => {
    localStorage.setItem('acm.viewer.prefs', '{bad json')
    expect(loadViewerPrefs()).toEqual({ video: 'internal', image: 'internal' })
    localStorage.setItem('acm.viewer.prefs', JSON.stringify({ video: 42 }))
    expect(loadViewerPrefs().video).toBe('internal')
  })
})
