import { describe, it, expect } from 'vitest'
import { getKeyPageUrl } from './keyUrls'
import { PROVIDERS } from '../data/providers'

describe('官方 Key 页地址', () => {
  it('全部平台都有 https 的 Key 页地址（自定义端点除外：无官方 Key 页，按钮打开账户自己的服务地址）', () => {
    expect(PROVIDERS.length).toBe(57)
    for (const p of PROVIDERS) {
      if (p.id === 'custom-endpoint') continue
      const url = getKeyPageUrl(p)
      expect(url, p.id).toMatch(/^https:\/\//)
    }
  })
  it('不再指向错误平台的地址（历史串值已修正）', () => {
    const byId = Object.fromEntries(PROVIDERS.map(p => [p.id, getKeyPageUrl(p)]))
    expect(byId['workbuddy']).not.toContain('bigmodel')
    expect(byId['leonardo']).not.toContain('openai')
    expect(byId['pika']).not.toContain('elevenlabs')
    expect(byId['kling']).not.toContain('elevenlabs')
    expect(byId['sunno']).not.toContain('perplexity')
    expect(byId['canva']).not.toContain('voyageai')
    expect(byId['replit']).not.toContain('stability')
    expect(byId['midjourney']).not.toContain('stability')
  })
  it('重点平台落在各自官方域名', () => {
    const byId = Object.fromEntries(PROVIDERS.map(p => [p.id, getKeyPageUrl(p)]))
    expect(byId['glm']).toContain('bigmodel.cn')
    expect(byId['kim']).toContain('kimi.com')
    expect(byId['deepseek']).toContain('deepseek.com')
    expect(byId['elevenlabs']).toContain('elevenlabs.io')
    expect(byId['jina']).toContain('jina.ai')
  })
})
