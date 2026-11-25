// 平台目录 —— 与 Web 端 src/data/providers.ts 保持一致
// 仅官方域名链接；小程序不做任何自动化外部操作
const PROVIDERS = [
  { id:'openai', name:'OpenAI', short:'OpenAI', cat:'文本大模型', url:'https://platform.openai.com/usage', checkin:'', color:'#10a37f', initials:'OA', note:'官方 Usage API 可用（需 Admin Key），仅只读查询。' },
  { id:'anthropic', name:'Anthropic Claude', short:'Claude', cat:'文本大模型', url:'https://console.anthropic.com/settings/usage', checkin:'', color:'#d97757', initials:'CL', note:'控制台可查看用量；Admin API 需单独申请。' },
  { id:'gemini', name:'Google Gemini', short:'Gemini', cat:'文本大模型', url:'https://aistudio.google.com/app/apikey', checkin:'https://aistudio.google.com/app/apikey', color:'#4285f4', initials:'GE', note:'AI Studio 提供免费额度，无公开用量 API，走手动录入。' },
  { id:'deepseek', name:'DeepSeek', short:'DeepSeek', cat:'文本大模型', url:'https://platform.deepseek.com', checkin:'https://platform.deepseek.com/top_up', color:'#4d6bfe', initials:'DS', note:'控制台查看余额，无公开用量 API。' },
  { id:'qwen', name:'通义千问', short:'通义', cat:'文本大模型', url:'https://bailian.console.aliyun.com/cn-beijing/model/market', checkin:'https://bailian.console.aliyun.com/', color:'#615ced', initials:'通', note:'API 地址中的 {WorkspaceId} 需替换为你的业务空间 ID；旧 dashscope.aliyuncs.com 域名仍可用。' },
  { id:'kim', name:'Moonshot Kimi', short:'Kimi', cat:'文本大模型', url:'https://platform.moonshot.cn', checkin:'https://platform.moonshot.cn/console/info', color:'#1a1a1a', initials:'K', note:'控制台查看余额与用量。' },
  { id:'doubao', name:'豆包 / 火山方舟', short:'豆包', cat:'文本大模型', url:'https://console.volcengine.com/ark', checkin:'https://www.doubao.com/', color:'#f04142', initials:'豆', note:'官方签到：电脑版左下角签到窗 / 头像 →「免费用豆包」，每日 200 额度、周一翻倍（30 天有效）。API 用量在火山方舟控制台查看。' },
  { id:'workbuddy', name:'WorkBuddy', short:'WorkBuddy', cat:'文本大模型', url:'https://www.workbuddy.cn/', checkin:'https://www.workbuddy.cn/', color:'#0052d9', initials:'WB', note:'官方签到：客户端左下角头像 →「Buddy 加油站」，每日 100 积分，连签 7/14/28 天有额外奖励（当月有效）。' },
  { id:'glm', name:'智谱 GLM', short:'GLM', cat:'文本大模型', url:'https://bigmodel.cn', checkin:'https://bigmodel.cn', color:'#3859ff', initials:'G', note:'开放平台查看余额。' },
  { id:'siliconflow', name:'SiliconFlow 硅基流动', short:'硅基流动', cat:'文本大模型', url:'https://cloud.siliconflow.cn', checkin:'', color:'#7c3aed', initials:'SF', note:'聚合多模型平台，控制台查看余额，无公开用量 API。' },
  { id:'baichuan', name:'百川智能', short:'百川', cat:'文本大模型', url:'https://platform.baichuan-ai.com', checkin:'', color:'#2563eb', initials:'百', note:'开放平台控制台查看用量。' },
  { id:'minimax', name:'MiniMax 稀宇', short:'MiniMax', cat:'文本大模型', url:'https://platform.minimaxi.com/user-center', checkin:'', color:'#0f172a', initials:'MM', note:'开放平台控制台查看余额；也提供语音/视频模型。' },
  { id:'stepfun', name:'阶跃星辰', short:'阶跃', cat:'文本大模型', url:'https://platform.stepfun.com', checkin:'', color:'#6366f1', initials:'阶', note:'阶跃星辰开放平台。' },
  { id:'xai', name:'xAI Grok', short:'Grok', cat:'文本大模型', url:'https://console.x.ai/', checkin:'', color:'#111827', initials:'X', note:'X 旗下 Grok 模型开放平台。' },
  { id:'mistral', name:'Mistral AI', short:'Mistral', cat:'文本大模型', url:'https://console.mistral.ai/usage', checkin:'', color:'#fa500e', initials:'MI', note:'欧洲开源模型厂商，控制台查看用量。' },
  { id:'cohere', name:'Cohere', short:'Cohere', cat:'文本大模型', url:'https://dashboard.cohere.com/', checkin:'', color:'#d0ff5e', initials:'CO', note:'企业文本模型与嵌入。' },
  { id:'groq', name:'Groq', short:'Groq', cat:'文本大模型', url:'https://console.groq.com/', checkin:'', color:'#f55036', initials:'GR', note:'高速推理服务，控制台查看配额。' },
  { id:'together', name:'Together AI', short:'Together', cat:'文本大模型', url:'https://api.together.ai/', checkin:'', color:'#f26522', initials:'TA', note:'多模型推理平台。' },
  { id:'openrouter', name:'OpenRouter', short:'OpenRouter', cat:'文本大模型', url:'https://openrouter.ai/activity', checkin:'', color:'#6366f1', initials:'OR', note:'聚合多厂商模型的统一 API 网关。' },
  { id:'cursor', name:'Cursor', short:'Cursor', cat:'编程助手', url:'https://www.cursor.com/account/usage', checkin:'', color:'#111827', initials:'CU', note:'订阅账户在 Account 页查看用量。' },
  { id:'copilot', name:'GitHub Copilot', short:'Copilot', cat:'编程助手', url:'https://github.com/settings/copilot', checkin:'', color:'#24292f', initials:'GH', note:'GitHub Settings 查看请求配额。' },
  { id:'windsurf', name:'Windsurf', short:'Windsurf', cat:'编程助手', url:'https://windsurf.com/account', checkin:'', color:'#0ea5e9', initials:'WS', note:'AI 编程 IDE，订阅账户查看用量。' },
  { id:'claude-code', name:'Claude Code', short:'Claude Code', cat:'编程助手', url:'https://console.anthropic.com/settings/usage', checkin:'', color:'#d97757', initials:'CC', note:'Anthropic 命令行编程助手，走 Claude 订阅额度。' },
  { id:'codex', name:'OpenAI Codex', short:'Codex', cat:'编程助手', url:'https://chatgpt.com/', checkin:'', color:'#10a37f', initials:'CX', note:'OpenAI 编程 Agent，走 ChatGPT 订阅额度。' },
  { id:'tabnine', name:'Tabnine', short:'Tabnine', cat:'编程助手', url:'https://www.tabnine.com/account', checkin:'', color:'#1e293b', initials:'TN', note:'代码补全助手，订阅账户查看用量。' },
  { id:'replit', name:'Replit Agent', short:'Replit', cat:'编程助手', url:'https://replit.com/account', checkin:'', color:'#f26207', initials:'RP', note:'在线 IDE 与 AI Agent，订阅查看用量。' },
  { id:'sourcegraph', name:'Sourcegraph Cody', short:'Cody', cat:'编程助手', url:'https://sourcegraph.com/', checkin:'', color:'#4285f4', initials:'CY', note:'代码搜索与 AI 助手。' },
  { id:'midjourney', name:'Midjourney', short:'MJ', cat:'图像生成', url:'https://www.midjourney.com/account', checkin:'', color:'#111827', initials:'MJ', note:'订阅 Fast Hours 在 Account 页查看。' },
  { id:'stability', name:'Stability AI', short:'Stability', cat:'图像生成', url:'https://platform.stability.ai/account/credits', checkin:'', color:'#7c3aed', initials:'ST', note:'Stable Diffusion 系列图像模型。' },
  { id:'ideogram', name:'Ideogram', short:'Ideogram', cat:'图像生成', url:'https://ideogram.ai', checkin:'', color:'#ec4899', initials:'ID', note:'擅长文字渲染的图像生成模型。' },
  { id:'leonardo', name:'Leonardo AI', short:'Leonardo', cat:'图像生成', url:'https://app.leonardo.ai/', checkin:'', color:'#8b5cf6', initials:'LE', note:'游戏/设计向图像生成，订阅查看 tokens。' },
  { id:'dalle', name:'DALL·E (OpenAI)', short:'DALL·E', cat:'图像生成', url:'https://platform.openai.com/usage', checkin:'', color:'#10a37f', initials:'DE', note:'OpenAI 图像生成，与 GPT API 共用额度。' },
  { id:'flux', name:'FLUX (Black Forest)', short:'FLUX', cat:'图像生成', url:'https://bfl.ai', checkin:'', color:'#1e293b', initials:'FX', note:'高质量开源图像生成模型。' },
  { id:'sora', name:'Sora (OpenAI)', short:'Sora', cat:'视频生成', url:'https://chatgpt.com/', checkin:'', color:'#111827', initials:'SO', note:'OpenAI 视频生成，走 ChatGPT 订阅额度。' },
  { id:'runway', name:'Runway', short:'Runway', cat:'视频生成', url:'https://app.runwayml.com/', checkin:'', color:'#1e293b', initials:'RW', note:'AI 视频生成与编辑，订阅查看 credits。' },
  { id:'pika', name:'Pika', short:'Pika', cat:'视频生成', url:'https://pika.art/', checkin:'', color:'#8b5cf6', initials:'PK', note:'AI 视频生成工具，订阅查看额度。' },
  { id:'kling', name:'可灵 Kling', short:'可灵', cat:'视频生成', url:'https://klingai.kuaishou.com/', checkin:'', color:'#ff6600', initials:'KL', note:'快手可灵 AI 视频生成。' },
  { id:'hailuo', name:'海螺 AI', short:'海螺', cat:'视频生成', url:'https://hailuoai.com/', checkin:'', color:'#2563eb', initials:'HL', note:'MiniMax 旗下视频生成。' },
  { id:'elevenlabs', name:'ElevenLabs', short:'Eleven', cat:'语音音频', url:'https://elevenlabs.io/app/settings/usage', checkin:'https://elevenlabs.io/app/subscription', color:'#111827', initials:'EL', note:'控制台查看字符额度。' },
  { id:'whisper', name:'OpenAI Whisper', short:'Whisper', cat:'语音音频', url:'https://platform.openai.com/usage', checkin:'', color:'#10a37f', initials:'WH', note:'语音转文字，按音频时长计费。' },
  { id:'deepgram', name:'Deepgram', short:'Deepgram', cat:'语音音频', url:'https://console.deepgram.com/', checkin:'', color:'#7c3aed', initials:'DG', note:'实时语音识别与合成。' },
  { id:'sunno', name:'Suno AI', short:'Suno', cat:'语音音频', url:'https://suno.com/', checkin:'', color:'#ec4899', initials:'SU', note:'AI 音乐生成，订阅查看 credits。' },
  { id:'udio', name:'Udio', short:'Udio', cat:'语音音频', url:'https://www.udio.com/', checkin:'', color:'#0ea5e9', initials:'UD', note:'AI 音乐生成。' },
  { id:'perplexity', name:'Perplexity', short:'PPLX', cat:'搜索研究', url:'https://www.perplexity.ai', checkin:'', color:'#20808d', initials:'PX', note:'API 账户可查看余额。' },
  { id:'tavily', name:'Tavily', short:'Tavily', cat:'搜索研究', url:'https://app.tavily.com/', checkin:'', color:'#14b8a6', initials:'TV', note:'为 AI Agent 设计的搜索 API。' },
  { id:'serpapi', name:'SerpAPI', short:'SerpAPI', cat:'搜索研究', url:'https://serpapi.com/dashboard', checkin:'', color:'#f59e0b', initials:'SP', note:'搜索引擎结果 API，按调用次数计费。' },
  { id:'exa', name:'Exa AI', short:'Exa', cat:'搜索研究', url:'https://dashboard.exa.ai/', checkin:'', color:'#6366f1', initials:'EX', note:'神经搜索引擎 API。' },
  { id:'figma', name:'Figma AI', short:'Figma', cat:'设计工具', url:'https://www.figma.com', checkin:'', color:'#f24e1e', initials:'FG', note:'订阅账户查看 AI 额度。' },
  { id:'canva', name:'Canva AI', short:'Canva', cat:'设计工具', url:'https://www.canva.com/', checkin:'', color:'#00c4cc', initials:'CV', note:'在线设计工具，Magic Studio AI 功能。' },
  { id:'adobe', name:'Adobe Firefly', short:'Firefly', cat:'设计工具', url:'https://www.adobe.com/', checkin:'', color:'#ff0000', initials:'AF', note:'Adobe 生成式 AI，订阅查看生成额度。' },
  { id:'voyage', name:'Voyage AI', short:'Voyage', cat:'嵌入向量', url:'https://dashboard.voyageai.com/', checkin:'', color:'#8b5cf6', initials:'VA', note:'高质量嵌入与重排序模型。' },
  { id:'jina', name:'Jina AI', short:'Jina', cat:'嵌入向量', url:'https://jina.ai/', checkin:'', color:'#0ea5e9', initials:'JA', note:'嵌入、重排序与网页读取 API。' }
]

