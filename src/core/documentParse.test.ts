import { describe, it, expect } from 'vitest'
import { needsBinaryParse } from './documentParse'

describe('二进制文档识别', () => {
  it('识别 docx / pdf（含大小写）', () => {
    expect(needsBinaryParse('报告.docx')).toBe(true)
    expect(needsBinaryParse('paper.PDF')).toBe(true)
    expect(needsBinaryParse('简历.DOCX')).toBe(true)
  })
  it('纯文本类不需要二进制解析', () => {
    expect(needsBinaryParse('a.txt')).toBe(false)
    expect(needsBinaryParse('b.md')).toBe(false)
    expect(needsBinaryParse('c.csv')).toBe(false)
  })
  it('doc/xls 老格式暂不解析', () => {
    expect(needsBinaryParse('a.doc')).toBe(false)
    expect(needsBinaryParse('b.xls')).toBe(false)
  })
})
