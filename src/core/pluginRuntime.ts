// ============================================================
// 插件运行时（v0.1.264）：沙箱 iframe + postMessage RPC 桥。
// 每个插件在 sandbox="allow-scripts"（无 allow-same-origin）的 iframe 里运行，
// 与宿主不同源、碰不到宿主 DOM 与存储；一切能力经带 nonce 的 RPC 回到宿主执行：
// - acm.http：宿主代理发请求，先过清单 hosts 白名单；桌面走 Rust plugin_http（绕 CORS + SSRF 校验），
//   手机走 CapacitorHttp，网页走 fetch（受 CORS 限制）。
// - acm.storage：插件私有 localStorage 命名空间。
// - acm.digest：脱敏数据摘要（与 AI 助手「引用我的数据」同一份，绝不含密钥）。
// - acm.notify / acm.openUrl。
// 余额适配器：宿主在保险箱解锁后把单个账户的明文 Key 作为一次性调用参数传入沙箱，
// 插件代码注册的 fetchBalance(ctx) 用 ctx.http（仍受白名单约束）查官方接口并返回结构化结果。
// ============================================================
import type { AppState, DataSourceAdapter } from './types'
import { PROVIDER_MAP } from '../data/providers'
import { getAdapter } from './adapters'
import {
  loadPlugins, isHostAllowed, pluginStorageGet, pluginStorageSet, pluginHttpDesktop, isDesktopShell,
  pluginSettingsValues, type InstalledPlugin,
} from './plugins'
import { buildDataDigest } from './dataDigest'
import { isNativeApp } from './openExternal'

// ---------------- 宿主回调（App 注入：通知与状态源） ----------------
let notifyHandler: ((msg: string) => void) | null = null
let stateProvider: (() => AppState) | null = null
export function setPluginHostHandlers(h: { notify: (msg: string) => void; getState: () => AppState }): void {
  notifyHandler = h.notify
  stateProvider = h.getState
}

// ---------------- 沙箱内桥脚本（字符串注入 srcdoc） ----------------
// 注意：桥脚本里不能出现字面量 </script（会截断 srcdoc），组装时统一转义。
const BRIDGE_JS = `
;(function () {
  var nonce = window.__ACM_NONCE__
  var seq = 0
  var pending = {}
  var adapters = {}
  var panelFn = null
  function post(msg) { msg.nonce = nonce; parent.postMessage(msg, '*') }
  window.addEventListener('message', function (ev) {
    var d = ev.data || {}
    if (d.nonce !== nonce) return
    if (d.kind === 'acm-rpc-result') {
      var p = pending[d.id]
      if (!p) return
      delete pending[d.id]
      if (d.ok) p.resolve(d.value); else p.reject(new Error(d.error || 'RPC failed'))
    } else if (d.kind === 'acm-call' && d.method === 'fetchBalance') {
      var fn = adapters[d.providerId]
      if (!fn) { post({ kind: 'acm-call-result', id: d.id, ok: false, error: 'plugin did not register an adapter for ' + d.providerId }); return }
      var ctx = {
        apiKey: d.apiKey, providerId: d.providerId, baseUrl: d.baseUrl || '', settings: d.settings || {},
        http: function (url, opts) { return window.acm.http(url, opts) },
      }
      Promise.resolve().then(function () { return fn(ctx) }).then(
        function (v) { post({ kind: 'acm-call-result', id: d.id, ok: true, value: v }) },
        function (e) { post({ kind: 'acm-call-result', id: d.id, ok: false, error: String(e && e.message ? e.message : e) }) }
      )
    } else if (d.kind === 'acm-panel-start') {
      if (panelFn) { try { panelFn(window.acm) } catch (e) { post({ kind: 'acm-error', error: String(e && e.message ? e.message : e) }) } }
    }
  })
  function rpc(method, args) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++seq)
      pending[id] = { resolve: resolve, reject: reject }
      post({ kind: 'acm-rpc', id: id, method: method, args: args || {} })
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('host RPC timeout: ' + method)) } }, 35000)
    })
  }
  window.acm = {
    registerBalanceAdapter: function (providerId, fn) { adapters[providerId] = fn },
    registerPanel: function (fn) { panelFn = fn },
    notify: function (msg) { post({ kind: 'acm-rpc', id: 'n' + (++seq), method: 'notify', args: { msg: String(msg) } }) },
    openUrl: function (url) { return rpc('openUrl', { url: String(url) }) },
    http: function (url, opts) { return rpc('http', { url: String(url), opts: opts || {} }) },
    digest: function () { return rpc('digest', {}) },
    getSettings: function () { return rpc('getSettings', {}) },
    storage: {
      get: function (key) { return rpc('storageGet', { key: String(key) }) },
      set: function (key, value) { return rpc('storageSet', { key: String(key), value: value }) },
    },
  }
})()
`

