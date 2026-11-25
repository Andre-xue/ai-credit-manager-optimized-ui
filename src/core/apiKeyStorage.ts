// API Key 存放文件（v0.1.298）：把全部账户的 Key 写成一个清单文件，
// 放到用户在「设置 → 数据存储」里选的文件夹，Key 增删改后自动保持最新。
// 清单固定密文 + JSON（v0.1.300）；serializeApiKeyRows 仍保留多格式序列化
// 能力供备份等场景复用。桌面端专用（写本机文件）。

import type { AppState } from './types'
import { isLocalProvider } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { buildKeyBackup } from './keyBackup'
import { storageDir, type StoragePrefs, type ApiKeyStoreFormat } from './storagePrefs'

export interface ApiKeyRow {
  platform: string
  label: string
  key: string
  apiUrl: string
  note: string
  updatedAt: string
}

/** 收集要写入文件的 Key 行。明文模式必须给主密码（buildKeyBackup 内部解密）。 */
export async function collectApiKeyRows(state: AppState, mode: 'cipher' | 'plain', pwd?: string): Promise<ApiKeyRow[]> {
  const ids = state.accounts.filter(a => !isLocalProvider(a.providerId)).map(a => a.id)
  if (ids.length === 0) return []
  const backup = await buildKeyBackup(state, ids, mode, pwd)
  return backup.accounts.map(item => {
    const a = item.account
    return {
      platform: PROVIDER_MAP[a.providerId]?.name ?? a.providerId,
      label: a.label,
      key: mode === 'plain' ? (item.apiKey ?? '') : (a.encryptedKey ?? ''),
      apiUrl: a.apiUrl ?? '',
      note: a.note ?? '',
      updatedAt: a.updatedAt ?? '',
    }
  })
}

const escMd = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function apiKeyFileName(format: ApiKeyStoreFormat): string {
  return `apikeys.${format}`
}

/** 把 Key 行序列化为 md / json / txt / html 文本（xlsx 走二进制路径） */
export function serializeApiKeyRows(rows: ApiKeyRow[], mode: 'cipher' | 'plain', format: 'md' | 'json' | 'txt' | 'html', now = new Date()): string {
  const stamp = now.toLocaleString('zh-CN', { hour12: false })
  const modeLabel = mode === 'plain' ? '明文' : '密文（保险箱加密，未解锁不可读）'
  if (format === 'json') {
    return JSON.stringify({ app: 'AI 魔方', kind: 'apikey-storage', mode, exportedAt: now.toISOString(), keys: rows }, null, 2)
  }
  if (format === 'md') {
    const lines = [
      '# API Key 清单',
      '',
      `> 由 AI 魔方自动维护 · ${modeLabel} · 更新于 ${stamp}`,
      '',
      '| 平台 | 名称 | API Key | 接口地址 | 备注 |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map(r => `| ${escMd(r.platform)} | ${escMd(r.label)} | ${escMd(r.key)} | ${escMd(r.apiUrl)} | ${escMd(r.note)} |`),
      '',
    ]
    return lines.join('\n')
  }
  if (format === 'txt') {
    const lines = [
      'API Key 清单（AI 魔方自动维护）',
      `形式：${modeLabel}`,
      `更新于：${stamp}`,
      '',
    ]
    rows.forEach((r, i) => {
      lines.push(`[${i + 1}] ${r.platform} · ${r.label}`)
      lines.push(`    API Key：${r.key}`)
      if (r.apiUrl) lines.push(`    接口地址：${r.apiUrl}`)
      if (r.note) lines.push(`    备注：${r.note}`)
      lines.push('')
    })
    return lines.join('\n')
  }
  // html：可直接双击打开的独立页面
  const trs = rows.map(r => `<tr><td>${escHtml(r.platform)}</td><td>${escHtml(r.label)}</td><td class="k">${escHtml(r.key)}</td><td>${escHtml(r.apiUrl)}</td><td>${escHtml(r.note)}</td></tr>`).join('\n')
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8"><title>API Key 清单</title>',
    '<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:32px;color:#1f2023}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #d9dce3;padding:8px 10px;font-size:13px;text-align:left;vertical-align:top}th{background:#f2f3f7}.k{font-family:ui-monospace,Menlo,monospace;word-break:break-all}.meta{color:#667085;font-size:12.5px}</style>',
    '</head><body>',
    '<h1>API Key 清单</h1>',
    `<p class="meta">由 AI 魔方自动维护 · ${escHtml(modeLabel)} · 更新于 ${escHtml(stamp)}</p>`,
    '<table><thead><tr><th>平台</th><th>名称</th><th>API Key</th><th>接口地址</th><th>备注</th></tr></thead>',
    `<tbody>\n${trs}\n</tbody></table>`,
    '</body></html>',
  ].join('\n')
}

export interface WriteApiKeyResult { ok: boolean; path?: string; error?: string }

/** 清单固定形式（v0.1.300）：密文 + JSON，与备份页的密文备份一致；
 * 明文与其它格式走备份页手动备份，不在数据存储里另设选项。 */
export const APIKEY_LIST_MODE = 'cipher' as const
export const APIKEY_LIST_FORMAT = 'json' as const

/** 把 Key 清单文件写进数据存储的 apikey 目录。未启用/未选目录时返回错误说明。 */
export async function writeApiKeyStorageFile(state: AppState, prefs: StoragePrefs): Promise<WriteApiKeyResult> {
  const dir = storageDir('apikey', prefs)
  if (!dir) return { ok: false, error: '数据存储未开启或未选择 API Key 存放文件夹' }
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }
  const invoke = w.__TAURI_INTERNALS__?.invoke
  if (!invoke) return { ok: false, error: '仅桌面端可写入本机文件夹' }
  try {
    const rows = await collectApiKeyRows(state, APIKEY_LIST_MODE)
    const content = serializeApiKeyRows(rows, APIKEY_LIST_MODE, APIKEY_LIST_FORMAT)
    const path = await invoke('write_file_to_dir', { dir, filename: apiKeyFileName(APIKEY_LIST_FORMAT), content }) as string
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) }
  }
}
