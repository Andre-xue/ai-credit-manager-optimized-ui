import { describe, expect, it, vi } from 'vitest'
import { collectMcpTools, runToolChatLoop, type CollectedTools } from './toolChat'
import type { Account } from './types'

vi.mock('./mcp', () => ({
  loadMcpServers: () => [
    { id: 'srv 1', name: 'Fetch 网页抓取', transport: 'http', url: 'https://example.com/mcp' },
    { id: 'srv2', name: '未连接的', transport: 'http', url: 'https://example.org/mcp' },
  ],
  getMcpConnection: (id: string) => (id === 'srv 1'
    ? { status: 'ready', tools: [{ name: 'fetch', description: '抓取网页', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } }] }
    : { status: 'idle', tools: [] }),
  callMcpTool: vi.fn(),
}))

const fakeAccount = { id: 'a1', providerId: 'deepseek', label: 'deepseek-chat' } as unknown as Account

describe('collectMcpTools', () => {
  it('只收已连接服务器的工具，暴露名合法且可路由回真实工具', () => {
    const { defs, routes } = collectMcpTools()
    expect(defs).toHaveLength(1)
    const fn = (defs[0] as { function: { name: string } }).function
    expect(fn.name).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(routes.get(fn.name)).toEqual({ serverId: 'srv 1', serverName: 'Fetch 网页抓取', toolName: 'fetch' })
  })
})

describe('runToolChatLoop', () => {
  const collected: CollectedTools = {
    defs: [{ type: 'function', function: { name: 'mcp_s_fetch', description: '抓取', parameters: { type: 'object' } } }],
    routes: new Map([['mcp_s_fetch', { serverId: 's', serverName: 'Fetch', toolName: 'fetch' }]]),
  }

  it('模型请求工具 → 执行 → 回喂 → 返回最终文本', async () => {
    const callFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: '', toolCalls: [{ id: 'c1', name: 'mcp_s_fetch', arguments: '{"url":"https://a.b"}' }] })
      .mockResolvedValueOnce({ ok: true, text: '这是基于网页内容的回答' })
    const callToolFn = vi.fn().mockResolvedValue({ text: '网页正文', isError: false })
    const out = await runToolChatLoop({
      account: fakeAccount, apiKey: 'k', messages: [{ role: 'user', content: '看看这个网页' }],
      collected, callFn: callFn as never, callToolFn: callToolFn as never,
    })
    expect(out.text).toBe('这是基于网页内容的回答')
    expect(out.events).toEqual([{ serverName: 'Fetch', toolName: 'fetch', ok: true }])
    expect(callToolFn).toHaveBeenCalledWith('s', 'fetch', { url: 'https://a.b' })
    // 第二轮请求里应带上 tool 结果消息
    const secondMsgs = callFn.mock.calls[1][2] as Array<{ role: string; content: string | null }>
    expect(secondMsgs.some(m => m.role === 'tool' && m.content === '网页正文')).toBe(true)
  })

  it('工具执行失败也回喂错误并继续对话', async () => {
    const callFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: '', toolCalls: [{ id: 'c1', name: 'mcp_s_fetch', arguments: '{}' }] })
      .mockResolvedValueOnce({ ok: true, text: '工具坏了，但我先答这些' })
    const callToolFn = vi.fn().mockRejectedValue(new Error('连接断开'))
    const out = await runToolChatLoop({
      account: fakeAccount, apiKey: 'k', messages: [{ role: 'user', content: 'hi' }],
      collected, callFn: callFn as never, callToolFn: callToolFn as never,
    })
    expect(out.text).toContain('工具坏了')
    expect(out.events[0].ok).toBe(false)
  })

  it('平台不支持工具时降级返回普通文本', async () => {
    const callFn = vi.fn().mockResolvedValue({ ok: true, text: '普通回答', toolsUnsupported: true })
    const out = await runToolChatLoop({
      account: fakeAccount, apiKey: 'k', messages: [{ role: 'user', content: 'hi' }],
      collected, callFn: callFn as never, callToolFn: vi.fn() as never,
    })
    expect(out.toolsUnsupported).toBe(true)
    expect(out.text).toBe('普通回答')
  })

  it('没有工具时直接抛错（调用方应先检查）', async () => {
    await expect(runToolChatLoop({
      account: fakeAccount, apiKey: 'k', messages: [], collected: { defs: [], routes: new Map() },
    })).rejects.toThrow('没有可用的 MCP 工具')
  })
})
