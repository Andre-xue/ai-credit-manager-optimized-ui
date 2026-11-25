import { describe, it, expect, beforeEach } from 'vitest'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

import {
  getVolcConfig, saveVolcConfig, clearVolcConfig, hasRealtimeConfig, DEFAULT_VOLC_CONFIG,
} from './volcConfig'

describe('火山引擎语音配置', () => {
  beforeEach(() => clearVolcConfig())

  it('无配置时返回默认值', () => {
    expect(getVolcConfig()).toEqual(DEFAULT_VOLC_CONFIG)
    expect(hasRealtimeConfig()).toBe(false)
  })

  it('保存后 Token 不明文存储，读取可还原', () => {
    saveVolcConfig({ ...DEFAULT_VOLC_CONFIG, appId: '123456', accessToken: 'secret-token-abc' })
    const raw = localStorage.getItem('acm.volc.config.v1')!
    expect(raw).not.toContain('secret-token-abc')
    expect(raw).toContain('accessTokenEnc')
    expect(getVolcConfig().accessToken).toBe('secret-token-abc')
  })

  it('中英文混排 Token 往返正确', () => {
    saveVolcConfig({ ...DEFAULT_VOLC_CONFIG, appId: 'a', accessToken: '令牌-ABC-中文-123' })
    expect(getVolcConfig().accessToken).toBe('令牌-ABC-中文-123')
  })

  it('有 APP ID + Token 时 hasRealtimeConfig 为真', () => {
    expect(hasRealtimeConfig()).toBe(false)
    saveVolcConfig({ ...DEFAULT_VOLC_CONFIG, appId: '123' })
    expect(hasRealtimeConfig()).toBe(false)
    saveVolcConfig({ ...DEFAULT_VOLC_CONFIG, appId: '123', accessToken: 'tk' })
    expect(hasRealtimeConfig()).toBe(true)
  })

  it('清空后恢复默认', () => {
    saveVolcConfig({ ...DEFAULT_VOLC_CONFIG, appId: '123', accessToken: 'tk' })
    clearVolcConfig()
    expect(getVolcConfig()).toEqual(DEFAULT_VOLC_CONFIG)
  })
})
