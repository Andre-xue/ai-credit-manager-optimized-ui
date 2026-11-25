import { describe, it, expect } from 'vitest'
import { isTextAttachment, decodeAttachmentText, formatSize, type PickedAttachment } from './attachments'

// node 环境下 btoa/atob 可用（node 16+），但 TextDecoder 需要确认；这里做兼容
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

const att = (name: string, mime: string, text: string): PickedAttachment => ({
  name, mime, size: text.length, dataUrl: `data:${mime};base64,${utf8ToBase64(text)}`,
  base64: utf8ToBase64(text), kind: 'file',
})

describe('附件文本识别', () => {
  it('识别常见文本类附件', () => {
    expect(isTextAttachment(att('note.md', 'text/markdown', 'x'))).toBe(true)
    expect(isTextAttachment(att('data.csv', 'text/csv', 'x'))).toBe(true)
    expect(isTextAttachment(att('conf.json', 'application/json', 'x'))).toBe(true)
    expect(isTextAttachment(att('code.ts', 'text/plain', 'x'))).toBe(true)
  })
  it('图片/音频/视频不算文本附件', () => {
    expect(isTextAttachment(att('pic.png', 'image/png', 'x'))).toBe(false)
    expect(isTextAttachment(att('song.mp3', 'audio/mpeg', 'x'))).toBe(false)
    expect(isTextAttachment(att('movie.mp4', 'video/mp4', 'x'))).toBe(false)
  })
})

describe('附件文本解码', () => {
  it('正确还原中文内容（不被 latin1 乱码）', () => {
    const original = '请分析这份文件：电影票账单\n第二行：¥128.00'
    expect(decodeAttachmentText(att('a.md', 'text/markdown', original))).toBe(original)
  })
  it('正确还原英文与换行', () => {
    const original = 'line1\nline2\nline3'
    expect(decodeAttachmentText(att('a.txt', 'text/plain', original))).toBe(original)
  })
  it('非法 base64 返回空字符串而不抛错', () => {
    const bad: PickedAttachment = { ...att('a.txt', 'text/plain', 'x'), base64: '!!!not-base64!!!' }
    expect(decodeAttachmentText(bad)).toBe('')
  })
})

describe('文件大小格式化', () => {
  it('小于 1KB 显示 B', () => expect(formatSize(512)).toBe('512 B'))
  it('KB 与 MB 换算', () => {
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(3 * 1048576)).toBe('3.0 MB')
  })
})
