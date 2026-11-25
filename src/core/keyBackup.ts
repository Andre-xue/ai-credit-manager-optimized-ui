// 删除 API Key 前的强制备份：支持密文云备份、本机文件（明文/密文）、本机备忘录（明文）。
// 备份文件是自包含的：密文备份带保险箱同步材料，明文备份带解密后的 Key。

import type { AppState, Account, CheckinRecord, QuotaSnapshot, UsageEvent } from './types'
import { isLocalProvider } from './types'
import { decryptSecret, encryptSecret, fingerprint, getVaultSyncMaterial, applyVaultSyncMaterial, type VaultSyncMaterial } from './crypto'
import { isNativeApp, isDesktopApp } from './openExternal'
import { pushPayload } from './sync'
import { todayISO, uid, latestQuota } from './store'
import { PROVIDER_MAP } from '../data/providers'

export type KeyBackupMode = 'cloud' | 'local' | 'notes'
export type KeyBackupFormat = 'cipher' | 'plain'
/** 备份文件容器格式（与明文/密文无关）。
 * json/csv/txt 是可恢复导入的机器格式；md/html/xlsx 是只读清单格式（v0.1.301，
 * Ethan 要求）：字段一一对应——名称=平台名+（备注）、余额（未设置为空）、
 * 链接地址（账户地址或平台默认地址）、API Key、分组。 */
export type BackupFileFormat = 'json' | 'csv' | 'txt' | 'md' | 'html' | 'xlsx'
export type ReadableBackupFormat = 'md' | 'html' | 'xlsx'
export const isReadableFormat = (f: BackupFileFormat): f is ReadableBackupFormat =>
  f === 'md' || f === 'html' || f === 'xlsx'

export interface KeyBackupItem {
  account: Account
  encryptedKey?: string
  quotas: QuotaSnapshot[]
  usage: UsageEvent[]
  checkins: CheckinRecord[]
  /** 仅明文备份包含 */
  apiKey?: string
}

export interface KeyBackupFile {
  kind: 'acm-key-backup'
  version: 1
  createdAt: string
  backupId: string
  /** 备忘录等手动保存场景用于确认用户确实保存成功 */
  confirmationCode: string
  format: KeyBackupFormat
  /** 密文备份时的保险箱材料，用于异机恢复解密 */
  vault?: VaultSyncMaterial
  accounts: KeyBackupItem[]
}

