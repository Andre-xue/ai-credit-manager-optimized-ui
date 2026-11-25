import { describe, it, expect } from 'vitest'
import { ocrToParagraphs } from './imageOcr'

describe('OCR文本分段', () => {
  it('按空行分段', () => {
    expect(ocrToParagraphs('第一段文字\n\n第二段文字')).toEqual(['第一段文字', '第二段文字'])
  })
  it('按单行分段并去空', () => {
    expect(ocrToParagraphs('第一行\n第二行\n\n第三行')).toEqual(['第一行', '第二行', '第三行'])
  })
  it('空输出返回空数组', () => {
    expect(ocrToParagraphs('   \n\n ')).toEqual([])
  })
})
