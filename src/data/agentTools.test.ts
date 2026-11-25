import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AGENT_TOOLS, CHECKIN_TOOLS, CATEGORY_TAGS, PLATFORM_TAGS,
} from './agentTools'

describe('AI 工具目录一致性', () => {
  it('id 唯一', () => {
    const ids = AGENT_TOOLS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('国内外均有工具，且均有可签到与无签到分组', () => {
    for (const region of ['cn', 'global'] as const) {
      const list = AGENT_TOOLS.filter(t => t.region === region)
      expect(list.some(t => t.canCheckin), `${region} 应有可签到工具`).toBe(true)
      expect(list.some(t => !t.canCheckin), `${region} 应有无签到工具`).toBe(true)
    }
  })

  it('每个工具有中英文名、定位说明', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.nameEn.length).toBeGreaterThan(0)
      expect(t.desc.length).toBeGreaterThan(4)
    }
  })

  it('所有跳转链接为 https 官方站点', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.downloadUrl).toMatch(/^https:\/\//)
      if (t.checkinUrl) expect(t.checkinUrl).toMatch(/^https:\/\//)
    }
  })

  it('可签到工具有签到规则，无签到工具有福利说明', () => {
    for (const t of AGENT_TOOLS) {
      if (t.canCheckin) expect(t.checkinTip && t.checkinTip.length > 8).toBe(true)
      else expect(t.benefitTip && t.benefitTip.length > 4).toBe(true)
    }
  })

  it('官方图标文件均存在（按 t.icon 路径）', () => {
    for (const t of AGENT_TOOLS) {
      const rel = t.icon.replace(/^\//, '')
      const p = resolve(process.cwd(), 'public', rel)
      expect(existsSync(p), `缺少图标 ${rel}（${t.id}）`).toBe(true)
    }
  })

  it('签到清单为目录子集且全部可签到', () => {
    const ids = new Set(AGENT_TOOLS.map(t => t.id))
    expect(CHECKIN_TOOLS.length).toBeGreaterThanOrEqual(10)
    for (const t of CHECKIN_TOOLS) {
      expect(ids.has(t.id)).toBe(true)
      expect(t.canCheckin).toBe(true)
    }
  })

  it('本地客户端映射结构合法且至少覆盖主流工具', () => {
    const withLocal = AGENT_TOOLS.filter(t => t.localApp)
    expect(withLocal.length).toBeGreaterThanOrEqual(15)
    for (const t of withLocal) {
      expect(t.localApp!.bundleIds.length + t.localApp!.exeNames.length).toBeGreaterThan(0)
      for (const b of t.localApp!.bundleIds) expect(b).toMatch(/^[A-Za-z0-9.\-]+$/)
      for (const e of t.localApp!.exeNames) expect(e.toLowerCase().endsWith('.exe')).toBe(true)
    }
    for (const id of ['workbuddy', 'doubao', 'kimi', 'chatgpt', 'claude', 'gemini']) {
      expect(AGENT_TOOLS.find(t => t.id === id)?.localApp).toBeDefined()
    }
  })

  describe('多级分类与使用量字段', () => {
    it('每个工具有合法功能分类，且属于 CATEGORY_TAGS', () => {
      const cats = new Set<string>(CATEGORY_TAGS)
      for (const t of AGENT_TOOLS) {
        expect(cats.has(t.category), `${t.id} 分类 ${t.category} 不在 CATEGORY_TAGS`).toBe(true)
      }
    })

    it('每个工具有至少一种平台，且都属于 PLATFORM_TAGS', () => {
      const plats = new Set<string>(PLATFORM_TAGS)
      for (const t of AGENT_TOOLS) {
        expect(t.platforms.length, `${t.id} 缺少平台`).toBeGreaterThan(0)
        for (const p of t.platforms) expect(plats.has(p), `${t.id} 平台 ${p} 非法`).toBe(true)
      }
    })

    it('每个工具有使用量数值与展示文案（用于排序）', () => {
      for (const t of AGENT_TOOLS) {
        expect(Number.isFinite(t.usage), `${t.id} usage 非法`).toBe(true)
        expect(t.usage).toBeGreaterThan(0)
        expect(t.usageLabel.length).toBeGreaterThan(0)
      }
    })

    it('按使用量降序排列时头部为全球头部工具', () => {
      const sorted = [...AGENT_TOOLS].sort((a, b) => b.usage - a.usage)
      expect(sorted[0].id).toBe('chatgpt')
      expect(sorted.slice(0, 3).map(t => t.id)).toContain('gemini')
    })

    it('功能与平台覆盖足够多的分类（多级筛选有意义）', () => {
      expect(new Set(AGENT_TOOLS.map(t => t.category)).size).toBeGreaterThanOrEqual(8)
      expect(new Set(AGENT_TOOLS.flatMap(t => t.platforms)).size).toBeGreaterThanOrEqual(6)
    })
  })
})
