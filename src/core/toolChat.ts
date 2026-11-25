// AI 对话自动调用 MCP 工具（v0.1.317）：开关打开且有已连接的 MCP 服务器时，
// 用自有 API 账户对话会把 MCP 工具清单一并给模型，模型可自主决定调用工具
// （抓网页、读文件、查资料等），结果回喂模型后再产出最终回答，最多 5 轮。
// 开关只存本机（MCP 服务器配置本身也只存本机，跨设备无意义），默认关闭。
import { callChatWithTools, type ToolChatMessage } from './providerCall'
import { callMcpTool, getMcpConnection, loadMcpServers } from './mcp'
import type { Account } from './types'

const PREF_KEY = 'acm.ai.toolCalling'

export function loadToolCallingEnabled(): boolean {
  try { return localStorage.getItem(PREF_KEY) === '1' } catch { return false }
}
export function saveToolCallingEnabled(v: boolean): void {
  try { localStorage.setItem(PREF_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}

export interface McpToolRoute { serverId: string; serverName: string; toolName: string }
export interface CollectedTools { defs: Record<string, unknown>[]; routes: Map<string, McpToolRoute> }

function sanitizeName(s: string): string { return s.replace(/[^a-zA-Z0-9_-]/g, '_') }

/** 收集全部「已连接」MCP 服务器的工具，转成 OpenAI 工具定义 + 暴露名→真实路由映射 */
export function collectMcpTools(): CollectedTools {
  const defs: Record<string, unknown>[] = []
  const routes = new Map<string, McpToolRoute>()
  for (const srv of loadMcpServers()) {
    const conn = getMcpConnection(srv.id)
    if (conn.status !== 'ready') continue
    for (const tool of conn.tools) {
      let exposed = sanitizeName(`mcp_${srv.id}_${tool.name}`).slice(0, 64)
      if (routes.has(exposed)) {
        let n = 2
        while (routes.has(`${exposed.slice(0, 60)}_${n}`)) n++
        exposed = `${exposed.slice(0, 60)}_${n}`
      }
      routes.set(exposed, { serverId: srv.id, serverName: srv.name, toolName: tool.name })
      defs.push({
        type: 'function',
        function: {
          name: exposed,
          description: (tool.description ?? '').slice(0, 300) || tool.name,
          parameters: tool.inputSchema ?? { type: 'object', properties: {} },
        },
      })
    }
  }
  return { defs, routes }
}

export interface ToolEvent { serverName: string; toolName: string; ok: boolean }
export interface ToolChatOutcome { text: string; events: ToolEvent[]; toolsUnsupported: boolean }

type CallFn = typeof callChatWithTools
type CallToolFn = typeof callMcpTool

/**
 * 工具调用循环：调用模型 → 执行其请求的工具 → 结果回喂 → 直到模型给出最终文本。
 * callFn/callToolFn 仅供测试注入，生产走真实实现。
 */
export async function runToolChatLoop(opts: {
  account: Account
  apiKey: string
  engineId?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  messages: { role: string; content: string }[]
  onToolStart?: (info: { serverName: string; toolName: string }) => void
  collected?: CollectedTools
  callFn?: CallFn
  callToolFn?: CallToolFn
}): Promise<ToolChatOutcome> {
  const { defs, routes } = opts.collected ?? collectMcpTools()
  if (!defs.length) throw new Error('没有可用的 MCP 工具')
  const call = opts.callFn ?? callChatWithTools
  const callTool = opts.callToolFn ?? callMcpTool
  const convo: ToolChatMessage[] = opts.messages.map(m => ({ role: m.role, content: m.content }))
  const events: ToolEvent[] = []
  const MAX_ROUNDS = 5
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const r = await call(opts.account, opts.apiKey, convo, defs, opts.engineId, opts.reasoningEffort)
    if (!r.ok) throw new Error(r.error ?? '调用失败')
    if (r.toolsUnsupported) return { text: r.text, events, toolsUnsupported: true }
    if (!r.toolCalls?.length) return { text: r.text, events, toolsUnsupported: false }
    convo.push({
      role: 'assistant',
      content: r.text || null,
      tool_calls: r.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
    })
    for (const tc of r.toolCalls) {
      const route = routes.get(tc.name)
      if (!route) {
        convo.push({ role: 'tool', tool_call_id: tc.id, content: `错误：未知工具 ${tc.name}` })
        continue
      }
      opts.onToolStart?.({ serverName: route.serverName, toolName: route.toolName })
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.arguments || '{}') as Record<string, unknown> } catch { /* 参数非法 JSON 时以空参数执行，让工具自己报错 */ }
      try {
        const res = await callTool(route.serverId, route.toolName, args)
        events.push({ serverName: route.serverName, toolName: route.toolName, ok: !res.isError })
        convo.push({ role: 'tool', tool_call_id: tc.id, content: res.text.slice(0, 6000) || '(无文本结果)' })
      } catch (e) {
        events.push({ serverName: route.serverName, toolName: route.toolName, ok: false })
        convo.push({ role: 'tool', tool_call_id: tc.id, content: `工具调用失败：${(e as Error)?.message ?? String(e)}` })
      }
    }
  }
  // 轮次用尽：不再带工具收尾一次，逼模型基于已有结果作答
  const final = await call(opts.account, opts.apiKey, convo, [], opts.engineId, opts.reasoningEffort)
  if (!final.ok) throw new Error(final.error ?? '调用失败')
  return { text: final.text, events, toolsUnsupported: false }
}
