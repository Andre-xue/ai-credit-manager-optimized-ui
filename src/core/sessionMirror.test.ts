import { describe, it, expect } from 'vitest'
import { collectSdkEntries, hasSdkSession, applySdkEntries } from './sessionMirror'

class FakeLs {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

describe('云会话镜像的条目收集/还原（v0.1.311）', () => {
  it('只收集 workbuddy-cloud.* 条目，不碰应用自身数据', () => {
    const ls = new FakeLs()
    ls.setItem('workbuddy-cloud.session.abc', '{"refreshToken":"wbrt_x"}')
    ls.setItem('workbuddy-cloud.pkce.abc', 'state')
    ls.setItem('acm.state', 'big')
    const entries = collectSdkEntries(ls)
    expect(Object.keys(entries).sort()).toEqual(['workbuddy-cloud.pkce.abc', 'workbuddy-cloud.session.abc'])
    expect(hasSdkSession(ls)).toBe(true)
  })

  it('还原时只写回 SDK 条目；无会话键时 hasSdkSession 为 false', () => {
    const ls = new FakeLs()
    ls.setItem('acm.state', 'x')
    expect(hasSdkSession(ls)).toBe(false)
    applySdkEntries(ls, { 'workbuddy-cloud.session.abc': 's', 'evil.key': 'no' })
    expect(ls.getItem('workbuddy-cloud.session.abc')).toBe('s')
    expect(ls.getItem('evil.key')).toBeNull()
    expect(hasSdkSession(ls)).toBe(true)
  })
})
