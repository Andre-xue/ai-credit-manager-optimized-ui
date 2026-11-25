// Key 健康检查：错误归类与结果持久化
import { describe, it, expect, beforeEach } from 'vitest'
import { classifyHealthError, loadKeyHealth, saveKeyHealth } from './healthCheck'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

describe('classifyHealthError', () => {
  it('401/403 与密钥类文案归为 auth', () => {
    expect(classifyHealthError(new Error('接口返回 401：Unauthorized')).status).toBe('auth')
    expect(classifyHealthError(new Error('Invalid API key provided')).status).toBe('auth')
    expect(classifyHealthError(new Error('接口返回 403：Forbidden')).status).toBe('auth')
  })
  it('429/额度类文案归为 quota', () => {
    expect(classifyHealthError(new Error('接口返回 429：Too Many Requests')).status).toBe('quota')
    expect(classifyHealthError(new Error('insufficient_quota: 额度不足')).status).toBe('quota')
  })
  it('网络与 CORS 类归为 network', () => {
    expect(classifyHealthError(new TypeError('Failed to fetch')).status).toBe('network')
    expect(classifyHealthError(new Error('桌面代理不可用')).status).toBe('network')
  })
  it('其他错误归为 error 并保留原文', () => {
    const r = classifyHealthError(new Error('接口返回 500：boom'))
    expect(r.status).toBe('error')
    expect(r.message).toContain('500')
  })
})

describe('keyHealth 持久化', () => {
  beforeEach(() => { ;(localStorage as any).clear() })
  it('存取往返一致；无数据时为空对象', () => {
    expect(loadKeyHealth()).toEqual({})
    saveKeyHealth({ a1: { status: 'ok', latencyMs: 123, modelCount: 5, message: '可用', checkedAt: 42 } })
    const back = loadKeyHealth()
    expect(back.a1.status).toBe('ok')
    expect(back.a1.latencyMs).toBe(123)
  })
})
