// 操作审计日志：记录敏感操作（查看/复制/删除 Key、导出、改密码、云登录登出）。
// 只记动作与对象名，绝不记录密钥内容。存于 AppState.audit，随云同步跨端合并。
import type { AppState, AuditEntry } from './types'

export const AUDIT_CAP = 500

let seq = 0
export function makeAuditEntry(action: string, detail?: string, now = new Date()): AuditEntry {
  seq += 1
  return {
    id: `au-${now.getTime().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: now.toISOString(),
    action,
    detail,
  }
}

/** 把一条审计追加进 state（不可变更新，超限截断为最近 AUDIT_CAP 条） */
export function appendAudit(state: AppState, entry: AuditEntry): AppState {
  const audit = [...(state.audit ?? []), entry].slice(-AUDIT_CAP)
  return { ...state, audit }
}

/** 同步合并：两端审计按 id 去重并集，按时间升序，截断上限 */
export function mergeAudit(a: AuditEntry[] | undefined, b: AuditEntry[] | undefined): AuditEntry[] {
  const byId = new Map<string, AuditEntry>()
  for (const e of [...(a ?? []), ...(b ?? [])]) byId.set(e.id, e)
  return [...byId.values()].sort((x, y) => x.at.localeCompare(y.at)).slice(-AUDIT_CAP)
}
