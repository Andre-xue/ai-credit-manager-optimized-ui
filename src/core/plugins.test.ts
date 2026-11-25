import { describe, it, expect, beforeEach } from 'vitest'
import {
  validatePluginPackage, isHostAllowed, loadPlugins, installPlugin, uninstallPlugin,
  setPluginEnabled, pluginStorageGet, pluginStorageSet, pluginSettingsValues, savePluginSettings,
  type PluginPackage, type InstalledPlugin,
} from './plugins'

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

const validPkg: PluginPackage = {
  manifest: {
    id: 'demo-plugin', name: '演示插件', version: '1.0.0',
    provides: ['panel'], permissions: ['notify', 'storage'],
  },
  code: 'acm.notify("hi")',
}

describe('validatePluginPackage', () => {
  it('合法插件包通过', () => {
    expect(validatePluginPackage(validPkg)).toBeNull()
  })

  it('id 含非法字符被拒', () => {
    const bad = { ...validPkg, manifest: { ...validPkg.manifest, id: 'Bad_ID!' } }
    expect(validatePluginPackage(bad)).toContain('id')
  })

  it('声明 network 权限但没写 hosts 被拒', () => {
    const bad = { ...validPkg, manifest: { ...validPkg.manifest, permissions: ['network'] } }
    expect(validatePluginPackage(bad)).toContain('hosts')
    const ok = { ...validPkg, manifest: { ...validPkg.manifest, permissions: ['network'], hosts: ['api.example.com'] } }
    expect(validatePluginPackage(ok)).toBeNull()
  })

  it('进程插件没写 command 被拒', () => {
    const bad = { ...validPkg, manifest: { ...validPkg.manifest, provides: ['process'] } }
    expect(validatePluginPackage(bad)).toContain('command')
  })

  it('未知权限 / 空代码被拒', () => {
    const bad = { ...validPkg, manifest: { ...validPkg.manifest, permissions: ['root'] } }
    expect(validatePluginPackage(bad)).toContain('权限')
    expect(validatePluginPackage({ ...validPkg, code: '  ' })).toContain('代码')
  })
})