const PROVIDER_MAP = {}
PROVIDERS.forEach(function (p) { PROVIDER_MAP[p.id] = p })

// 本地存储工具（小程序 wx.Storage）
const STORAGE_KEY = 'acm.mini.v1'
var DEFAULT_SETTINGS = {
  checkinReminder: true,
  alertDays: 7,
  defaultUnit: 'credit',
  monthlyBudget: 200,
  backupReminder: true,
  uiTheme: 'aurora'
}
function load() {
  var state = { accounts: [], quotas: [], checkins: [], usage: [], settings: DEFAULT_SETTINGS }
  try {
    var raw = wx.getStorageSync(STORAGE_KEY)
    if (raw) {
      state.accounts = raw.accounts || []
      state.quotas = raw.quotas || []
      state.checkins = raw.checkins || []
      state.usage = raw.usage || []
      state.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {})
      if (raw.budget && !raw.settings) state.settings.monthlyBudget = raw.budget
    }
  } catch (e) {}
  return state
}
function save(state) {
  try { wx.setStorageSync(STORAGE_KEY, state) } catch (e) {}
}
function updateSettings(patch) {
  var state = load()
  state.settings = Object.assign({}, state.settings, patch)
  save(state)
  return state.settings
}
function today() {
  var d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/* ---------- 全平台外观主题 A–H（仅显示层，与业务数据隔离） ----------
   Web / Docker / 桌面 / 原生 WebView 使用 src/uiThemes.ts 的同名目录；
   此处为小程序原生实现，读写独立键 acm.mini.theme，同时镜像到 settings.uiTheme。 */
var UI_THEMES = [
  { id:'precision', letter:'A', name:'精准控制台', desc:'极简蓝 · 表格优先', interaction:'克制过渡、快捷操作',
    navBg:'#2563eb', tabBg:'#ffffff', tabColor:'#8a99ad', tabSelected:'#2563eb', windowBg:'#f4f7fb', dark:false },
  { id:'studio', letter:'B', name:'暖白工作室', desc:'暖白陶土 · 大留白', interaction:'柔和展开、沉静反馈',
    navBg:'#b85f3e', tabBg:'#fffdf9', tabColor:'#a2968a', tabSelected:'#b85f3e', windowBg:'#f5f1ea', dark:false },
  { id:'command', letter:'C', name:'暗夜指挥舱', desc:'深色高密度 · 数据监控', interaction:'实时刷新、紧凑反馈',
    navBg:'#101823', tabBg:'#101823', tabColor:'#6d837d', tabSelected:'#34d399', windowBg:'#080d14', dark:true },
  { id:'island', letter:'D', name:'青屿轻卡片', desc:'自然青绿 · 圆润卡片', interaction:'弹性按压、触控友好',
    navBg:'#0f8f81', tabBg:'#ffffff', tabColor:'#85aaa2', tabSelected:'#0f8f81', windowBg:'#edf7f4', dark:false },
  { id:'aurora', letter:'E', name:'极光琉璃', desc:'极光渐变 · 分层玻璃', interaction:'光影追随、弹性弹层',
    navBg:'#1b1932', tabBg:'#1b1932', tabColor:'#8d86b4', tabSelected:'#a996ff', windowBg:'#0d0c1b', dark:true },
  { id:'lumin', letter:'F', name:'极简流光', desc:'纯净浅色 · 精细描边', interaction:'共享过渡、磁性反馈',
    navBg:'#0969da', tabBg:'#ffffff', tabColor:'#94a1b5', tabSelected:'#0969da', windowBg:'#f7f9fc', dark:false },
  { id:'hud', letter:'G', name:'星舰 HUD', desc:'深空界面 · 精密刻度', interaction:'扫描光效、实时脉冲',
    navBg:'#0b1821', tabBg:'#0b1821', tabColor:'#5f8e8b', tabSelected:'#64ffda', windowBg:'#050d13', dark:true },
  { id:'editorial', letter:'H', name:'数字杂志', desc:'编辑排版 · 纸感层次', interaction:'章节转场、细节展开',
    navBg:'#c54c31', tabBg:'#faf7f0', tabColor:'#9c9082', tabSelected:'#c54c31', windowBg:'#eee9df', dark:false }
]
var UI_THEME_IDS = UI_THEMES.map(function (t) { return t.id })
var UI_THEME_DEFAULT = 'aurora'

function getUiThemeDef(id) {
  for (var i = 0; i < UI_THEMES.length; i++) if (UI_THEMES[i].id === id) return UI_THEMES[i]
  return UI_THEMES[4]
}
function getUiTheme() {
  try {
    var v = wx.getStorageSync('acm.mini.theme')
    if (UI_THEME_IDS.indexOf(v) >= 0) return v
    var s = load().settings || {}
    if (UI_THEME_IDS.indexOf(s.uiTheme) >= 0) return s.uiTheme
  } catch (e) {}
  return UI_THEME_DEFAULT
}
function setUiTheme(id) {
  if (UI_THEME_IDS.indexOf(id) < 0) return getUiTheme()
  try { wx.setStorageSync('acm.mini.theme', id) } catch (e) {}
  try { updateSettings({ uiTheme: id }) } catch (e) {}
  applyUiThemeChrome(id)
  return id
}
/* 联动系统导航栏、底部标签栏与窗口背景，让主题切换覆盖整屏 */
function applyUiThemeChrome(id) {
  if (typeof wx === 'undefined') return
  var t = getUiThemeDef(id || getUiTheme())
  try { wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: t.navBg }) } catch (e) {}
  try { wx.setTabBarStyle({ color: t.tabColor, selectedColor: t.tabSelected, backgroundColor: t.tabBg, borderStyle: t.dark ? 'black' : 'white' }) } catch (e) {}
  try { wx.setBackgroundColor({ backgroundColor: t.windowBg, backgroundColorTop: t.windowBg, backgroundColorBottom: t.windowBg }) } catch (e) {}
  try { wx.setBackgroundTextStyle({ textStyle: t.dark ? 'light' : 'dark' }) } catch (e) {}
}

module.exports = {
  PROVIDERS, PROVIDER_MAP, load, save, updateSettings, today,
  UI_THEMES, getUiTheme, setUiTheme, getUiThemeDef, applyUiThemeChrome
}
