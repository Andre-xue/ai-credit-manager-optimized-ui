// 本地模型资料卡数据：三层来源——
// 1) 内置知识库（知名模型精选优缺点/风格，准确、离线、秒出）；
// 2) Civitai 公开接口实时查询（新下载的模型按文件名匹配其模型页：简介/标签/热度，标注来源）；
// 3) 按名称与架构推断（明确标注为推断，仅供参考）。
// 纯文件名无法保证任意模型都查得到：查不到就如实降级，不编造。

import { isDesktopShell, pluginHttpDesktop } from './plugins'
import { isNativeApp } from './openExternal'
import { isMotionModule } from './modelCapability'

export interface LocalModelInfo {
  /** 展示名（文件名或 Civitai 模型名） */
  name: string
  tagline: string
  style?: string
  pros: string[]
  cons: string[]
  best?: string
  intro?: string
  stats?: string
  source: 'kb' | 'civitai' | 'infer'
  sourceUrl?: string
}

type KbEntry = Omit<LocalModelInfo, 'name' | 'source' | 'sourceUrl'>

const KB: { pattern: RegExp; info: KbEntry }[] = [
  // 结构类（LoRA/VAE/ControlNet/放大）必须排在底模之前：
  // 如 controlnet/control_v11p_sd15_*.pth 的文件名含 sd15，若先匹配底模会被误判为 SD1.5 底模
  {
    pattern: /(^|[/\\])loras?([/\\])|lora/i,
    info: {
      tagline: 'LoRA · 风格/角色微调（非底模）', style: '依 LoRA 内容而定',
      pros: ['体积小，给底模叠加特定风格或角色', '可多个叠加、权重可调'],
      cons: ['不能单独出图，必须搭配同架构底模', '权重过高容易画面崩坏'],
      best: '固定画风、特定角色',
    },
  },
  {
    pattern: /(^|[/\\])vae([/\\])|-vae\.|\.vae\./i,
    info: {
      tagline: 'VAE · 解码器（非底模）', style: '—',
      pros: ['改善出图色彩与细节（尤其动漫常用的 kl-f8-anime2）'],
      cons: ['不能单独出图，需在工作流中作为 VAE 输入'],
      best: '搭配底模改善色调',
    },
  },
  {
    pattern: /controlnet/i,
    info: {
      tagline: 'ControlNet · 结构控制模型（非底模）', style: '姿势/边缘/深度控制',
      pros: ['按线稿、姿势、深度图精确控制构图'],
      cons: ['不能单独出图，需 ControlNet 节点与对应预处理'],
      best: '线稿上色、姿势复刻',
    },
  },
  {
    pattern: /esrgan|upscal/i,
    info: {
      tagline: '放大模型（非底模）', style: '超分辨率',
      pros: ['把成图放大 2–4 倍并补细节'],
      cons: ['不能单独出图，用于出图后的放大环节'],
      best: '成图高清放大',
    },
  },
  {
    pattern: /anything/,
    info: {
      tagline: 'Anything 系列 · 动漫插画底模（SD1.5）', style: '日系动漫、插画、二次元',
      pros: ['动漫线条干净、上色稳定', '提示词响应好，构图听话', '社区 LoRA 与教程资源丰富'],
      cons: ['写实与照片感弱', '手部细节偶有瑕疵（SD1.5 通病）', '原生 512 分辨率，高清需放大'],
      best: '动漫头像、插画、二次元场景',
    },
  },
  {
    pattern: /realistic[_ ]?vision/,
    info: {
      tagline: 'Realistic Vision · 写实摄影底模（SD1.5）', style: '写实、摄影感、人像',
      pros: ['皮肤质感与真实光影出色', '人像表现在 SD1.5 里属顶级梯队', '细节丰富，噪点控制好'],
      cons: ['动漫/插画风格弱', '手部与文字仍是弱项', '对提示词与采样参数较敏感'],
      best: '写实人像、产品图、摄影风场景',
    },
  },
  {
    pattern: /v1-5-pruned|sd[-_ ]?v?1[-_.]?5|stable[-_ ]?diffusion[-_ ]?v?1\.?5/,
    info: {
      tagline: 'Stable Diffusion 1.5 · 原版底模', style: '通用基础',
      pros: ['兼容性最好，LoRA/ControlNet 生态最全', 'AnimateDiff 运动模块的标配搭档', '出图稳定可预期，适合做训练起点'],
      cons: ['直出画质平庸，不如微调模型', '原生 512 分辨率，细节有限'],
      best: '测试工作流、本地视频底模、训练微调',
    },
  },
  {
    pattern: /dreamshaper/,
    info: {
      tagline: 'DreamShaper · 全能通用底模（SD1.5）', style: '绘画、写实、奇幻均衡',
      pros: ['风格适应面广，插画与写实都不差', '开箱即用，对新手友好', '社区口碑稳定'],
      cons: ['各项都不差但都不极致', '原生 512 分辨率'],
      best: '日常出图、概念设计、海报',
    },
  },
  {
    pattern: /chilloutmix/,
    info: {
      tagline: 'ChilloutMix · 写实人像底模（SD1.5）', style: '写实、亚洲人像',
      pros: ['亚洲面孔与身材表现自然', '肤色与光影柔和'],
      cons: ['风格偏窄，非人像题材一般', '版本授权条款需留意'],
      best: '写实人像、写真风',
    },
  },
  {
    pattern: /majicmix/,
    info: {
      tagline: 'majicMIX · 写实人像底模（SD1.5）', style: '写实、亚洲审美人像',
      pros: ['面部精致，妆容质感好', '出图稳定，废片率低'],
      cons: ['题材偏人像，其他类型一般', '原生 512 分辨率'],
      best: '人像写真、美妆风',
    },
  },
  {
    pattern: /counterfeit/,
    info: {
      tagline: 'Counterfeit · 高质量动漫底模（SD1.5）', style: '动漫、插画',
      pros: ['画面精细，色彩通透', '细节量大，适合精修出图'],
      cons: ['生成较慢', '写实题材弱'],
      best: '高质量动漫插画',
    },
  },
  {
    pattern: /meinamix/,
    info: {
      tagline: 'MeinaMix · 动漫底模（SD1.5）', style: '动漫、鲜艳明快',
      pros: ['色彩鲜艳，角色表现讨喜', '出图快，废片率低'],
      cons: ['背景细节一般', '写实题材弱'],
      best: '动漫角色、立绘',
    },
  },
  {
    pattern: /pony/,
    info: {
      tagline: 'Pony Diffusion · 多风格底模（SDXL）', style: '多风格、标签式提示',
      pros: ['风格覆盖极广（写实/动漫/卡通）', '对 Danbooru 标签响应好', '原生 1024 分辨率'],
      cons: ['需要评分标签等特定提示写法', '模型较大，8G 内存出图偏慢'],
      best: '多风格创作、角色图',
    },
  },
  {
    pattern: /flux/,
    info: {
      tagline: 'FLUX.1 · 新一代底模', style: '写实、文字渲染、通用',
      pros: ['提示词理解与画面文字渲染强', '构图与细节出色'],
      cons: ['模型体积大、极吃内存，8G 机器非常吃力', '生成速度慢'],
      best: '海报、带文字的设计图',
    },
  },
  {
    pattern: /sd[_ ]?xl|_xl_|sdxl/,
    info: {
      tagline: 'SDXL 系底模', style: '通用、原生高清',
      pros: ['原生 1024 分辨率，细节与构图更好', '提示词理解强于 SD1.5'],
      cons: ['比 SD1.5 更吃内存、出图更慢', '与 SD1.5 的 LoRA/运动模块不通用'],
      best: '高清出图、海报',
    },
  },
]

