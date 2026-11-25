// ============================================================
// MCP（Model Context Protocol）客户端（v0.1.264）：接入第三方工具/插件生态。
// 服务器配置存本机（不云同步）。两种传输：
// - stdio：本地命令启动的 MCP 服务器，仅桌面端（经 Rust 桥 mcp_* 命令收发 JSON-RPC 行）；
// - http：远程 Streamable HTTP MCP（桌面走 Rust 代理、手机走原生网络层、网页走 fetch）。
// 连接后可 tools/list 列工具、tools/call 直接调用；连接状态经事件广播给插件模块页。
// ============================================================
import { isDesktopShell, pluginHttpDesktop } from './plugins'
import { isNativeApp } from './openExternal'

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
}

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpConnStatus = 'idle' | 'connecting' | 'ready' | 'error'
export interface McpConnection {
  status: McpConnStatus
  tools: McpTool[]
  error?: string
  serverInfo?: string
}

const SERVERS_KEY = 'acm.mcp.servers.v1'
export const MCP_EVENT = 'acm-mcp-changed'

function emitMcpChanged(): void {
  try { window.dispatchEvent(new Event(MCP_EVENT)) } catch { /* 忽略 */ }
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    const arr = JSON.parse(localStorage.getItem(SERVERS_KEY) ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string').map(s => {
      // v0.1.327 一次性迁移：Filesystem 还是出厂默认（目录只有 /tmp）时，换成默认开放名单，
      // 用户手动改过的目录名单不动。@HOME@ 在启动时由桌面端展开为主目录
      const args: string[] = Array.isArray(s.args) ? s.args : []
      const pkgIdx = args.findIndex(a => typeof a === 'string' && a.includes('@modelcontextprotocol/server-filesystem'))
      if (pkgIdx >= 0) {
        const dirs = args.slice(pkgIdx + 1)
        if (dirs.length === 1 && dirs[0] === '/tmp') {
          return { ...s, args: [...args.slice(0, pkgIdx + 1), '@HOME@', '/Applications'] }
        }
      }
      return s
    })
  } catch { return [] }
}

function saveMcpServers(list: McpServerConfig[]): void {
  try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list)) } catch { /* 忽略 */ }
  emitMcpChanged()
}

export function upsertMcpServer(cfg: McpServerConfig): void {
  const list = loadMcpServers()
  saveMcpServers(list.some(s => s.id === cfg.id) ? list.map(s => (s.id === cfg.id ? cfg : s)) : [...list, cfg])
}

export function removeMcpServer(id: string): void {
  void disconnectMcpServer(id)
  saveMcpServers(loadMcpServers().filter(s => s.id !== id))
}