function escapeScript(s: string): string {
  return s.replace(/<\/script/gi, '<\\/script')
}

function buildSrcdoc(plugin: InstalledPlugin, nonce: string): string {
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>'
    + (plugin.html ?? '')
    + '<script>window.__ACM_NONCE__=' + JSON.stringify(nonce) + '<\/script>'
    + '<script>' + escapeScript(BRIDGE_JS) + '<\/script>'
    + '<script>try{\n' + escapeScript(plugin.code) + '\n}catch(e){parent.postMessage({kind:"acm-init-error",nonce:' + JSON.stringify(nonce) + ',error:String(e&&e.message?e.message:e)},"*")}<\/script>'
    + '<script>parent.postMessage({kind:"acm-ready",nonce:' + JSON.stringify(nonce) + '},"*")<\/script>'
    + '</body></html>'
}

/** 桌面端插件帧的文档地址：自定义协议 acmplugin 单独成页，文档自带 CSP，不继承主窗口的 script-src 'self'
 *  （srcdoc 子文档会继承嵌入方 CSP，桥与插件的内联脚本会被全部拦截、面板点了没反应——v0.1.284 修复）；
 *  Windows 上该协议以 http://<scheme>.localhost 形式提供。非桌面端返回空串，沿用 srcdoc（网页/手机没有这层 CSP）。 */
export function pluginFrameUrl(nonce: string, desktop: boolean, platform: string): string {
  if (!desktop) return ''
  return /win/i.test(platform) ? `http://acmplugin.localhost/frame/${nonce}` : `acmplugin://localhost/frame/${nonce}`
}

function tauriInvokeRaw(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a: Record<string, unknown>) => Promise<unknown> } }
  if (!w.__TAURI_INTERNALS__?.invoke) return Promise.reject(new Error('仅桌面端可用'))
  return w.__TAURI_INTERNALS__.invoke(cmd, args)
}

// ---------------- 宿主侧 RPC 执行 ----------------

interface HttpOpts { method?: string; headers?: Record<string, string>; body?: string }

async function hostHttp(plugin: InstalledPlugin, url: string, opts: HttpOpts): Promise<{ status: number; text: string }> {
  if (!plugin.manifest.permissions.includes('network')) throw new Error('插件未声明 network 权限')
  if (!isHostAllowed(url, plugin.manifest.hosts)) throw new Error(`域名不在插件白名单内：${safeHost(url)}`)
  const method = (opts.method ?? 'GET').toUpperCase()
  const headers = opts.headers ?? {}
  if (isDesktopShell()) return pluginHttpDesktop(url, method, headers, opts.body)
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({ url, method, headers, data: opts.body, responseType: 'text' })
    return { status: res.status, text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '') }
  }
  const res = await fetch(url, { method, headers, body: opts.body })
  return { status: res.status, text: await res.text() }
}

