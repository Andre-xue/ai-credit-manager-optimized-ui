// 本地服务控制 Hook：把 App 层的服务开关状态与启停逻辑集中管理，
// 供设置页、AI 翻译、AI 图像、AI 视频等多处共用，保证开关状态联动。
// 状态源单一：settings.localServices（持久化）；运行时状态（服务是否真在跑）由本机探测得到。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, LocalServiceKey, MemoryTier } from './types'
import {
  checkLocalService, startLocalService, stopServiceByPort, comfyLaunchDesktopEnabled,
  reconcileLocalService,
} from './localServices'
import {
  LOCAL_SERVICE_KEYS, isServiceEnabled, planServiceToggle, notifyLocalServiceChanged,
} from './localServicesSettings'
import { qwenTtsWarmup, resetQwenWarmup } from './qwenTts'

export interface ServiceController {
  /** 某服务在 App 内是否启用（来自 settings） */
  enabled: (key: LocalServiceKey) => boolean
  /** 某服务本机是否真的在运行（返回地址或 null） */
  status: Partial<Record<LocalServiceKey, string | null>>
  /** 正在切换的服务 key */
  busyKey: LocalServiceKey | null
  /** 切换服务开关（含启停进程、8G 限制） */
  toggle: (key: LocalServiceKey) => Promise<void>
  /** 刷新运行时状态 */
  refresh: () => void
}

/**
 * @param settings 当前 AppSettings（只读）
 * @param patchSettings 更新 settings 的回调（写入 localServices）
 * @param memTier 内存档位
 * @param notify 提示回调
 */
