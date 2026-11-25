// AI 工具目录 —— 国内外 / 可签到 / 功能 / 平台 多级分类 + 官方图标 + 使用量排序
// 数据来源：SimilarWeb 月访问量、QuestMobile/Sensor Tower 月活（2026-11 核实）+ 各平台官方站点。
// 说明：
// - usage 为「月访问量/月活」量级（单位：百万次），用于按使用量由高到低排序；usageLabel 为展示文案。
// - canCheckin 仅标记「官方确有每日签到 / 登录领积分」机制；免费额度/试用/新用户赠金归为无签到。
// - platforms 标注该工具提供客户端的平台（含仅 Web）；用于平台分类筛选。
// - 所有链接均为官方域名；工具只做提醒与跳转，不模拟登录、不自动领取。
// - 图标为各平台官方 logo，已下载到本地 public/agent-icons，离线可用。

export type AgentRegion = 'cn' | 'global'
export type AgentCategory =
  | '综合办公' | '对话助手' | '编程开发' | 'AI 搜索' | '图像设计' | '视频创作'
  | 'Agent 平台' | '音乐音频' | '翻译写作' | '效率工具'

export type AgentPlatform = 'Windows' | 'macOS' | 'Linux' | 'iOS' | 'Android' | 'Web' | '浏览器插件'

export interface LocalApp {
  /** macOS 官方 bundle id 候选（按顺序探测，命中即唤醒） */
  bundleIds: string[]
  /** Windows 官方可执行文件名 / 开始菜单名候选 */
  exeNames: string[]
}

export interface AgentTool {
  id: string
  name: string        // 中文名
  nameEn: string      // 英文名
  region: AgentRegion
  category: AgentCategory
  canCheckin: boolean
  /** 官方下载/直达链接（https 官方域名） */
  downloadUrl: string
  /** 签到或福利入口链接（可与 downloadUrl 相同，入口在客户端内时指向官网） */
  checkinUrl?: string
  /** 签到说明：入口位置与奖励规则 */
  checkinTip?: string
  /** 无签到时的福利说明 */
  benefitTip?: string
  /** 本地官方 logo 路径 */
  icon: string
  /** 品牌色，用于卡片图标底 */
  color: string
  /** 一句话定位 */
  desc: string
  /** 本地客户端标识（有桌面端的工具才配置；缺失则直接走官网） */
  localApp?: LocalApp
  /** 支持的平台（用于平台分类筛选；Web 表示仅网页/无独立客户端） */
  platforms: AgentPlatform[]
  /** 月访问量/月活量级（百万次），用于由高到低排序 */
  usage: number
  /** 使用量展示文案 */
  usageLabel: string
}

const icon = (id: string) => `/agent-icons/${id}.png`

