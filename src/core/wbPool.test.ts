import { describe, it, expect } from 'vitest'
import { extractCompletionText, classifyChatError, orderPoolCandidates, type PoolAccountMeta } from './wbPool'

describe('wbPool.extractCompletionText', () => {
  it('解析 SSE 分片并拼接', () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{"content":"，世界"}}]}',
      'data: [DONE]',
    ].join('\n')
    expect(extractCompletionText(sse)).toBe('你好，世界')
  })
  it('解析普通 JSON', () => {
    expect(extractCompletionText('{"choices":[{"message":{"content":"答案"}}]}')).toBe('答案')
  })
  it('空响应返回空串', () => {
    expect(extractCompletionText('')).toBe('')
    expect(extractCompletionText('data: [DONE]')).toBe('')
  })
})

describe('wbPool.classifyChatError', () => {
  it('鉴权/限流/额度分类', () => {
    expect(classifyChatError(401, '')).toBe('auth')
    expect(classifyChatError(429, '')).toBe('rate')
    expect(classifyChatError(400, '积分不足，请充值')).toBe('quota')
    expect(classifyChatError(500, 'boom')).toBe('other')
  })
})

describe('wbPool.orderPoolCandidates', () => {
  const metas: PoolAccountMeta[] = [
    { id: 'a', label: 'A', uid: 'a' },
    { id: 'b', label: 'B', uid: 'b' },
    { id: 'c', label: 'C', uid: 'c' },
  ]
  it('停用剔除、置顶优先、最久未用优先、冷却垫底', () => {
    const now = 1_000_000
    const { ready, cooling } = orderPoolCandidates(metas, {
      a: { lastUsedAt: 500 },
      b: { pinned: true, lastUsedAt: 900 },
      c: { cooldownUntil: now + 60000 },
    }, now)
    expect(ready.map(m => m.id)).toEqual(['b', 'a'])
    expect(cooling.map(m => m.id)).toEqual(['c'])
  })
  it('全部停用时无候选', () => {
    const { ready, cooling } = orderPoolCandidates(metas, { a: { disabled: true }, b: { disabled: true }, c: { disabled: true } }, 0)
    expect(ready).toEqual([])
    expect(cooling).toEqual([])
  })
})
