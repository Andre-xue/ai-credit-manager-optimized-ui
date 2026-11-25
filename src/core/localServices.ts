// 本地模型服务探测：桌面端通过 Tauri 命令实时扫描本机监听端口；
// 手机 / Web 端无法访问宿主本机，明确提示不可用（本地模型仅桌面端支持）。

import { isDesktopApp } from './openExternal'
import type { LocalServiceKey } from './types'

export interface LocalService {
  service: string
  host: string
  port: number
  url: string
}

/** 探测本机正在运行的本地模型服务；返回可连接的网关地址列表 */
export async function detectLocalServices(): Promise<{ ok: boolean; services: LocalService[]; error?: string }> {
  if (!isDesktopApp()) {
    return {
      ok: false,
      services: [],
      error: '本地模型仅能在桌面客户端添加：手机 / 网页无法访问你电脑上的本机服务。请在桌面端添加。',
    }
  }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<LocalService[]> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { ok: false, services: [], error: '桌面接口不可用，请重启应用后重试' }
    const services = await invoke('detect_local_services')
    return { ok: true, services: services ?? [] }
  } catch (e) {
    return { ok: false, services: [], error: `探测失败：${(e as Error)?.message ?? String(e)}` }
  }
}

const SCAN_DESKTOP_KEY = 'acm.comfyui.scanDesktop'

/** ComfyUI 模型磁盘扫描是否同时覆盖 Comfy Desktop 实例目录（本机偏好，默认关） */
export function comfyScanDesktopEnabled(): boolean {
  try { return localStorage.getItem(SCAN_DESKTOP_KEY) === '1' } catch { return false }
}

export function setComfyScanDesktop(on: boolean): void {
  try { localStorage.setItem(SCAN_DESKTOP_KEY, on ? '1' : '0') } catch { /* 忽略 */ }
}

const LAUNCH_DESKTOP_KEY = 'acm.comfyui.launchDesktop'

/** ComfyUI 启动方式：开启后改为拉起 Comfy Desktop 应用（本机偏好，默认关） */
export function comfyLaunchDesktopEnabled(): boolean {
  try { return localStorage.getItem(LAUNCH_DESKTOP_KEY) === '1' } catch { return false }
}

export function setComfyLaunchDesktop(on: boolean): void {
  try { localStorage.setItem(LAUNCH_DESKTOP_KEY, on ? '1' : '0') } catch { /* 忽略 */ }
}

/** 拉取本地服务已加载/已安装的模型列表（供选择式输入） */
export async function fetchLocalModels(key: 'ollama' | 'comfyui' | 'lmstudio', url: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  if (!isDesktopApp()) return { ok: false, models: [], error: '仅桌面端支持拉取本地模型列表' }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string[]> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { ok: false, models: [], error: '桌面接口不可用' }
    const models = await invoke('fetch_local_models', { key, url, scanExtra: key === 'comfyui' && comfyScanDesktopEnabled() })
    return { ok: true, models: models ?? [] }
  } catch (e) {
    return { ok: false, models: [], error: (e as Error)?.message ?? String(e) }
  }
}

/** 弹出系统文件选择器选择本地模型文件，返回完整路径；取消返回 null */
export async function chooseModelFile(): Promise<string | null> {
  if (!isDesktopApp()) return null
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<string | null> }
    }
    return await w.__TAURI_INTERNALS__?.invoke?.('choose_model_file') ?? null
  } catch { return null }
}

/** 检测单个本地服务是否运行，返回其实际地址；未运行/非桌面端返回 null */
export async function checkLocalService(key: LocalServiceKey): Promise<string | null> {
  if (!isDesktopApp()) return null
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string | null> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return null
    return await invoke('check_local_service', { key })
  } catch {
    return null
  }
}

/** 启动本机本地服务（显式调用）；返回指引文案或错误 */
export async function startLocalService(key: LocalServiceKey): Promise<{ ok: boolean; message: string }> {
  if (!isDesktopApp()) return { ok: false, message: '仅桌面端支持一键启动，请在电脑上运行对应应用' }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { ok: false, message: '桌面接口不可用' }
    const message = await invoke('start_local_service', { key, launchDesktop: key === 'comfyui' && comfyLaunchDesktopEnabled() })
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/** 停止由本 App 启动的本地服务进程（不碰用户手动启动的服务） */
export async function stopLocalService(key: LocalServiceKey): Promise<{ ok: boolean; message: string }> {
  if (!isDesktopApp()) return { ok: false, message: '仅桌面端支持' }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { ok: false, message: '桌面接口不可用' }
    const message = await invoke('stop_local_service', { key })
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/** 停止占用服务端口的进程（含外部启动的）：确认式关闭——等进程真退出、端口真释放才算成功，赖着不走会强制结束 */
export async function stopServiceByPort(key: LocalServiceKey): Promise<{ ok: boolean; message: string }> {
  if (!isDesktopApp()) return { ok: false, message: '仅桌面端支持' }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { ok: false, message: '桌面接口不可用' }
    const message = await invoke('stop_service_by_port', { key })
    return { ok: true, message }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? String(e) }
  }
}

/**
 * 开关关闭状态下的遗留进程对账（App 启动时对每个关着的服务调用一次）：
 * 清理上次遗留的服务进程（托管孤儿 / 端口上的服务进程 / 守护中的 Ollama 应用），
 * 保证「开关关了 = 服务不常驻」。返回是否真的动了进程与说明。
 */
export async function reconcileLocalService(key: LocalServiceKey): Promise<{ acted: boolean; message: string }> {
  if (!isDesktopApp()) return { acted: false, message: '' }
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<[boolean, string]> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return { acted: false, message: '' }
    const [acted, message] = await invoke('reconcile_local_service', { key })
    return { acted: !!acted, message: message ?? '' }
  } catch { return { acted: false, message: '' } }
}

/** 某服务是否由本 App 启动且仍在运行（决定是否显示停止按钮） */
export async function isServiceAppManaged(key: LocalServiceKey): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<boolean> }
    }
    return await w.__TAURI_INTERNALS__?.invoke?.('is_service_app_managed', { key }) ?? false
  } catch { return false }
}

/** 读取本机物理内存 GB（仅桌面端）；失败返回 0，调用方按保守档处理 */
export async function getSystemMemoryGb(): Promise<number> {
  if (!isDesktopApp()) return 0
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string) => Promise<number> }
    }
    const invoke = w.__TAURI_INTERNALS__?.invoke
    if (!invoke) return 0
    const gb = await invoke('get_system_memory_gb')
    return Number.isFinite(gb) && gb > 0 ? gb : 0
  } catch {
    return 0
  }
}
