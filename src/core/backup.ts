// 完整数据备份：把整份 AppState 导出为一个 JSON 文件 / 从文件导回（不依赖云同步）。
// 备份包含账户、额度、签到、用量、设置与「加密后的」密钥（密文，不是明文），
// 导入到其他设备后，需要用备份来源设备的同一主密码解锁保险箱。

import type { AppState } from './types'

export interface BackupEnvelope {
  app: 'ai-credit-manager'
  kind: 'full-backup'
  version: 1
  appVersion: string
  exportedAt: string
  state: AppState
}

export function buildBackup(state: AppState, appVersion: string): string {
  // 网关令牌是本机凭据、界面语言是本机偏好，都不进备份文件（导入后保留目标设备自己的）
  const safeState: AppState = { ...state, settings: { ...state.settings, gatewayToken: undefined, language: undefined } }
  const env: BackupEnvelope = {
    app: 'ai-credit-manager',
    kind: 'full-backup',
    version: 1,
    appVersion,
    exportedAt: new Date().toISOString(),
    state: safeState,
  }
  return JSON.stringify(env, null, 2)
}

export interface BackupSummary {
  accounts: number
  usage: number
  checkins: number
  quotas: number
}

export function summarizeState(state: AppState): BackupSummary {
  return {
    accounts: Array.isArray(state.accounts) ? state.accounts.length : 0,
    usage: Array.isArray(state.usage) ? state.usage.length : 0,
    checkins: Array.isArray(state.checkins) ? state.checkins.length : 0,
    quotas: Array.isArray(state.quotas) ? state.quotas.length : 0,
  }
}

export type ParseBackupResult =
  | { ok: true; state: AppState; summary: BackupSummary }
  | { ok: false; error: string }

/** 解析备份文件文本：接受本模块的信封格式，也接受直接导出的裸 AppState JSON */
export function parseBackup(text: string): ParseBackupResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件不是有效的 JSON，无法导入' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: '备份内容为空或格式不对' }
  const candidate = (parsed as { state?: unknown }).state ?? parsed
  if (!candidate || typeof candidate !== 'object') return { ok: false, error: '备份里没有找到数据部分' }
  const s = candidate as Partial<AppState>
  if (
    !Array.isArray(s.accounts) || !Array.isArray(s.usage) ||
    !Array.isArray(s.quotas) || !Array.isArray(s.checkins) ||
    typeof s.settings !== 'object' || s.settings === null
  ) {
    return { ok: false, error: '这不是 AI 魔方的完整备份文件（缺少账户 / 用量 / 设置等必要部分）' }
  }
  const state = s as AppState
  return { ok: true, state, summary: summarizeState(state) }
}
