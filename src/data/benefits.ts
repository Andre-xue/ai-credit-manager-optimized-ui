// 福利中心数据：只收录各平台公开可查的「免费层 / 新用户试用 / 签到福利」类型信息。
// 合规原则：
//  1. 具体额度数字频繁变化，不写死，一律以「查看官方政策」为准。
//  2. 只提供官方域名链接，跳转由用户本人操作，工具不自动领取、不抓取、不模拟登录。
//  3. 数据仅供提醒，不构成任何平台承诺。
export interface BenefitItem {
  id: string
  providerId: string
  title: string
  /** 中性描述，不含易变的精确数字 */
  desc: string
  /** 免费层 / 新用户试用 / 每日签到 / 教育优惠 */
  kind: 'free-tier' | 'trial' | 'daily' | 'education' | 'other'
  /** 官方政策或领取页面 */
  url: string
  /** 数据核对日期 */
  updatedAt: string
}

const CHECKED = '2026-11-17'

export const BENEFITS: BenefitItem[] = [
  {
    id: 'b-gemini', providerId: 'gemini', title: 'Gemini API 免费层',
    desc: '提供永久免费层，覆盖 Flash 系列等模型，在速率限制内可调用；具体限额以官方定价页为准。',
    kind: 'free-tier', url: 'https://ai.google.dev/gemini-api/docs/rate-limits', updatedAt: CHECKED,
  },
  {
    id: 'b-openai', providerId: 'openai', title: 'OpenAI 新用户试用额度',
    desc: 'API 通常无永久免费层；部分计划提供 API 额度或数据共享赠送额度，以官方说明为准。',
    kind: 'trial', url: 'https://platform.openai.com/docs/pricing', updatedAt: CHECKED,
  },
  {
    id: 'b-anthropic', providerId: 'anthropic', title: 'Claude 新用户试用额度',
    desc: '新账户可能获得少量试用额度用于测试 API，之后按量计费；以官方定价页为准。',
    kind: 'trial', url: 'https://www.anthropic.com/pricing', updatedAt: CHECKED,
  },
  {
    id: 'b-qwen', providerId: 'qwen', title: '通义千问 / 百炼免费额度',
    desc: '新用户通常赠送免费 Token 额度，部分轻量模型提供长期免费调用；有效期与额度以百炼控制台为准。',
    kind: 'trial', url: 'https://help.aliyun.com/zh/model-studio/', updatedAt: CHECKED,
  },
  {
    id: 'b-deepseek', providerId: 'deepseek', title: 'DeepSeek 余额与赠送额度',
    desc: '各时期政策不同，新注册用户可能获赠额度，账户赠送余额优先扣除；以官方公告为准。',
    kind: 'trial', url: 'https://platform.deepseek.com/', updatedAt: CHECKED,
  },
  {
    id: 'b-glm', providerId: 'glm', title: '智谱 GLM 免费模型',
    desc: '提供部分 Flash 系列免费模型与新用户额度，具体免费范围以开放平台说明为准。',
    kind: 'free-tier', url: 'https://open.bigmodel.cn/pricing', updatedAt: CHECKED,
  },
  {
    id: 'b-kimi', providerId: 'kim', title: 'Kimi 开放平台额度',
    desc: 'API 按量计费为主，文件上传等部分功能可能限时免费；以官方定价说明为准。',
    kind: 'other', url: 'https://platform.moonshot.cn/docs/pricing', updatedAt: CHECKED,
  },
  {
    id: 'b-doubao', providerId: 'doubao', title: '火山方舟新用户额度',
    desc: '新用户通常可领取免费 Token 额度，部分轻量模型提供免费调用；以方舟控制台为准。',
    kind: 'trial', url: 'https://www.volcengine.com/docs/82379', updatedAt: CHECKED,
  },
  {
    id: 'b-cursor', providerId: 'cursor', title: 'Cursor 免费版',
    desc: '提供功能受限的免费版，订阅用户另有额度；具体限制以官方定价页为准。',
    kind: 'free-tier', url: 'https://cursor.com/pricing', updatedAt: CHECKED,
  },
  {
    id: 'b-copilot', providerId: 'copilot', title: 'GitHub Copilot 免费版',
    desc: '面向个人提供有限的免费请求额度，学生与开源维护者可申请更完整权益；以官方说明为准。',
    kind: 'free-tier', url: 'https://github.com/features/copilot/plans', updatedAt: CHECKED,
  },
  {
    id: 'b-perplexity', providerId: 'perplexity', title: 'Perplexity API 试用',
    desc: 'API 按量计费，部分场景提供试用或免费搜索额度；以官方定价页为准。',
    kind: 'trial', url: 'https://www.perplexity.ai/settings/api', updatedAt: CHECKED,
  },
  {
    id: 'b-elevenlabs', providerId: 'elevenlabs', title: 'ElevenLabs 免费额度',
    desc: '免费账户每月提供一定字符额度，可体验语音生成；以官方定价页为准。',
    kind: 'free-tier', url: 'https://elevenlabs.io/pricing', updatedAt: CHECKED,
  },
  {
    id: 'b-mj', providerId: 'midjourney', title: 'Midjourney 试用',
    desc: '通常无长期免费层，新用户可能有短期试用；以官方说明为准。',
    kind: 'trial', url: 'https://www.midjourney.com/', updatedAt: CHECKED,
  },
  {
    id: 'b-figma', providerId: 'figma', title: 'Figma 教育优惠',
    desc: '符合条件的学生与教育工作者可申请免费或优惠的专业功能；以官方教育页面为准。',
    kind: 'education', url: 'https://www.figma.com/education/', updatedAt: CHECKED,
  },
]

export const BENEFIT_KIND_LABEL: Record<BenefitItem['kind'], string> = {
  'free-tier': '免费层', trial: '新用户试用', daily: '每日签到', education: '教育优惠', other: '其他福利',
}
