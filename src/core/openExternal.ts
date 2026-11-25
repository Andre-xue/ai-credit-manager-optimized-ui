// 外部链接打开工具：桌面端走 Rust 命令调用系统默认浏览器，Web 端走 window.open。
// 原因：Tauri WebView 中 <a target="_blank"> 常被拦截，导致"只提示不打开"。

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 是否运行在 Capacitor 原生壳（安卓 App）内 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { Capacitor?: { isNative?: boolean; getPlatform?: () => string } }
  return !!(w.Capacitor?.isNative && ['android', 'ios'].includes(w.Capacitor.getPlatform?.() ?? ''))
}

/** 生物识别可用的平台：桌面（Touch ID）或原生 App（指纹/人脸） */
export async function biometricAvailable(): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<boolean> } }
      if (!w.__TAURI_INTERNALS__?.invoke) return false
      return await w.__TAURI_INTERNALS__.invoke('biometric_available')
    } catch { return false }
  }
  if (isNativeApp()) {
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth')
      const res = await BiometricAuth.checkBiometry()
      return !!res.isAvailable
    } catch { return false }
  }
  return false
}

/** 调用系统生物识别验证（桌面 Touch ID / 手机指纹或人脸），返回是否通过 */
export async function biometricAuth(reason = '验证身份以继续'): Promise<boolean> {
  if (isDesktopApp()) {
    try {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<boolean> } }
      if (!w.__TAURI_INTERNALS__?.invoke) return false
      return await w.__TAURI_INTERNALS__.invoke('biometric_auth')
    } catch { return false }
  }
  if (isNativeApp()) {
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth')
      await BiometricAuth.authenticate({ reason, cancelTitle: '取消' })
      return true
    } catch { return false }
  }
  return false
}

/** 生物识别类型的中文名（用于设置页说明，如「指纹」「Face ID」） */
export async function biometricLabel(): Promise<string> {
  if (isNativeApp()) {
    try {
      const { BiometricAuth, BiometryType } = await import('@aparajita/capacitor-biometric-auth')
      const res = await BiometricAuth.checkBiometry()
      switch (res.biometryType) {
        case BiometryType.faceId:
        case BiometryType.faceAuthentication: return '人脸'
        case BiometryType.touchId:
        case BiometryType.fingerprintAuthentication: return '指纹'
        case BiometryType.irisAuthentication: return '虹膜'
        default: return '生物识别'
      }
    } catch { return '生物识别' }
  }
  return '触控 ID'
}

/** 检测本机是否安装了指定客户端（仅桌面端有效） */
export async function isAppInstalled(bundleIds: string[], exeNames: string[]): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<boolean> } }
    if (!w.__TAURI_INTERNALS__?.invoke) return false
    return await w.__TAURI_INTERNALS__.invoke('is_app_installed', { bundleIds, exeNames })
  } catch { return false }
}

/** 唤醒本机客户端。返回是否成功发起 */
export async function openLocalApp(bundleIds: string[], exeNames: string[]): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<boolean> } }
    if (!w.__TAURI_INTERNALS__?.invoke) return false
    return await w.__TAURI_INTERNALS__.invoke('open_local_app', { bundleIds, exeNames })
  } catch { return false }
}

/**
 * 智能打开官方工具：桌面端优先唤醒本机已安装的客户端，失败或网页端则打开官网。
 * 返回 { opened: 是否已发起跳转, via: 'local' | 'web' }。
 */
export async function openTool(
  localApp: { bundleIds: string[]; exeNames: string[] } | undefined,
  fallbackUrl: string,
): Promise<{ opened: boolean; via: 'local' | 'web' }> {
  if (isDesktopApp() && localApp) {
    const launched = await openLocalApp(localApp.bundleIds, localApp.exeNames)
    if (launched) return { opened: true, via: 'local' }
  }
  const opened = await openExternal(fallbackUrl)
  return { opened, via: 'web' }
}

/** 打开系统「麦克风隐私设置」面板（仅桌面端）。返回是否成功发起 */
export async function openMicSettings(): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<void> } }
    if (!w.__TAURI_INTERNALS__?.invoke) return false
    await w.__TAURI_INTERNALS__.invoke('open_mic_settings')
    return true
  } catch { return false }
}

/** 打开系统「语音识别隐私设置」面板（仅桌面端）。返回是否成功发起 */
export async function openSpeechSettings(): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<void> } }
    if (!w.__TAURI_INTERNALS__?.invoke) return false
    await w.__TAURI_INTERNALS__.invoke('open_speech_settings')
    return true
  } catch { return false }
}

/** 在系统默认浏览器中打开官方页面。返回是否成功发起 */
export async function openExternal(url: string): Promise<boolean> {
  if (!url || !/^https?:\/\//.test(url)) return false
  try {
    if (isDesktopApp()) {
      const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: Record<string, unknown>) => Promise<void> } }
      if (!w.__TAURI_INTERNALS__?.invoke) return false
      await w.__TAURI_INTERNALS__.invoke('open_url', { url })
      return true
    }
    // Web 端：新标签页打开； popup 被拦截时降级为当前页跳转
    const win = window.open(url, '_blank', 'noopener,noreferrer')
    if (win) return true
    window.location.href = url
    return true
  } catch {
    return false
  }
}
