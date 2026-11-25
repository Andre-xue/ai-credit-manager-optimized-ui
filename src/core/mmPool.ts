import { encryptSecret, decryptSecret } from './crypto'
import {
  hasCheckinCred, loadCheckinCred, clearCheckinCred,
  getMinimaxStatus, claimMinimax,
  type CheckinCred, type CheckinStatus, type CredBox,
} from './checkin'

/**
 * MiniMax 签到多账号（v0.1.363）：和 WorkBuddy 账号池同款存储——
 * 每个账号的 token 用保险箱主密码单独加密、只存本机。
 * MiniMax 池只用于签到（不做模型池），管理就在每日签到页里。
 */

const MM_KEY = 'acm.mmpool.v1'

export interface MmAccountMeta { id: string; label: string; uid: string }
interface MmEntry extends MmAccountMeta { cipher: string }
interface MmFile { accounts: MmEntry[] }

function readFile(): MmFile {
  try {
    const v = JSON.parse(localStorage.getItem(MM_KEY) ?? '{}') as MmFile
    return { accounts: Array.isArray(v.accounts) ? v.accounts : [] }
  } catch { return { accounts: [] } }
}

function writeFile(f: MmFile): void {
  try { localStorage.setItem(MM_KEY, JSON.stringify(f)) } catch { /* 忽略 */ }
}

export function listMmMeta(): MmAccountMeta[] {
  return readFile().accounts.map(({ id, label, uid }) => ({ id, label, uid }))
}

export async function addMmAccount(cred: CheckinCred, pwd: string): Promise<MmAccountMeta> {
  const f = readFile()
  const id = cred.uid || `mm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  const meta: MmAccountMeta = { id, label: cred.label || 'MiniMax 账号', uid: cred.uid }
  const cipher = await encryptSecret(JSON.stringify(cred), pwd)
  const existing = f.accounts.findIndex(a => a.id === id)
  if (existing >= 0) f.accounts[existing] = { ...meta, cipher }
  else f.accounts.push({ ...meta, cipher })
  writeFile(f)
  return meta
}

export function removeMmAccount(id: string): void {
  const f = readFile()
  f.accounts = f.accounts.filter(a => a.id !== id)
  writeFile(f)
}

export function mmCredBox(id: string, pwd: string): CredBox {
  return {
    load: async () => {
      const entry = readFile().accounts.find(a => a.id === id)
      if (!entry) return null
      try {
        const cred = JSON.parse(await decryptSecret(entry.cipher, pwd)) as CheckinCred
        return cred && cred.accessToken ? cred : null
      } catch { return null }
    },
    save: async cred => {
      const f = readFile()
      const entry = f.accounts.find(a => a.id === id)
      if (!entry) return
      entry.cipher = await encryptSecret(JSON.stringify(cred), pwd)
      if (cred.label) entry.label = cred.label
      if (cred.uid) entry.uid = cred.uid
      writeFile(f)
    },
  }
}

/** 把签到页时代的单个 MiniMax 凭据迁进多账号存储（只迁一次） */
export async function migrateLegacyMinimaxCred(pwd: string): Promise<boolean> {
  if (listMmMeta().length || !hasCheckinCred('minimax')) return false
  const cred = await loadCheckinCred('minimax', pwd)
  if (!cred) return false
  await addMmAccount(cred, pwd)
  clearCheckinCred('minimax')
  return true
}

export interface MmAccountStatus { meta: MmAccountMeta; status?: CheckinStatus; error?: string }

export async function mmAccountStatuses(pwd: string): Promise<MmAccountStatus[]> {
  const out: MmAccountStatus[] = []
  for (const meta of listMmMeta()) {
    try {
      out.push({ meta, status: await getMinimaxStatus(mmCredBox(meta.id, pwd)) })
    } catch (e) {
      out.push({ meta, error: e instanceof Error ? e.message : '查询失败' })
    }
  }
  return out
}

export async function mmClaimOne(pwd: string, id: string): Promise<{ message: string; points: number }> {
  return claimMinimax(mmCredBox(id, pwd))
}
