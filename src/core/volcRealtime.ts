// 火山引擎端到端实时语音客户端（桌面端走 Rust 桥接）。
//
// 背景：浏览器/Tauri WebView 的 WebSocket 不能自定义鉴权 header，WKWebView 也没有
// getUserMedia，所以纯前端无法直连火山端到端语音。桌面端改由 Rust 侧建连 + 采集麦克风，
// 前端通过 Tauri 命令 start/send/stop 控制，通过 `volc://event` 事件接收识别文本与音频。
//
// Web/手机端暂不支持（需另部署支持自定义 header 的 WS 中继），调用会给出明确提示。

import { isDesktopApp } from './openExternal'
import { getVolcConfig } from './volcConfig'

export type VolcRealtimeEvent =
  | { type: 'connected' | 'session_ready' | 'aiAudioEnd'; data?: string }
  | { type: 'asr' | 'ai_text' | 'error' | 'status'; data: string }
  | { type: 'aiAudio'; audio: string; sampleRate: number }

export interface VolcRealtimeHandlers {
  onEvent: (e: VolcRealtimeEvent) => void
}

interface InvokeWindow extends Window {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
}

function invoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
  if (!isDesktopApp()) return null
  const w = window as unknown as InvokeWindow
  return w.__TAURI_INTERNALS__?.invoke ?? null
}

/** 当前环境是否支持火山端到端实时语音（仅桌面端；且需 Rust 桥接已接入编译） */
export function isVolcRealtimeSupported(): boolean {
  // 骨架阶段：Rust 侧 volc_realtime 命令尚未接入编译（依赖下载受限），故统一返回 false，
  // 避免 UI 暴露一个点了会失败的功能。联调完成后改为 return isDesktopApp()。
  return false
}

/**
 * 启动火山端到端会话。桌面端通过 Rust 命令。
 * 由于 Tauri v2 的事件监听需要 @tauri-apps/api/event，这里用动态 import 避免 Web 打包报错。
 */
export async function startVolcRealtime(handlers: VolcRealtimeHandlers): Promise<{ ok: boolean; error?: string }> {
  // 骨架阶段：Rust 桥接未接入编译，统一返回未启用提示
  if (!isVolcRealtimeSupported()) {
    return { ok: false, error: '火山端到端实时语音正在适配中（桌面原生桥接待联调）；声音复刻可正常使用' }
  }
  if (!isDesktopApp()) {
    return { ok: false, error: '火山端到端实时语音目前仅桌面端支持；Web/手机端需另部署语音中继' }
  }
  const inv = invoke()
  if (!inv) return { ok: false, error: '桌面接口不可用，请重启应用' }
  const cfg = getVolcConfig()
  if (!cfg.appId.trim() || !cfg.accessToken.trim()) {
    return { ok: false, error: '请先在「语音配置 → 火山引擎」填写 APP ID 与 Access Token' }
  }

  try {
    // 动态订阅 Tauri 事件
    const { listen } = await import('@tauri-apps/api/event')
    await listen<Record<string, unknown>>('volc://event', (ev) => {
      handlers.onEvent(ev.payload as unknown as VolcRealtimeEvent)
    })

    await inv('start_volc_realtime', {
      cfg: {
        app_id: cfg.appId,
        access_token: cfg.accessToken,
        ws_url: cfg.wsUrl,
        resource_id: cfg.resourceId,
        voice: cfg.realtimeVoice,
        app_key: 'PlgvMymc7f3tQnJ6',
      },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? '启动失败' }
  }
}

/** 推送一段 16kHz 单声道 PCM（base64）给火山。桌面端麦克风由 Rust 采集，通常无需手动调用。 */
export async function sendVolcAudio(pcmBase64: string): Promise<void> {
  const inv = invoke()
  if (!inv) return
  try { await inv('send_volc_audio', { pcmB64: pcmBase64 }) } catch { /* ignore */ }
}

/** 结束会话 */
export async function stopVolcRealtime(): Promise<void> {
  const inv = invoke()
  if (!inv) return
  try { await inv('stop_volc_realtime') } catch { /* ignore */ }
}
