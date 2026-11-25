import { describe, it, expect } from 'vitest'
import { defaultReasoningLevel, globalReasoningEffort, toReasoningEffort } from './engines'

describe('AI 思考模式全局映射', () => {
  it('开启思考模式时默认深度推理 High / medium', () => {
    expect(defaultReasoningLevel(true)).toBe('High')
    expect(globalReasoningEffort(true)).toBe('medium')
  })
  it('关闭思考模式时默认 Off / 无 effort', () => {
    expect(defaultReasoningLevel(false)).toBe('Off')
    expect(globalReasoningEffort(false)).toBeUndefined()
    expect(defaultReasoningLevel(undefined)).toBe('Off')
    expect(globalReasoningEffort(undefined)).toBeUndefined()
  })
  it('推理等级到 effort 映射保持不变', () => {
    expect(toReasoningEffort('Off')).toBeUndefined()
    expect(toReasoningEffort('Low')).toBe('minimal')
    expect(toReasoningEffort('High')).toBe('medium')
    expect(toReasoningEffort('Max')).toBe('high')
  })
})
