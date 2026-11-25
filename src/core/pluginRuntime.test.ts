import { describe, it, expect } from 'vitest'
import { pluginFrameUrl } from './pluginRuntime'

// v0.1.284：桌面主窗口 CSP script-src 'self' 会被 srcdoc 子文档继承，插件面板内联脚本全被拦截
//（Ethan 实测：汇率面板按钮点了毫无反应）。桌面帧改走 acmplugin 自定义协议单独成页。
describe('插件面板文档地址（桌面 CSP 绕行）', () => {
  it('桌面 macOS 走 acmplugin:// 协议', () => {
    expect(pluginFrameUrl('n123', true, 'MacIntel')).toBe('acmplugin://localhost/frame/n123')
  })
  it('桌面 Windows 走 http://acmplugin.localhost', () => {
    expect(pluginFrameUrl('n123', true, 'Win32')).toBe('http://acmplugin.localhost/frame/n123')
  })
  it('非桌面端返回空串（沿用 srcdoc）', () => {
    expect(pluginFrameUrl('n123', false, 'MacIntel')).toBe('')
    expect(pluginFrameUrl('n123', false, 'Linux armv8l')).toBe('')
  })
})
