// 文件管家本地索引：文件名录（localStorage）+ 内容块向量（IndexedDB，独立于文档问答的库）。
// 嵌入与切块复用 docQA 的纯函数（Ollama /api/embed）；Ollama 不可用时向量留空，搜索自动降级为关键词匹配。

import { chunkText, embedText, cosineSimilarity, keywordScore, type DocChunk } from './docQA'

const DB_NAME = 'acm-filemgr-db'
const STORE = 'chunks'
const FILES_KEY = 'acm.filemgr.files.v1'

export interface FileRecord {
  path: string
  name: string
  ext: string
  indexed: boolean      // 是否已建内容索引
  chunkCount: number
  indexedAt: number
  // 增量索引（v0.1.335）：上次索引时的文件大小/修改时间与嵌入模型（'' 表示关键词模式）
  size?: number
  mtime?: string
  embedModel?: string
}

export interface FileStat { size: number; mtime: string }

/** 解析 Filesystem MCP get_file_info 的返回（JSON 文本）；解析不出返回 null */
export function parseFileInfo(text: string): FileStat | null {
  try {
    const o = JSON.parse(text) as { size?: unknown; modified?: unknown }
    if (typeof o.size !== 'number' || typeof o.modified !== 'string') return null
    return { size: o.size, mtime: o.modified }
  } catch { return null }
}

/**
 * 增量判定：这个文件这次要不要重读重索引。
 * - 没索引过 / 嵌入模式变了（关键词↔语义或换模型）→ 要
 * - 有 stat：大小或修改时间与上次不同（含旧记录没存 stat）→ 要；一致 → 跳过
 * - 无 stat（get_file_info 不可用）：自动模式跳过（无法验证变化，避免全量重跑），手动强制模式重读
 */
export function shouldReindex(rec: FileRecord | undefined, stat: FileStat | null, embedModel: string, force: boolean): boolean {
  if (!rec || !rec.indexed) return true
  if ((rec.embedModel ?? '') !== embedModel) return true
  if (stat) return rec.size !== stat.size || rec.mtime !== stat.mtime
  return force
}

export const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'log', 'xml', 'html', 'htm', 'yaml', 'yml', 'toml', 'ini', 'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'sh', 'sql', 'css'])

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function loadFileRecords(): FileRecord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(FILES_KEY) ?? '[]')
    return Array.isArray(arr) ? arr.filter(r => r && typeof r.path === 'string') : []
  } catch { return [] }
}

function saveFileRecords(list: FileRecord[]): void {
  try { localStorage.setItem(FILES_KEY, JSON.stringify(list)) } catch { /* 存不下则忽略 */ }
}

export function upsertFileRecord(rec: FileRecord): void {
  const list = loadFileRecords()
  const i = list.findIndex(r => r.path === rec.path)
  if (i >= 0) list[i] = rec; else list.push(rec)
  saveFileRecords(list)
}

// ---------- IndexedDB（与 docQA 同构，独立库互不干扰） ----------
let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('docId', 'docId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
    req.onblocked = () => { dbPromise = null; reject(new Error('数据库被占用')) }
  })
  return dbPromise
}

async function allChunks(): Promise<DocChunk[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as DocChunk[])
    req.onerror = () => reject(req.error)
  })
}

async function deleteChunksOf(path: string): Promise<void> {
  const db = await openDb()
  const chunks = await allChunks()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const c of chunks) if (c.docId === path) store.delete(c.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 给一个文本文件建索引：切块 → 逐块嵌入（embedBase 为空或失败则向量留空走关键词） */
export async function indexFileText(params: {
  path: string
  text: string
  embedBase?: string
  embedModel?: string
  size?: number
  mtime?: string
}): Promise<number> {
  const chunks = chunkText(params.text)
  if (!chunks.length) throw new Error('文件内容为空')
  await deleteChunksOf(params.path)
  const db = await openDb()
  for (let i = 0; i < chunks.length; i++) {
    let vector: number[] = []
    if (params.embedBase && params.embedModel) {
      try { vector = await embedText(params.embedBase, params.embedModel, chunks[i]) } catch { vector = [] }
    }
    const chunk: DocChunk = { id: `${params.path}#${i}`, docId: params.path, docName: params.path, index: i, text: chunks[i], vector }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(chunk)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
  const name = params.path.split('/').pop() ?? params.path
  upsertFileRecord({
    path: params.path, name, ext: extOf(name), indexed: true, chunkCount: chunks.length, indexedAt: Date.now(),
    size: params.size, mtime: params.mtime, embedModel: params.embedModel ?? '',
  })
  return chunks.length
}

export async function removeFileIndex(path: string): Promise<void> {
  await deleteChunksOf(path)
  saveFileRecords(loadFileRecords().filter(r => r.path !== path))
}

export interface FileSearchHit {
  path: string
  name: string
  score: number
  snippet: string
  via: '文件名' | '语义' | '关键词'
}

/** 混合搜索：文件名子串命中 + 内容（有查询向量走语义，否则/同时关键词），按文件聚合取最高分块 */
export async function searchFileIndex(params: {
  query: string
  queryVector?: number[]
  topK?: number
}): Promise<FileSearchHit[]> {
  const q = params.query.trim()
  if (!q) return []
  const topK = params.topK ?? 8
  const byPath = new Map<string, FileSearchHit>()
  const push = (h: FileSearchHit) => {
    const cur = byPath.get(h.path)
    if (!cur || h.score > cur.score) byPath.set(h.path, h)
  }
  // 文件名命中（对全部已登记文件，含未建内容索引的）
  const ql = q.toLowerCase()
  for (const r of loadFileRecords()) {
    if (r.name.toLowerCase().includes(ql) || r.path.toLowerCase().includes(ql)) {
      push({ path: r.path, name: r.name, score: 0.9, snippet: r.indexed ? '文件名命中' : '文件名命中（未建内容索引）', via: '文件名' })
    }
  }
  // 内容命中
  const chunks = await allChunks().catch(() => [] as DocChunk[])
  for (const c of chunks) {
    const name = c.docId.split('/').pop() ?? c.docId
    if (params.queryVector && c.vector.length === params.queryVector.length && c.vector.length > 0) {
      const s = cosineSimilarity(params.queryVector, c.vector)
      if (s > 0.35) push({ path: c.docId, name, score: s, snippet: c.text.slice(0, 160), via: '语义' })
    }
    const ks = keywordScore(q, c.text)
    if (ks > 0) push({ path: c.docId, name, score: Math.min(0.85, 0.4 + ks / 10), snippet: c.text.slice(0, 160), via: '关键词' })
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score).slice(0, topK)
}

/** 取某文件命中块做问答上下文（按关键词粗排取前几块） */
export async function fileChunksForQa(query: string, limit = 6): Promise<{ path: string; text: string }[]> {
  const chunks = await allChunks().catch(() => [] as DocChunk[])
  return chunks
    .map(c => ({ c, s: keywordScore(query, c.text) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => ({ path: x.c.docId, text: x.c.text }))
}