export const AGENT_TOOLS: AgentTool[] = [
  // ==================== 国内 · 可签到 ====================
  {
    id: 'doubao', name: '豆包', nameEn: 'Doubao', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://www.doubao.com/', checkinUrl: 'https://www.doubao.com/',
    checkinTip: '电脑版左下角签到窗，或头像 →「免费用豆包」；每日 200 额度、周一翻倍，30 天累计约 8800；额度 30 天有效，手机端无入口。',
    icon: icon('doubao'), color: '#f04142', desc: '字节跳动的 AI 助手，对话、写作、绘图、PPT 一站式，电脑版「豆包工作」可操作本地文件。',
    localApp: { bundleIds: ['com.bot.pc.doubao'], exeNames: ['Doubao.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 382, usageLabel: '月活约 3.82 亿',
  },
  {
    id: 'yuanbao', name: '腾讯元宝', nameEn: 'Tencent Yuanbao', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://yuanbao.tencent.com/', checkinUrl: 'https://yuanbao.tencent.com/',
    checkinTip: '手机 App →「福利中心」每日签到攒积分，可兑话费券、视频会员等；积分有有效期，以 App 实时页面为准。',
    icon: icon('yuanbao'), color: '#4f6bfe', desc: '腾讯旗下 AI 助手，全功能免费，支持文档处理、AI 搜索与多模态生成。',
    localApp: { bundleIds: ['com.tencent.yuanbao', 'com.tencent.Yuanbao'], exeNames: ['Yuanbao.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 57, usageLabel: '月活约 5695 万',
  },
  {
    id: 'workbuddy', name: 'WorkBuddy', nameEn: 'WorkBuddy', region: 'cn', category: '综合办公', canCheckin: true,
    downloadUrl: 'https://www.workbuddy.cn/', checkinUrl: 'https://www.workbuddy.cn/',
    checkinTip: '客户端左下角头像 →「Buddy 加油站」每日签到，每日 100 积分，连签 7/14/28 天有额外奖励；积分当月有效，手机端无入口。',
    icon: icon('workbuddy'), color: '#00b96b', desc: '腾讯出品的 AI Agent 办公工作台，本地文件批处理、定时任务、手机远程控电脑。',
    localApp: { bundleIds: ['com.tencent.workbuddy.mac'], exeNames: ['WorkBuddy.exe'] },
    platforms: ['Windows', 'macOS'], usage: 12, usageLabel: '办公 Agent 新秀',
  },
  {
    id: 'zhipu', name: '智谱清言', nameEn: 'ChatGLM', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://chatglm.cn/', checkinUrl: 'https://chatglm.cn/',
    checkinTip: '网页/App 每日登录领积分，连续登录有额外奖励；积分规则以账户页实时显示为准。',
    icon: icon('zhipu'), color: '#3859ff', desc: '智谱 AI 的对话助手，基于 GLM 模型，支持长文本、文件解析与智能体。',
    localApp: { bundleIds: ['com.zhihuishu.chatglm', 'com.zhipu.chatglm'], exeNames: ['ChatGLM.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 72, usageLabel: '月活约 7200 万',
  },
  {
    id: 'minimax', name: 'MiniMax Code', nameEn: 'MiniMax Code', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://agent.minimax.cn/', checkinUrl: 'https://agent.minimax.cn/',
    checkinTip: 'MiniMax Code / Agent 登录后进「用量」页 → 每日签到，每日 400 积分，第 4/7 天各 1000，满一周 4000；积分 30 天有效。签到需手动点，不会自动到账。',
    icon: icon('minimax'), color: '#0f172a', desc: '稀宇科技旗下 AI Agent，海螺视频、语音合成与深度研究一体；签到在 MiniMax Code。',
    platforms: ['Web', 'Windows', 'macOS'], usage: 38, usageLabel: '月活约 3800 万',
  },
  {
    id: 'yiyan', name: '文心一言', nameEn: 'ERNIE Bot', region: 'cn', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://yiyan.baidu.com/', checkinUrl: 'https://yiyan.baidu.com/',
    checkinTip: 'App「我的」→ 每日签到，或网页头像菜单 → 签到；按连续天数发放充电值，规则以官方页面为准。',
    icon: icon('yiyan'), color: '#4e6ef2', desc: '百度的 AI 助手，基于文心大模型，支持多模态问答与插件生态。',
    localApp: { bundleIds: ['com.baidu.wenxin', 'com.baidu.yiyan'], exeNames: ['Yiyan.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 121, usageLabel: '月活约 1.21 亿',
  },
  {
    id: 'metaso', name: '秘塔 AI 搜索', nameEn: 'Metaso', region: 'cn', category: 'AI 搜索', canCheckin: true,
    downloadUrl: 'https://metaso.cn/', checkinUrl: 'https://metaso.cn/',
    checkinTip: '每日登录领约 500 积分，仅当日有效；深度研究约消耗 20–30 积分/次。规则以官网为准。',
    icon: icon('metaso'), color: '#1480f5', desc: '以深度搜索和学术研究著称的 AI 搜索引擎，自动整理来源生成综述。',
    platforms: ['Web', 'iOS', 'Android'], usage: 15, usageLabel: '搜索新锐',
  },
  {
    id: 'trae', name: 'Trae', nameEn: 'Trae', region: 'cn', category: '编程开发', canCheckin: true,
    downloadUrl: 'https://www.trae.cn/', checkinUrl: 'https://www.trae.cn/',
    checkinTip: '免费版账户菜单 →「签到」，每日约 100 积分；积分与规则以客户端账户页为准。',
    icon: icon('trae'), color: '#3b82f6', desc: '字节跳动的 AI 原生 IDE，Builder 模式可从自然语言直接生成完整项目。',
    localApp: { bundleIds: ['com.trae.app', 'com.trae.ide'], exeNames: ['Trae.exe'] },
    platforms: ['Windows', 'macOS'], usage: 9, usageLabel: 'AI IDE 新秀',
  },
  {
    id: 'qoder', name: '通义灵码 / Qoder', nameEn: 'Qoder', region: 'cn', category: '编程开发', canCheckin: true,
    downloadUrl: 'https://qoder.com/', checkinUrl: 'https://qoder.com/',
    checkinTip: '桌面客户端每日约 100 Credits，学生教师另有额度；具体以客户端账户页为准。',
    icon: icon('qoder'), color: '#615ced', desc: '阿里旗下 AI 编程工具，代码补全、Agent 模式与仓库级理解。',
    localApp: { bundleIds: ['com.alibaba.qoder', 'com.qoder.app'], exeNames: ['Qoder.exe'] },
    platforms: ['Windows', 'macOS'], usage: 34, usageLabel: '月活约 3400 万',
  },
  {
    id: 'coze', name: '扣子', nameEn: 'Coze', region: 'cn', category: 'Agent 平台', canCheckin: true,
    downloadUrl: 'https://www.coze.cn/', checkinUrl: 'https://www.coze.cn/',
    checkinTip: '每日登录领活动积分（约 1500 点，7 天有效），用于 Bot 对话与工作流调用；规则以官网活动页为准。',
    icon: icon('coze'), color: '#1a1a1a', desc: '字节跳动的 AI Agent 搭建平台，工作流、插件、知识库一应俱全，支持发布到飞书/微信。',
    platforms: ['Web'], usage: 20, usageLabel: 'Agent 平台头部',
  },

  // ==================== 国内 · 无签到 ====================
  {
    id: 'qianwen', name: '通义千问', nameEn: 'Qwen', region: 'cn', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://qianwen.com/', icon: icon('tongyi'), color: '#615ced',
    benefitTip: '个人版对话、文档解析基本不限量，生视频每日约 15 次。无每日签到。',
    desc: '阿里云的大模型助手，表格清洗、文档解析与 Qwen Code 编程一应俱全。',
    localApp: { bundleIds: ['com.alibaba.qwen', 'com.aliyun.tongyi'], exeNames: ['Tongyi.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 167, usageLabel: '月活约 1.67 亿',
  },
  {
    id: 'deepseek', name: 'DeepSeek', nameEn: 'DeepSeek', region: 'cn', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://www.deepseek.com/', icon: icon('deepseek'), color: '#4d6bfe',
    benefitTip: '网页版与 App 基础对话免费，API 按量计费。无每日签到。',
    desc: '深度求索的推理大模型，代码与数学能力强，API 价格亲民。',
    localApp: { bundleIds: ['com.deepseek.dsh', 'com.deepseek.chat'], exeNames: ['DeepSeek.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 130, usageLabel: '月活约 1.30 亿',
  },
  {
    id: 'kimi', name: 'Kimi', nameEn: 'Kimi', region: 'cn', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://www.kimi.com/', icon: icon('kimi'), color: '#1a1a1a',
    benefitTip: '基础对话与长文档阅读免费；Kimi Agent 每月约 6 次免费任务。无每日签到。',
    desc: '月之暗面出品，长文本处理见长，支持超长文档阅读与深度研究。',
    localApp: { bundleIds: ['com.moonshot.kimichat', 'com.moonshot.Kimi'], exeNames: ['Kimi.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 29, usageLabel: '月访问约 2900 万',
  },
  {
    id: 'kling', name: '可灵', nameEn: 'Kling', region: 'cn', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://klingai.kuaishou.com/', icon: icon('kling'), color: '#ff6600',
    benefitTip: '每日赠送免费灵感值用于生成，属每日额度而非签到；以官网账户页为准。',
    desc: '快手推出的 AI 视频生成工具，支持文生视频、图生视频与运镜控制。',
    platforms: ['Web', 'iOS', 'Android'], usage: 47, usageLabel: '月活约 4700 万',
  },
  {
    id: 'jimeng', name: '即梦', nameEn: 'Jimeng', region: 'cn', category: '图像设计', canCheckin: false,
    downloadUrl: 'https://jimeng.jianying.com/', icon: icon('jimeng'), color: '#ec4899',
    benefitTip: '每日赠送免费积分用于生图/生视频，属每日额度而非签到；以官方页面为准。',
    desc: '字节跳动旗下创作工具，AI 绘画、视频生成与数字人一站式。',
    platforms: ['Web', 'iOS', 'Android'], usage: 55, usageLabel: '月活约 5500 万',
  },
  {
    id: 'hailuo', name: '海螺 AI', nameEn: 'Hailuo AI', region: 'cn', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://hailuoai.com/', icon: icon('hailuo'), color: '#2563eb',
    benefitTip: '提供每日免费生成额度，属免费层而非签到；具体以官网为准。',
    desc: 'MiniMax 旗下视频与语音创作平台，图生视频效果出色。',
    platforms: ['Web', 'iOS', 'Android'], usage: 25, usageLabel: '视频创作热门',
  },
  {
    id: 'nami', name: '纳米 AI 搜索', nameEn: 'Nami AI', region: 'cn', category: 'AI 搜索', canCheckin: false,
    downloadUrl: 'https://www.n.cn/', icon: icon('nami'), color: '#e11d48',
    benefitTip: '基础搜索免费使用，多智能体协作需会员。无每日签到。',
    desc: '360 推出的 AI 搜索，支持多智能体协同完成复杂调研任务。',
    platforms: ['Web', 'Windows', 'macOS', 'iOS', 'Android'], usage: 41, usageLabel: '月活约 4100 万',
  },
  {
    id: 'tiangong', name: '天工 AI', nameEn: 'Tiangong AI', region: 'cn', category: '综合办公', canCheckin: false,
    downloadUrl: 'https://www.tiangong.cn/', icon: icon('tiangong'), color: '#7c3aed',
    benefitTip: '基础对话与搜索免费，深度研究按次计费。无每日签到。',
    desc: '昆仑万维的 AI 助手，擅长搜索、写作、PPT 与音乐生成。',
    platforms: ['Web', 'iOS', 'Android'], usage: 31, usageLabel: '月活约 3100 万',
  },

  // ==================== 海外 · 可签到 ====================
  {
    id: 'genspark', name: 'Genspark', nameEn: 'Genspark', region: 'global', category: '综合办公', canCheckin: true,
    downloadUrl: 'https://www.genspark.ai/', checkinUrl: 'https://www.genspark.ai/',
    checkinTip: '免费版每日 100 积分，邀请好友再得积分；登录后自动发放，规则以官网为准。',
    icon: icon('genspark'), color: '#111827', desc: '一站式 AI 工作台，多模型对话、深度研究、文档与幻灯片生成。',
    platforms: ['Web', 'iOS', 'Android'], usage: 35, usageLabel: '月访问约 3490 万',
  },
  {
    id: 'poe', name: 'Poe', nameEn: 'Poe', region: 'global', category: '对话助手', canCheckin: true,
    downloadUrl: 'https://poe.com/', checkinUrl: 'https://poe.com/',
    checkinTip: '免费用户每日 300 compute points，登录自动发放；额度近年已缩减，以官网为准。',
    icon: icon('poe'), color: '#0f172a', desc: 'Quora 旗下 AI 聚合平台，一个入口切换 GPT、Claude、Gemini 等主流模型。',
    platforms: ['Web', 'iOS', 'Android'], usage: 7, usageLabel: '月访问约 670 万',
  },
  {
    id: 'monica', name: 'Monica', nameEn: 'Monica', region: 'global', category: '效率工具', canCheckin: true,
    downloadUrl: 'https://monica.im/', checkinUrl: 'https://monica.im/',
    checkinTip: '免费版每日约 40 次基础查询，登录领取；高级查询与 Deep Research 次数有限。',
    icon: icon('monica'), color: '#2563eb', desc: '浏览器 AI 助手插件，侧边栏一键总结网页、PDF、YouTube 与深度搜索。',
    platforms: ['浏览器插件', 'Web', 'iOS', 'Android'], usage: 43, usageLabel: '月活约 4300 万',
  },
  {
    id: 'anygen', name: 'AnyGen', nameEn: 'AnyGen', region: 'global', category: '综合办公', canCheckin: true,
    downloadUrl: 'https://www.anygen.io/', checkinUrl: 'https://www.anygen.io/',
    checkinTip: '每日登录领 200 积分，可累积不清零；邀请好友每人 1000 积分。规则以官网为准。',
    icon: icon('anygen'), color: '#0ea5e9', desc: '字节海外版交付型 Agent，擅长 PPT、文档、数据分析与网页生成。',
    platforms: ['Web'], usage: 6, usageLabel: '海外 Agent 新秀',
  },
  {
    id: 'manus', name: 'Manus', nameEn: 'Manus', region: 'global', category: 'Agent 平台', canCheckin: true,
    downloadUrl: 'https://manus.im/', checkinUrl: 'https://manus.im/',
    checkinTip: '所有用户每日可免费执行一项任务（约 300 积分），UTC 0 点重置；注册一次性赠 1000 积分。属每日任务额度，非手动签到按钮。',
    icon: icon('manus'), color: '#111827', desc: '通用型 AI Agent，自动拆解任务、调用工具并交付完整成果。',
    platforms: ['Web', 'iOS', 'Android'], usage: 29, usageLabel: '月访问约 2930 万',
  },

  // ==================== 海外 · 无签到 ====================
  {
    id: 'chatgpt', name: 'ChatGPT', nameEn: 'ChatGPT', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://chatgpt.com/', icon: icon('chatgpt'), color: '#10a37f',
    benefitTip: '免费用户有限次调用模型，达上限自动降级；图像生成每日约 2–3 张。无每日签到。',
    desc: 'OpenAI 的旗舰助手，对话、数据分析、图像生成与深度研究。',
    localApp: { bundleIds: ['com.openai.codex', 'com.openai.chatgpt'], exeNames: ['ChatGPT.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 5320, usageLabel: '月访问约 53 亿',
  },
  {
    id: 'gemini', name: 'Gemini', nameEn: 'Google Gemini', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://gemini.google.com/', icon: icon('gemini'), color: '#4285f4',
    benefitTip: 'Flash 模式文本对话基本不限量，Pro 每日有限次，Deep Research 每月约 5 份。无签到。',
    desc: 'Google 的多模态 AI 助手，深度集成 Gmail、Drive 与搜索。',
    localApp: { bundleIds: ['com.google.GeminiMacOS', 'com.google.gemini'], exeNames: ['Gemini.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 1140, usageLabel: '月访问约 11.4 亿',
  },
  {
    id: 'claude', name: 'Claude', nameEn: 'Claude', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://claude.ai/', icon: icon('claude'), color: '#d97757',
    benefitTip: '免费版按用量限额使用，无每日签到；Pro 订阅解锁更高额度。',
    desc: 'Anthropic 的 AI 助手，长文本与代码能力出色，支持 Projects 与 artifacts。',
    localApp: { bundleIds: ['com.anthropic.claudefordesktop'], exeNames: ['Claude.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 968, usageLabel: '月访问约 9.68 亿',
  },
  {
    id: 'canva', name: 'Canva', nameEn: 'Canva', region: 'global', category: '图像设计', canCheckin: false,
    downloadUrl: 'https://www.canva.com/', icon: icon('canva'), color: '#00c4cc',
    benefitTip: '免费版模板与素材丰富，部分高级素材需订阅；无每日签到。',
    desc: '在线设计平台，AI 生图、抠图、文案与演示文稿一站完成。',
    localApp: { bundleIds: ['com.canva.CanvaDesktop'], exeNames: ['Canva.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 760, usageLabel: '月访问约 7.6 亿',
  },
  {
    id: 'grok', name: 'Grok', nameEn: 'Grok', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://grok.com/', icon: icon('grok'), color: '#1a1a1a',
    benefitTip: '免费版有限次请求，实时接入 X 平台信息。无每日签到。',
    desc: 'xAI 旗下助手，擅长实时资讯与幽默风格对话。',
    localApp: { bundleIds: ['com.xai.grok', 'com.xai.Grok'], exeNames: ['Grok.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 190, usageLabel: '月访问约 1.9 亿',
  },
  {
    id: 'character-ai', name: 'Character.AI', nameEn: 'Character.AI', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://character.ai/', icon: icon('character-ai'), color: '#6d5efc',
    benefitTip: '免费版有限次对话，角色陪伴与创作；无每日签到。',
    desc: '虚拟角色对话平台，可自定义 AI 角色进行陪伴与角色扮演。',
    platforms: ['Web', 'iOS', 'Android'], usage: 166, usageLabel: '月访问约 1.66 亿',
  },
  {
    id: 'deepl', name: 'DeepL', nameEn: 'DeepL', region: 'global', category: '翻译写作', canCheckin: false,
    downloadUrl: 'https://www.deepl.com/', icon: icon('deepl'), color: '#0a2540',
    benefitTip: '免费版有限次翻译，Pro 解锁全文与文档翻译；无每日签到。',
    desc: '高质量神经机器翻译，支持多语种文本与文档互译。',
    localApp: { bundleIds: ['com.deepl.Linguist', 'com.deepl.DeepL'], exeNames: ['DeepL.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 145, usageLabel: '月访问约 1.45 亿',
  },
  {
    id: 'perplexity', name: 'Perplexity', nameEn: 'Perplexity', region: 'global', category: 'AI 搜索', canCheckin: false,
    downloadUrl: 'https://www.perplexity.ai/', icon: icon('perplexity'), color: '#20808d',
    benefitTip: '基础搜索免费，Pro 深度搜索每 4 小时约 5 次。无每日签到。',
    desc: 'AI 搜索标杆，回答附引用来源，可溯源性强。',
    platforms: ['Web', 'iOS', 'Android'], usage: 141, usageLabel: '月访问约 1.41 亿',
  },
  {
    id: 'copilot', name: 'Microsoft Copilot', nameEn: 'Microsoft Copilot', region: 'global', category: '对话助手', canCheckin: false,
    downloadUrl: 'https://copilot.microsoft.com/', icon: icon('copilot'), color: '#0f6cbd',
    benefitTip: '免费版有限次对话与图像生成，集成 Bing 搜索。无每日签到。',
    desc: '微软的 AI 助手，深度嵌入 Windows、Office 与 Edge 浏览器。',
    localApp: { bundleIds: ['com.microsoft.copilot'], exeNames: ['Copilot.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 93, usageLabel: '月访问约 9270 万',
  },
  {
    id: 'suno', name: 'Suno', nameEn: 'Suno', region: 'global', category: '音乐音频', canCheckin: false,
    downloadUrl: 'https://suno.com/', icon: icon('suno'), color: '#8b5cf6',
    benefitTip: '免费版每日有少量生成额度，属免费层；无每日签到。',
    desc: '输入文字即可生成完整歌曲（含人声与编曲）的 AI 音乐工具。',
    platforms: ['Web'], usage: 82, usageLabel: '月访问约 8180 万',
  },
  {
    id: 'capcut', name: '剪映 / CapCut', nameEn: 'CapCut', region: 'global', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://www.capcut.com/', icon: icon('capcut'), color: '#111827',
    benefitTip: '免费版功能丰富，部分特效/素材需会员；无每日签到。',
    desc: '字节旗下视频剪辑工具，AI 字幕、去背景、特效与模板一应俱全。',
    localApp: { bundleIds: ['com.lemon.lv', 'com.capcut.CapCut'], exeNames: ['CapCut.exe', 'JianyingPro.exe'] },
    platforms: ['Windows', 'macOS', 'iOS', 'Android', 'Web'], usage: 69, usageLabel: '月访问约 6860 万',
  },
  {
    id: 'notebooklm', name: 'NotebookLM', nameEn: 'NotebookLM', region: 'global', category: '效率工具', canCheckin: false,
    downloadUrl: 'https://notebooklm.google.com/', icon: icon('notebooklm'), color: '#4285f4',
    benefitTip: '免费版可上传资料生成摘要、播客与问答；无每日签到。',
    desc: 'Google 的 AI 笔记本，基于你上传的资料做摘要、问答与音频概览。',
    platforms: ['Web'], usage: 67, usageLabel: '月访问约 6650 万',
  },
  {
    id: 'removebg', name: 'Remove.bg', nameEn: 'Remove.bg', region: 'global', category: '图像设计', canCheckin: false,
    downloadUrl: 'https://www.remove.bg/', icon: icon('removebg'), color: '#5b21b6',
    benefitTip: '免费版有限次抠图，按量或订阅解锁更多；无每日签到。',
    desc: '一键自动去除图片背景的在线工具，支持批量与 API。',
    platforms: ['Web'], usage: 63, usageLabel: '月访问约 6300 万',
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', nameEn: 'ElevenLabs', region: 'global', category: '音乐音频', canCheckin: false,
    downloadUrl: 'https://elevenlabs.io/', icon: icon('elevenlabs'), color: '#111827',
    benefitTip: '免费版每月有限额字符， prosody 与克隆需订阅；无每日签到。',
    desc: '高仿真 AI 语音合成与音色克隆，支持多语种配音。',
    platforms: ['Web'], usage: 55, usageLabel: '月访问约 5490 万',
  },
  {
    id: 'lovable', name: 'Lovable', nameEn: 'Lovable', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://lovable.dev/', icon: icon('lovable'), color: '#a855f7',
    benefitTip: '免费版有少量生成额度，属免费层；无每日签到。',
    desc: '用自然语言快速生成网页应用并一键部署的 AI 编程工具。',
    platforms: ['Web'], usage: 50, usageLabel: '月访问约 5000 万',
  },
  {
    id: 'grammarly', name: 'Grammarly', nameEn: 'Grammarly', region: 'global', category: '翻译写作', canCheckin: false,
    downloadUrl: 'https://www.grammarly.com/', icon: icon('grammarly'), color: '#15c39a',
    benefitTip: '免费版基础语法检查，高级改写需订阅；无每日签到。',
    desc: '英文写作辅助工具，语法纠错、润色与语气调整。',
    localApp: { bundleIds: ['com.grammarly.Grammarly'], exeNames: ['Grammarly.exe'] },
    platforms: ['Windows', 'macOS', '浏览器插件', 'Web'], usage: 46, usageLabel: '月访问约 4550 万',
  },
  {
    id: 'quillbot', name: 'QuillBot', nameEn: 'QuillBot', region: 'global', category: '翻译写作', canCheckin: false,
    downloadUrl: 'https://quillbot.com/', icon: icon('quillbot'), color: '#7c3aed',
    benefitTip: '免费版有限次改写，订阅解锁全部模式；无每日签到。',
    desc: 'AI 改写与释义工具，支持语法检查、总结与查重。',
    platforms: ['Web', '浏览器插件'], usage: 33, usageLabel: '月访问约 3270 万',
  },
  {
    id: 'cursor', name: 'Cursor', nameEn: 'Cursor', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://cursor.com/', icon: icon('cursor'), color: '#111827',
    benefitTip: '免费版有有限次高级请求额度，属免费层而非签到。',
    desc: 'AI 原生代码编辑器，Tab 补全、Composer 多文件编辑与 Agent 模式。',
    localApp: { bundleIds: ['com.todesktop.230313mzl4w4u92', 'com.cursor.Cursor'], exeNames: ['Cursor.exe'] },
    platforms: ['Windows', 'macOS', 'Linux'], usage: 27, usageLabel: '月访问约 2720 万',
  },
  {
    id: 'github-copilot', name: 'GitHub Copilot', nameEn: 'GitHub Copilot', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://github.com/features/copilot', icon: icon('github-copilot'), color: '#24292f',
    benefitTip: '个人用户每月有免费补全与对话额度，超出需订阅。无每日签到。',
    desc: 'GitHub 的 AI 编程助手，代码补全、聊天与 Agent 模式。',
    localApp: { bundleIds: ['com.github.copilot'], exeNames: ['GitHub Copilot.exe'] },
    platforms: ['Windows', 'macOS', '浏览器插件'], usage: 22, usageLabel: '开发者广泛使用',
  },
  {
    id: 'gamma', name: 'Gamma', nameEn: 'Gamma', region: 'global', category: '效率工具', canCheckin: false,
    downloadUrl: 'https://gamma.app/', icon: icon('gamma'), color: '#6d28d9',
    benefitTip: '免费版有限次生成，订阅解锁更多额度；无每日签到。',
    desc: '输入主题即可自动生成精美演示文稿、文档与网页。',
    platforms: ['Web'], usage: 22, usageLabel: '月访问约 2190 万',
  },
  {
    id: 'replit', name: 'Replit', nameEn: 'Replit', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://replit.com/', icon: icon('replit'), color: '#f26207',
    benefitTip: '免费版有基础算力，Agent 应用生成需订阅；无每日签到。',
    desc: '在线编程与部署平台，Agent 可从零生成完整应用。',
    platforms: ['Web', 'iOS', 'Android'], usage: 18, usageLabel: '月访问约 1790 万',
  },
  {
    id: 'heygen', name: 'HeyGen', nameEn: 'HeyGen', region: 'global', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://www.heygen.com/', icon: icon('heygen'), color: '#5b4bdb',
    benefitTip: '免费版有限次视频生成，订阅解锁更多；无每日签到。',
    desc: 'AI 数字人视频生成，文本转虚拟主播口播视频。',
    platforms: ['Web'], usage: 17, usageLabel: '月访问约 1700 万',
  },
  {
    id: 'leonardo', name: 'Leonardo.Ai', nameEn: 'Leonardo.Ai', region: 'global', category: '图像设计', canCheckin: false,
    downloadUrl: 'https://leonardo.ai/', icon: icon('leonardo'), color: '#0f172a',
    benefitTip: '免费版每日有免费代币，属每日额度；无每日签到。',
    desc: '面向创作者的 AI 图像生成平台，风格模型与精细控制丰富。',
    platforms: ['Web'], usage: 18, usageLabel: '月访问约 1800 万',
  },
  {
    id: 'midjourney', name: 'Midjourney', nameEn: 'Midjourney', region: 'global', category: '图像设计', canCheckin: false,
    downloadUrl: 'https://www.midjourney.com/', icon: icon('midjourney'), color: '#111827',
    benefitTip: '订阅制服务，偶有免费体验活动，无常驻签到机制。',
    desc: '高质量 AI 图像生成工具，艺术风格与美感表现突出。',
    platforms: ['Web'], usage: 11, usageLabel: '月访问约 1050 万',
  },
  {
    id: 'runway', name: 'Runway', nameEn: 'Runway', region: 'global', category: '视频创作', canCheckin: false,
    downloadUrl: 'https://runwayml.com/', icon: icon('runway'), color: '#1e293b',
    benefitTip: '免费版有有限生成额度，属免费层而非签到。',
    desc: 'AI 视频生成与编辑平台，支持视频到视频、绿幕与运动追踪。',
    platforms: ['Web'], usage: 9, usageLabel: '月访问约 860 万',
  },
  {
    id: 'windsurf', name: 'Windsurf', nameEn: 'Windsurf', region: 'global', category: '编程开发', canCheckin: false,
    downloadUrl: 'https://windsurf.com/', icon: icon('windsurf'), color: '#0ea5e9',
    benefitTip: '免费版有有限次高级交互额度，属免费层而非签到。',
    desc: 'AI 编程 IDE，Cascade 流式协作擅长跨文件重构。',
    localApp: { bundleIds: ['com.exafunction.windsurf'], exeNames: ['Windsurf.exe'] },
    platforms: ['Windows', 'macOS'], usage: 8, usageLabel: 'AI IDE 热门',
  },
]

export const REGION_LABEL: Record<AgentRegion, string> = { cn: '国内工具', global: '海外工具' }
export const CATEGORY_TAGS: AgentCategory[] = [
  '综合办公', '对话助手', '编程开发', 'AI 搜索', '图像设计', '视频创作',
  'Agent 平台', '音乐音频', '翻译写作', '效率工具',
]
export const PLATFORM_TAGS: AgentPlatform[] = ['Windows', 'macOS', 'Linux', 'iOS', 'Android', 'Web', '浏览器插件']

export const CHECKIN_TOOLS = AGENT_TOOLS.filter(t => t.canCheckin)