export function newMcpServerId(): string {
  return `mcp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 常用 MCP 服务器预设（一键填入表单，确认后添加；stdio 预设需要本机装有对应运行时） */
export const MCP_PRESETS: Array<McpServerConfig & { note: string }> = [
  {
    id: 'preset-everything', name: 'Everything 示例服务', transport: 'stdio',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'],
    note: '官方示例服务器（含 echo、加法、时间等演示工具），需本机有 Node.js',
  },
  {
    id: 'preset-fetch', name: 'Fetch 网页抓取', transport: 'stdio',
    command: 'uvx', args: ['mcp-server-fetch'],
    note: '官方 fetch 服务器：抓取网页并转 Markdown，需本机有 uv/uvx',
  },
  {
    id: 'preset-filesystem', name: 'Filesystem 文件系统', transport: 'stdio',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '@HOME@', '/Applications'],
    note: '官方文件系统服务器；默认开放你的用户主目录（文稿/下载/桌面都在内）与 /Applications，不存在的目录自动跳过；可在编辑里增减目录',
  },
  {
    id: 'preset-deepwiki', name: 'DeepWiki（远程）', transport: 'http',
    url: 'https://mcp.deepwiki.com/mcp',
    note: '远程 MCP：查询公开 GitHub 仓库的文档与结构，免登录',
  },
]

// ---------------- 连接管理 ----------------

const connections = new Map<string, McpConnection>()
export function getMcpConnection(id: string): McpConnection {
  return connections.get(id) ?? { status: 'idle', tools: [] }
}
function setConn(id: string, c: McpConnection): void {
  connections.set(id, c)
  emitMcpChanged()
}

function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a: Record<string, unknown>) => Promise<T> } }
  if (!w.__TAURI_INTERNALS__?.invoke) return Promise.reject(new Error('仅桌面端可用'))
  return w.__TAURI_INTERNALS__.invoke(cmd, args)
}

interface JsonRpcPending { resolve: (v: unknown) => void; reject: (e: Error) => void }

class McpClient {
  private seq = 0
  private pending = new Map<number, JsonRpcPending>()
  private pollTimer: number | null = null
  private sessionId: string | null = null
  private buffer = ''

  constructor(private cfg: McpServerConfig) {}

  private handleMessage(msg: Record<string, unknown>): void {
    const id = msg.id as number | undefined
    if (id !== undefined && this.pending.has(id)) {
      const p = this.pending.get(id)!
      this.pending.delete(id)
      if (msg.error) {
        const err = msg.error as { message?: string }
        p.reject(new Error(err.message ?? 'MCP 服务器返回错误'))
      } else {
        p.resolve(msg.result)
      }
      return
    }
    // 服务器主动发来的请求：只应答 ping，其余回 -32601
    if (typeof msg.method === 'string' && id !== undefined) {
      const result = msg.method === 'ping' ? {} : undefined
      void this.sendRaw(result !== undefined
        ? { jsonrpc: '2.0', id, result }
        : { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not supported by client' } })
    }
  }

  private handleText(text: string): void {
    // Streamable HTTP 的响应可能是纯 JSON、SSE（data: 行）或 JSON-RPC 批量
    const trimmed = text.trim()
    if (!trimmed) return
    const tryParse = (s: string) => {
      try {
        const v = JSON.parse(s)
        if (Array.isArray(v)) v.forEach(m => this.handleMessage(m as Record<string, unknown>))
        else if (v && typeof v === 'object') this.handleMessage(v as Record<string, unknown>)
      } catch { /* 半行/非 JSON 忽略 */ }
    }
    if (trimmed.includes('data:')) {
      for (const line of trimmed.split('\n')) {
        const l = line.trim()
        if (l.startsWith('data:')) tryParse(l.slice(5).trim())
      }
    } else {
      tryParse(trimmed)
    }
  }

  private async httpPost(payload: unknown): Promise<void> {
    const url = this.cfg.url ?? ''
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    const body = JSON.stringify(payload)
    let status = 0
    let text = ''
    let respHeaders: Record<string, string> = {}
    if (isDesktopShell()) {
      const r = await pluginHttpDesktop(url, 'POST', headers, body)
      status = r.status; text = r.text; respHeaders = r.headers
    } else if (isNativeApp()) {
      const { CapacitorHttp } = await import('@capacitor/core')
      const res = await CapacitorHttp.request({ url, method: 'POST', headers, data: body, responseType: 'text' })
      status = res.status
      text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
      respHeaders = (res.headers ?? {}) as Record<string, string>
    } else {
      const res = await fetch(url, { method: 'POST', headers, body })
      status = res.status
      text = await res.text()
      res.headers.forEach((v, k) => { respHeaders[k] = v })
    }
    const sid = respHeaders['mcp-session-id'] ?? respHeaders['Mcp-Session-Id']
    if (sid) this.sessionId = sid
    if (status >= 400) throw new Error(`MCP 服务器返回 HTTP ${status}${text ? `：${text.slice(0, 160)}` : ''}`)
    this.handleText(text)
  }

  private async sendRaw(payload: unknown): Promise<void> {
    if (this.cfg.transport === 'stdio') {
      await tauriInvoke('mcp_write', { id: this.cfg.id, line: JSON.stringify(payload) })
    } else {
      await this.httpPost(payload)
    }
  }

  request<T>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    const id = ++this.seq
    const p = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`MCP 请求超时：${method}`)) }
      }, timeoutMs)
    })
    return this.sendRaw({ jsonrpc: '2.0', id, method, params }).then(() => p as Promise<T>, (e) => {
      this.pending.delete(id)
      throw e
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.sendRaw({ jsonrpc: '2.0', method, params })
  }

  async connect(): Promise<{ tools: McpTool[]; serverInfo?: string }> {
    if (this.cfg.transport === 'stdio') {
      if (!isDesktopShell()) throw new Error('stdio 类型的 MCP 服务器只能在桌面端运行')
      await tauriInvoke('mcp_start', { id: this.cfg.id, command: this.cfg.command ?? '', args: this.cfg.args ?? [] })
      // 轮询 stdout 行
      this.pollTimer = window.setInterval(() => {
        void tauriInvoke<string[]>('mcp_read', { id: this.cfg.id }).then(lines => {
          for (const line of lines) {
            this.buffer += line + '\n'
            let idx: number
            while ((idx = this.buffer.indexOf('\n')) >= 0) {
              const one = this.buffer.slice(0, idx).trim()
              this.buffer = this.buffer.slice(idx + 1)
              if (one) this.handleText(one)
            }
          }
        }).catch(() => { /* 读取失败静默，等下个周期 */ })
      }, 250)
    }
    // 首次连接 npx/uvx 要现下载服务包，20 秒常不够（Ethan 实测 Everything 初始化超时）——放宽到 90 秒
    const init = await this.request<{ serverInfo?: { name?: string; version?: string } }>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'AI Credit Manager', version: '0.1.264' },
    }, 90000)
    await this.notify('notifications/initialized').catch(() => { /* 部分服务器不接受通知，忽略 */ })
    const listed = await this.request<{ tools?: McpTool[] }>('tools/list', {}, 90000)
    const tools = Array.isArray(listed?.tools) ? listed.tools : []
    const info = init?.serverInfo ? `${init.serverInfo.name ?? ''} ${init.serverInfo.version ?? ''}`.trim() : undefined
    return { tools, serverInfo: info || undefined }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const r = await this.request<{ content?: Array<{ type: string; text?: string }>; isError?: boolean }>(
      'tools/call', { name, arguments: args }, 60000,
    )
    const text = (r?.content ?? []).map(c => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`)).join('\n')
    return { text: text || '(无文本结果)', isError: !!r?.isError }
  }

  /** 原始内容块调用（v0.1.331）：图片等非文本内容不压扁，供文件管家读图片缩略图 */
  async callToolRaw(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError: boolean }> {
    const r = await this.request<{ content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }>(
      'tools/call', { name, arguments: args }, 60000,
    )
    return { content: r?.content ?? [], isError: !!r?.isError }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer !== null) { window.clearInterval(this.pollTimer); this.pollTimer = null }
    this.pending.forEach(p => p.reject(new Error('连接已断开')))
    this.pending.clear()
    if (this.cfg.transport === 'stdio') await tauriInvoke('mcp_stop', { id: this.cfg.id }).catch(() => { /* 忽略 */ })
  }
}

