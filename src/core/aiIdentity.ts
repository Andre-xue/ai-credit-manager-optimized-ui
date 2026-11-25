// AI 聊天身份配置：机器人与"我"的头像、名字、音色与回答前缀。
// 关键：这些配置只存本机 localStorage，不进入云同步；同一账号在不同平台互相独立。

export interface AvatarPreset {
  id: string
  emoji: string
  color: string
  label: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'spark', emoji: '✨', color: '#6366f1', label: '星光' },
  { id: 'bot', emoji: '🤖', color: '#4f46e5', label: '机器人' },
  { id: 'cat', emoji: '🐱', color: '#f59e0b', label: '猫咪' },
  { id: 'fox', emoji: '🦊', color: '#f97316', label: '狐狸' },
  { id: 'panda', emoji: '🐼', color: '#10b981', label: '熊猫' },
  { id: 'rabbit', emoji: '🐰', color: '#ec4899', label: '兔子' },
  { id: 'star', emoji: '⭐', color: '#8b5cf6', label: '星星' },
  { id: 'moon', emoji: '🌙', color: '#3b82f6', label: '月亮' },
  { id: 'sun', emoji: '🌞', color: '#ef4444', label: '太阳' },
  { id: 'coffee', emoji: '☕', color: '#92400e', label: '咖啡' },
  { id: 'book', emoji: '📚', color: '#0ea5e9', label: '书本' },
  { id: 'gem', emoji: '💎', color: '#06b6d4', label: '宝石' },
]

export interface BotProfile {
  avatarId: string
  avatarDataUrl?: string
  name: string
  voiceURI: string | null
}

export interface UserProfile {
  avatarId: string
  avatarDataUrl?: string
  nickname: string
  phrase: string
}

const BOT_KEY = 'acm.ai.botProfile.v1'
const USER_KEY = 'acm.ai.userProfile.v1'

export const DEFAULT_BOT: BotProfile = { avatarId: 'spark', name: 'AI 助手', voiceURI: null }
export const DEFAULT_USER: UserProfile = { avatarId: 'user', nickname: '我', phrase: '' }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { ...fallback }
    return { ...fallback, ...JSON.parse(raw) }
  } catch { return { ...fallback } }
}

function save<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 忽略 */ }
}

export function loadBotProfile(): BotProfile { return load(BOT_KEY, DEFAULT_BOT) }
export function saveBotProfile(p: BotProfile): void { save(BOT_KEY, p) }
export function loadUserProfile(): UserProfile { return load(USER_KEY, DEFAULT_USER) }
export function saveUserProfile(p: UserProfile): void { save(USER_KEY, p) }

/** 把用户选择的图片等比缩放到正方形画布（不拉伸变形），返回压缩后的 data URL */
export function resizeAvatarImage(file: File, max = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('读取图片失败'))
    fr.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片格式不支持'))
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = max; canvas.height = max
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('画布不可用')); return }
        ctx.fillStyle = '#eef2ff'
        ctx.fillRect(0, 0, max, max)
        const scale = Math.min(max / img.width, max / img.height)
        const w = img.width * scale, h = img.height * scale
        ctx.drawImage(img, (max - w) / 2, (max - h) / 2, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = String(fr.result)
    }
    fr.readAsDataURL(file)
  })
}

export function getAvatar(id: string): AvatarPreset {
  return AVATAR_PRESETS.find(a => a.id === id)
    ?? (id === 'user' ? { id: 'user', emoji: '👤', color: '#64748b', label: '我' } : AVATAR_PRESETS[0])
}

/** 每次 AI 回答前的固定前缀：昵称 + 自定义短语。未设置时返回空串。 */
export function replyPrefix(): string {
  const u = loadUserProfile()
  const parts = [u.nickname.trim(), u.phrase.trim()].filter(Boolean)
  if (!parts.length) return ''
  return `${parts.join('：')}：`
}

/** 按用户设置的昵称/短语与 AI 名字生成动态系统提示，让回复自然带称呼而不是硬拼前缀。 */
export function buildIdentitySystemPrompt(bot: BotProfile, user: UserProfile, isFirstReply: boolean): string {
  const nickname = user.nickname.trim() || '朋友'
  const phrase = user.phrase.trim()
  const botName = bot.name.trim() || 'AI 助手'
  const intro = `我是一位叫“${botName}”的AI小助手，可以陪你聊天、帮你解决问题，也能帮你查看总结这个应用里的数据。`
  return [
    `你是「AI 魔方」App 内置的智能助手，名字叫“${botName}”。用户昵称是“${nickname}”${phrase ? `（用户自称“${phrase}”）` : ''}。`,
    '回复要求：简洁、准确、可执行；优先用中文；不要编造具体产品价格、规则或日期，不确定时明确说明并建议到官方渠道核实。',
    '像真人朋友一样自然对话：**不要**在每句开头固定加“你好/您好/称呼/哈哈”之类的问候或口头禅，直接切入正题；称呼只在确实自然、必要的时候偶尔使用。',
    isFirstReply ? `如果是第一次对话且用户主动打招呼，可以简短回应并说一句：“${intro}”；除此之外不要主动自我介绍。` : '不要做自我介绍。',
    '涉及额度管理、签到、API Key 安全、费用控制时结合本 App 功能给出建议；其他问题也可以正常回答。',
  ].join('\n')
}

/**
 * 语音通话专用系统提示：口语化、短句、直答，专为"说出来好听 + 生成快"设计。
 * 不强制问候、不做自我介绍、不用 markdown/emoji，避免逐字蹦和呆板腔。
 */
export function buildVoiceSystemPrompt(bot: BotProfile, user: UserProfile): string {
  const botName = bot.name.trim() || 'AI 助手'
  const nickname = user.nickname.trim() || ''
  return [
    `你是「AI 魔方」的语音助手“${botName}”，正在和用户${nickname ? `“${nickname}”` : ''}进行语音通话。`,
    '这是**语音对话**，你的文字会被直接朗读出来，因此必须：',
    '1. 用自然口语、简短句子回答，一般 1~2 句、30 字以内，能一句说完就一句，绝不啰嗦；',
    '2. 直接给答案，不要复述或重复用户的问题，不要用“你好/您好/哈哈/嗯/好的呀/让我想想”这类开头，也不要自我介绍、不要报自己的名字；',
    '3. 只用纯中文文字和常见标点（，。？！），不要用 markdown、标题、列表、符号、emoji、括号注音或英文缩写；',
    '4. 语气亲切自然、像真人朋友随口回应，适当用“啊、呢、吧、啦”等语气词，但不要机械堆砌；',
    '5. 回答要像个活人在聊天，不要像助手汇报工作，不要总结、不要分点。',
    '不确定时简短说明并建议查官方渠道。',
  ].join('\n')
}

export function withReplyPrefix(text: string): string {
  const p = replyPrefix()
  if (!p || text.startsWith(p)) return text
  return `${p}${text}`
}
