// 本机账号/设备登记：云 SDK 一期没有列会话或设备管理接口，这里记录本机可见的登录设备。
// 仅存本地，不进入云同步；不同平台同一账号看到的列表彼此独立。

import { getClientId } from './sync'
import { currentPlatform } from './updater'

export interface DeviceRecord {
  clientId: string
  platform: string
  label: string
  firstSeen: number
  lastSeen: number
}

const KEY = 'acm.account.devices.v1'

const PLATFORM_LABEL: Record<string, string> = {
  desktop: '桌面客户端', android: '安卓客户端', docker: 'Docker Web', web: '网页版', miniapp: '微信小程序',
}

export function loadDevices(): DeviceRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

/** 启动/登录时登记当前设备，返回最新列表 */
export function touchCurrentDevice(): DeviceRecord[] {
  const list = loadDevices()
  const id = getClientId()
  const platform = currentPlatform()
  const now = Date.now()
  const idx = list.findIndex(d => d.clientId === id)
  if (idx >= 0) list[idx] = { ...list[idx], platform, label: PLATFORM_LABEL[platform] ?? platform, lastSeen: now }
  else list.push({ clientId: id, platform, label: PLATFORM_LABEL[platform] ?? platform, firstSeen: now, lastSeen: now })
  const trimmed = list.slice(-30)
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)) } catch { /* 忽略 */ }
  return trimmed
}

export function clearDevices(): void {
  try { localStorage.removeItem(KEY) } catch { /* 忽略 */ }
}
