// 免费模型「按用途分组」（v0.1.317）：免费清单来自云端/Zen/Kilo 三路、命名各异，
// 只按来源堆一长串很难挑。这里用模型 id 的命名启发式归到用途组，并给出能力标签，
// 供 AI 助手免费模型菜单分组展示。启发式只是挑选指引，不代表官方定位。

export type ModelPurpose = '通用对话' | '深度推理' | '看图理解' | '代码倾向' | '快速轻量'

export const PURPOSE_ORDER: ModelPurpose[] = ['通用对话', '深度推理', '看图理解', '代码倾向', '快速轻量']

export const PURPOSE_ICON: Record<ModelPurpose, string> = {
  通用对话: '💬',
  深度推理: '🧠',
  看图理解: '👁️',
  代码倾向: '💻',
  快速轻量: '⚡',
}

export interface ModelPurposeInfo {
  purpose: ModelPurpose
  /** 能力标签（展示用）：对话恒有，其余按命名特征补充 */
  tags: string[]
}

/** 从 id 里提取参数量（B），如 'flint-40b' → 40、'lfm-3-1.7b' → 1.7；无则 null */
function sizeBillions(id: string): number | null {
  const m = id.match(/(\d+(?:\.\d+)?)b(?![a-z])/)
  return m ? Number(m[1]) : null
}

export function classifyModelPurpose(modelId: string): ModelPurposeInfo {
  const id = modelId.toLowerCase()
  const tags = ['对话']
  const isReasoning = /reasoning|thinking|ultra|-r1|r1-|qwq|deepthink/.test(id)
  const isVision = /(^|[-_/:])vl([-_/:]|$)|vision|omni/.test(id)
  const isCode = /flint|coder|code/.test(id)
  const size = sizeBillions(id)
  const isLight = (size !== null && size <= 8) || /nano|mini|tiny|lite/.test(id)
  const isFast = isLight || /flash|lightning|fast|turbo/.test(id)

  if (isVision) tags.push('看图')
  if (isReasoning) tags.push('推理')
  if (isCode) tags.push('代码')
  if (isFast) tags.push('快速')

  // 分组优先级：推理（omni+reasoning 归推理，看图靠标签补充）→ 看图 → 代码 → 轻量 → 通用
  let purpose: ModelPurpose = '通用对话'
  if (isReasoning) purpose = '深度推理'
  else if (isVision) purpose = '看图理解'
  else if (isCode) purpose = '代码倾向'
  else if (isLight) purpose = '快速轻量'
  return { purpose, tags }
}
