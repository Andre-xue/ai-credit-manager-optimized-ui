// 内置平台目录：官方链接 + 数据获取方式。所有链接均为官方域名，跳转由用户本人操作。
// apiKeyUrl 优先使用官方稳定根域名（官方会路由到最新 Key 管理页），避免深路径改版失效。
// 按「模型功能」分类组织：文本大模型 / 编程 / 图像 / 视频 / 语音音频 / 搜索 / 设计 / 嵌入向量 / 其他。
// dailyCheckin 仅标记官方确有「每日签到领积分」的平台（如 WorkBuddy Buddy 加油站、豆包电脑版签到）。
import type { ProviderDefinition } from '../core/types'

export const PROVIDERS: ProviderDefinition[] = [
  // ==================== 文本大模型 ====================
  {
    id: 'openai', name: 'OpenAI', shortName: 'OpenAI', category: 'llm',
    officialUrl: 'https://platform.openai.com/', usageUrl: 'https://platform.openai.com/usage',
    color: '#10a37f', initials: 'OA', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    note: '官方 Usage API 可用（需 Admin Key），仅只读查询。',
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', shortName: 'Claude', category: 'llm',
    officialUrl: 'https://console.anthropic.com/', usageUrl: 'https://console.anthropic.com/settings/usage',
    color: '#d97757', initials: 'CL', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.anthropic.com/v1',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    note: '控制台可查看用量；Admin API 需单独申请。',
  },
  {
    id: 'gemini', name: 'Google Gemini', shortName: 'Gemini', category: 'llm',
    officialUrl: 'https://ai.google.dev/', usageUrl: 'https://aistudio.google.com/app/apikey',
    color: '#4285f4', initials: 'GE', modes: ['manual'],
    checkinUrl: 'https://aistudio.google.com/app/apikey',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    note: 'AI Studio 提供免费额度，无公开用量 API，走手动录入。',
  },
  {
    id: 'deepseek', name: 'DeepSeek', shortName: 'DeepSeek', category: 'llm',
    officialUrl: 'https://platform.deepseek.com/', usageUrl: 'https://platform.deepseek.com',
    color: '#4d6bfe', initials: 'DS', modes: ['manual'],
    checkinUrl: 'https://platform.deepseek.com/top_up',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    note: '控制台查看余额，无公开用量 API。',
  },
  {
    id: 'qwen', name: '通义千问', shortName: '通义', category: 'llm',
    officialUrl: 'https://bailian.console.aliyun.com/', usageUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/market',
    color: '#615ced', initials: '通', modes: ['manual'],
    checkinUrl: 'https://bailian.console.aliyun.com/',
    // 阿里云百炼新版业务空间专属域名；{WorkspaceId} 请在控制台「业务空间详情」查看后替换
    apiBaseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    note: 'API 地址中的 {WorkspaceId} 需替换为你的业务空间 ID；旧 dashscope.aliyuncs.com 域名仍可用。',
  },
  {
    id: 'kim', name: 'Moonshot Kimi', shortName: 'Kimi', category: 'llm',
    officialUrl: 'https://platform.moonshot.cn/', usageUrl: 'https://platform.moonshot.cn',
    color: '#1a1a1a', initials: 'K', modes: ['manual'],
    checkinUrl: 'https://platform.moonshot.cn/console/info',
    apiBaseUrl: 'https://api.moonshot.cn/v1',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
    note: '控制台查看余额与用量。',
  },
  {
    id: 'doubao', name: '豆包 / 火山方舟', shortName: '豆包', category: 'llm',
    officialUrl: 'https://www.doubao.com/', usageUrl: 'https://console.volcengine.com/ark',
    color: '#f04142', initials: '豆', modes: ['manual'],
    // 签到在豆包电脑版客户端内（左下角签到窗 / 头像 →「免费用豆包」），官网是唯一稳定官方入口
    checkinUrl: 'https://www.doubao.com/',
    dailyCheckin: true,
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    note: '官方签到：电脑版左下角签到窗 / 头像 →「免费用豆包」，每日 200 额度、周一翻倍，30 天累计 8800（额度 30 天有效，手机端无入口）。API 用量在火山方舟控制台查看。',
  },
  {
    id: 'workbuddy', name: 'WorkBuddy', shortName: 'WorkBuddy', category: 'llm',
    officialUrl: 'https://www.workbuddy.cn/',
    apiKeyUrl: 'https://www.workbuddy.cn/', usageUrl: 'https://www.workbuddy.cn/',
    color: '#0052d9', initials: 'WB', modes: ['manual'],
    // 签到在客户端左下角头像 →「Buddy 加油站」，官网是唯一稳定官方入口
    checkinUrl: 'https://www.workbuddy.cn/',
    dailyCheckin: true,
    note: '官方签到：客户端左下角头像 →「Buddy 加油站」，每日 100 积分，连签 7/14/28 天有额外奖励（积分当月有效，手机端无入口）。',
  },
  {
    id: 'glm', name: '智谱 GLM', shortName: 'GLM', category: 'llm',
    officialUrl: 'https://bigmodel.cn', usageUrl: 'https://bigmodel.cn',
    color: '#3859ff', initials: 'G', modes: ['manual'],
    checkinUrl: 'https://bigmodel.cn',
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    note: '开放平台查看余额。',
  },
  {
    id: 'tencent', name: '腾讯云混元', shortName: '混元', category: 'llm',
    officialUrl: 'https://cloud.tencent.com/product/hunyuan', usageUrl: 'https://console.cloud.tencent.com/tokenhub',
    color: '#0052d9', initials: '腾', modes: ['manual'],
    apiBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKeyUrl: 'https://console.cloud.tencent.com/tokenhub',
    note: '腾讯云 TokenHub（混元 Hy 系列），OpenAI 兼容接口；控制台查看用量。',
  },
  {
    id: 'siliconflow', name: 'SiliconFlow 硅基流动', shortName: '硅基流动', category: 'llm',
    officialUrl: 'https://www.siliconflow.cn/', usageUrl: 'https://cloud.siliconflow.cn',
    color: '#7c3aed', initials: 'SF', modes: ['manual'],
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '聚合多模型平台，控制台查看余额，无公开用量 API。',
  },
  {
    id: 'baichuan', name: '百川智能', shortName: '百川', category: 'llm',
    officialUrl: 'https://platform.baichuan-ai.com/', usageUrl: 'https://platform.baichuan-ai.com',
    color: '#2563eb', initials: '百', modes: ['manual'],
    apiBaseUrl: 'https://api.baichuan-ai.com/v1',
    apiKeyUrl: 'https://platform.baichuan-ai.com/',
    note: '开放平台控制台查看用量。',
  },
  {
    id: 'minimax', name: 'MiniMax 稀宇', shortName: 'MiniMax', category: 'llm',
    officialUrl: 'https://www.minimaxi.com/', usageUrl: 'https://platform.minimaxi.com/user-center',
    color: '#0f172a', initials: 'MM', modes: ['manual'],
    apiBaseUrl: 'https://api.minimax.chat/v1',
    apiKeyUrl: 'https://platform.minimax.cn/console/keys',
    note: '开放平台控制台查看余额；也提供语音/视频模型。',
  },
  {
    id: 'stepfun', name: '阶跃星辰', shortName: '阶跃', category: 'llm',
    officialUrl: 'https://www.stepfun.com/', usageUrl: 'https://platform.stepfun.com',
    color: '#6366f1', initials: '阶', modes: ['manual'],
    apiBaseUrl: 'https://api.stepfun.com/v1',
    apiKeyUrl: 'https://platform.stepfun.com/interface-key',
    note: '阶跃星辰开放平台。',
  },
  {
    id: 'xai', name: 'xAI Grok', shortName: 'Grok', category: 'llm',
    officialUrl: 'https://x.ai/', usageUrl: 'https://console.x.ai/',
    color: '#111827', initials: 'X', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.x.ai/v1',
    apiKeyUrl: 'https://console.x.ai/',
    note: 'X 旗下 Grok 模型开放平台。',
  },
  {
    id: 'mistral', name: 'Mistral AI', shortName: 'Mistral', category: 'llm',
    officialUrl: 'https://mistral.ai/', usageUrl: 'https://console.mistral.ai/usage',
    color: '#fa500e', initials: 'MI', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.mistral.ai/v1',
    apiKeyUrl: 'https://console.mistral.ai/api-keys/',
    note: '欧洲开源模型厂商，控制台查看用量。',
  },
  {
    id: 'cohere', name: 'Cohere', shortName: 'Cohere', category: 'llm',
    officialUrl: 'https://cohere.com/', usageUrl: 'https://dashboard.cohere.com/',
    color: '#d0ff5e', initials: 'CO', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.cohere.com/v2',
    apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    note: '企业文本模型与嵌入。',
  },
  {
    id: 'groq', name: 'Groq', shortName: 'Groq', category: 'llm',
    officialUrl: 'https://groq.com/', usageUrl: 'https://console.groq.com/',
    color: '#f55036', initials: 'GR', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com/keys',
    note: '高速推理服务，控制台查看配额。',
  },
  {
    id: 'together', name: 'Together AI', shortName: 'Together', category: 'llm',
    officialUrl: 'https://www.together.ai/', usageUrl: 'https://api.together.ai/',
    color: '#f26522', initials: 'TA', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.together.xyz/v1',
    apiKeyUrl: 'https://api.together.ai/settings/api-keys',
    note: '多模型推理平台。',
  },
  {
    id: 'openrouter', name: 'OpenRouter', shortName: 'OpenRouter', category: 'llm',
    officialUrl: 'https://openrouter.ai/', usageUrl: 'https://openrouter.ai/activity',
    color: '#6366f1', initials: 'OR', modes: ['api', 'manual'],
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    note: '聚合多厂商模型的统一 API 网关。',
  },

  // ==================== 编程助手 ====================
  {
    id: 'cursor', name: 'Cursor', shortName: 'Cursor', category: 'code',
    officialUrl: 'https://cursor.com/', usageUrl: 'https://www.cursor.com/account/usage',
    color: '#111827', initials: 'CU', modes: ['subscription', 'manual'],
    apiBaseUrl: 'https://api.cursor.com/v1',
    apiKeyUrl: 'https://cursor.com/dashboard',
    note: '订阅账户在 Account 页查看用量。',
  },
  {
    id: 'copilot', name: 'GitHub Copilot', shortName: 'Copilot', category: 'code',
    officialUrl: 'https://github.com/features/copilot', usageUrl: 'https://github.com/settings/copilot',
    color: '#24292f', initials: 'GH', modes: ['subscription', 'manual'],
    apiBaseUrl: 'https://api.github.com',
    apiKeyUrl: 'https://github.com/settings/tokens',
    note: 'GitHub Settings 查看请求配额。',
  },
  {
    id: 'windsurf', name: 'Windsurf', shortName: 'Windsurf', category: 'code',
    officialUrl: 'https://windsurf.com/',
    apiKeyUrl: 'https://windsurf.com/', usageUrl: 'https://windsurf.com/account',
    color: '#0ea5e9', initials: 'WS', modes: ['subscription', 'manual'],
    note: 'AI 编程 IDE，订阅账户查看用量。',
  },
  {
    id: 'claude-code', name: 'Claude Code', shortName: 'Claude Code', category: 'code',
    officialUrl: 'https://www.anthropic.com/claude-code',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys', usageUrl: 'https://console.anthropic.com/settings/usage',
    color: '#d97757', initials: 'CC', modes: ['subscription', 'manual'],
    note: 'Anthropic 命令行编程助手，走 Claude 订阅额度。',
  },
  {
    id: 'codex', name: 'OpenAI Codex', shortName: 'Codex', category: 'code',
    officialUrl: 'https://openai.com/codex/',
    apiKeyUrl: 'https://platform.openai.com/api-keys', usageUrl: 'https://chatgpt.com/',
    color: '#10a37f', initials: 'CX', modes: ['subscription', 'manual'],
    note: 'OpenAI 编程 Agent，走 ChatGPT 订阅额度。',
  },
  {
    id: 'tabnine', name: 'Tabnine', shortName: 'Tabnine', category: 'code',
    officialUrl: 'https://www.tabnine.com/',
    apiKeyUrl: 'https://app.tabnine.com/', usageUrl: 'https://www.tabnine.com/account',
    color: '#1e293b', initials: 'TN', modes: ['subscription', 'manual'],
    note: '代码补全助手，订阅账户查看用量。',
  },
  {
    id: 'replit', name: 'Replit Agent', shortName: 'Replit', category: 'code',
    officialUrl: 'https://replit.com/',
    apiKeyUrl: 'https://replit.com/', usageUrl: 'https://replit.com/account',
    color: '#f26207', initials: 'RP', modes: ['subscription', 'manual'],
    note: '在线 IDE 与 AI Agent，订阅查看用量。',
  },
  {
    id: 'sourcegraph', name: 'Sourcegraph Cody', shortName: 'Cody', category: 'code',
    officialUrl: 'https://sourcegraph.com/cody',
    apiKeyUrl: 'https://sourcegraph.com/user/settings/tokens', usageUrl: 'https://sourcegraph.com/',
    color: '#4285f4', initials: 'CY', modes: ['subscription', 'manual'],
    note: '代码搜索与 AI 助手。',
  },

  // ==================== 图像生成 ====================
  {
    id: 'midjourney', name: 'Midjourney', shortName: 'MJ', category: 'image',
    officialUrl: 'https://www.midjourney.com/',
    apiKeyUrl: 'https://www.midjourney.com/', usageUrl: 'https://www.midjourney.com/account',
    color: '#111827', initials: 'MJ', modes: ['subscription', 'manual'],
    note: '订阅 Fast Hours 在 Account 页查看。',
  },
  {
    id: 'stability', name: 'Stability AI', shortName: 'Stability', category: 'image',
    officialUrl: 'https://stability.ai/', usageUrl: 'https://platform.stability.ai/account/credits',
    color: '#7c3aed', initials: 'ST', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.stability.ai/v2beta',
    apiKeyUrl: 'https://platform.stability.ai/account/keys',
    note: 'Stable Diffusion 系列图像模型。',
  },
  {
    id: 'ideogram', name: 'Ideogram', shortName: 'Ideogram', category: 'image',
    officialUrl: 'https://ideogram.ai/', usageUrl: 'https://ideogram.ai',
    color: '#ec4899', initials: 'ID', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.ideogram.ai/v1',
    apiKeyUrl: 'https://ideogram.ai/api-keys',
    note: '擅长文字渲染的图像生成模型。',
  },
  {
    id: 'leonardo', name: 'Leonardo AI', shortName: 'Leonardo', category: 'image',
    officialUrl: 'https://leonardo.ai/',
    apiKeyUrl: 'https://app.leonardo.ai/api-access', usageUrl: 'https://app.leonardo.ai/',
    color: '#8b5cf6', initials: 'LE', modes: ['subscription', 'manual'],
    note: '游戏/设计向图像生成，订阅查看 tokens。',
  },
  {
    id: 'dalle', name: 'DALL·E (OpenAI)', shortName: 'DALL·E', category: 'image',
    officialUrl: 'https://openai.com/dall-e-3/', usageUrl: 'https://platform.openai.com/usage',
    color: '#10a37f', initials: 'DE', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    note: 'OpenAI 图像生成，与 GPT API 共用额度。',
  },
  {
    id: 'flux', name: 'FLUX (Black Forest)', shortName: 'FLUX', category: 'image',
    officialUrl: 'https://blackforestlabs.ai/', usageUrl: 'https://bfl.ai',
    color: '#1e293b', initials: 'FX', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.bfl.ai/v1',
    apiKeyUrl: 'https://dashboard.bfl.ai/',
    note: '高质量开源图像生成模型。',
  },

  // ==================== 视频生成 ====================
  {
    id: 'sora', name: 'Sora (OpenAI)', shortName: 'Sora', category: 'video',
    officialUrl: 'https://openai.com/sora/',
    apiKeyUrl: 'https://platform.openai.com/api-keys', usageUrl: 'https://chatgpt.com/',
    color: '#111827', initials: 'SO', modes: ['subscription', 'manual'],
    note: 'OpenAI 视频生成，走 ChatGPT 订阅额度。',
  },
  {
    id: 'runway', name: 'Runway', shortName: 'Runway', category: 'video',
    officialUrl: 'https://runwayml.com/',
    apiKeyUrl: 'https://dev.runwayml.com/', usageUrl: 'https://app.runwayml.com/',
    color: '#1e293b', initials: 'RW', modes: ['subscription', 'manual'],
    note: 'AI 视频生成与编辑，订阅查看 credits。',
  },
  {
    id: 'pika', name: 'Pika', shortName: 'Pika', category: 'video',
    officialUrl: 'https://pika.art/',
    apiKeyUrl: 'https://pika.art/', usageUrl: 'https://pika.art/',
    color: '#8b5cf6', initials: 'PK', modes: ['subscription', 'manual'],
    note: 'AI 视频生成工具，订阅查看额度。',
  },
  {
    id: 'kling', name: '可灵 Kling', shortName: '可灵', category: 'video',
    officialUrl: 'https://klingai.kuaishou.com/',
    apiKeyUrl: 'https://klingai.kuaishou.com/', usageUrl: 'https://klingai.kuaishou.com/',
    color: '#ff6600', initials: 'KL', modes: ['subscription', 'manual'],
    note: '快手可灵 AI 视频生成。',
  },
  {
    id: 'hailuo', name: '海螺 AI', shortName: '海螺', category: 'video',
    officialUrl: 'https://hailuoai.com/',
    apiKeyUrl: 'https://platform.minimax.cn/console/keys', usageUrl: 'https://hailuoai.com/',
    color: '#2563eb', initials: 'HL', modes: ['subscription', 'manual'],
    note: 'MiniMax 旗下视频生成。',
  },

  // ==================== 语音 / 音频 ====================
  {
    id: 'elevenlabs', name: 'ElevenLabs', shortName: 'Eleven', category: 'voice',
    officialUrl: 'https://elevenlabs.io/', usageUrl: 'https://elevenlabs.io/app/settings/usage',
    color: '#111827', initials: 'EL', modes: ['manual'],
    checkinUrl: 'https://elevenlabs.io/app/subscription',
    apiBaseUrl: 'https://api.elevenlabs.io/v1',
    apiKeyUrl: 'https://elevenlabs.io/app/developers/api-keys',
    note: '控制台查看字符额度。',
  },
  {
    id: 'whisper', name: 'OpenAI Whisper', shortName: 'Whisper', category: 'voice',
    officialUrl: 'https://openai.com/research/whisper', usageUrl: 'https://platform.openai.com/usage',
    color: '#10a37f', initials: 'WH', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    note: '语音转文字，按音频时长计费。',
  },
  {
    id: 'deepgram', name: 'Deepgram', shortName: 'Deepgram', category: 'voice',
    officialUrl: 'https://deepgram.com/', usageUrl: 'https://console.deepgram.com/',
    color: '#7c3aed', initials: 'DG', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.deepgram.com/v1',
    apiKeyUrl: 'https://console.deepgram.com/',
    note: '实时语音识别与合成。',
  },
  {
    id: 'sunno', name: 'Suno AI', shortName: 'Suno', category: 'voice',
    officialUrl: 'https://suno.com/',
    apiKeyUrl: 'https://suno.com/', usageUrl: 'https://suno.com/',
    color: '#ec4899', initials: 'SU', modes: ['subscription', 'manual'],
    note: 'AI 音乐生成，订阅查看 credits。',
  },
  {
    id: 'udio', name: 'Udio', shortName: 'Udio', category: 'voice',
    officialUrl: 'https://www.udio.com/',
    apiKeyUrl: 'https://www.udio.com/', usageUrl: 'https://www.udio.com/',
    color: '#0ea5e9', initials: 'UD', modes: ['subscription', 'manual'],
    note: 'AI 音乐生成。',
  },

  // ==================== 搜索 / 研究 ====================
  {
    id: 'perplexity', name: 'Perplexity', shortName: 'PPLX', category: 'search',
    officialUrl: 'https://www.perplexity.ai/', usageUrl: 'https://www.perplexity.ai',
    color: '#20808d', initials: 'PX', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.perplexity.ai',
    apiKeyUrl: 'https://console.perplexity.ai/',
    note: 'API 账户可查看余额。',
  },
  {
    id: 'tavily', name: 'Tavily', shortName: 'Tavily', category: 'search',
    officialUrl: 'https://tavily.com/', usageUrl: 'https://app.tavily.com/',
    color: '#14b8a6', initials: 'TV', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.tavily.com',
    apiKeyUrl: 'https://app.tavily.com/home',
    note: '为 AI Agent 设计的搜索 API。',
  },
  {
    id: 'serpapi', name: 'SerpAPI', shortName: 'SerpAPI', category: 'search',
    officialUrl: 'https://serpapi.com/', usageUrl: 'https://serpapi.com/dashboard',
    color: '#f59e0b', initials: 'SP', modes: ['api', 'manual'],
    apiBaseUrl: 'https://serpapi.com',
    apiKeyUrl: 'https://serpapi.com/dashboard',
    note: '搜索引擎结果 API，按调用次数计费。',
  },
  {
    id: 'exa', name: 'Exa AI', shortName: 'Exa', category: 'search',
    officialUrl: 'https://exa.ai/', usageUrl: 'https://dashboard.exa.ai/',
    color: '#6366f1', initials: 'EX', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.exa.ai',
    apiKeyUrl: 'https://dashboard.exa.ai/api-keys',
    note: '神经搜索引擎 API。',
  },

  // ==================== 设计工具 ====================
  {
    id: 'figma', name: 'Figma AI', shortName: 'Figma', category: 'design',
    officialUrl: 'https://www.figma.com/', usageUrl: 'https://www.figma.com',
    color: '#f24e1e', initials: 'FG', modes: ['subscription', 'manual'],
    apiBaseUrl: 'https://api.figma.com/v1',
    apiKeyUrl: 'https://www.figma.com/settings',
    note: '订阅账户查看 AI 额度。',
  },
  {
    id: 'canva', name: 'Canva AI', shortName: 'Canva', category: 'design',
    officialUrl: 'https://www.canva.com/',
    apiKeyUrl: 'https://www.canva.dev/', usageUrl: 'https://www.canva.com/',
    color: '#00c4cc', initials: 'CV', modes: ['subscription', 'manual'],
    note: '在线设计工具，Magic Studio AI 功能。',
  },
  {
    id: 'adobe', name: 'Adobe Firefly', shortName: 'Firefly', category: 'design',
    officialUrl: 'https://www.adobe.com/products/firefly.html',
    apiKeyUrl: 'https://developer.adobe.com/', usageUrl: 'https://www.adobe.com/',
    color: '#ff0000', initials: 'AF', modes: ['subscription', 'manual'],
    note: 'Adobe 生成式 AI，订阅查看生成额度。',
  },

  // ==================== 嵌入 / 向量 ====================
  {
    id: 'voyage', name: 'Voyage AI', shortName: 'Voyage', category: 'embedding',
    officialUrl: 'https://www.voyageai.com/', usageUrl: 'https://dashboard.voyageai.com/',
    color: '#8b5cf6', initials: 'VA', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.voyageai.com/v1',
    apiKeyUrl: 'https://dashboard.voyageai.com/',
    note: '高质量嵌入与重排序模型。',
  },
  {
    id: 'jina', name: 'Jina AI', shortName: 'Jina', category: 'embedding',
    officialUrl: 'https://jina.ai/', usageUrl: 'https://jina.ai/',
    color: '#0ea5e9', initials: 'JA', modes: ['api', 'manual'],
    apiBaseUrl: 'https://api.jina.ai/v1',
    apiKeyUrl: 'https://jina.ai/api-dashboard',
    note: '嵌入、重排序与网页读取 API。',
  },

  // ==================== 本地部署模型 ====================
  // 说明：本地模型走独立添加页（路径 + 本机实时探测的网关端口），apiBaseUrl 留空。
  {
    id: 'local-ollama', name: 'Ollama（本地）', shortName: 'Ollama', category: 'local',
    officialUrl: 'https://ollama.com/',
    apiKeyUrl: 'https://ollama.com/', usageUrl: 'https://ollama.com/',
    color: '#ffffff', initials: 'OL', modes: ['api'],
    note: '本机 Ollama 服务，默认端口 11434；网关地址由本机实时探测，不可修改。',
  },
  {
    id: 'local-comfyui', name: 'ComfyUI（本地）', shortName: 'ComfyUI', category: 'local',
    officialUrl: 'https://github.com/comfyanonymous/ComfyUI',
    apiKeyUrl: 'https://github.com/Comfy-Org/ComfyUI', usageUrl: 'https://github.com/comfyanonymous/ComfyUI',
    color: '#1f9e7a', initials: 'CF', modes: ['api'],
    note: '本机 ComfyUI 服务，默认端口 8188；网关地址由本机实时探测，不可修改。',
  },
  {
    id: 'custom-endpoint', name: '自定义端点（OpenAI 兼容）', shortName: '自定义端点', category: 'llm',
    officialUrl: '', usageUrl: '',
    color: '#64748b', initials: '自', modes: ['api', 'manual'],
    note: '任意 OpenAI 兼容网关：填服务地址即可接入（如 dsh 独立网关、One API、LM Studio、本地转发端口）；Key 可留空，模型列表自动从端点拉取。',
  },

  // ==================== 语音配置(APP)专用 ====================
  // 只服务「语音配置」模块（声音克隆/朗读的官方 API Key）；不参与 AI 聊天调用与展示。
  {
    id: 'voice-config', name: '语音配置（APP）', shortName: '语音配置', category: 'voice-config',
    officialUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key', usageUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    color: '#7c5cff', initials: 'VC', modes: ['api'],
    note: '[语音配置(APP)] 专用于语音朗读/声音克隆的 API Key（如阿里云百炼 sk-）；AI 聊天不会调用，也不在该页展示。',
  },
]

export const PROVIDER_MAP: Record<string, ProviderDefinition> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
)

/** 功能分类的顺序与中文标签（用于平台选择弹窗分组） */
export const CATEGORY_ORDER: ProviderDefinition['category'][] = [
  'llm', 'code', 'image', 'video', 'voice', 'search', 'design', 'embedding', 'local', 'voice-config', 'other',
]

export const CATEGORY_LABEL: Record<ProviderDefinition['category'], string> = {
  llm: '文本大模型', code: '编程助手', image: '图像生成', video: '视频生成',
  voice: '语音音频', search: '搜索研究', design: '设计工具', embedding: '嵌入向量',
  local: '本地模型', 'voice-config': '语音配置(APP)', other: '其他',
}
