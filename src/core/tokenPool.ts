import { encryptSecret, decryptSecret } from './crypto'
import { TOKEN_PLATFORM_IDS } from './checkinPlatforms'

/**
 * 通用「令牌类」签到平台的多账号存储（v0.1.367）：
 * 豆包 / 灵犀 / DuMate / 小浣熊 / 天翼 AI / Qoder 等平台的凭据都是用户粘贴的
 * Cookie / Token / PAT 字符串，统一按平台分开存：每个账号一条，secret 用保险箱
 * 主密码单独加密，只存本机不云同步（与 WorkBuddy / MiniMax 池同款）。
 */

const KEY = 'acm.tokenpool.v1'

export interface TokenAccountMeta { id: string; label: string }
interface TokenEntry extends TokenAccountMeta { cipher: string }
type TokenFile = Partial<Record<string, TokenEntry[]>>

function readFile(): TokenFile {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as TokenFile
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

function writeFile(f: TokenFile): void {
  try { localStorage.setItem(KEY, JSON.stringify(f)) } catch { /* 忽略 */ }
}

export function listTokenMeta(platform: string): TokenAccountMeta[] {
  return (readFile()[platform] ?? []).map(({ id, label }) => ({ id, label }))
}

export function hasTokenAccounts(platform: string): boolean {
  return (readFile()[platform] ?? []).length > 0
}

export function hasAnyTokenAccounts(): boolean {
  return Object.values(readFile()).some(list => (list ?? []).length > 0)
}

export async function addTokenAccount(platform: string, label: string, secret: string, pwd: string): Promise<TokenAccountMeta> {
  const f = readFile()
  const list = f[platform] ?? []
  const id = `tk-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  const meta: TokenAccountMeta = { id, label: label.trim() || '未命名账号' }
  list.push({ ...meta, cipher: await encryptSecret(secret.trim(), pwd) })
  f[platform] = list
  writeFile(f)
  return meta
}

export function removeTokenAccount(platform: string, id: string): void {
  const f = readFile()
  f[platform] = (f[platform] ?? []).filter(a => a.id !== id)
  writeFile(f)
}

export async function loadTokenSecret(platform: string, id: string, pwd: string): Promise<string | null> {
  const entry = (readFile()[platform] ?? []).find(a => a.id === id)
  if (!entry || !pwd) return null
  try {
    const secret = await decryptSecret(entry.cipher, pwd)
    return secret ? secret : null
  } catch { return null }
}

// ---- 凭据迁移（桌面导出 → 手机导入）：整包用主密码加密，不明文落盘 ----

export async function exportTokenCredentials(pwd: string): Promise<string> {
  const items: { platform: string; label: string; secret: string }[] = []
  for (const pid of TOKEN_PLATFORM_IDS) {
    for (const m of listTokenMeta(pid)) {
      const sec = await loadTokenSecret(pid, m.id, pwd)
      if (sec) items.push({ platform: pid, label: m.label, secret: sec })
    }
  }
  if (!items.length) throw new Error('还没有可导出的凭据（先在任意令牌平台添加账号）')
  const cipher = await encryptSecret(JSON.stringify({ v: 1, items }), pwd)
  return JSON.stringify({ app: 'ai-cube', kind: 'token-credentials', cipher }, null, 2)
}

export async function importTokenCredentials(text: string, pwd: string): Promise<{ added: number; skipped: number }> {
  let outer: { kind?: string; cipher?: string }
  try { outer = JSON.parse(text) as { kind?: string; cipher?: string } } catch { throw new Error('文件格式不对：不是 AI 魔方导出的凭据文件') }
  if (outer.kind !== 'token-credentials' || !outer.cipher) throw new Error('文件格式不对：不是 AI 魔方导出的凭据文件')
  let plain: string
  try { plain = await decryptSecret(outer.cipher, pwd) } catch { throw new Error('解密失败：主密码不对，或手机与电脑不是同一套保险箱（需先同步保险箱）') }
  const payload = JSON.parse(plain) as { items?: { platform: string; label: string; secret: string }[] }
  let added = 0, skipped = 0
  for (const it of payload.items ?? []) {
    if (!(TOKEN_PLATFORM_IDS as string[]).includes(it.platform) || !it.secret) { skipped++; continue }
    const pid = it.platform
    if (listTokenMeta(pid).some(m => m.label === it.label)) { skipped++; continue }
    await addTokenAccount(pid, it.label || '导入的账号', it.secret, pwd)
    added++
  }
  return { added, skipped }
}
