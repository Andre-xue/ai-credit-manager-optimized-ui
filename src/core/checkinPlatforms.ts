// 签到平台注册表：按「国内/国外 × 功能」分类；每平台一个自动签到开关（仅本机保存）。
// 关掉某平台后，批量签到（自动签到、菜单栏一键签到）会跳过它；逐个账号的手动签到不受影响。
// 新平台接入时在这里登记一行，签到页分组与自动签到过滤会自动跟上。

export type CheckinPlatformId =
  | 'workbuddy' | 'minimax'
  | 'doubao' | 'lingxi' | 'dumate' | 'xiaohuanxiong' | 'teleagent'
  | 'qoder-cn' | 'qoder-intl'

export interface CheckinPlatformMeta {
  id: CheckinPlatformId
  name: string
  regionLabel: '国内' | '国外'
  category: string
  /** 每日签到收益的单位文案 */
  unit: string
  /** 凭据获取与使用说明（签到页可折叠展开） */
  guide: string[]
}

const COOKIE_GUIDE_TAIL = '凭据只加密存在本机保险箱里，不上传、不云同步；失效了重新复制一次粘回来即可。'

export const CHECKIN_PLATFORMS: CheckinPlatformMeta[] = [
  {
    id: 'workbuddy', name: 'WorkBuddy', regionLabel: '国内', category: 'AI 编程工具', unit: '积分',
    guide: [
      '账号在工坊的「WorkBuddy 账号池」里添加：点添加账号会打开腾讯官方授权页，登录后自动入池，不用手动复制任何东西。',
      '每个账号每天签到 100 积分；账号多了可以在账号池里逐个添加，签到时全部一起签。',
      '令牌只加密存本机（多设备会互相顶掉登录态，所以不要在别的工具里同时用同一账号签到）。',
    ],
  },
  {
    id: 'qoder-cn', name: 'Qoder（国内版）', regionLabel: '国内', category: 'AI 编程工具', unit: 'Credits',
    guide: [
      '打开 Qoder 客户端（或 qoder.com.cn）登录你的账号，在设置里找到「个人访问令牌（PAT）」，生成一个，复制后粘到下面的添加框里。',
      '每日签到 100 Credits；活动每天北京时间 10:00 换新一轮，10 点前显示的是上一轮的状态，到点后自动签会补上。',
      '国内版与国际版是两套账号，令牌不能混用。',
    ],
  },
  {
    id: 'qoder-intl', name: 'Qoder（国际版）', regionLabel: '国外', category: 'AI 编程工具', unit: 'Credits',
    guide: [
      '打开 Qoder 国际版客户端（或 qoder.sh）登录，在设置里生成「个人访问令牌（PAT）」，复制后粘到下面的添加框里。',
      '每日签到领 Credits；活动每天北京时间 10:00 换新一轮。',
      '国际版与国内版是两套账号，令牌不能混用。',
    ],
  },
  {
    id: 'minimax', name: 'MiniMax', regionLabel: '国内', category: '大模型平台', unit: '积分',
    guide: [
      '点「添加账号」会给一个授权链接和设备码：在浏览器打开链接、登录 MiniMax、输入设备码确认，账号就加进来了。',
      '每日签到基础 400 积分，第 4 天和第 7 天 1000 积分，按 7 天一轮循环。',
    ],
  },
  {
    id: 'doubao', name: '豆包', regionLabel: '国内', category: 'AI 助手', unit: '额度',
    guide: [
      '每天签到 +200 体验额度。需要豆包的登录 Cookie，获取方法：',
      '1. 电脑浏览器打开 doubao.com 并登录（要用个人账号，飞书/工作版账号没有签到任务）；',
      '2. 按 F12 打开开发者工具，切到「应用（Application）」→ 左侧「Cookie」→ doubao.com，把整行 Cookie 复制下来（也可以在「网络」页随便点一个请求，复制请求头里的 Cookie）；',
      '3. 回到这里，点「添加账号」，把 Cookie 粘进去保存。',
      COOKIE_GUIDE_TAIL,
    ],
  },
  {
    id: 'xiaohuanxiong', name: '商汤小浣熊', regionLabel: '国内', category: 'AI 助手', unit: '积分',
    guide: [
      '小浣熊没有签到按钮：每日积分（免费版 300/天）是登录发放的，这里的「签到」是替你确认到账并把额度有效期续到 7 天。',
      '需要登录令牌：浏览器打开 xiaohuanxiong.com 登录 → F12 开发者工具 →「应用」→ Cookie 里找 xhx_token，复制它的值（或整行 Cookie）→ 回来点「添加账号」粘进去。',
      COOKIE_GUIDE_TAIL,
    ],
  },
  {
    id: 'teleagent', name: '天翼 AI', regionLabel: '国内', category: 'AI 助手', unit: '积分',
    guide: [
      '签到在 TeleAgent 的「积分福利社」里，每天有可领的奖励，这里会自动把能领的都领掉。',
      '需要登录令牌：浏览器打开 agent.teleai.com.cn 登录 → F12 开发者工具 →「应用」→ Cookie 里找 operationToken，复制它的值（或整行 Cookie）→ 回来点「添加账号」粘进去。',
      COOKIE_GUIDE_TAIL,
    ],
  },
  {
    id: 'lingxi', name: 'WPS 灵犀', regionLabel: '国内', category: 'AI 办公', unit: '智点',
    guide: [
      '每天签到领智点。可以先下载 WPS 灵犀 App 登录，也可以直接用网页版：',
      '1. 浏览器打开 lingxi.wps.cn 并登录；',
      '2. F12 开发者工具 →「应用」→ Cookie 里找 wps_sid，复制它的值（或整行 Cookie）；',
      '3. 回到这里，点「添加账号」粘进去保存。',
      COOKIE_GUIDE_TAIL,
    ],
  },
  {
    id: 'dumate', name: '百度 DuMate', regionLabel: '国内', category: 'AI 办公', unit: '积分',
    guide: [
      '每天签到领积分。可以先下载百度搭子（DuMate）App 登录，也可以直接用网页版：',
      '1. 浏览器打开 console.bce.baidu.com 并登录百度账号；',
      '2. F12 开发者工具 →「应用」→ Cookie，把整行 Cookie 复制下来（必须包含 bce-user-info 这一项，少了它领不了）；',
      '3. 回到这里，点「添加账号」粘进去保存。',
      COOKIE_GUIDE_TAIL,
    ],
  },
]

/** 走令牌池（粘贴凭据）的平台 id 列表 */
export const TOKEN_PLATFORM_IDS: CheckinPlatformId[] = [
  'doubao', 'lingxi', 'dumate', 'xiaohuanxiong', 'teleagent', 'qoder-cn', 'qoder-intl',
]

export function platformMeta(id: CheckinPlatformId): CheckinPlatformMeta {
  return CHECKIN_PLATFORMS.find(p => p.id === id) ?? CHECKIN_PLATFORMS[0]
}

const KEY = 'acm.checkin.platforms.v1'

function readPrefs(): Partial<Record<CheckinPlatformId, boolean>> {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Record<CheckinPlatformId, boolean>>
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}

/** 平台是否参与批量签到（默认开） */
export function getPlatformEnabled(id: CheckinPlatformId): boolean {
  return readPrefs()[id] !== false
}

export function setPlatformEnabled(id: CheckinPlatformId, on: boolean): void {
  try {
    const prefs = readPrefs()
    prefs[id] = on
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch { /* 忽略 */ }
}
