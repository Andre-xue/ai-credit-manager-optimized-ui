// 每日签到页的横向页签组织（v0.1.403，同看剧 394 页签样式）：
// 9 个平台各一个页签 + 国内外 × 功能两维筛选，页签切换状态本机记忆。
// 纯函数，便于单测；组件只负责渲染与状态。
import { CHECKIN_PLATFORMS, type CheckinPlatformId, type CheckinPlatformMeta } from './checkinPlatforms'

export const CHECKIN_TAB_KEY = 'acm.checkin.tab'

/** 页签上显示的平台名（比注册表名更短：Qoder 国内/国际） */
export const CHECKIN_TAB_LABELS: Record<CheckinPlatformId, string> = {
  workbuddy: 'WorkBuddy',
  minimax: 'MiniMax',
  doubao: '豆包',
  lingxi: 'WPS 灵犀',
  dumate: '百度 DuMate',
  xiaohuanxiong: '商汤小浣熊',
  teleagent: '天翼 AI',
  'qoder-cn': 'Qoder 国内',
  'qoder-intl': 'Qoder 国际',
}

export type CheckinRegionFilter = '全部' | '国内' | '国外'

/** 功能分类（注册表里实际出现的，去重后按注册表顺序） */
export function checkinTabCategories(): string[] {
  return [...new Set(CHECKIN_PLATFORMS.map(p => p.category))]
}

/** 两维筛选后可见的平台页签（注册表顺序） */
export function visibleCheckinTabs(region: CheckinRegionFilter, category: string): CheckinPlatformMeta[] {
  return CHECKIN_PLATFORMS.filter(p =>
    (region === '全部' || p.regionLabel === region) &&
    (category === '全部' || p.category === category),
  )
}

/** 读本机记住的页签，无效值回落到 workbuddy */
export function readSavedCheckinTab(): CheckinPlatformId {
  try {
    const v = localStorage.getItem(CHECKIN_TAB_KEY)
    if (v && CHECKIN_PLATFORMS.some(p => p.id === v)) return v as CheckinPlatformId
  } catch { /* 忽略 */ }
  return 'workbuddy'
}

export function saveCheckinTab(id: CheckinPlatformId): void {
  try { localStorage.setItem(CHECKIN_TAB_KEY, id) } catch { /* 忽略 */ }
}

/** 当前选中的页签被筛选筛掉时，落到第一个可见页签；筛后一个不剩时返回 null */
export function resolveCheckinTab(active: CheckinPlatformId, visible: CheckinPlatformMeta[]): CheckinPlatformId | null {
  if (visible.some(p => p.id === active)) return active
  return visible[0]?.id ?? null
}
