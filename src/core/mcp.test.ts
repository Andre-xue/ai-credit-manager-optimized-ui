import { describe, it, expect, beforeEach } from 'vitest'
import { loadMcpServers, upsertMcpServer, removeMcpServer, getMcpConnection, MCP_PRESETS } from './mcp'

class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  clear() { this.m.clear() }
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).localStorage = new MemStorage()
  ;(globalThis as Record<string, unknown>).window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} }
})

describe('Filesystem 默认目录迁移（v0.1.327）', () => {
  it('出厂默认 /tmp 被迁移为 @HOME@ + /Applications，用户改过的名单不动', () => {
    upsertMcpServer({ id: 'fs1', name: 'Filesystem 文件系统', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] })
    expect(loadMcpServers().find(s => s.id === 'fs1')?.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '@HOME@', '/Applications'])
    upsertMcpServer({ id: 'fs2', name: '自定义', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/x/Downloads'] })
    expect(loadMcpServers().find(s => s.id === 'fs2')?.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/Users/x/Downloads'])
  })
})

describe('MCP 服务器配置存储', () => {
  it('增删改查往返一致', () => {
    expect(loadMcpServers()).toHaveLength(0)
    upsertMcpServer({ id: 's1', name: '测试', transport: 'http', url: 'https://example.com/mcp' })
    upsertMcpServer({ id: 's2', name: '本地', transport: 'stdio', command: 'npx', args: ['-y', 'x'] })
    expect(loadMcpServers()).toHaveLength(2)
    upsertMcpServer({ id: 's1', name: '改名', transport: 'http', url: 'https://example.com/mcp' })
    expect(loadMcpServers().find(s => s.id === 's1')?.name).toBe('改名')
    removeMcpServer('s1')
    expect(loadMcpServers().map(s => s.id)).toEqual(['s2'])
  })

  it('未连接的服务器状态为 idle 且无工具', () => {
    const c = getMcpConnection('nope')
    expect(c.status).toBe('idle')
    expect(c.tools).toEqual([])
  })

  it('预设包含 stdio 与 http 两种形态且字段齐全', () => {
    expect(MCP_PRESETS.some(p => p.transport === 'stdio' && !!p.command)).toBe(true)
    expect(MCP_PRESETS.some(p => p.transport === 'http' && !!p.url)).toBe(true)
    for (const p of MCP_PRESETS) expect(p.note.length).toBeGreaterThan(0)
  })
})
