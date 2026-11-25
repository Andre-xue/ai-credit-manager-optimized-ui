// 官方「创建 / 管理 API Key」页面地址：内置值来自 data/providers 的 apiKeyUrl（发版时逐个核验）；
// 运行时自动拉取官网托管的 key-urls.json（与应用同站点发布）覆盖内置值——平台改版 Key 页地址时
// 只需更新该 JSON，所有已安装版本下次打开即生效，无需发版。拉取失败/离线时用内置值。
import type { ProviderDefinition } from './types'

const LS_KEY = 'acm.keyurls.v1'
const REMOTE_URL = 'https://andre-xue.github.io/ai-credit-manager-optimized/key-urls.json'
export const KEYURLS_EVENT = 'acm-keyurls-updated'

function loadCached(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

let overrides: Record<string, string> = loadCached()

/** 当前生效的官方 Key 页地址：远程最新 > 内置 apiKeyUrl > 用量页 > 官网 */
export function getKeyPageUrl(provider: ProviderDefinition): string {
  return overrides[provider.id] || provider.apiKeyUrl || provider.usageUrl || provider.officialUrl
}

/** 语音配置账户按所选语音服务商映射到其 Key 管理页所在平台（无 Key 的本地/系统服务返回 null） */
export const VOICE_KEY_PROVIDER: Record<string, string> = {
  aliyun: 'voice-config',
  volcengine: 'doubao',
  tencent: 'tencent',
  minimax: 'minimax',
  elevenlabs: 'elevenlabs',
}

/** 拉取最新 Key 页地址表（App 启动时调用一次；成功后广播事件让已渲染的按钮刷新） */
export async function refreshKeyUrls(): Promise<void> {
  try {
    const resp = await fetch(REMOTE_URL, { cache: 'no-store' })
    if (!resp.ok) return
    const data = await resp.json()
    const urls = (data as { urls?: unknown })?.urls
    if (!urls || typeof urls !== 'object') return
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(urls as Record<string, unknown>)) {
      if (typeof v === 'string' && /^https:\/\//.test(v)) clean[k] = v
    }
    if (Object.keys(clean).length === 0) return
    overrides = clean
    try { localStorage.setItem(LS_KEY, JSON.stringify(clean)) } catch { /* 存储不可用时仅内存生效 */ }
    window.dispatchEvent(new Event(KEYURLS_EVENT))
  } catch { /* 离线/被拦截：继续用内置地址 */ }
}