export interface BackupResult {
  ok: boolean
  /** 备份落点描述，用于界面提示 */
  location?: string
  /** 是否调起了系统分享（备忘录场景） */
  shared?: boolean
  error?: string
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

/** 构造备份对象。明文备份必须提供已验证的主密码。 */
export async function buildKeyBackup(
  state: AppState,
  accountIds: string[],
  format: KeyBackupFormat,
  pwd?: string,
): Promise<KeyBackupFile> {
  // 本地模型（Ollama/ComfyUI 等）只存本机路径，不进任何备份
  const targets = state.accounts.filter(a => accountIds.includes(a.id) && !isLocalProvider(a.providerId))
  if (targets.length === 0) throw new Error('没有可备份的账户')
  if (format === 'plain' && !pwd) throw new Error('明文备份需要验证主密码')

  const accounts: KeyBackupItem[] = []
  for (const a of targets) {
    let apiKey: string | undefined
    if (format === 'plain' && a.encryptedKey) {
      try { apiKey = await decryptSecret(a.encryptedKey, pwd!) }
      catch { throw new Error(`「${a.label}」解密失败，请确认主密码正确`) }
    }
    accounts.push({
      account: a,
      quotas: state.quotas.filter(q => q.accountId === a.id),
      usage: state.usage.filter(u => u.accountId === a.id),
      checkins: state.checkins.filter(c => c.accountId === a.id),
      apiKey,
    })
  }

  return {
    kind: 'acm-key-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    backupId: uid('bk'),
    confirmationCode: String(Math.floor(100000 + Math.random() * 900000)),
    format,
    vault: format === 'cipher' ? getVaultSyncMaterial() : undefined,
    accounts,
  }
}

/** CSV 单元格：转义双引号，并防公式注入（= + - @ 等开头加单引号） */
const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

// 不再导出 vaultBiometricPwd（可还原的主密码副本）。列顺序保持不变以兼容旧导入，
// 该列留空；导入端也忽略旧值。
const CSV_HEADER = [
  'kind', 'version', 'backupId', 'confirmationCode', 'createdAt', 'format',
  'vaultSalt', 'vaultVerify', 'vaultBiometricPwd',
  'id', 'providerId', 'label', 'mode', 'apiUrl', 'note', 'keyFingerprint', 'key',
  'accCreatedAt', 'accUpdatedAt', 'quotasJson', 'usageJson', 'checkinsJson',
]

export type MachineBackupFormat = 'json' | 'csv' | 'txt'

/** 序列化为 JSON / CSV / TXT。TXT 也是可机器解析的稳定格式，不只是给人看。 */
export function serializeKeyBackup(backup: KeyBackupFile, fileFormat: MachineBackupFormat = 'json'): string {
  if (fileFormat === 'json') return JSON.stringify(backup, null, 2)

  const vault = backup.vault
  const rows = backup.accounts.map(item => {
    const a = item.account
    const key = backup.format === 'plain' ? (item.apiKey ?? '') : (a.encryptedKey ?? '')
    return [
      backup.kind, backup.version, backup.backupId, backup.confirmationCode, backup.createdAt, backup.format,
      vault?.salt ?? '', vault?.verify ?? '', vault?.biometricPwd ?? '',
      a.id, a.providerId, a.label, a.mode, a.apiUrl ?? '', a.note ?? '', a.keyFingerprint ?? '', key,
      a.createdAt, a.updatedAt,
      JSON.stringify(item.quotas), JSON.stringify(item.usage), JSON.stringify(item.checkins),
    ]
  })

  if (fileFormat === 'csv') {
    return [CSV_HEADER, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
  }

  const lines = [
    '# AI 魔方密钥备份（文本格式，可导入）',
    `kind=${JSON.stringify(backup.kind)}`,
    `version=${JSON.stringify(backup.version)}`,
    `backupId=${JSON.stringify(backup.backupId)}`,
    `confirmationCode=${JSON.stringify(backup.confirmationCode)}`,
    `createdAt=${JSON.stringify(backup.createdAt)}`,
    `format=${JSON.stringify(backup.format)}`,
    '[vault]',
    `salt=${JSON.stringify(vault?.salt ?? null)}`,
    `verify=${JSON.stringify(vault?.verify ?? null)}`,
    // 不写入主密码凭据；旧备份里的 biometricPwd 行在导入时也会被忽略
  ]
  rows.forEach(r => {
    lines.push('[account]')
    CSV_HEADER.slice(9).forEach((k, i) => lines.push(`${k}=${JSON.stringify(r[i + 9])}`))
  })
  return lines.join('\n')
}

// ---- 只读清单格式（md / html / xlsx）：字段与账户一一对应（v0.1.301） ----

export interface KeyBackupReadableRow {
  /** 名称：AI 平台名字 +（备注），无备注只显示平台名 */
  name: string
  /** 余额：最新快照剩余（带单位）；没有设置额度/快照时为空 */
  balance: string
  /** 链接地址：账户自填地址，缺省用平台默认 API 地址 */
  apiUrl: string
  /** API Key：明文备份为原文，密文备份为保险箱密文 */
  apiKey: string
  /** 分组：账户所在的分组，未分组为空 */
  group: string
}

const UNIT_TEXT: Record<string, string> = { credit: '积分', token: 'Tokens', request: '次', currency: '元', day: '天' }
const trimNum = (n: number) => String(Math.round(n * 10000) / 10000)

export function buildReadableRows(backup: KeyBackupFile): KeyBackupReadableRow[] {
  return backup.accounts.map(item => {
    const a = item.account
    const provider = PROVIDER_MAP[a.providerId]
    const q = latestQuota(item.quotas, a.id)
    return {
      name: `${provider?.name ?? a.providerId}${a.note ? `（${a.note}）` : ''}`,
      balance: q && Number.isFinite(q.total) ? `${trimNum(q.total - q.used)} ${UNIT_TEXT[q.unit] ?? q.unit}`.trim() : '',
      apiUrl: a.apiUrl || provider?.apiBaseUrl || '',
      apiKey: backup.format === 'plain' ? (item.apiKey ?? '') : (a.encryptedKey ?? ''),
      group: a.group ?? '',
    }
  })
}

const escMdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const escHtmlCell = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 清单格式序列化（md / html）：给人看的表格，不能用于恢复导入 */
export function serializeKeyBackupReadable(backup: KeyBackupFile, format: 'md' | 'html'): string {
  const rows = buildReadableRows(backup)
  const modeLabel = backup.format === 'plain' ? '明文' : '密文（保险箱加密）'
  const stamp = backup.createdAt.replace('T', ' ').slice(0, 19)
  if (format === 'md') {
    return [
      '# AI 魔方密钥备份',
      '',
      `> 形式：${modeLabel} · 生成于 ${stamp} · 共 ${rows.length} 个`,
      '',
      '| 名称 | 余额 | 链接地址 | API Key | 分组 |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map(r => `| ${escMdCell(r.name)} | ${escMdCell(r.balance)} | ${escMdCell(r.apiUrl)} | ${escMdCell(r.apiKey)} | ${escMdCell(r.group)} |`),
      '',
    ].join('\n')
  }
  const trs = rows.map(r =>
    `<tr><td>${escHtmlCell(r.name)}</td><td>${escHtmlCell(r.balance)}</td><td>${escHtmlCell(r.apiUrl)}</td><td class="k">${escHtmlCell(r.apiKey)}</td><td>${escHtmlCell(r.group)}</td></tr>`,
  ).join('\n')
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>AI 魔方密钥备份</title>',
    '<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f2023}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d5dd;padding:8px 10px;font-size:13px;text-align:left;vertical-align:top}th{background:#f4f4f5}.k{word-break:break-all;font-family:ui-monospace,monospace;font-size:12px}.meta{color:#667085;font-size:12.5px}</style>',
    '</head><body>',
    '<h2>AI 魔方密钥备份</h2>',
    `<p class="meta">形式：${escHtmlCell(modeLabel)} · 生成于 ${escHtmlCell(stamp)} · 共 ${rows.length} 个</p>`,
    '<table><thead><tr><th>名称</th><th>余额</th><th>链接地址</th><th>API Key</th><th>分组</th></tr></thead>',
    `<tbody>\n${trs}\n</tbody></table>`,
    '</body></html>',
  ].join('\n')
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

/** Excel 清单（xlsx 二进制 → base64）：列与 md/html 一致 */
export async function buildKeyBackupXlsxBase64(backup: KeyBackupFile): Promise<string> {
  const XLSX = await import('xlsx')
  const rows = buildReadableRows(backup)
  const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
    '名称': r.name, '余额': r.balance, '链接地址': r.apiUrl, 'API Key': r.apiKey, '分组': r.group,
  })))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'API Keys')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return bytesToBase64(new Uint8Array(out))
}

