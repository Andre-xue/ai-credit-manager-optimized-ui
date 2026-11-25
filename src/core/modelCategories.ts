// 模型分类体系：沟通「添加账户备注」与「AI 页模型下拉」两处的分类。
// 备注里用 [分类] 前缀（复用 noteCategory 提取），AI 页据此过滤账户列表。

/** 添加账户时备注写死的可选分类（用户指定 5 项） */
export const NOTE_CATEGORIES = ['通用型', '生图型', '视频型', '对话型', '本地型'] as const
export type NoteCategory = typeof NOTE_CATEGORIES[number]

/** AI 页模型分类下拉：前 6 项为用户指定，末项「免费模型」承载平台内置模型（不混入通用型） */
export const MODEL_CATEGORIES = ['通用型', '生图型', '视频型', '对话型', '文本型', '本地型', '免费模型'] as const
export type ModelCategory = typeof MODEL_CATEGORIES[number]

/** 分类用途说明与图标（用于信息卡与提示） */
export const CATEGORY_META: Record<ModelCategory, { desc: string; icon: string; canChat: boolean }> = {
  通用型: { desc: '你在 API Key 管理页保存的全部自有模型', icon: '✨', canChat: true },
  生图型: { desc: '文生图 / 图生图，如 Midjourney、即梦', icon: '🎨', canChat: false },
  视频型: { desc: '文生视频 / 图生视频，如可灵、Runway', icon: '🎬', canChat: false },
  对话型: { desc: '文本对话，支持 AI 语音通话模式', icon: '💬', canChat: true },
  文本型: { desc: '纯文本处理与补全', icon: '📝', canChat: true },
  本地型: { desc: '本机部署的模型，需本地服务地址', icon: '🖥️', canChat: true },
  免费模型: { desc: '平台内置免密钥模型（Auto/Hy4 等）', icon: '⚡', canChat: true },
}

/** 语音配置(APP)专用分类标识：不作为可选分类，仅供识别与 AI 页隐藏 */
export const VOICE_CONFIG_CATEGORY = '语音配置(APP)'

/** 是否为语音配置(APP)专用账户（按 providerId 或 note 前缀判定） */
export function isVoiceConfigAccount(providerId?: string, note?: string): boolean {
  if (providerId === 'voice-config') return true
  return !!note && note.trimStart().startsWith(`[${VOICE_CONFIG_CATEGORY}]`)
}

/** 备注 → 分类（备注下拉 5 类）。兼容 [通用型]/通用型: 等写法，以及旧备注里的 文本/图片 等词。 */
export function categoryFromNote(note?: string): NoteCategory {
  if (!note) return '通用型'
  const s = note.trim()
  // 标准写法：[分类] 说明
  const bracket = s.match(/^\[([^\]]+)\]/)
  const head = (bracket ? bracket[1] : s.split(/[:：\/\s]/)[0]).trim()
  // 精确匹配 5 类备注分类
  const exact = NOTE_CATEGORIES.find(c => c === head)
  if (exact) return exact
  // 兼容简称与旧备注；文本型在备注体系里归入通用型（对话文本）
  if (/生图|图片|绘图|image|画图/i.test(head)) return '生图型'
  if (/视频|video/i.test(head)) return '视频型'
  if (/对话|chat|聊天/i.test(head)) return '对话型'
  if (/本地|local/i.test(head)) return '本地型'
  return '通用型'
}

/** 生成写死备注文本： [分类] + 用户补充说明 */
export function buildNote(category: NoteCategory, extra?: string): string {
  const tail = extra?.trim()
  return tail ? `[${category}] ${tail}` : `[${category}]`
}

/** AI 页用：备注 → 模型分类（6 类，保留文本型）。语音配置(APP)返回专用标识，不进可见分类。 */
export function categoryForModel(note?: string): ModelCategory | typeof VOICE_CONFIG_CATEGORY {
  if (!note) return '通用型'
  const s = note.trim()
  // 语音配置(APP)专用：返回隐藏分类，AI 页下拉不展示、列表过滤时排除
  if (s.startsWith(`[${VOICE_CONFIG_CATEGORY}]`)) return VOICE_CONFIG_CATEGORY
  const bracket = s.match(/^\[([^\]]+)\]/)
  const head = (bracket ? bracket[1] : s.split(/[:：\/\s]/)[0]).trim()
  const exact = MODEL_CATEGORIES.find(c => c === head)
  if (exact) return exact
  if (/生图|图片|绘图|image|画图/i.test(head)) return '生图型'
  if (/视频|video/i.test(head)) return '视频型'
  if (/对话|chat|聊天/i.test(head)) return '对话型'
  if (/文本|text/i.test(head)) return '文本型'
  if (/本地|local/i.test(head)) return '本地型'
  return '通用型'
}