const clients = new Map<string, McpClient>()

export async function connectMcpServer(cfg: McpServerConfig): Promise<void> {
  setConn(cfg.id, { status: 'connecting', tools: [] })
  const client = new McpClient(cfg)
  clients.set(cfg.id, client)
  try {
    const { tools, serverInfo } = await client.connect()
    setConn(cfg.id, { status: 'ready', tools, serverInfo })
  } catch (e) {
    clients.delete(cfg.id)
    await client.disconnect().catch(() => { /* 忽略 */ })
    setConn(cfg.id, { status: 'error', tools: [], error: e instanceof Error ? e.message : String(e) })
  }
}

export async function disconnectMcpServer(id: string): Promise<void> {
  const client = clients.get(id)
  clients.delete(id)
  if (client) await client.disconnect().catch(() => { /* 忽略 */ })
  setConn(id, { status: 'idle', tools: [] })
}

export async function callMcpTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const client = clients.get(serverId)
  if (!client) throw new Error('服务器未连接')
  return client.callTool(toolName, args)
}

export async function callMcpToolRaw(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError: boolean }> {
  const client = clients.get(serverId)
  if (!client) throw new Error('服务器未连接')
  return client.callToolRaw(toolName, args)
}

export async function mcpServerLogs(id: string): Promise<string> {
  try { return await tauriInvoke<string>('mcp_logs', { id }) } catch { return '' }
}
