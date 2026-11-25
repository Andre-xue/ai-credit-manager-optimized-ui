import { describe, it, expect } from 'vitest'
import { readFilesFromDataTransfer, type ImportedFile } from './fileImport'

// 构造一个最小 DataTransfer 替身（测试 DOM 文件读取路径）
function fakeDT(files: { name: string; text: string }[]): DataTransfer {
  return {
    files: files.map(f => ({
      name: f.name,
      text: async () => f.text,
    })),
  } as unknown as DataTransfer
}

describe('DOM 文件导入（Web/手机拖放与粘贴）', () => {
  it('读取纯文本文件内容', async () => {
    const r = await readFilesFromDataTransfer(fakeDT([{ name: 'a.txt', text: 'hello' }]))
    expect(r.files).toEqual([{ name: 'a.txt', text: 'hello' }])
    expect(r.skipped).toEqual([])
  })
  it('跳过二进制文档与图片', async () => {
    const r = await readFilesFromDataTransfer(fakeDT([
      { name: 'a.docx', text: 'ignored' },
      { name: 'b.png', text: 'ignored' },
      { name: 'c.md', text: 'kept' },
    ]))
    expect(r.files).toEqual([{ name: 'c.md', text: 'kept' }])
    expect(r.skipped).toEqual(['a.docx', 'b.png'])
  })
  it('空 DataTransfer 返回空', async () => {
    const r = await readFilesFromDataTransfer(null)
    expect(r).toEqual({ files: [], skipped: [] })
  })
})

describe('导入文件类型对象', () => {
  it('ImportedFile 结构正确', () => {
    const f: ImportedFile = { name: 'x.txt', text: '内容' }
    expect(f.name).toBe('x.txt')
    expect(f.text).toBe('内容')
  })
})
