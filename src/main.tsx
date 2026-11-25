import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './liquid-glass.css'
import './claude-ui.css'
import './motion-effects.css'
import './redesign.css'
import './liquid-global.css'
import './theme-gallery.css'
import { applyUiTheme, readInitialUiTheme } from './uiThemes'

// 在 React 首屏前恢复外观，避免 Web、桌面与原生 WebView 出现主题闪烁。
applyUiTheme(readInitialUiTheme())

// 预览钩子：URL 带 ?preview=phone 时模拟 Capacitor 原生环境，便于在浏览器里预览手机端液态玻璃界面。
// 仅用于开发/验收，正常用户不会带此参数，对生产无影响。
if (typeof window !== 'undefined' && (new URLSearchParams(location.search).get('preview') === 'phone' || location.hash.includes('preview=phone'))) {
  const w = window as unknown as { Capacitor?: unknown }
  w.Capacitor = { isNative: true, getPlatform: () => 'android' }
}

// 手机端禁用双指/双击缩放，呈现原生 App 体验（viewport meta 之外的兜底）
if (typeof window !== 'undefined') {
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false })
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false })
  // 阻止 iOS 双击缩放
  let lastTouch = 0
  document.addEventListener('touchend', (e) => {
    const now = Date.now()
    if (now - lastTouch < 300) e.preventDefault()
    lastTouch = now
  }, { passive: false })
}

/** 手机端：先从原生存储恢复数据，再渲染 App（确保更新/重装后数据不丢），最后定时镜像备份。 */
async function bootstrap() {
  // 桌面端菜单栏迷你窗是独立窗口（#/mini）：只读本机状态，不走主应用启动流程
  if (typeof window !== 'undefined' && location.hash.includes('/mini')) {
    const { MiniView } = await import('./components/MiniView')
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <MiniView />
      </React.StrictMode>,
    )
    return
  }
  const { restoreFromNative, backupToNative } = await import('./core/persistence')
  await restoreFromNative()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )

  // 启动后做一次备份，之后定期备份（页面隐藏时也备份，覆盖绝大多数更新场景）
  void backupToNative()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void backupToNative()
    })
  }
  window.setInterval(() => void backupToNative(), 30_000)
}

void bootstrap()
