// 本地模型资料卡：模型选择框下方展示优缺点/风格/适合场景。
// 数据三层：内置知识库（精选）→ Civitai 实时查询 → 架构推断，卡片底部标注来源。

import { useEffect, useState } from 'react'
import { Info, ThumbsUp, ThumbsDown, Target, Loader2, ExternalLink, Palette } from 'lucide-react'
import { kbModelInfo, resolveLocalModelInfo, type LocalModelInfo } from '../core/modelInfo'
import { openExternal } from '../core/openExternal'
import { t } from '../core/i18n'

export function LocalModelInfoCard({ filename }: { filename: string }) {
  const [info, setInfo] = useState<LocalModelInfo | null>(() => kbModelInfo(filename))
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const kb = kbModelInfo(filename)
    setInfo(kb)
    if (!filename || kb) { setLoading(false); return }
    setLoading(true)
    resolveLocalModelInfo(filename)
      .then(r => { if (!cancelled) { setInfo(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filename])

  if (!filename) return null
  if (!info) {
    return loading
      ? <div className="gen-model-info"><div className="gen-mi-title" style={{ marginBottom: 0 }}><Loader2 size={13} className="spin" /> {t('正在联网查询模型资料…')}</div></div>
      : null
  }
  const sourceLabel = info.source === 'kb'
    ? t('资料来源：本地知识库')
    : info.source === 'civitai'
      ? t('资料来源：Civitai 实时数据')
      : t('资料来源：按名称与架构推断，仅供参考')
  return (
    <div className="gen-model-info">
      <div className="gen-mi-title"><Info size={13} /> {info.tagline}</div>
      {info.style && <div className="gen-mi-style"><Palette size={12} /> {t('风格：{style}', { style: info.style })}</div>}
      {info.intro && <p className="gen-mi-intro">{info.intro}</p>}
      {(info.pros.length > 0 || info.cons.length > 0) && (
        <div className="gen-mi-grid">
          <div className="gen-mi-col pros">
            <span className="gen-mi-label"><ThumbsUp size={12} /> {t('优点')}</span>
            {info.pros.length ? info.pros.map((p, i) => <span key={i} className="gen-mi-item">· {p}</span>) : <span className="gen-mi-item">—</span>}
          </div>
          <div className="gen-mi-col cons">
            <span className="gen-mi-label"><ThumbsDown size={12} /> {t('缺点 / 注意')}</span>
            {info.cons.length ? info.cons.map((c, i) => <span key={i} className="gen-mi-item">· {c}</span>) : <span className="gen-mi-item">—</span>}
          </div>
        </div>
      )}
      {info.best && <div className="gen-mi-best"><Target size={12} /> {t('适合：{best}', { best: info.best })}</div>}
      <div className="gen-mi-source">
        <span>{sourceLabel}{info.stats ? ` · ${info.stats}` : ''}</span>
        {info.sourceUrl && (
          <button className="gen-mi-link" onClick={() => void openExternal(info.sourceUrl!)}>
            {t('查看页面')} <ExternalLink size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