export function useServiceController(
  settings: AppSettings | undefined,
  patchSettings: (patch: Partial<AppSettings>) => void,
  memTier: MemoryTier,
  notify: (msg: string) => void,
): ServiceController {
  const [status, setStatus] = useState<Partial<Record<LocalServiceKey, string | null>>>({})
  const [busyKey, setBusyKey] = useState<LocalServiceKey | null>(null)

  const refresh = useCallback(() => {
    void Promise.all(LOCAL_SERVICE_KEYS.map(async k => [k, await checkLocalService(k)] as const))
      .then(rows => {
        const map = Object.fromEntries(rows) as Partial<Record<LocalServiceKey, string | null>>
        setStatus(map)
      })
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // 启动对账（每个会话只做一次，等 settings 就绪后执行）：让开关状态成为唯一事实——
  // 开着的：Ollama 没在跑则拉起一次（原 refresh 自愈移到这里一次性做，避免每次刷新都
  // 尝试拉起、与用户刚关掉开关的动作竞态，把用户关掉的服务又拉回来）。
  // Qwen3-TTS 开着也不自启：模型加载慢（约 5~30 秒）且常驻约 6GB 内存，由用户需要时手动启动；
  // 关着的：清理上次遗留的服务进程（App 异常退出留下的孤儿 / 端口上的服务进程 /
  // 守护中的 Ollama 应用），保证「关了就不常驻」跨重启也成立。清理真动了进程才提示。
  const reconciledRef = useRef(false)
  useEffect(() => {
    if (!settings || reconciledRef.current) return
    reconciledRef.current = true
    void (async () => {
      for (const k of LOCAL_SERVICE_KEYS) {
        if (isServiceEnabled(settings, k)) {
          if (k === 'ollama') {
            const addr = await checkLocalService(k)
            if (!addr) {
              const r = await startLocalService(k)
              if (r.ok) refresh()
            }
          }
        } else {
          const r = await reconcileLocalService(k)
          if (r.acted) {
            const name = k === 'ollama' ? 'Ollama' : k === 'comfyui' ? 'ComfyUI' : k === 'qwentts' ? 'Qwen3-TTS' : 'LM Studio'
            notify(`已清理遗留的 ${name} 服务进程（开关处于关闭）：${r.message}`)
            notifyLocalServiceChanged(k, false)
          }
        }
      }
      refresh()
    })()
  }, [settings, notify, refresh])

  const enabled = useCallback((key: LocalServiceKey) => isServiceEnabled(settings, key), [settings])

  const toggle = useCallback(async (key: LocalServiceKey) => {
    if (busyKey) return
    const plan = planServiceToggle(settings, key, memTier)
    if (!plan) return
    const { next, stopKeys, enabled: willEnable } = plan
    setBusyKey(key)
    patchSettings({ localServices: next })
    const name = key === 'ollama' ? 'Ollama' : key === 'comfyui' ? 'ComfyUI' : key === 'qwentts' ? 'Qwen3-TTS' : 'LM Studio'
    try {
      // 互斥：先停掉被挤掉的其他服务（关自己留给下方 else 统一处理）
      for (const oldKey of stopKeys) {
        if (oldKey === key) continue
        const r = await stopServiceByPort(oldKey)
        setStatus(prev => ({ ...prev, [oldKey]: '' }))
        notifyLocalServiceChanged(oldKey, false)
        const oldName = oldKey === 'ollama' ? 'Ollama' : oldKey === 'comfyui' ? 'ComfyUI' : oldKey === 'qwentts' ? 'Qwen3-TTS' : 'LM Studio'
        if (r.ok) notify(`已关闭 ${oldName} 以释放内存（${r.message}）`)
      }
      if (willEnable) {
        const already = await checkLocalService(key)
        if (already) {
          setStatus(prev => ({ ...prev, [key]: already }))
          notify(`${name} 已在运行，已直接启用`)
          // Qwen3-TTS 已在跑：后台预热一次模型，首次克隆不再等加载
          if (key === 'qwentts') void qwenTtsWarmup()
        } else if (key !== 'lmstudio') {
          const r = await startLocalService(key)
          notify(`${name}：${r.message}`)
          if (r.ok) {
            let tries = 0
            const poll = window.setInterval(() => {
              void checkLocalService(key).then(addr => {
                if (addr) {
                  setStatus(prev => ({ ...prev, [key]: addr })); window.clearInterval(poll)
                  // Qwen3-TTS 刚起来：后台预热一次模型，首次克隆不再等加载
                  if (key === 'qwentts') void qwenTtsWarmup()
                }
                else if (++tries >= (key === 'qwentts' ? 30 : 15)) {
                  window.clearInterval(poll)
                  if (key === 'comfyui' && comfyLaunchDesktopEnabled()) {
                    // Desktop 拉起模式：应用已打开但实例还没由用户点开，不算失败——
                    // 不回滚开关，等实例启动后探测会自动识别（状态刷新/进页面时会更新）
                    notify('已打开 Comfy Desktop，请在其中打开你的实例，启动后会自动识别')
                  } else {
                    // 启动命令返回成功但服务始终没起来 → 回滚开关，避免"已开启却连不上"的状态脱节
                    patchSettings({ localServices: { ...(settings?.localServices ?? {}), [key]: false } })
                    setStatus(prev => ({ ...prev, [key]: null }))
                    notifyLocalServiceChanged(key, false)
                    notify(`${name} 启动后未能正常监听端口，已自动关闭开关。请确认本机 ${key} 可正常运行后重试`)
                  }
                }
              })
            }, 2000)
          } else {
            // 启动命令直接失败 → 回滚开关
            patchSettings({ localServices: { ...(settings?.localServices ?? {}), [key]: false } })
            notifyLocalServiceChanged(key, false)
          }
        } else {
          notify(`${name} 请在 LM Studio 应用内手动开启本地服务器`)
        }
      } else {
        const r = await stopServiceByPort(key)
        notify(`${name}：${r.ok ? r.message : `停止失败：${r.message}`}`)
        setStatus(prev => ({ ...prev, [key]: '' }))
        // Qwen3-TTS 停掉后复位预热状态，下次启动重新预热
        if (key === 'qwentts') resetQwenWarmup()
      }
      notifyLocalServiceChanged(key, willEnable)
    } finally { setBusyKey(null) }
  }, [settings, memTier, busyKey, patchSettings, notify])

  return { enabled, status, busyKey, toggle, refresh }
}
