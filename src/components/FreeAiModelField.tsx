// 免费 AI 模型选择（AI 翻译两页共用）：加载云端免费 + Zen/Kilo 免费通道选项并分组展示。

import { useEffect, useState } from 'react'
import { loadFreeAiOptions, type FreeAiOption } from '../core/freeAi'
import { t } from '../core/i18n'

export function useFreeAiOptions() {
  const [options, setOptions] = useState<FreeAiOption[]>([])
  const [key, setKey] = useState('')
  useEffect(() => {
    let off = false
    loadFreeAiOptions()
      .then(list => {
        if (off) return
        setOptions(list)
        setKey(prev => (list.some(o => o.key === prev) ? prev : (list[0]?.key ?? '')))
      })
      .catch(() => {})
    return () => { off = true }
  }, [])
  const selected = options.find(o => o.key === key)
  return { options, key, setKey, selected }
}

export function FreeAiModelSelect({ options, value, onChange, disabled }: {
  options: FreeAiOption[]; value: string; onChange: (k: string) => void; disabled?: boolean
}) {
  const groups = [...new Set(options.map(o => o.group))]
  return (
    <div className="tr-field">
      <label>{t('免费模型')}</label>
      <select className="select" value={value} onChange={e => onChange(e.target.value)} disabled={disabled || options.length === 0}>
        {options.length === 0 && <option value="">{t('暂无可用免费模型（云端需先登录）')}</option>}
        {groups.map(g => (
          <optgroup key={g} label={t(g)}>
            {options.filter(o => o.group === g).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
