import type { UiThemeId } from './core/types'

export interface UiThemeDefinition {
  id: UiThemeId
  letter: string
  name: string
  english: string
  description: string
  interaction: string
  dark: boolean
  colors: [string, string, string]
  surface: { bg: string; panel: string; text: string; muted: string; primary: string }
}

/** 全平台共享的外观目录。仅描述显示层，不参与账户、额度或接口逻辑。 */
export const UI_THEMES: readonly UiThemeDefinition[] = [
  {
    id: 'precision', letter: 'A', name: '精准控制台', english: 'Precision Console',
    description: '极简蓝 · 表格优先 · 高效管理', interaction: '克制过渡、快捷操作、清晰状态',
    dark: false, colors: ['#2563eb', '#eff6ff', '#172554'],
    surface: { bg: '#f4f7fb', panel: '#ffffff', text: '#172033', muted: '#64748b', primary: '#2563eb' },
  },
  {
    id: 'studio', letter: 'B', name: '暖白工作室', english: 'Warm Studio',
    description: '暖白陶土 · 大留白 · 专注创作', interaction: '柔和展开、沉静反馈、对话聚焦',
    dark: false, colors: ['#c96f4a', '#f6f1e9', '#3d342d'],
    surface: { bg: '#f5f1ea', panel: '#fffdf9', text: '#352e29', muted: '#84786d', primary: '#b85f3e' },
  },
  {
    id: 'command', letter: 'C', name: '暗夜指挥舱', english: 'Night Command',
    description: '深色高密度 · 数据监控 · 多窗格', interaction: '实时刷新、紧凑反馈、键盘优先',
    dark: true, colors: ['#34d399', '#111827', '#a7f3d0'],
    surface: { bg: '#080d14', panel: '#101823', text: '#e5f2ed', muted: '#8ca39b', primary: '#34d399' },
  },
  {
    id: 'island', letter: 'D', name: '青屿轻卡片', english: 'Calm Island',
    description: '自然青绿 · 圆润卡片 · 移动优先', interaction: '弹性按压、底部导航、触控友好',
    dark: false, colors: ['#0f9f8f', '#eaf8f4', '#153f3a'],
    surface: { bg: '#edf7f4', panel: '#ffffff', text: '#153f3a', muted: '#668781', primary: '#0f8f81' },
  },
  {
    id: 'aurora', letter: 'E', name: '极光琉璃', english: 'Aurora Glass',
    description: '极光渐变 · 分层玻璃 · 空间纵深', interaction: '光影追随、弹性弹层、流动进度',
    dark: true, colors: ['#9d8cff', '#55d6be', '#17152d'],
    surface: { bg: '#0d0c1b', panel: '#1b1932', text: '#f2efff', muted: '#aaa4c7', primary: '#a996ff' },
  },
  {
    id: 'lumin', letter: 'F', name: '极简流光', english: 'Luminous Minimal',
    description: '纯净浅色 · 精细描边 · 丝滑动效', interaction: '共享过渡、悬浮预览、磁性反馈',
    dark: false, colors: ['#0969da', '#7c3aed', '#f6f8fc'],
    surface: { bg: '#f7f9fc', panel: '#ffffff', text: '#152033', muted: '#64748b', primary: '#0969da' },
  },
  {
    id: 'hud', letter: 'G', name: '星舰 HUD', english: 'Starship HUD',
    description: '深空界面 · 精密刻度 · 未来数据', interaction: '扫描光效、实时脉冲、指令面板',
    dark: true, colors: ['#64ffda', '#38bdf8', '#07131c'],
    surface: { bg: '#050d13', panel: '#0b1821', text: '#d8fff7', muted: '#82aaa6', primary: '#64ffda' },
  },
  {
    id: 'editorial', letter: 'H', name: '数字杂志', english: 'Editorial Motion',
    description: '编辑排版 · 纸感层次 · 内容叙事', interaction: '章节转场、阅读进度、细节展开',
    dark: false, colors: ['#d65336', '#ece7dd', '#25221e'],
    surface: { bg: '#eee9df', panel: '#faf7f0', text: '#27231f', muted: '#7f756a', primary: '#c54c31' },
  },
]

export const DEFAULT_UI_THEME: UiThemeId = 'aurora'

export function isUiThemeId(value: unknown): value is UiThemeId {
  return typeof value === 'string' && UI_THEMES.some(theme => theme.id === value)
}

export function getUiTheme(id?: UiThemeId): UiThemeDefinition {
  return UI_THEMES.find(theme => theme.id === id) ?? UI_THEMES.find(theme => theme.id === DEFAULT_UI_THEME)!
}

/** 首屏渲染前恢复外观，避免桌面/WebView 打开时先闪一下旧主题。 */
export function readInitialUiTheme(): UiThemeId {
  if (typeof window === 'undefined') return DEFAULT_UI_THEME
  try {
    const direct = localStorage.getItem('acm.ui.theme')
    if (isUiThemeId(direct)) return direct
    const raw = localStorage.getItem('acm.state.v1')
    const saved = raw ? JSON.parse(raw) as { settings?: { uiTheme?: unknown } } : null
    if (isUiThemeId(saved?.settings?.uiTheme)) return saved.settings.uiTheme
  } catch { /* 存储不可用时使用默认主题 */ }
  return DEFAULT_UI_THEME
}

export function applyUiTheme(id: UiThemeId): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.uiTheme = id
  try { localStorage.setItem('acm.ui.theme', id) } catch { /* 仅内存生效 */ }
}
