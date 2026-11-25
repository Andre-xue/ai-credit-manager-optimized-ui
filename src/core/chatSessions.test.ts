import { describe, it, expect, beforeEach } from 'vitest'
import {
  SESSIONS_KEY, loadSessionList, loadArchivedList, setSessionArchived, clearSessionsData, deleteStoredSession,
} from './chatSessions'

// node 环境内存版 localStorage + window 桩（writeRawStore 会 dispatchEvent）
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()
;(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} }

function seed() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify({
    activeId: 'a',
    sessions: [
      { id: 'a', title: '会话A', messages: [{ role: 'user', content: 'hi' }], updatedAt: 300 },
      { id: 'b', title: '会话B', messages: [], updatedAt: 200 },
      { id: 'c', title: '会话C', messages: [], updatedAt: 100, archived: true },
    ],
  }))
}

beforeEach(() => { (localStorage as any).clear(); seed() })

describe('会话归档', () => {
  it('历史列表不含已归档，归档列表只含已归档', () => {
    expect(loadSessionList().sessions.map(s => s.id)).toEqual(['a', 'b'])
    expect(loadArchivedList().map(s => s.id)).toEqual(['c'])
  })

  it('归档当前会话后当前指针切到剩余第一个未归档会话', () => {
    setSessionArchived('a', true)
    const list = loadSessionList()
    expect(list.sessions.map(s => s.id)).toEqual(['b'])
    expect(list.activeId).toBe('b')
    expect(loadArchivedList().map(s => s.id).sort()).toEqual(['a', 'c'])
  })

  it('归档最后一个未归档会话时补一个空会话作当前会话', () => {
    setSessionArchived('a', true)
    setSessionArchived('b', true)
    const list = loadSessionList()
    expect(list.sessions).toHaveLength(1)
    expect(list.sessions[0].count).toBe(0)
    expect(list.activeId).toBe(list.sessions[0].id)
  })

  it('恢复归档后回到历史列表', () => {
    setSessionArchived('c', false)
    expect(loadSessionList().sessions.map(s => s.id)).toContain('c')
    expect(loadArchivedList()).toHaveLength(0)
  })
})

describe('按范围清空聊天数据', () => {
  it('history：只清未归档，已归档保留，当前换成新空会话', () => {
    clearSessionsData('history')
    expect(loadSessionList().sessions).toHaveLength(1)
    expect(loadSessionList().sessions[0].count).toBe(0)
    expect(loadArchivedList().map(s => s.id)).toEqual(['c'])
  })

  it('archived：只清已归档，未归档与当前指针不变', () => {
    clearSessionsData('archived')
    expect(loadArchivedList()).toHaveLength(0)
    const list = loadSessionList()
    expect(list.sessions.map(s => s.id)).toEqual(['a', 'b'])
    expect(list.activeId).toBe('a')
  })

  it('all：全部清空，只剩一个新的空会话', () => {
    clearSessionsData('all')
    expect(loadArchivedList()).toHaveLength(0)
    const list = loadSessionList()
    expect(list.sessions).toHaveLength(1)
    expect(list.sessions[0].count).toBe(0)
  })

  it('删除已归档会话不影响其他会话', () => {
    deleteStoredSession('c')
    expect(loadArchivedList()).toHaveLength(0)
    expect(loadSessionList().sessions.map(s => s.id)).toEqual(['a', 'b'])
  })
})
