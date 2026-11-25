import { describe, it, expect } from 'vitest'
import {
  memoryToTier, maxServicesForTier, isServiceEnabled, isAccountServiceEnabled,
  enabledServiceCount, toggleService, planServiceToggle, providerToService, tierAdvice, shouldShowLocalCategory,
  initServicesForTier,
} from './localServicesSettings'
import type { AppSettings } from './types'

const base = (localServices?: Record<string, boolean>): AppSettings => ({
  vaultInitialized: true, monthlyBudget: 200, checkinReminder: true, checkinProviders: [],
  alertDays: 7, defaultUnit: 'credit', backupReminder: true,
  unlockMethod: 'password', unitPrices: {},
  localServices,
})

describe('memoryToTier', () => {
  it('按物理内存正确分档', () => {
    expect(memoryToTier(4)).toBe(8)
    expect(memoryToTier(8)).toBe(8)
    expect(memoryToTier(9.5)).toBe(8)
    expect(memoryToTier(16)).toBe(16)
    expect(memoryToTier(12)).toBe(16)
    expect(memoryToTier(32)).toBe(32)
    expect(memoryToTier(64)).toBe(32)
  })
  it('异常值按最保守 8G 处理', () => {
    expect(memoryToTier(0)).toBe(8)
    expect(memoryToTier(-1)).toBe(8)
    expect(memoryToTier(NaN)).toBe(8)
  })
})

describe('硬限制与默认值', () => {
  it('8G 档最多 1 个服务，16G/32G 不限', () => {
    expect(maxServicesForTier(8)).toBe(1)
    expect(maxServicesForTier(16)).toBe(4)
    expect(maxServicesForTier(32)).toBe(4)
  })
  it('未配置时默认全部开启（Qwen3-TTS 例外：未配置默认关）', () => {
    expect(isServiceEnabled(base(), 'ollama')).toBe(true)
    expect(isServiceEnabled(base(), 'qwentts')).toBe(false)
    expect(enabledServiceCount(base())).toBe(3)
  })
  it('明确关闭的服务判定为关闭', () => {
    const s = base({ ollama: false, comfyui: true, lmstudio: true })
    expect(isServiceEnabled(s, 'ollama')).toBe(false)
    expect(enabledServiceCount(s)).toBe(2)
  })
})

describe('AI页本地型分类显隐', () => {
  it('全部本地服务关闭时隐藏本地型分类', () => {
    const s = base({ ollama: false, comfyui: false, lmstudio: false })
    expect(shouldShowLocalCategory(s)).toBe(false)
  })
  it('开启任一本地服务时显示本地型分类', () => {
    expect(shouldShowLocalCategory(base({ ollama: true, comfyui: false, lmstudio: false }))).toBe(true)
    expect(shouldShowLocalCategory(base({ ollama: false, comfyui: true, lmstudio: false }))).toBe(true)
    expect(shouldShowLocalCategory(base())).toBe(true)
  })
  it('只开 Qwen3-TTS 不显示本地型分类（它是语音服务，不是模型服务）', () => {
    expect(shouldShowLocalCategory(base({ ollama: false, comfyui: false, lmstudio: false, qwentts: true }))).toBe(false)
  })
})

describe('Qwen3-TTS 服务开关（v0.1.400）', () => {
  it('各档位首次初始化默认都不开 Qwen3-TTS（需用户显式启用）', () => {
    expect(initServicesForTier(8).qwentts).toBe(false)
    expect(initServicesForTier(16).qwentts).toBe(false)
    expect(initServicesForTier(32).qwentts).toBe(false)
    expect(initServicesForTier(8).ollama).toBe(true)
  })
  it('providerId 正确映射到 qwentts', () => {
    expect(providerToService('local-qwentts')).toBe('qwentts')
  })
  it('8G 档：开 Qwen3-TTS 会挤掉已开的 Ollama（内存互斥）', () => {
    const r = planServiceToggle({ localServices: { ollama: true, comfyui: false, lmstudio: false, qwentts: false } } as never, 'qwentts', 8)
    expect(r!.enabled).toBe(true)
    expect(r!.next.qwentts).toBe(true)
    expect(r!.next.ollama).toBe(false)
    expect(r!.stopKeys).toContain('ollama')
  })
  it('8G 档：Ollama 已开时再开 Qwen3-TTS 被 toggleService 拒绝', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false, qwentts: false })
    expect(toggleService(s, 'qwentts', 8)).toBeNull()
  })
  it('16G 档：Qwen3-TTS 与 Ollama 可同时开', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false, qwentts: false })
    expect(toggleService(s, 'qwentts', 16)).toEqual({ ollama: true, comfyui: false, lmstudio: false, qwentts: true })
  })
})

