// 系统通知服务：三端统一封装。
// - 安卓（Capacitor）：@capacitor/local-notifications，支持定时通知（App 关闭也能提醒）
// - 桌面（Tauri）：@tauri-apps/plugin-notification
// - Web：标准 Notification API（页面打开时有效）
// 任一端不可用时静默降级，调用方可用 getNotificationPermission 判断状态。

export type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

/** 每日签到定时通知的固定 ID（便于覆盖/取消） */
export const CHECKIN_SCHEDULE_ID = 1001

function isCapacitorNative(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return !!cap?.isNativePlatform?.()
  } catch { return false }
}

function isTauri(): boolean {
  try {
    return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
  } catch { return false }
}

async function capacitorNotifications() {
  const mod = await import('@capacitor/local-notifications')
  return mod.LocalNotifications
}

export async function getNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    if (isCapacitorNative()) {
      const ln = await capacitorNotifications()
      const r = await ln.checkPermissions()
      return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt'
    }
    if (isTauri()) {
      const mod = await import('@tauri-apps/plugin-notification')
      return (await mod.isPermissionGranted()) ? 'granted' : 'prompt'
    }
    if (typeof Notification !== 'undefined') {
      return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'prompt'
    }
  } catch { /* fall through */ }
  return 'unsupported'
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  try {
    if (isCapacitorNative()) {
      const ln = await capacitorNotifications()
      const r = await ln.requestPermissions()
      return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt'
    }
    if (isTauri()) {
      const mod = await import('@tauri-apps/plugin-notification')
      const p = await mod.requestPermission()
      return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt'
    }
    if (typeof Notification !== 'undefined') {
      const p = await Notification.requestPermission()
      return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt'
    }
  } catch { /* fall through */ }
  return 'unsupported'
}

/** 立即发送一条系统通知；成功返回 true */
export async function showNotification(title: string, body: string, tag?: string): Promise<boolean> {
  try {
    if (isCapacitorNative()) {
      const ln = await capacitorNotifications()
      await ln.schedule({
        notifications: [{
          id: Math.floor(Math.random() * 900000) + 100000,
          title, body,
          schedule: { at: new Date(Date.now() + 300) },
        }],
      })
      return true
    }
    if (isTauri()) {
      const mod = await import('@tauri-apps/plugin-notification')
      mod.sendNotification({ title, body })
      return true
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag, icon: './pwa-512.png' })
      return true
    }
  } catch { /* fall through */ }
  return false
}

/** 安卓端：设置每日定时签到提醒（App 关闭也会触发）；其他端为 no-op */
export async function scheduleDailyCheckin(hour: number, minute: number): Promise<void> {
  if (!isCapacitorNative()) return
  try {
    const ln = await capacitorNotifications()
    await ln.cancel({ notifications: [{ id: CHECKIN_SCHEDULE_ID }] }).catch(() => undefined)
    await ln.schedule({
      notifications: [{
        id: CHECKIN_SCHEDULE_ID,
        title: '今日签到提醒',
        body: '打开 AI 魔方看看今天的待签到，领取免费额度，别让它过期。',
        schedule: { on: { hour, minute }, allowWhileIdle: true },
      }],
    })
  } catch { /* 忽略：提醒调度失败不影响主流程 */ }
}

export async function cancelDailyCheckin(): Promise<void> {
  if (!isCapacitorNative()) return
  try {
    const ln = await capacitorNotifications()
    await ln.cancel({ notifications: [{ id: CHECKIN_SCHEDULE_ID }] })
  } catch { /* ignore */ }
}