function defaultFileName(backup: KeyBackupFile, fileFormat: BackupFileFormat = 'json'): string {
  return `acm-key-backup-${backup.format}-${todayISO()}-${backup.backupId.slice(-6)}.${fileFormat}`
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const asArray = <T,>(v: unknown): T[] => {
  try { const p = JSON.parse(String(v ?? '[]')); return Array.isArray(p) ? p : [] } catch { return [] }
  return []
}

/** 识别并解析三种格式的备份文件（按内容识别，不依赖扩展名） */
export function parseKeyBackup(text: string): KeyBackupFile | null {
  const raw = text.trim()
  if (!raw) return null
  try {
    const json = JSON.parse(raw)
    if (json?.kind === 'acm-key-backup') return json as KeyBackupFile
  } catch { /* 继续尝试其他格式 */ }

  if (/^"?kind"?,/.test(raw.split(/\r?\n/)[0])) {
    const lines = raw.split(/\r?\n/)
    const header = parseCsvLine(lines[0]).map(h => h.trim())
    if (!header.includes('kind')) return null
    const get = (row: string[], key: string) => row[header.indexOf(key)] ?? ''
    const first = parseCsvLine(lines[1] ?? '')
    const vault: VaultSyncMaterial | undefined = get(first, 'vaultSalt')
      ? { salt: get(first, 'vaultSalt') || null, verify: get(first, 'vaultVerify') || null, biometricPwd: get(first, 'vaultBiometricPwd') || null }
      : undefined
    const accounts: KeyBackupItem[] = lines.slice(1).filter(Boolean).map(line => {
      const r = parseCsvLine(line)
      const account: Account = {
        id: get(r, 'id'), providerId: get(r, 'providerId'), label: get(r, 'label'),
        mode: get(r, 'mode') as Account['mode'], apiUrl: get(r, 'apiUrl') || undefined,
        note: get(r, 'note') || undefined, keyFingerprint: get(r, 'keyFingerprint') || undefined,
        createdAt: get(r, 'accCreatedAt'), updatedAt: get(r, 'accUpdatedAt'),
      }
      const isPlain = get(r, 'format') === 'plain'
      if (!isPlain) account.encryptedKey = get(r, 'key') || undefined
      return {
        account,
        encryptedKey: isPlain ? undefined : get(r, 'key') || undefined,
        apiKey: isPlain ? get(r, 'key') || undefined : undefined,
        quotas: asArray(get(r, 'quotasJson')), usage: asArray(get(r, 'usageJson')), checkins: asArray(get(r, 'checkinsJson')),
      } as KeyBackupItem
    }).filter(i => i.account.id)
    if (!accounts.length) return null
    return {
      kind: 'acm-key-backup', version: 1, createdAt: get(first, 'createdAt'),
      backupId: get(first, 'backupId'), confirmationCode: get(first, 'confirmationCode'),
      format: get(first, 'format') === 'plain' ? 'plain' : 'cipher', vault, accounts,
    }
  }

  if (raw.includes('[account]') || raw.startsWith('# AI 魔方密钥备份') || raw.startsWith('# AI 积分管家密钥备份')) {
    const meta: Record<string, unknown> = {}
    let vault: VaultSyncMaterial | undefined
    const accounts: KeyBackupItem[] = []
    let current: Record<string, unknown> | null = null
    let section: 'meta' | 'vault' | 'account' = 'meta'
    const parseVal = (s: string) => { try { return JSON.parse(s) } catch { return s } }
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      if (line === '[vault]') { section = 'vault'; vault = {} as VaultSyncMaterial; continue }
      if (line === '[account]') {
        if (current) accounts.push(fromTxtAccount(current))
        current = {}; section = 'account'; continue
      }
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim(), val = parseVal(line.slice(eq + 1).trim())
      if (section === 'vault' && vault) (vault as any)[key] = val
      else if (section === 'account' && current) current[key] = val
      else meta[key] = val
    }
    if (current) accounts.push(fromTxtAccount(current))
    if (!accounts.length || meta.kind !== 'acm-key-backup') return null
    return {
      kind: 'acm-key-backup', version: 1 as const,
      createdAt: String(meta.createdAt ?? ''), backupId: String(meta.backupId ?? ''),
      confirmationCode: String(meta.confirmationCode ?? ''),
      format: meta.format === 'plain' ? 'plain' : 'cipher',
      vault, accounts,
    }
  }
  return null
}

