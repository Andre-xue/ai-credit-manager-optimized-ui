// 全局搜索命令面板（Cmd/Ctrl+K）：搜页面、账户、AI 工具，键盘可达。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { t } from '../core/i18n'

export interface PaletteItem {
  id: string
  group: string
  title: string
  hint?: string
  keywords: string
  run: () => void
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items.slice(0, 12)
    const scored = items
      .map((it) => {
        const hay = `${it.title} ${it.hint ?? ''} ${it.keywords}`.toLowerCase()
        const idx = hay.indexOf(needle)
        return { it, score: idx === -1 ? -1 : (hay.startsWith(needle) ? 0 : idx) }
      })
      .filter((s) => s.score >= 0)
      .sort((a, b) => a.score - b.score)
    return scored.slice(0, 12).map((s) => s.it)
  }, [items, q])

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (it: PaletteItem | undefined) => { if (it) { onClose(); it.run() } }

  return (
    <div className="overlay cmdk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk-panel" role="dialog" aria-label={t('全局搜索')}>
        <div className="cmdk-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('搜索页面、账户、工具…')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); choose(results[sel]) }
              else if (e.key === 'Escape') { onClose() }
            }}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {results.length === 0 && <div className="cmdk-empty">{t('没有匹配的结果')}</div>}
          {results.map((it, i) => (
            <button
              key={it.id}
              data-idx={i}
              className={`cmdk-item ${i === sel ? 'active' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(it)}
            >
              <span className="cmdk-group">{it.group}</span>
              <span className="cmdk-title">{it.title}</span>
              {it.hint && <span className="cmdk-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
        <div className="cmdk-foot">{t('↑↓ 选择 · Enter 打开 · 支持搜索页面 / 账户 / 工具名')}</div>
      </div>
    </div>
  )
}