describe('插件设置项（独立设置页）', () => {
  const withSettings = (settings: unknown): PluginPackage => ({
    ...validPkg,
    manifest: { ...validPkg.manifest, settings } as PluginPackage['manifest'],
  })

  it('合法设置项声明通过', () => {
    expect(validatePluginPackage(withSettings([
      { key: 'base', label: '基准货币', type: 'select', options: ['USD', 'CNY'], default: 'USD' },
      { key: 'verbose', label: '详细日志', type: 'switch', default: false },
    ]))).toBeNull()
  })

  it('key 重复 / select 无 options / type 非法都被拒', () => {
    expect(validatePluginPackage(withSettings([
      { key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' },
    ]))).toContain('重复')
    expect(validatePluginPackage(withSettings([{ key: 's', label: 'S', type: 'select' }]))).toContain('options')
    expect(validatePluginPackage(withSettings([{ key: 'x', label: 'X', type: 'magic' }]))).toContain('type')
  })

  it('设置值：默认值打底，设置页存的值覆盖', () => {
    const rec: InstalledPlugin = {
      manifest: {
        id: 'set-demo', name: '设置演示', version: '1.0.0', provides: ['panel'], permissions: [],
        settings: [
          { key: 'base', label: '基准', type: 'select', options: ['USD', 'CNY'], default: 'USD' },
          { key: 'n', label: '数量', type: 'number', default: 3 },
        ],
      },
      code: 'x', enabled: true, installedAt: 0, source: 'editor',
    }
    expect(pluginSettingsValues(rec)).toEqual({ base: 'USD', n: 3 })
    savePluginSettings('set-demo', { base: 'CNY' })
    expect(pluginSettingsValues(rec)).toEqual({ base: 'CNY', n: 3 })
  })
})

describe('isHostAllowed', () => {
  it('精确域名与子域名放行', () => {
    expect(isHostAllowed('https://api.example.com/v1', ['example.com'])).toBe(true)
    expect(isHostAllowed('https://example.com/v1', ['example.com'])).toBe(true)
  })
  it('相似域名与未声明域名拒绝', () => {
    expect(isHostAllowed('https://evil-example.com/', ['example.com'])).toBe(false)
    expect(isHostAllowed('https://other.com/', ['example.com'])).toBe(false)
    expect(isHostAllowed('not a url', ['example.com'])).toBe(false)
    expect(isHostAllowed('https://example.com/', [])).toBe(false)
    expect(isHostAllowed('https://example.com/', undefined)).toBe(false)
  })
  it('协议收口（v0.1.285）：公网域名只许 https，本机才许 http', () => {
    expect(isHostAllowed('http://api.example.com/v1', ['example.com'])).toBe(false)
    expect(isHostAllowed('ftp://example.com/', ['example.com'])).toBe(false)
    expect(isHostAllowed('http://127.0.0.1:11434/api/tags', ['127.0.0.1'])).toBe(true)
    expect(isHostAllowed('http://localhost:1234/v1', ['localhost'])).toBe(true)
  })
})

describe('下架示例模板的清理（v0.1.326）', () => {
  it('未改过的余额适配器模板（占位域名）被滤掉，改成真实域名的保留', () => {
    const untouched = { ...validPkg, manifest: { ...validPkg.manifest, id: 'acm-template-adapter', hosts: ['api.example.com'] } }
    const edited = { ...validPkg, manifest: { ...validPkg.manifest, id: 'acm-template-adapter', hosts: ['api.real.com'] } }
    installPlugin(untouched, 'builtin')
    expect(loadPlugins().some(p => p.manifest.id === 'acm-template-adapter')).toBe(false)
    uninstallPlugin('acm-template-adapter')
    installPlugin(edited, 'builtin')
    expect(loadPlugins().some(p => p.manifest.id === 'acm-template-adapter')).toBe(true)
    uninstallPlugin('acm-template-adapter')
  })
})

describe('插件安装与私有存储', () => {
  it('安装 / 启停 / 卸载全流程，卸载清私有存储', () => {
    installPlugin(validPkg, 'editor')
    expect(loadPlugins()).toHaveLength(1)
    expect(loadPlugins()[0].enabled).toBe(true)
    setPluginEnabled('demo-plugin', false)
    expect(loadPlugins()[0].enabled).toBe(false)
    pluginStorageSet('demo-plugin', 'k', { v: 1 })
    expect(pluginStorageGet('demo-plugin', 'k')).toEqual({ v: 1 })
    expect(pluginStorageGet('other-plugin', 'k')).toBeNull()
    uninstallPlugin('demo-plugin')
    expect(loadPlugins()).toHaveLength(0)
    expect(pluginStorageGet('demo-plugin', 'k')).toBeNull()
  })

  it('同 id 重装保留启用状态并更新代码', () => {
    installPlugin(validPkg, 'editor')
    setPluginEnabled('demo-plugin', false)
    installPlugin({ ...validPkg, code: 'v2' }, 'file')
    const p = loadPlugins()[0]
    expect(p.code).toBe('v2')
    expect(p.enabled).toBe(false)
    expect(p.source).toBe('file')
  })

  it('更新时扩大权限/域名会默认停用（v0.1.285），无扩大则保留启用状态', () => {
    installPlugin(validPkg, 'editor')
    expect(loadPlugins()[0].enabled).toBe(true)
    // 仅改代码：保留启用
    installPlugin({ ...validPkg, code: 'v2' }, 'file')
    expect(loadPlugins()[0].enabled).toBe(true)
    // 新增域名：默认停用
    installPlugin({ ...validPkg, manifest: { ...validPkg.manifest, hosts: [...(validPkg.manifest.hosts ?? []), 'evil.example.com'] } }, 'file')
    expect(loadPlugins()[0].enabled).toBe(false)
  })
})