function fromTxtAccount(r: Record<string, unknown>): KeyBackupItem {
  const account: Account = {
    id: String(r.id ?? ''), providerId: String(r.providerId ?? ''), label: String(r.label ?? ''),
    mode: String(r.mode ?? 'api') as Account['mode'], apiUrl: String(r.apiUrl ?? '') || undefined,
    note: String(r.note ?? '') || undefined, keyFingerprint: String(r.keyFingerprint ?? '') || undefined,
    createdAt: String(r.accCreatedAt ?? ''), updatedAt: String(r.accUpdatedAt ?? ''),
  }
  const isPlain = r.format === 'plain' || String(r.key ?? '').startsWith('sk-')
  if (!isPlain) account.encryptedKey = String(r.key ?? '') || undefined
  return {
    account,
    encryptedKey: isPlain ? undefined : String(r.key ?? '') || undefined,
    apiKey: isPlain ? String(r.key ?? '') || undefined : undefined,
    quotas: asArray(r.quotasJson), usage: asArray(r.usageJson), checkins: asArray(r.checkinsJson),
  } as KeyBackupItem
}

/** 把备份导入到当前状态：密文原样恢复并应用保险箱材料；明文需当前主密码重新加密。 */
export async function importKeyBackup(text: string, state: AppState, pwd?: string): Promise<AppState> {
  const backup = parseKeyBackup(text)
  if (!backup) throw new Error('不是可识别的密钥备份文件（支持 JSON / CSV / TXT）')
  if (backup.vault?.salt || backup.vault?.verify) applyVaultSyncMaterial(backup.vault)
  const merge = <T extends { id: string }>(base: T[], incoming: T[]) => {
    const map = new Map(base.map(x => [x.id, x]))
    incoming.forEach(x => map.set(x.id, x))
    return Array.from(map.values())
  }
  let accounts = [...state.accounts]
  let quotas = [...state.quotas]
  let usage = [...state.usage]
  let checkins = [...state.checkins]
  for (const item of backup.accounts) {
    const a = { ...item.account }
    if (backup.format === 'plain' && item.apiKey) {
      if (!pwd) throw new Error('明文备份包含密钥，请先解锁保险箱再导入')
      a.encryptedKey = await encryptSecret(item.apiKey, pwd)
      a.keyFingerprint = fingerprint(item.apiKey)
    } else if (item.encryptedKey) {
      a.encryptedKey = item.encryptedKey
    }
    const idx = accounts.findIndex(x => x.id === a.id)
    if (idx >= 0) accounts[idx] = a; else accounts.unshift(a)
    quotas = merge(quotas, item.quotas)
    usage = merge(usage, item.usage)
    checkins = merge(checkins, item.checkins)
  }
  return { ...state, accounts, quotas, usage, checkins }
}