const MOTION_INFO: KbEntry = {
  tagline: 'AnimateDiff 运动模块（SD1.5）', style: '视频运动生成',
  pros: ['让静态底模动起来，生成连贯短视频', '可与任意 SD1.5 底模搭配', '资源占用相对小'],
  cons: ['不能单独使用，必须搭配 SD1.5 底模', '原生 16 帧短片段，长视频需分段拼接', '与 SDXL / Flux 底模不兼容'],
  best: '文生视频、动态壁纸、短动效',
}

export function baseNameOf(filename: string): string {
  const base = (filename || '').split(/[\\/]/).pop() ?? filename
  return base.replace(/\.(safetensors|ckpt|gguf|bin|pt|pth)$/i, '')
}

/** 知识库同步查询（命中返回精选资料，未命中返回 null） */
export function kbModelInfo(filename: string): LocalModelInfo | null {
  if (!filename) return null
  if (isMotionModule(filename)) return { name: baseNameOf(filename), ...MOTION_INFO, source: 'kb' }
  const lower = filename.toLowerCase()
  for (const e of KB) {
    if (e.pattern.test(lower)) return { name: baseNameOf(filename), ...e.info, source: 'kb' }
  }
  return null
}

/** 按架构推断的兜底资料（明确标注为推断） */
export function inferModelInfo(filename: string): LocalModelInfo {
  const lower = filename.toLowerCase()
  if (/xl|pony|flux/.test(lower)) {
    return {
      name: baseNameOf(filename), source: 'infer',
      tagline: '大模型架构（SDXL/Flux 系）', style: '通用',
      pros: ['原生分辨率高，构图与细节较好'],
      cons: ['吃内存、出图较慢，8G 机器需留意'],
      best: '高清出图',
    }
  }
  return {
    name: baseNameOf(filename), source: 'infer',
    tagline: 'SD1.5 系底模（按名称推断）', style: '通用',
    pros: ['生态成熟，出图快、内存占用低', 'LoRA 与教程资源多'],
    cons: ['原生 512 分辨率，直出细节有限'],
    best: '日常出图、本地视频底模',
  }
}

