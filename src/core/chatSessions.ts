// AI 助手会话存储的跨组件通道：会话数据存 localStorage（acm_ai_sessions_v1，AIView 拥有完整读写），
// 左侧边栏的历史列表通过本模块读元信息、发打开/新建/改名/删除请求，AIView 监听事件同步。

export const SESSIONS_KEY = 'acm_ai_sessions_v1'
export const SESSIONS_EVENT = 'acm-sessions-changed'
export const OPEN_SESSION_EVENT = 'acm-open-session'
export const NEW_SESSION_EVENT = 'acm-new-session'
export const TOGGLE_HISTORY_EVENT = 'acm-toggle-history'

const PENDING_OPEN_KEY = 'acm_ai_open_session_pending'
const PENDING_NEW_KEY = 'acm_ai_new_session_pending'

export interface SessionMeta {
  id: string
  title: string
  updatedAt: number
  count: number
}

interface StoredSession {
  id: string
  title: string
  messages: unknown[]
  updatedAt: number
  /** 已归档：不出现在历史列表，收进「已归档」分组，可恢复 */
  archived?: boolean
}

interface RawStore {
  sessions: StoredSession[]
  activeId: string
}

export function readRawStore(): RawStore | null {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RawStore
    if (!Array.isArray(parsed.sessions)) return null
    return parsed
  } catch { return null }
}

function writeRawStore(store: RawStore): void {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(store)) } catch { /* 忽略 */ }
  window.dispatchEvent(new Event(SESSIONS_EVENT))
}

/** 边栏用：只读会话元信息（标题/时间/条数），按最近更新倒序；已归档的不在此列 */
export function loadSessionList(): { sessions: SessionMeta[]; activeId: string } {
  const store = readRawStore()
  if (!store) return { sessions: [], activeId: '' }
  const sessions = store.sessions
    .filter(s => !s.archived)
    .map(s => ({ id: s.id, title: s.title || '新对话', updatedAt: s.updatedAt || 0, count: Array.isArray(s.messages) ? s.messages.length : 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return { sessions, activeId: store.activeId }
}

/** 已归档会话元信息（边栏「已归档」分组用） */
export function loadArchivedList(): SessionMeta[] {
  const store = readRawStore()
  if (!store) return []
  return store.sessions
    .filter(s => s.archived)
    .map(s => ({ id: s.id, title: s.title || '新对话', updatedAt: s.updatedAt || 0, count: Array.isArray(s.messages) ? s.messages.length : 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function freshEmptySession(): StoredSession {
  return { id: `sess-${Date.now()}`, title: '新对话', messages: [], updatedAt: Date.now() }
}

/** 归档/恢复会话：归档当前会话时把当前会话切到剩余第一个未归档会话；没有未归档的了就补一个空会话 */
export function setSessionArchived(id: string, archived: boolean): void {
  const store = readRawStore()
  if (!store) return
  const sessions = store.sessions.map(s => s.id === id ? { ...s, archived } : s)
  let activeId = store.activeId
  if (archived && store.activeId === id) {
    const rest = sessions.filter(s => !s.archived)
    if (rest.length) activeId = rest[0].id
    else {
      const fresh = freshEmptySession()
      sessions.push(fresh)
      activeId = fresh.id
    }
  }
  writeRawStore({ sessions, activeId })
}

/** 按范围清空聊天数据（设置页「清空历史与数据」用）：history=未归档会话，archived=已归档会话，all=全部 */
export function clearSessionsData(scope: 'history' | 'archived' | 'all'): void {
  const store = readRawStore()
  if (scope === 'all' || !store) {
    const fresh = freshEmptySession()
    writeRawStore({ sessions: [fresh], activeId: fresh.id })
    return
  }
  if (scope === 'archived') {
    const kept = store.sessions.filter(s => !s.archived)
    if (!kept.length) {
      const fresh = freshEmptySession()
      writeRawStore({ sessions: [fresh], activeId: fresh.id })
      return
    }
    writeRawStore({ sessions: kept, activeId: kept.some(s => s.id === store.activeId) ? store.activeId : kept[0].id })
    return
  }
  // history：只留已归档，当前会话换成新的空会话
  const kept = store.sessions.filter(s => s.archived)
  const fresh = freshEmptySession()
  writeRawStore({ sessions: [...kept, fresh], activeId: fresh.id })
}

export function updateSessionTitle(id: string, title: string): void {
  const store = readRawStore()
  if (!store) return
  writeRawStore({ ...store, sessions: store.sessions.map(s => s.id === id ? { ...s, title } : s) })
}

/** 删除会话：删的是当前会话则切到剩余第一个；全删光则补一个空会话（与 AIView 内删除语义一致） */
export function deleteStoredSession(id: string): void {
  const store = readRawStore()
  if (!store) return
  const rest = store.sessions.filter(s => s.id !== id)
  if (!rest.length) {
    const fresh: StoredSession = { id: `sess-${Date.now()}`, title: '新对话', messages: [], updatedAt: Date.now() }
    writeRawStore({ sessions: [fresh], activeId: fresh.id })
    return
  }
  writeRawStore({ sessions: rest, activeId: store.activeId === id ? rest[0].id : store.activeId })
}

/** 请求打开某会话：写 pending（AIView 未挂载时挂载后消费）+ 发事件（已挂载时立即响应） */
export function requestOpenSession(id: string): void {
  try { localStorage.setItem(PENDING_OPEN_KEY, id) } catch { /* 忽略 */ }
  window.dispatchEvent(new Event(OPEN_SESSION_EVENT))
}

export function requestNewSession(): void {
  try { localStorage.setItem(PENDING_NEW_KEY, '1') } catch { /* 忽略 */ }
  window.dispatchEvent(new Event(NEW_SESSION_EVENT))
}

export function requestToggleHistory(): void {
  window.dispatchEvent(new Event(TOGGLE_HISTORY_EVENT))
}

/** AIView 消费 pending 请求，返回需要执行的动作（消费后即清除） */
export function consumePendingSessionActions(): { openId?: string; wantNew?: boolean } {
  const out: { openId?: string; wantNew?: boolean } = {}
  try {
    const openId = localStorage.getItem(PENDING_OPEN_KEY)
    if (openId) { out.openId = openId; localStorage.removeItem(PENDING_OPEN_KEY) }
    if (localStorage.getItem(PENDING_NEW_KEY)) { out.wantNew = true; localStorage.removeItem(PENDING_NEW_KEY) }
  } catch { /* 忽略 */ }
  return out
}
