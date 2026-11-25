// 模型优缺点说明卡片：AI 图像/视频模块共用。
// 内置知识库命中则显示 tagline / 优点 / 缺点 / 适用场景；未收录模型显示通用提示。

import { Info, ThumbsUp, ThumbsDown, Target } from 'lucide-react'
import { describeModel, type MediaModelInfo } from '../core/mediaAdapters'
import { t } from '../core/i18n'

export function ModelInfoCard({ modelId, kind }: { modelId: string; kind: 'image' | 'video' }) {
  if (!modelId) return null
  const info: MediaModelInfo = describeModel(modelId, kind)
  return (
    <div className="gen-model-info">
      <div className="gen-mi-title"><Info size={13} /> {info.tagline}</div>
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
      {info.best && <div className="gen-mi-best"><Target size={12} /> {t('适合：{best}', { best: info.best })}</div>}
    </div>
  )
}
