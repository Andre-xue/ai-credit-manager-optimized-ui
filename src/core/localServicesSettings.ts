// 本地模型服务 App 内启用开关：纯应用层逻辑，不启停任何系统服务。
// 系统上的 Ollama / ComfyUI 等仍由用户按需启动，其他软件调用不受本开关影响。

import type { AppSettings, LocalServiceKey, MemoryTier } from './types'
import { isLocalProvider } from './types'

export const LOCAL_SERVICE_KEYS: LocalServiceKey[] = ['ollama', 'comfyui', 'lmstudio', 'qwentts']

/** 模型类本地服务（Ollama/ComfyUI/LM Studio）：Qwen3-TTS 是语音服务，不计入「本地型」模型分类 */
export const MODEL_SERVICE_KEYS: LocalServiceKey[] = ['ollama', 'comfyui', 'lmstudio']

/** 本地服务 key → providerId（qwentts 无模型账户，仅作开关与账户服务门控的映射） */
export const SERVICE_TO_PROVIDER: Record<LocalServiceKey, string> = {
  ollama: 'local-ollama',
  comfyui: 'local-comfyui',
  lmstudio: 'local-lmstudio',
  qwentts: 'local-qwentts',
}

/** providerId → 本地服务 key（非本地 provider 返回 null） */
export function providerToService(providerId: string | undefined | null): LocalServiceKey | null {
  if (!isLocalProvider(providerId)) return null
  const key = providerId!.replace(/^local-/, '') as LocalServiceKey
  return LOCAL_SERVICE_KEYS.includes(key) ? key : null
}

/** 物理内存 GB → 内存档位：<=8G→8，<=16G→16，其余→32 */
export function memoryToTier(gb: number): MemoryTier {
  if (!Number.isFinite(gb) || gb <= 0) return 8 // 检测失败按最保守处理
  if (gb <= 10) return 8   // 4G/8G 及 8~10G 归一到 8G 档
  if (gb <= 20) return 16  // 12G/16G 及附近归一到 16G 档
  return 32                // 24G/32G 及以上
}

/** 该档位最多可同时开启的本地服务数：8G 硬限制 1 个，其余不限 */
export function maxServicesForTier(tier: MemoryTier): number {
  return tier === 8 ? 1 : LOCAL_SERVICE_KEYS.length
}

/** 该档位的建议文案 */
export function tierAdvice(tier: MemoryTier): string {
  if (tier === 8) return '检测到 8G 内存：为保持流畅，仅允许同时开启 1 个本地服务。'
  if (tier === 16) return '检测到 16G 内存：建议只开启 1 个本地服务，同时开多个可能占用较多内存。'
  return `检测到 ${tier}G 及以上内存：可同时开启全部本地服务。`
}

/** 某服务在 App 内是否启用（未配置默认开启，避免升级后本地模型突然不可用）。
 * 例外：Qwen3-TTS 未配置默认关闭——它是重服务（约 6GB 常驻内存、另需下载约 1GB 模型），
 * 必须由用户显式启用；否则老用户 settings 里缺这个键会被默认算成已开，8G 下还会挤占唯一名额。 */
export function isServiceEnabled(settings: AppSettings | undefined, key: LocalServiceKey): boolean {
  if (key === 'qwentts') return settings?.localServices?.[key] === true
  return settings?.localServices?.[key] !== false
}

/** 某账户的本地服务是否已启用（非本地账户恒为 true） */
export function isAccountServiceEnabled(settings: AppSettings | undefined, providerId: string | undefined | null): boolean {
  const key = providerToService(providerId)
  return key ? isServiceEnabled(settings, key) : true
}

/** 当前已开启的本地服务数量 */
export function enabledServiceCount(settings: AppSettings | undefined): number {
  return LOCAL_SERVICE_KEYS.filter(k => isServiceEnabled(settings, k)).length
}

/** AI 页是否显示「本地型」分类：设置页至少一个本地模型服务开启时才显示（Qwen3-TTS 是语音服务，不计入） */
export function shouldShowLocalCategory(settings: AppSettings | undefined): boolean {
  return MODEL_SERVICE_KEYS.some(k => isServiceEnabled(settings, k))
}

/**
 * 首次根据内存档位生成默认开关：8G 只开第一个（Ollama），其余档位全开。
 * 仅在 localServicesInitialized 标记未设置时调用一次。
 * Qwen3-TTS 默认关：它需另行下载约 1GB 模型、常驻约 6GB 内存，由用户在语音配置页显式启用。
 */
export function initServicesForTier(tier: MemoryTier): Partial<Record<LocalServiceKey, boolean>> {
  if (tier === 8) return { ollama: true, comfyui: false, lmstudio: false, qwentts: false }
  return { ollama: true, comfyui: true, lmstudio: true, qwentts: false }
}

/** 本地服务开关变化事件名：AIView 监听此事件清理该服务的内存缓存 */
export const LOCAL_SERVICE_CHANGED_EVENT = 'acm:local-service-changed'

/** 派发服务开关变化（设置页切换后调用，AIView 收到后清理对应服务缓存） */
export function notifyLocalServiceChanged(key: LocalServiceKey, enabled: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent(LOCAL_SERVICE_CHANGED_EVENT, { detail: { key, enabled } }))
  } catch { /* 非浏览器环境忽略 */ }
}

export interface ServiceTogglePlan {
  /** 更新后的开关映射（写入 settings.localServices） */
  next: Partial<Record<LocalServiceKey, boolean>>
  /** 需要停掉进程、清缓存、释放内存的服务（互斥切换时被关闭的旧服务） */
  stopKeys: LocalServiceKey[]
  /** 目标服务最终是否开启 */
  enabled: boolean
}

/**
 * 规划服务切换：8G 等受限档位下，开启新服务会自动关闭当前已开启的其他服务（互斥），
 * 返回需要停掉的旧服务列表供调用方真正停进程释放内存。关闭操作总是允许。
 */
export function planServiceToggle(
  settings: AppSettings | undefined,
  key: LocalServiceKey,
  tier: MemoryTier,
): ServiceTogglePlan | null {
  const willEnable = !isServiceEnabled(settings, key)
  const next = { ...(settings?.localServices ?? {}) }
  if (!willEnable) {
    next[key] = false
    return { next, stopKeys: [key], enabled: false }
  }
  // 开启：找出当前已开启的其他服务（超过内存上限时全部关掉）
  const max = maxServicesForTier(tier)
  const othersEnabled = LOCAL_SERVICE_KEYS.filter(k => k !== key && isServiceEnabled(settings, k))
  const stopKeys = othersEnabled.slice(0, Math.max(0, othersEnabled.length - (max - 1)))
  next[key] = true
  for (const k of stopKeys) next[k] = false
  return { next, stopKeys, enabled: true }
}

/**
 * 尝试切换某服务的开关，返回新的开关映射；若违反 8G 硬限制则返回 null（拒绝开启）。
 * 关闭操作总是允许。兼容旧调用方；新代码建议用 planServiceToggle 实现互斥切换。
 */
export function toggleService(
  settings: AppSettings | undefined,
  key: LocalServiceKey,
  tier: MemoryTier,
): Partial<Record<LocalServiceKey, boolean>> | null {
  const next = { ...(settings?.localServices ?? {}) }
  const willEnable = !isServiceEnabled(settings, key)
  if (willEnable && enabledServiceCount(settings) >= maxServicesForTier(tier)) {
    return null // 已达上限，拒绝
  }
  next[key] = willEnable
  return next
}