describe('账户服务判定', () => {
  it('本地账户按服务开关判定', () => {
    const s = base({ ollama: false })
    expect(isAccountServiceEnabled(s, 'local-ollama')).toBe(false)
    expect(isAccountServiceEnabled(s, 'local-comfyui')).toBe(true)
  })
  it('非本地账户恒为启用', () => {
    expect(isAccountServiceEnabled(base(), 'openai')).toBe(true)
    expect(providerToService('openai')).toBeNull()
  })
  it('providerId 正确映射到服务 key', () => {
    expect(providerToService('local-ollama')).toBe('ollama')
    expect(providerToService('local-comfyui')).toBe('comfyui')
    expect(providerToService('local-lmstudio')).toBe('lmstudio')
  })
})

describe('toggleService 硬限制', () => {
  it('8G 档：已开 1 个时再开另一个被拒绝', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'comfyui', 8)).toBeNull()
  })
  it('8G 档：关闭后返回新状态', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'ollama', 8)).toEqual({ ollama: false, comfyui: false, lmstudio: false })
  })
  it('8G 档：当前 0 个时允许开一个', () => {
    const s = base({ ollama: false, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'ollama', 8)).toEqual({ ollama: true, comfyui: false, lmstudio: false })
  })
  it('16G 档：允许开多个', () => {
    const s = base({ ollama: true, comfyui: false, lmstudio: false })
    expect(toggleService(s, 'comfyui', 16)).toEqual({ ollama: true, comfyui: true, lmstudio: false })
  })
})

describe('tierAdvice', () => {
  it('各档位给出对应建议文案', () => {
    expect(tierAdvice(8)).toContain('仅允许同时开启 1 个')
    expect(tierAdvice(16)).toContain('建议只开启 1 个')
    expect(tierAdvice(32)).toContain('全部本地服务')
  })
})

describe('服务互斥切换 planServiceToggle', () => {
  const s = (localServices: Record<string, boolean>) => ({ localServices } as never)
  it('8G 档：开启新服务自动关掉当前已开服务并列出待停列表', () => {
    const r = planServiceToggle(s({ ollama: true, comfyui: false }), 'comfyui', 8)
    expect(r).not.toBeNull()
    expect(r!.enabled).toBe(true)
    expect(r!.next.comfyui).toBe(true)
    expect(r!.next.ollama).toBe(false)
    expect(r!.stopKeys).toContain('ollama')
    expect(r!.stopKeys).not.toContain('comfyui')
  })
  it('8G 档：反向切换（关 ComfyUI 开 Ollama）对称', () => {
    const r = planServiceToggle(s({ ollama: false, comfyui: true }), 'ollama', 8)
    expect(r!.stopKeys).toContain('comfyui')
    expect(r!.next.ollama).toBe(true)
    expect(r!.next.comfyui).toBe(false)
  })
  it('关闭服务：stopKeys 含自己，enabled=false', () => {
    const r = planServiceToggle(s({ ollama: true }), 'ollama', 8)
    expect(r!.enabled).toBe(false)
    expect(r!.next.ollama).toBe(false)
    expect(r!.stopKeys).toEqual(['ollama'])
  })
  it('高内存档：未超上限不关任何服务', () => {
    const r = planServiceToggle(s({ ollama: true, comfyui: false, lmstudio: false }), 'comfyui', 32)
    expect(r!.stopKeys).toEqual([])
    expect(r!.next.ollama).toBe(true)
    expect(r!.next.comfyui).toBe(true)
  })
})
