// 本地服务开关按钮：设置页之外的模块（AI 翻译 / AI 图像 / AI 视频）共用的服务启停开关。
// 状态来自传入的 ServiceController（单一数据源 settings.localServices），因此与设置页天然联动：
// 任一处切换 -> 更新 settings -> 所有引用处同步显示。
// 右侧为果冻开关（与设置页 Toggle 同款 jelly 动画）：反映「已启用」状态；
// 「服务运行中」由电源图标变绿 + 状态徽标文案表达。

import { useEffect, useRef, useState } from 'react'
import { Power, Loader2 } from 'lucide-react'
import type { LocalServiceKey } from '../core/types'
import type { ServiceController } from '../core/useServiceController'
import { t } from '../core/i18n'

export function ServiceSwitch({
  controller, serviceKey, label, compact,
}: {
  controller: ServiceController
  serviceKey: LocalServiceKey
  label?: string
  compact?: boolean
}) {
  const enabled = controller.enabled(serviceKey)
  const running = !!controller.status[serviceKey]
  const busy = controller.busyKey === serviceKey
  const name = label ?? (serviceKey === 'ollama' ? 'Ollama' : serviceKey === 'comfyui' ? 'ComfyUI' : serviceKey === 'qwentts' ? 'Qwen3-TTS' : 'LM Studio')

  // 果冻动画方向（与 Toggle 组件同逻辑）：enabled 变化时播一次 350ms 滑动
  const [anim, setAnim] = useState<'on' | 'off' | null>(null)
  const prevEnabled = useRef(enabled)
  useEffect(() => {
    if (prevEnabled.current !== enabled) {
      setAnim(enabled ? 'on' : 'off')
      prevEnabled.current = enabled
      const t = window.setTimeout(() => setAnim(null), 360)
      return () => window.clearTimeout(t)
    }
  }, [enabled])

  return (
    <button
      type="button"
      className={`service-switch ${enabled ? 'on' : ''} ${compact ? 'compact' : ''}`}
      onClick={() => void controller.toggle(serviceKey)}
      disabled={busy}
      title={enabled
        ? running
          ? t('{name} 已启用（运行中：{url}），点击关闭', { name, url: controller.status[serviceKey] ?? '' })
          : t('{name} 已启用（未检测到运行），点击关闭', { name })
        : t('{name} 未启用，点击开启并启动服务', { name })}
    >
      {busy ? <Loader2 size={14} className="spin" /> : <Power size={14} className={running ? 'svc-running' : ''} />}
      <span className="service-switch-label">{name}</span>
      <span className={`service-switch-state ${enabled ? 'on' : ''}`}>{enabled ? (running ? t('运行中') : t('已开启')) : t('已关闭')}</span>
      <span className={`jelly-toggle mini ${enabled ? 'is-on' : ''}`} aria-hidden="true">
        <span className={`jelly-dot ${anim ? `anim-${anim}` : (enabled ? 'static-on' : 'static-off')}`} />
      </span>
    </button>
  )
}
