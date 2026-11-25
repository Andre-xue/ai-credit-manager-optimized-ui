// 归档会话落盘（v0.1.298，Ethan 要求）：在边栏点「归档」后，若数据存储的
// 「AI 助手文件」已开启并选了文件夹，把该会话以 md 存进该文件夹。
// 格式为对话式一问一答：用户与 AI 用不同标题区块明确区分，方便日后翻看。

import { readRawStore } from './chatSessions'
import { storageDir } from './storagePrefs'

export interface ArchiveMessage { role: string; content: string; at?: number }

export interface ArchiveSessionLike {
  id: string
  title: string
  updatedAt: number
  messages: ArchiveMessage[]
}

/** 一问一答 md：用户「## 👤 用户」、AI「## 🤖 AI 助手」，逐条成段，区分明确 */
export function buildArchiveMarkdown(session: ArchiveSessionLike, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
  const lines = [
    `# ${session.title || '新对话'}`,
    '',
    `- 归档时间：${stamp}`,
    `- 消息数：${session.messages.length}`,
    '',
    '---',
    '',
  ]
  for (const m of session.messages) {
    if (m.role === 'system') continue
    lines.push(m.role === 'user' ? '## 👤 用户' : '## 🤖 AI 助手')
    lines.push('')
    lines.push(m.content ?? '')
    lines.push('')
  }
  return lines.join('\n')
}

/** 文件名：归档-标题-YYYYMMDD-HHmm.md（标题做文件名安全处理，限长） */
export function archiveFileName(session: ArchiveSessionLike, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const safe = (session.title || '新对话').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 40) || '新对话'
  return `归档-${safe}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.md`
}

/** 归档后落盘：读原始会话存储 → 写 md 到 AI 文件目录。未开启/失败静默返回 false */
export async function saveArchivedSessionToFolder(sessionId: string): Promise<boolean> {
  const dir = storageDir('ai')
  if (!dir) return false
  const store = readRawStore()
  const session = store?.sessions.find(s => s.id === sessionId)
  if (!session) return false
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
  const invoke = w.__TAURI_INTERNALS__?.invoke
  if (!invoke) return false
  try {
    const like: ArchiveSessionLike = {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messages: (session.messages as ArchiveMessage[]).filter(m => m && typeof m.content === 'string'),
    }
    await invoke('write_file_to_dir', { dir, filename: archiveFileName(like), content: buildArchiveMarkdown(like) })
    return true
  } catch {
    return false
  }
}