function safeHost(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

async function hostRpc(plugin: InstalledPlugin, method: string, args: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'notify': {
      if (!plugin.manifest.permissions.includes('notify')) throw new Error('插件未声明 notify 权限')
      notifyHandler?.(`${plugin.manifest.name}：${String(args.msg ?? '')}`)
      return null
    }
    case 'storageGet': {
      if (!plugin.manifest.permissions.includes('storage')) throw new Error('插件未声明 storage 权限')
      return pluginStorageGet(plugin.manifest.id, String(args.key ?? ''))
    }
    case 'storageSet': {
      if (!plugin.manifest.permissions.includes('storage')) throw new Error('插件未声明 storage 权限')
      pluginStorageSet(plugin.manifest.id, String(args.key ?? ''), args.value)
      return null
    }
    case 'digest': {
      if (!plugin.manifest.permissions.includes('data')) throw new Error('插件未声明 data 权限')
      if (!stateProvider) throw new Error('宿主未就绪')
      return buildDataDigest(stateProvider())
    }
    case 'getSettings': {
      // 插件读自己的设置（用户在本插件设置页里填的值 + 清单默认值），无需额外权限
      return pluginSettingsValues(plugin)
    }
    case 'http': {
      return hostHttp(plugin, String(args.url ?? ''), (args.opts ?? {}) as HttpOpts)
    }
    case 'openUrl': {
      if (!plugin.manifest.permissions.includes('openUrl')) throw new Error('插件未声明 openUrl 权限')
      const url = String(args.url ?? '')
      if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http(s) 链接')
      if (isDesktopShell()) {
        const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a: Record<string, unknown>) => Promise<unknown> } }
        await w.__TAURI_INTERNALS__?.invoke?.('open_url', { url })
      } else {
        window.open(url, '_blank')
      }
      return null
    }
    default:
      throw new Error(`未知的宿主方法：${method}`)
  }
}

// ---------------- 帧管理 ----------------

interface FrameHandle {
  iframe: HTMLIFrameElement
  nonce: string
  plugin: InstalledPlugin
  ready: Promise<void>
  callSeq: number
  pendingCalls: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  destroy: () => void
}

