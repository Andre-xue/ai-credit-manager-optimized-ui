/** 图库横向筛选条折叠状态（v0.1.388）：仅本机记忆，仿照免费游戏 acm.freegames.groups.v1 */
const FILTER_COLLAPSED_KEY = 'acm.gallery.filterCollapsed.v1'

export function loadFilterCollapsed(): boolean {
  try { return localStorage.getItem(FILTER_COLLAPSED_KEY) === '1' } catch { return false }
}

export function saveFilterCollapsed(v: boolean): void {
  try { localStorage.setItem(FILTER_COLLAPSED_KEY, v ? '1' : '0') } catch { /* 忽略 */ }
}
