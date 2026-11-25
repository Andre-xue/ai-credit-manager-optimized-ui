import { describe, it, expect } from 'vitest'
import { EXAMPLE_PLUGINS } from './plugins'
import { buildDataDigest } from './dataDigest'
import type { AppState } from './types'

// 数据速览示例面板（v0.1.287 改版）：把摘要文本解析成卡片渲染。
// 这里用真实 buildDataDigest 产物喂给真实示例插件代码（假 DOM），
// 摘要格式或解析正则任何一边漂移都会让测试变红，避免面板静默退化回纯文本。

class FakeEl {
  innerHTML = ''
  textContent = ''
  private handlers: Record<string, () => Promise<void>> = {}
  addEventListener(ev: string, fn: () => Promise<void>) { this.handlers[ev] = fn }
  async click() { await this.handlers['click']?.() }
}

function mkState(): AppState {
  return {
    version: 1,
    accounts: [
      { id: 'a1', providerId: 'deepseek', label: 'DeepSeek', encryptedKey: 'x' },
      { id: 'a2', providerId: 'kimi', label: 'Kimi', encryptedKey: 'y' },
    ],
    quotas: [
      { id: 'q1', accountId: 'a1', unit: 'currency', total: 5.22, used: 0, capturedAt: '2026-11-21T08:00:00' },
      { id: 'q2', accountId: 'a2', unit: 'currency', total: 23.46, used: 0, capturedAt: '2026-11-21T08:00:00' },
    ],
    checkins: [],
    benefitMarks: [],
    usage: [],
    settings: { vaultInitialized: true, monthlyBudget: 200, checkinReminder: true, checkinProviders: [], alertDays: 7, defaultUnit: 'credit', backupReminder: true, backupReminderDays: 7, unlockMethod: 'password', uiStyle: 'claude', uiMotion: true, unitPrices: {} },
  } as unknown as AppState
}

describe('数据速览示例面板渲染', () => {
  it('摘要被解析成卡片：合计、账户行、低余额、预算、签到', async () => {
    const pkg = EXAMPLE_PLUGINS.find(p => p.manifest.id === 'acm-example-digest')
    expect(pkg).toBeTruthy()
    const digest = buildDataDigest(mkState(), '2026-11-21')
    expect(digest).toContain('货币额度剩余合计 ¥28.68')

    const els: Record<string, FakeEl> = { 'dg-go': new FakeEl(), 'dg-out': new FakeEl(), 'dg-at': new FakeEl() }
    const fakeDocument = { getElementById: (id: string) => els[id] }
    const acm = { digest: async () => digest }
    new Function('document', 'acm', pkg!.code)(fakeDocument, acm)
    await els['dg-go'].click()

    const html = els['dg-out'].innerHTML
    expect(html).toContain('货币额度剩余合计')
    expect(html).toContain('¥28.68')
    expect(html).toContain('DeepSeek')
    expect(html).toContain('Kimi')
    expect(html).toContain('低余额账户')
    expect(html).toContain('本月预算 ¥200')
    expect(html).toContain('已用 0%')
    expect(html).toContain('签到')
    expect(html).not.toContain('<pre')
    expect(els['dg-at'].textContent).toContain('更新于')
  })

  it('摘要格式无法解析时回退为原文展示而非空白', async () => {
    const pkg = EXAMPLE_PLUGINS.find(p => p.manifest.id === 'acm-example-digest')
    const els: Record<string, FakeEl> = { 'dg-go': new FakeEl(), 'dg-out': new FakeEl(), 'dg-at': new FakeEl() }
    const fakeDocument = { getElementById: (id: string) => els[id] }
    const acm = { digest: async () => '某种未知格式的摘要' }
    new Function('document', 'acm', pkg!.code)(fakeDocument, acm)
    await els['dg-go'].click()
    expect(els['dg-out'].innerHTML).toContain('某种未知格式的摘要')
  })
})