function browserDownload(text: string, filename: string, fileFormat: BackupFileFormat): void {
  const mime = fileFormat === 'json' ? 'application/json'
    : fileFormat === 'csv' ? 'text/csv'
    : fileFormat === 'md' ? 'text/markdown'
    : fileFormat === 'html' ? 'text/html'
    : 'text/plain'
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function browserDownloadBase64(base64: string, filename: string, mime: string): void {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 桌面端弹出系统文件夹选择器，返回用户选定路径（取消返回 null） */
export async function chooseBackupFolder(): Promise<string | null> {
  if (!isDesktopApp()) return null
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }
  try {
    const dir = await w.__TAURI_INTERNALS__?.invoke?.('choose_save_dir', {})
    return typeof dir === 'string' && dir ? dir : null
  } catch { return null }
}

/** 备份到本机文件夹：桌面可指定目录，原生 App 写入 Documents，Web 走浏览器下载。 */
export async function backupToLocalFile(backup: KeyBackupFile, dir?: string | null, fileFormat: BackupFileFormat = 'json'): Promise<BackupResult> {
  const filename = defaultFileName(backup, fileFormat)
  try {
    if (fileFormat === 'xlsx') {
      const base64 = await buildKeyBackupXlsxBase64(backup)
      if (isDesktopApp() && dir) {
        const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> } }
        const invoke = w.__TAURI_INTERNALS__?.invoke
        if (!invoke) throw new Error('桌面接口不可用')
        const path = await invoke('write_binary_to_dir', { dir, filename, contentBase64: base64 })
        return { ok: true, location: path }
      }
      if (isNativeApp()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem')
        await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents, recursive: true })
        return { ok: true, location: `Documents/${filename}` }
      }
      browserDownloadBase64(base64, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      return { ok: true, location: filename }
    }
    const text = isReadableFormat(fileFormat)
      ? serializeKeyBackupReadable(backup, fileFormat)
      : serializeKeyBackup(backup, fileFormat)
    if (isDesktopApp() && dir) {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<string> } }
      const invoke = w.__TAURI_INTERNALS__?.invoke
      if (!invoke) throw new Error('桌面接口不可用')
      const path = await invoke('write_file_to_dir', { dir, filename, content: text })
      return { ok: true, location: path }
    }
    if (isNativeApp()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      await Filesystem.writeFile({
        path: filename,
        data: utf8ToBase64(text),
        directory: Directory.Documents,
        recursive: true,
      })
      return { ok: true, location: `Documents/${filename}` }
    }
    browserDownload(text, filename, fileFormat)
    return { ok: true, location: filename }
  } catch (e) {
    return { ok: false, error: `本机文件备份失败：${(e as Error)?.message ?? String(e)}` }
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* 继续走兜底 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

/** 备份到本机备忘录：优先调起系统分享（手机可直接选择备忘录），失败则复制到剪贴板。 */
export async function backupToNotes(backup: KeyBackupFile, fileFormat: BackupFileFormat = 'txt'): Promise<BackupResult> {
  // 备忘录只能明文：防御性检查，避免调用方传错格式
  if (backup.format !== 'plain') return { ok: false, error: '备忘录备份只能使用明文格式' }
  // 备忘录是文本场景：清单/二进制格式一律落回可恢复的 TXT 机器格式
  const machineFormat: MachineBackupFormat = fileFormat === 'json' || fileFormat === 'csv' ? fileFormat : 'txt'
  const text = serializeKeyBackup(backup, machineFormat)
  const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string }) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'AI 魔方密钥备份', text })
      return { ok: true, shared: true }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return { ok: false, error: '已取消分享，未执行删除' }
      // 分享不可用则降级剪贴板
    }
  }
  const copied = await copyText(text)
  return copied
    ? { ok: true, shared: false, location: '剪贴板' }
    : { ok: false, error: '无法写入剪贴板，请检查浏览器权限' }
}

/** 密文备份到云：把备份追加到云端载荷，保留已有备份（最多 20 份）。 */
export async function backupToCloud(backup: KeyBackupFile, appState: AppState): Promise<BackupResult> {
  if (backup.format !== 'cipher') return { ok: false, error: '云端备份仅支持密文格式' }
  const result = await pushPayload(appState, [backup])
  return result.ok
    ? { ok: true, location: '云端保险箱' }
    : { ok: false, error: `云端备份失败：${result.error ?? '未知错误'}` }
}
