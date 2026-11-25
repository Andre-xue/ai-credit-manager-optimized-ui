import { describe, expect, it } from 'vitest'
import {
  dedupeSameKeyAccounts,
  errorText,
  formatUsageBalance,
  getAdapter,
  parseDeepseekBalance,
  parseMoonshotBalance,
  parseOpenrouterKeyInfo,
  parseSiliconflowUserInfo,
} from './adapters'

describe('余额接口解析', () => {
  it('DeepSeek：取 total_balance 并拆出充值/赠金明细', () => {
    const r = parseDeepseekBalance({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
    })
    expect(r.remaining).toBe(110)
    expect(r.total).toBe(110)
    expect(r.used).toBe(0)
    expect(r.symbol).toBe('¥')
    expect(r.detail).toBe('充值 ¥100 · 赠金 ¥10')
  })

  it('DeepSeek：美元账户用 $ 且无赠金时不带明细', () => {
    const r = parseDeepseekBalance({
      balance_infos: [{ currency: 'USD', total_balance: '5.5', granted_balance: '0.00', topped_up_balance: '5.5' }],
    })
    expect(r.symbol).toBe('$')
    expect(r.detail).toBe('充值 $5.5')
  })

  it('DeepSeek：结构不对时抛可读错误', () => {
    expect(() => parseDeepseekBalance({})).toThrow(/无法识别/)
  })

  it('Kimi：取 available_balance，代金券进明细', () => {
    const r = parseMoonshotBalance({ code: 0, data: { available_balance: 42.5, voucher_balance: 10, cash_balance: 32.5 }, status: true })
    expect(r.remaining).toBe(42.5)
    expect(r.detail).toBe('含代金券 ¥10')
  })

  it('Kimi：无代金券时无明细', () => {
    const r = parseMoonshotBalance({ code: 0, data: { available_balance: 3, voucher_balance: 0, cash_balance: 3 } })
    expect(r.remaining).toBe(3)
    expect(r.detail).toBeUndefined()
  })

  it('硅基流动：取 data.balance 字符串', () => {
    const r = parseSiliconflowUserInfo({ code: 20000, data: { balance: '25.60', chargeBalance: '100', totalBalance: '125.60' } })
    expect(r.remaining).toBeCloseTo(25.6)
    expect(r.symbol).toBe('¥')
  })

  it('OpenRouter：有限额度算剩余', () => {
    const r = parseOpenrouterKeyInfo({ data: { usage: 12.5, limit: 50, limit_remaining: 37.5 } })
    expect(r.remaining).toBe(37.5)
    expect(r.used).toBe(12.5)
    expect(r.total).toBe(50)
    expect(r.detail).toBe('总额度 $50')
  })

  it('OpenRouter：无上限走 label', () => {
    const r = parseOpenrouterKeyInfo({ data: { usage: 3, limit: null } })
    expect(r.label).toContain('无额度上限')
    expect(r.remaining).toBeUndefined()
  })
})

describe('getAdapter.supported（余额可用性只看端点，不看目录 modes）', () => {
  it('已接端点的平台均可用（目录里 modes 为 manual 也不影响）', () => {
    for (const id of ['deepseek', 'kim', 'siliconflow', 'openrouter']) {
      expect(getAdapter(id).supported, id).toBe(true)
    }
  })
  it('无端点的平台不可用', () => {
    expect(getAdapter('doubao').supported).toBe(false)
  })
  it('GLM 不可用：官方 /balance 地址实测 404、未向 API Key 开放余额查询（2026-11-20）', () => {
    expect(getAdapter('glm').supported).toBe(false)
  })
})

describe('dedupeSameKeyAccounts（同平台同指纹只留一条）', () => {
  const acc = (id: string, providerId: string, keyFingerprint?: string) => ({ id, providerId, keyFingerprint })
  it('同平台 + 同指纹去重；不同平台同指纹不误伤；无指纹按 id 保留', () => {
    const list = [acc('1', 'kim', 'fp-a'), acc('2', 'kim', 'fp-a'), acc('3', 'glm', 'fp-a'), acc('4', 'kim'), acc('5', 'kim')]
    expect(dedupeSameKeyAccounts(list).map(a => a.id)).toEqual(['1', '3', '4', '5'])
  })
})

describe('errorText（Tauri 字符串型 reject 不能被吞掉）', () => {
  it('纯字符串原样返回', () => {
    expect(errorText('官方接口返回 401：Token is invalid.', '兜底')).toBe('官方接口返回 401：Token is invalid.')
  })
  it('Error 取 message；未知形状走兜底', () => {
    expect(errorText(new Error('网络失败'), '兜底')).toBe('网络失败')
    expect(errorText(undefined, '兜底')).toBe('兜底')
    expect(errorText('', '兜底')).toBe('兜底')
  })
})

describe('formatUsageBalance', () => {
  it('余额型：符号+金额+明细', () => {
    expect(formatUsageBalance({ used: 0, total: 110, unit: 'currency', remaining: 110, symbol: '¥', detail: '充值 ¥100 · 赠金 ¥10' }))
      .toBe('剩余 ¥110 · 充值 ¥100 · 赠金 ¥10')
  })
  it('label 优先', () => {
    expect(formatUsageBalance({ used: 3, unit: 'currency', label: '已用 $3 · 该 Key 无额度上限' })).toBe('已用 $3 · 该 Key 无额度上限')
  })
  it('用量型：回落到 total-used', () => {
    expect(formatUsageBalance({ used: 40, total: 100, unit: 'token' })).toBe('剩余 60 token')
  })
})
