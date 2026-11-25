import { describe, it, expect } from 'vitest'
import {
  isZenFreeModel, isKiloFreeModel, parseUpstreamModels, buildUpstreamChatBody, parseUpstreamChatText,
  upstreamRetryDelayMs,
} from './upstreamFree'

describe('清单拉取重试节奏（v0.1.292）', () => {
  it('前三次失败递增等待，之后放弃', () => {
    expect(upstreamRetryDelayMs(0)).toBe(4000)
    expect(upstreamRetryDelayMs(1)).toBe(12000)
    expect(upstreamRetryDelayMs(2)).toBe(30000)
    expect(upstreamRetryDelayMs(3)).toBeNull()
    expect(upstreamRetryDelayMs(9)).toBeNull()
  })
})

describe('免费模型识别', () => {
  it('Zen：-free 结尾才算免费', () => {
    expect(isZenFreeModel('deepseek-v4.1-flash-free')).toBe(true)
    expect(isZenFreeModel('mimo-v2.6-flash-free')).toBe(true)
    expect(isZenFreeModel('claude-opus-4-5')).toBe(false)
    expect(isZenFreeModel('free-model')).toBe(false)
  })

  it('Kilo：:free 后缀或官方免费路由器', () => {
    expect(isKiloFreeModel('nvidia/nemotron-3-nano:free')).toBe(true)
    expect(isKiloFreeModel('kilo-auto/free')).toBe(true)
    expect(isKiloFreeModel('openrouter/free')).toBe(true)
    expect(isKiloFreeModel('openrouter/auto')).toBe(false)
    expect(isKiloFreeModel('anthropic/claude-sonnet-4')).toBe(false)
  })
})

describe('parseUpstreamModels', () => {
  it('Zen 清单只保留免费模型，name 兜底用 id', () => {
    const out = parseUpstreamModels('zen', {
      data: [
        { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash' },
        { id: 'claude-opus-4-5', name: 'Claude Opus' },
        { id: 'hy4-flash-free' },
      ],
    })
    expect(out).toEqual([
      { source: 'zen', id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash' },
      { source: 'zen', id: 'hy4-flash-free', name: 'hy4-flash-free' },
    ])
  })

  it('Kilo 清单过滤付费与路由器，坏数据不崩', () => {
    const out = parseUpstreamModels('kilo', {
      data: [
        { id: 'openrouter/free', name: 'Free Router' },
        { id: 'openai/gpt-5', name: 'GPT-5' },
        { id: 42 }, null, {},
      ],
    })
    expect(out.map(m => m.id)).toEqual(['openrouter/free'])
    expect(parseUpstreamModels('zen', null)).toEqual([])
    expect(parseUpstreamModels('kilo', { data: 'x' })).toEqual([])
  })
})

describe('对话请求/响应', () => {
  it('请求体：minimal 并入 low，其余透传，未指定不带 reasoning_effort', () => {
    const msgs = [{ role: 'user', content: 'hi' }]
    expect(buildUpstreamChatBody('m', msgs, 'minimal')).toMatchObject({ model: 'm', stream: false, reasoning_effort: 'low' })
    expect(buildUpstreamChatBody('m', msgs, 'high')).toMatchObject({ reasoning_effort: 'high' })
    expect(buildUpstreamChatBody('m', msgs)).not.toHaveProperty('reasoning_effort')
  })

  it('JSON 响应取 content；只有 reasoning 时用 reasoning 兜底；error 抛出', () => {
    expect(parseUpstreamChatText('{"choices":[{"message":{"content":"hello"}}]}')).toBe('hello')
    expect(parseUpstreamChatText('{"choices":[{"message":{"content":null,"reasoning":"think..."}}]}')).toBe('think...')
    expect(() => parseUpstreamChatText('{"error":{"message":"limit reached"}}')).toThrow('limit reached')
  })

  it('SSE 响应拼接 delta', () => {
    const sse = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n'
    expect(parseUpstreamChatText(sse)).toBe('你好')
  })
})
