import { describe, it, expect } from 'vitest'
import { parseFileInfo, shouldReindex, type FileRecord } from './fileIndex'

const rec = (over: Partial<FileRecord> = {}): FileRecord => ({
  path: '/a/b.txt', name: 'b.txt', ext: 'txt', indexed: true, chunkCount: 2, indexedAt: 1,
  size: 100, mtime: '2026-01-01T00:00:00Z', embedModel: '', ...over,
})

describe('parseFileInfo', () => {
  it('解析 get_file_info 的 JSON', () => {
    expect(parseFileInfo('{"size":42,"modified":"2026-01-02T03:04:05Z","isFile":true}')).toEqual({ size: 42, mtime: '2026-01-02T03:04:05Z' })
  })
  it('坏输入返回 null', () => {
    expect(parseFileInfo('not json')).toBeNull()
    expect(parseFileInfo('{"size":"x"}')).toBeNull()
  })
})

describe('shouldReindex（增量判定）', () => {
  const stat = { size: 100, mtime: '2026-01-01T00:00:00Z' }
  it('没记录/未索引 → 重建', () => {
    expect(shouldReindex(undefined, stat, '', false)).toBe(true)
    expect(shouldReindex(rec({ indexed: false }), stat, '', false)).toBe(true)
  })
  it('大小或修改时间变了 → 重建；没变 → 跳过', () => {
    expect(shouldReindex(rec(), { size: 101, mtime: stat.mtime }, '', false)).toBe(true)
    expect(shouldReindex(rec(), { size: 100, mtime: '2026-02-01T00:00:00Z' }, '', false)).toBe(true)
    expect(shouldReindex(rec(), stat, '', false)).toBe(false)
  })
  it('旧记录没存 stat → 重建一次（迁移）', () => {
    expect(shouldReindex(rec({ size: undefined, mtime: undefined }), stat, '', false)).toBe(true)
  })
  it('嵌入模式变化 → 重建', () => {
    expect(shouldReindex(rec(), stat, 'nomic-embed-text', false)).toBe(true)
    expect(shouldReindex(rec({ embedModel: 'nomic-embed-text' }), stat, '', false)).toBe(true)
  })
  it('无 stat：自动跳过、手动强制重读', () => {
    expect(shouldReindex(rec(), null, '', false)).toBe(false)
    expect(shouldReindex(rec(), null, '', true)).toBe(true)
  })
})
