import type { Account } from './types'
import { decryptSecret } from './crypto'
import { callChat } from './providerCall'
import { chatUpstream } from './upstreamFree'
import { classifyModelPurpose } from './modelPurpose'
import type { FreeAiOption } from './freeAi'
import type { WorkshopRoute } from './workshopChat'
import { PROVIDER_MAP } from '../data/providers'

/**
 * AI 图库索引（v0.1.343）：用看图模型给每张图片/每个视频首帧生成中文描述+标签，
 * 存本机 IndexedDB（acm-gallery-db/captions，按路径+mtime 失效），搜索时按描述命中。
 * 打标走工坊同款路线（上游免费/自有账户），但只收看图模型；云端免费路线暂不走（其多模态通道未验）。
 */
export interface CaptionRec { path: string; mtime: number; text: string; model: string; at: number }

const DB_NAME = 'acm-gallery-db'
const STORE = 'captions'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'path' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadCaptions(): Promise<Map<string, CaptionRec>> {
  const map = new Map<string, CaptionRec>()
  try {
    const db = await openDb()
    const all = await new Promise<CaptionRec[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result as CaptionRec[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    for (const r of all) if (r && r.path) map.set(r.path, r)
  } catch { /* 索引库不可用时按未索引处理 */ }
  return map
}

export async function saveCaption(rec: CaptionRec): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch { /* 保存失败不阻塞索引流程 */ }
}

/** 模型是否能看图：modelPurpose 的「看图」标签 + 常见多模态型号补充。
 * 排除（v0.1.393）：Embedding/Reranker 名字里带 VL 但不是对话模型，
 * 只出向量/排序、不出文字描述，选了也索引不了，菜单里直接不列。 */
export function isVisionModelId(id: string): boolean {
  if (/embedding|rerank/i.test(id)) return false
  if (classifyModelPurpose(id).tags.includes('看图')) return true
  return /gpt-4o|gpt-5|claude|gemini|internvl|llava|minicpm-v|glm-4v|qwen[^ ]*vl|step-1v|moonshot[^ ]*vision/i.test(id)
}

const TAG_PROMPT = '请用中文描述这张图片（视频取的是首帧）：第一行写一句不超过30字的画面描述；第二行以「标签：」开头，写 5-8 个便于检索的关键词（空格分隔），覆盖人物、场景、物体、颜色、氛围。只输出这两行，不要解释。'

/** 给一张图（data URL）打标，返回描述+标签文本 */
/** 自有账户下「能看图」的模型逐个列成路线（v0.1.354）：账户本身配置的模型（acct.label）
 * 已由基础路线覆盖，这里只补同一账户还能调的其他看图模型。
 * v0.1.393：接口返回的模型 id 可能重复，且账户配置的模型就是 label 本身
 * （旧比较 m !== acct.label 永远为真、拦不住），这里按 id 去重并排除已配置的。 */
export function accountVisionRoutes(acct: Account, models: string[]): WorkshopRoute[] {
  const providerName = PROVIDER_MAP[acct.providerId]?.name ?? acct.providerId
  const isConfigured = (m: string) => acct.label === m || acct.label.endsWith(`· ${m}`)
  const seen = new Set<string>()
  const out: WorkshopRoute[] = []
  for (const m of models) {
    if (seen.has(m) || isConfigured(m) || !isVisionModelId(m)) continue
    seen.add(m)
    out.push({ kind: 'account' as const, key: `acct:${acct.id}:${m}`, label: `自有 · ${providerName} · ${m}`, accountId: acct.id, modelId: m })
  }
  return out
}

/** 路线去重（v0.1.393）：同一模型可能同时来自基础路线与逐账户枚举，
 * 或同一账户被加了两次，菜单里只留第一次出现的（按 label 判重）。 */
export function dedupeVisionRoutes(routes: WorkshopRoute[]): WorkshopRoute[] {
  const seen = new Set<string>()
  return routes.filter(r => {
    if (seen.has(r.label)) return false
    seen.add(r.label)
    return true
  })
}

/** 看图模型一句话简介（v0.1.393，文案与 Ethan 确认过）：按模型 id 关键词匹配；
 * 未知的新模型给通用文案，不留空。顺序有讲究：Thinking 版先于具体型号匹配，
 * 因为 Thinking 版的简介是不推荐、与型号无关。 */
export function describeVisionModel(modelId: string): string {
  const id = modelId.toLowerCase()
  if (/embedding/i.test(id)) return '只把图文转成向量，不出文字，不能索引'
  if (/rerank/i.test(id)) return '只给图文相关性打分排序，不出文字，不能索引'
  if (/paddleocr/i.test(id)) return '百度飞桨模型，专长认图里的文字，描述场景比较干'
  if (/nemotron/i.test(id)) return '英伟达轻量多模态小模型，免费、快，但能力一般，免费档易限速'
  if (/thinking/i.test(id)) return '回答前先推理，慢、费 token，贴标签用不上'
  if (/captioner/i.test(id)) return '专门写图注的版本，最对口，描述最贴合图片内容'
  if (/qwen3-vl-8b-instruct/i.test(id)) return '通义 8B 视觉模型，轻快便宜，描述够用，性价比最高'
  if (/qwen3-vl-32b-instruct/i.test(id)) return '通义 32B 视觉模型，看图描述能力强，质量好，速度中等'
  if (/qwen3-vl-30b-a3b-instruct/i.test(id)) return '30B 混合专家模型，质量接近 32B 但更快更便宜'
  if (/qwen3-omni-30b-a3b-instruct/i.test(id)) return '通义全模态模型，文字图片音频视频都能处理，描述能力强'
  if (/qwen[^ ]*vl|qwen[^ ]*omni/i.test(id)) return '通义视觉模型，可看图描述'
  return '视觉模型，可看图描述'
}

/** 取路线对应的模型 id（简介用）：免费路线查 freeOptions；自有账户用
 * modelId/engine；基础路线没有 modelId 时从 label 文本里匹配（label 含模型 id）。 */
export function visionRouteModelId(route: WorkshopRoute, freeOptions: FreeAiOption[]): string {
  if (route.kind === 'free') return freeOptions.find(o => `free:${o.key}` === route.key)?.modelId ?? route.label
  if (route.kind === 'wbpool') return route.label
  return route.modelId ?? route.engine ?? route.label
}

export async function visionTagImage(params: {
  route: WorkshopRoute
  freeOptions: FreeAiOption[]
  accounts: Account[]
  sessionPwd: string
  imageDataUrl: string
}): Promise<string> {
  const { route, freeOptions, accounts, sessionPwd, imageDataUrl } = params
  const messages = [
    { role: 'system', content: '你是图片标注助手，只输出描述与标签。' },
    {
      role: 'user',
      content: [
        { type: 'text', text: TAG_PROMPT },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ] as unknown as { role: string; content: string }[]

  if (route.kind === 'free') {
    const opt = freeOptions.find(o => `free:${o.key}` === route.key)
    if (!opt) throw new Error('所选免费模型已不可用，请换一个')
    if (opt.source === 'cloud') throw new Error('云端免费模型暂不支持看图打标，请换带看图能力的免费模型或自有账户')
    const text = await chatUpstream(opt.source, opt.modelId, messages)
    if (!text.trim()) throw new Error('模型没有返回描述')
    return text.trim()
  }
  if (route.kind === 'wbpool') throw new Error('账号池暂不支持看图打标，请选免费看图模型或自有账户')
  const acct = accounts.find(a => a.id === route.accountId)
  if (!acct) throw new Error('所选账户不存在')
  if (!sessionPwd) throw new Error('保险箱未解锁，无法使用自有账户（可改用免费模型）')
  if (!acct.encryptedKey) throw new Error('该账户没有保存的密钥')
  const key = await decryptSecret(acct.encryptedKey, sessionPwd)
  const r = await callChat(acct, key, messages, route.modelId ?? route.engine)
  if (!r.ok) throw new Error(r.error || r.text || '调用失败')
  return r.text.trim()
}

/** 搜索命中：查询按空格/逗号分词，每个词都要在「文件名 + AI 描述」里出现（不分大小写） */
export function captionMatches(name: string, caption: string | undefined, query: string): boolean {
  const hay = `${name} ${caption ?? ''}`.toLowerCase()
  const tokens = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean)
  return tokens.length > 0 && tokens.every(t => hay.includes(t))
}