function createFrame(plugin: InstalledPlugin, visible: boolean): FrameHandle {
  // nonce 用密码学随机（128 位），不用时间戳+Math.random（v0.1.285 加固）
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const nonce = `n${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('title', plugin.manifest.name)
  if (visible) {
    iframe.style.width = '100%'
    iframe.style.height = '340px'
    iframe.style.border = '0'
    iframe.style.borderRadius = '10px'
    iframe.style.background = 'transparent'
  } else {
    iframe.style.display = 'none'
  }
  const pendingCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let readyResolve!: () => void
  const ready = new Promise<void>(r => { readyResolve = r })
  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== iframe.contentWindow) return
    const d = ev.data as Record<string, unknown> | null
    if (!d || d.nonce !== nonce) return
    if (d.kind === 'acm-ready') readyResolve()
    else if (d.kind === 'acm-rpc' && typeof d.id === 'string') {
      void hostRpc(plugin, String(d.method), (d.args ?? {}) as Record<string, unknown>).then(
        v => iframe.contentWindow?.postMessage({ kind: 'acm-rpc-result', nonce, id: d.id, ok: true, value: v }, '*'),
        // Tauri invoke 失败时 reject 的是 Rust 返回的字符串而非 Error 对象，
        // 取 e.message 会得到 undefined、真错误被吞成 'RPC failed'（v0.1.287 修复）
        (e: unknown) => iframe.contentWindow?.postMessage({ kind: 'acm-rpc-result', nonce, id: d.id, ok: false, error: String((e as { message?: unknown })?.message ?? e) }, '*'),
      )
    } else if (d.kind === 'acm-call-result' && typeof d.id === 'string') {
      const p = pendingCalls.get(d.id)
      if (!p) return
      pendingCalls.delete(d.id)
      if (d.ok) p.resolve(d.value)
      else p.reject(new Error(String(d.error ?? '插件调用失败')))
    } else if (d.kind === 'acm-init-error' || d.kind === 'acm-error') {
      notifyHandler?.(`${plugin.manifest.name} 出错：${String(d.error ?? '')}`)
    }
  }
  window.addEventListener('message', onMessage)
  const html = buildSrcdoc(plugin, nonce)
  const frameUrl = pluginFrameUrl(nonce, isDesktopShell(), typeof navigator !== 'undefined' ? navigator.platform : '')
  if (frameUrl) {
    // 桌面端：文档先交给 Rust 暂存，再指向自定义协议地址单独成页；暂存失败（旧壳）时回退 srcdoc
    void tauriInvokeRaw('plugin_frame_put', { id: nonce, html })
      .then(() => { iframe.src = frameUrl })
      .catch(() => { iframe.srcdoc = html })
  } else {
    iframe.srcdoc = html
  }
  const handle: FrameHandle = {
    iframe, nonce, plugin, ready,
    callSeq: 0,
    pendingCalls,
    destroy: () => {
      window.removeEventListener('message', onMessage)
      if (frameUrl) void tauriInvokeRaw('plugin_frame_remove', { id: nonce }).catch(() => undefined)
      pendingCalls.forEach(p => p.reject(new Error('插件帧已关闭')))
      pendingCalls.clear()
      iframe.remove()
    },
  }
  return handle
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms)
    p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e as Error) })
  })
}

// ---------------- 余额适配器 ----------------

/** 找到为该平台声明了余额适配器的已启用插件（第一个） */
export function findPluginAdapter(providerId: string): InstalledPlugin | null {
  return loadPlugins().find(p => p.enabled && p.manifest.provides.includes('adapter') && (p.manifest.providers ?? []).includes(providerId)) ?? null
}

export interface PluginBalanceResult {
  used?: number
  total?: number
  remaining?: number
  symbol?: string
  detail?: string
  label?: string
  unit?: string
}

export async function runPluginBalanceAdapter(plugin: InstalledPlugin, providerId: string, apiKey: string): Promise<PluginBalanceResult> {
  const frame = createFrame(plugin, false)
  document.body.appendChild(frame.iframe)
  try {
    await withTimeout(frame.ready, 6000, '插件加载超时')
    const id = `c${++frame.callSeq}`
    const result = new Promise<unknown>((resolve, reject) => frame.pendingCalls.set(id, { resolve, reject }))
    frame.iframe.contentWindow?.postMessage({
      kind: 'acm-call', nonce: frame.nonce, id, method: 'fetchBalance',
      providerId, apiKey, baseUrl: PROVIDER_MAP[providerId]?.apiBaseUrl ?? '',
      settings: pluginSettingsValues(plugin),
    }, '*')
    const v = await withTimeout(result, 30000, '插件查询超时（30 秒）')
    if (!v || typeof v !== 'object') throw new Error('插件适配器没有返回有效的余额结果')
    return v as PluginBalanceResult
  } finally {
    frame.destroy()
  }
}

/**
 * 在内置适配器之上叠加插件适配器：内置支持的平台行为不变；
 * 内置不支持但有已启用插件适配器的平台，supported 变为 true 且走插件查询。
 * App 里所有查余额入口统一用它替换 getAdapter。
 */
export function getAdapterWithPlugins(providerId: string): DataSourceAdapter {
  const base = getAdapter(providerId)
  if (base.supported) return base
  const plugin = findPluginAdapter(providerId)
  if (!plugin) return base
  return {
    ...base,
    supported: true,
    fetchUsage: async (apiKey: string) => {
      const r = await runPluginBalanceAdapter(plugin, providerId, apiKey)
      const used = typeof r.used === 'number' ? r.used
        : (typeof r.total === 'number' && typeof r.remaining === 'number' ? Math.max(0, r.total - r.remaining) : 0)
      return {
        used,
        total: r.total,
        remaining: r.remaining,
        symbol: r.symbol,
        detail: r.detail ? `${r.detail}（插件：${plugin.manifest.name}）` : `插件：${plugin.manifest.name}`,
        label: r.label,
        unit: (r.unit as never) ?? 'currency',
      }
    },
  }
}

// ---------------- 面板 ----------------

/** 把插件面板挂到容器里；返回卸载函数。插件代码在帧内运行，可直接操作自己的 DOM，并可调 acm.* */
export function mountPanelFrame(container: HTMLElement, plugin: InstalledPlugin): () => void {
  const frame = createFrame(plugin, true)
  container.appendChild(frame.iframe)
  void frame.ready.then(() => {
    frame.iframe.contentWindow?.postMessage({ kind: 'acm-panel-start', nonce: frame.nonce }, '*')
  })
  return () => frame.destroy()
}