// ---------- Civitai 实时查询 ----------

const CACHE_KEY = 'acm.modelinfo.civitai.v1'
const HIT_TTL = 7 * 24 * 3600 * 1000
const MISS_TTL = 24 * 3600 * 1000

/** 文件名 → Civitai 搜索词：去目录/扩展名/版本与精度后缀 */
export function civitaiQueryOf(filename: string): string {
  const s = baseNameOf(filename).replace(/[_-]+/g, ' ')
  const kept = s.split(/\s+/).filter(tok => {
    if (!tok) return false
    if (/^v\d+(\.\d+)?[a-z]*$/i.test(tok)) return false        // V6.0 / v5PrtRE 等版本标记
    if (/^(b\d+|nv|prt|re|pruned|emaonly|fp16|fp32|bf16|inpainting|vae)$/i.test(tok)) return false
    return true
  })
  return kept.join(' ').trim()
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length >= 2)
}

function cleanIntro(html?: string): string {
  if (!html) return ''
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  const sentences = text.split(/(?<=[.!?])\s+/)
  const good = sentences.filter(x => x.length >= 40 && !/https?:|patreon|exclusive|mage\.space|discord|check my/i.test(x))
  return (good.slice(0, 2).join(' ') || text).slice(0, 240)
}

interface CivitaiItem {
  id: number
  name: string
  type?: string
  description?: string
  tags?: string[]
  stats?: { downloadCount?: number; rating?: number; ratingCount?: number }
}

/** 把 Civitai 搜索结果映射为资料卡；与文件名不相关（词重叠 <50%）时返回 null */
export function mapCivitaiItem(item: CivitaiItem, query: string): LocalModelInfo | null {
  const q = new Set(tokens(query))
  if (!q.size) return null
  const hit = tokens(item.name).filter(x => q.has(x)).length
  if (hit / q.size < 0.5) return null
  const st = item.stats ?? {}
  const statsParts: string[] = []
  if (st.downloadCount) statsParts.push(`下载 ${st.downloadCount >= 10000 ? `${(st.downloadCount / 10000).toFixed(1)} 万` : st.downloadCount}`)
  if (st.rating) statsParts.push(`评分 ${st.rating.toFixed(1)}${st.ratingCount ? `（${st.ratingCount} 人）` : ''}`)
  return {
    name: item.name,
    tagline: item.name,
    style: (item.tags ?? []).slice(0, 6).join('、') || undefined,
    pros: [], cons: [],
    intro: cleanIntro(item.description) || undefined,
    stats: statsParts.join(' · ') || undefined,
    source: 'civitai',
    sourceUrl: `https://civitai.com/models/${item.id}`,
  }
}

function readCache(): Record<string, { at: number; info: LocalModelInfo | null }> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} }
}

async function fetchTextAny(url: string): Promise<string> {
  if (isDesktopShell()) {
    const r = await pluginHttpDesktop(url, 'GET', {}, '')
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
    return r.text
  }
  if (isNativeApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const r = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' } })
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** Civitai 实时查询（带本地缓存）；查不到或网络失败返回 null */
export async function fetchCivitaiInfo(filename: string): Promise<LocalModelInfo | null> {
  const query = civitaiQueryOf(filename)
  if (!query) return null
  const cache = readCache()
  const key = query.toLowerCase()
  const hit = cache[key]
  if (hit && Date.now() - hit.at < (hit.info ? HIT_TTL : MISS_TTL)) return hit.info
  let info: LocalModelInfo | null = null
  try {
    const text = await fetchTextAny(`https://civitai.com/api/v1/models?query=${encodeURIComponent(query)}&limit=5&nsfw=false`)
    const items = (JSON.parse(text)?.items ?? []) as CivitaiItem[]
    const mapped = items
      .map(it => mapCivitaiItem(it, query))
      .filter((x): x is LocalModelInfo => !!x)
    info = mapped.find(x => /checkpoint/i.test(items.find(i => `https://civitai.com/models/${i.id}` === x.sourceUrl)?.type ?? '')) ?? mapped[0] ?? null
  } catch { info = null }
  cache[key] = { at: Date.now(), info }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* 忽略 */ }
  return info
}

/** 完整解析：知识库 → Civitai 实时 → 架构推断 */
export async function resolveLocalModelInfo(filename: string): Promise<LocalModelInfo> {
  const kb = kbModelInfo(filename)
  if (kb) return kb
  const civ = await fetchCivitaiInfo(filename)
  if (civ) return civ
  return inferModelInfo(filename)
}
