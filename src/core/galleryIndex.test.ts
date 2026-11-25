import { describe, it, expect, vi } from 'vitest'
import {
  isVisionModelId, accountVisionRoutes, dedupeVisionRoutes, describeVisionModel, visionRouteModelId,
  visionTagImage,
} from './galleryIndex'
import { callChat } from './providerCall'
import type { Account } from './types'
import type { WorkshopRoute } from './workshopChat'

vi.mock('./providerCall', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./providerCall')>()
  return { ...orig, callChat: vi.fn() }
})
vi.mock('./crypto', () => ({ decryptSecret: async () => 'test-key' }))

const siliconAcct = (label: string): Account => ({
  id: 'acct-silicon', providerId: 'siliconflow', label,
  encryptedKey: 'x', note: '',
} as unknown as Account)

describe('isVisionModelId（v0.1.393：Embedding/Reranker 不是看图模型）', () => {
  it('Embedding 与 Reranker 不算看图模型', () => {
    expect(isVisionModelId('Qwen/Qwen3-VL-Embedding-8B')).toBe(false)
    expect(isVisionModelId('Qwen/Qwen3-VL-Reranker-8B')).toBe(false)
  })
  it('真正的 VL/Omni 模型算看图模型', () => {
    expect(isVisionModelId('Qwen/Qwen3-VL-8B-Instruct')).toBe(true)
    expect(isVisionModelId('Qwen/Qwen3-VL-32B-Instruct')).toBe(true)
    expect(isVisionModelId('Qwen/Qwen3-Omni-30B-A3B-Captioner')).toBe(true)
    expect(isVisionModelId('Qwen/Qwen3-Omni-30B-A3B-Thinking')).toBe(true)
    expect(isVisionModelId('nvidia/nemotron-3-nano-omni')).toBe(true)
    expect(isVisionModelId('PaddlePaddle/PaddleOCR-VL-1.5')).toBe(true)
  })
  it('纯对话模型不算', () => {
    expect(isVisionModelId('Qwen/Qwen3-32B')).toBe(false)
    expect(isVisionModelId('deepseek-chat')).toBe(false)
  })
})

describe('accountVisionRoutes 去重与排除（v0.1.393）', () => {
  const models = [
    'Qwen/Qwen3-VL-Embedding-8B', 'Qwen/Qwen3-VL-Reranker-8B',
    'Qwen/Qwen3-VL-8B-Instruct', 'Qwen/Qwen3-VL-8B-Instruct', // 接口可能返回重复 id
    'Qwen/Qwen3-VL-32B-Instruct', 'Qwen/Qwen3-Omni-30B-A3B-Captioner',
  ]
  it('排除 Embedding/Reranker，重复 id 只留一次', () => {
    const routes = accountVisionRoutes(siliconAcct('自有 · SiliconFlow 硅基流动 · Qwen/Qwen3-VL-32B-Thinking'), models)
    const labels = routes.map(r => r.label)
    expect(labels).not.toContain('自有 · SiliconFlow 硅基流动 · Qwen/Qwen3-VL-Embedding-8B')
    expect(labels).not.toContain('自有 · SiliconFlow 硅基流动 · Qwen/Qwen3-VL-Reranker-8B')
    expect(labels.filter(l => l.endsWith('Qwen/Qwen3-VL-8B-Instruct'))).toHaveLength(1)
    expect(labels).toHaveLength(3)
  })
  it('账户本身配置的模型不重复列出（label 含模型 id 的两种形态）', () => {
    const a = accountVisionRoutes(siliconAcct('自有 · SiliconFlow 硅基流动 · Qwen/Qwen3-VL-8B-Instruct'), [
      'Qwen/Qwen3-VL-8B-Instruct', 'Qwen/Qwen3-VL-32B-Instruct',
    ])
    expect(a.map(r => r.label)).toEqual(['自有 · SiliconFlow 硅基流动 · Qwen/Qwen3-VL-32B-Instruct'])
    const b = accountVisionRoutes(siliconAcct('Qwen/Qwen3-VL-8B-Instruct'), [
      'Qwen/Qwen3-VL-8B-Instruct', 'Qwen/Qwen3-VL-32B-Instruct',
    ])
    expect(b.map(r => r.label)).toEqual(['自有 · SiliconFlow 硅基流动 · Qwen/Qwen3-VL-32B-Instruct'])
  })
})

describe('dedupeVisionRoutes 按 label 去重（v0.1.393）', () => {
  it('同一 label 只留第一次出现，顺序不变', () => {
    const routes: WorkshopRoute[] = [
      { kind: 'free', key: 'free:a', label: '免费 · 模型 A' },
      { kind: 'account', key: 'acct:1', label: '自有 · 硅基流动 · Qwen/Qwen3-VL-8B-Instruct', accountId: '1' },
      { kind: 'account', key: 'acct:1:Qwen/Qwen3-VL-8B-Instruct', label: '自有 · 硅基流动 · Qwen/Qwen3-VL-8B-Instruct', accountId: '1', modelId: 'Qwen/Qwen3-VL-8B-Instruct' },
      { kind: 'account', key: 'acct:2:Qwen/Qwen3-VL-8B-Instruct', label: '自有 · 硅基流动 · Qwen/Qwen3-VL-8B-Instruct', accountId: '2', modelId: 'Qwen/Qwen3-VL-8B-Instruct' },
      { kind: 'account', key: 'acct:1:Qwen/Qwen3-VL-32B-Instruct', label: '自有 · 硅基流动 · Qwen/Qwen3-VL-32B-Instruct', accountId: '1', modelId: 'Qwen/Qwen3-VL-32B-Instruct' },
    ]
    const out = dedupeVisionRoutes(routes)
    expect(out.map(r => r.key)).toEqual(['free:a', 'acct:1', 'acct:1:Qwen/Qwen3-VL-32B-Instruct'])
  })
})

describe('describeVisionModel 一句话简介（v0.1.393）', () => {
  it('Ethan 确认过的文案逐条匹配', () => {
    expect(describeVisionModel('nvidia/nemotron-3-nano-omni')).toBe('英伟达轻量多模态小模型，免费、快，但能力一般，免费档易限速')
    expect(describeVisionModel('Qwen/Qwen3-VL-Embedding-8B')).toBe('只把图文转成向量，不出文字，不能索引')
    expect(describeVisionModel('Qwen/Qwen3-VL-Reranker-8B')).toBe('只给图文相关性打分排序，不出文字，不能索引')
    expect(describeVisionModel('PaddlePaddle/PaddleOCR-VL-1.5')).toBe('百度飞桨模型，专长认图里的文字，描述场景比较干')
    expect(describeVisionModel('Qwen/Qwen3-VL-8B-Instruct')).toBe('通义 8B 视觉模型，轻快便宜，描述够用，性价比最高')
    expect(describeVisionModel('Qwen/Qwen3-VL-32B-Instruct')).toBe('通义 32B 视觉模型，看图描述能力强，质量好，速度中等')
    expect(describeVisionModel('Qwen/Qwen3-VL-30B-A3B-Instruct')).toBe('30B 混合专家模型，质量接近 32B 但更快更便宜')
    expect(describeVisionModel('Qwen/Qwen3-Omni-30B-A3B-Instruct')).toBe('通义全模态模型，文字图片音频视频都能处理，描述能力强')
    expect(describeVisionModel('Qwen/Qwen3-Omni-30B-A3B-Captioner')).toBe('专门写图注的版本，最对口，描述最贴合图片内容')
  })
  it('Thinking 版统一是不推荐的简介', () => {
    for (const m of ['Qwen/Qwen3-VL-32B-Thinking', 'Qwen/Qwen3-VL-8B-Thinking', 'Qwen/Qwen3-Omni-30B-A3B-Thinking']) {
      expect(describeVisionModel(m)).toBe('回答前先推理，慢、费 token，贴标签用不上')
    }
  })
  it('未知的新模型给通用文案，不留空', () => {
    expect(describeVisionModel('SomeVendor/SomeNew-VL-99B')).toBe('视觉模型，可看图描述')
    expect(describeVisionModel('')).toBe('视觉模型，可看图描述')
  })
})

describe('visionRouteModelId', () => {
  it('免费路线查 freeOptions 的 modelId；自有路线用 modelId；基础路线回落 label', () => {
    const freeOptions = [{ key: 'k1', label: 'Nemotron', modelId: 'nvidia/nemotron-3-nano-omni' }] as never[]
    expect(visionRouteModelId({ kind: 'free', key: 'free:k1', label: '免费 · Nemotron' }, freeOptions)).toBe('nvidia/nemotron-3-nano-omni')
    expect(visionRouteModelId(
      { kind: 'account', key: 'acct:1:m', label: '自有 · 硅基流动 · Qwen/Qwen3-VL-8B-Instruct', accountId: '1', modelId: 'Qwen/Qwen3-VL-8B-Instruct' },
      freeOptions,
    )).toBe('Qwen/Qwen3-VL-8B-Instruct')
    expect(visionRouteModelId(
      { kind: 'account', key: 'acct:1', label: '自有 · 硅基流动 · Qwen/Qwen3-VL-32B-Thinking', accountId: '1' },
      freeOptions,
    )).toBe('自有 · 硅基流动 · Qwen/Qwen3-VL-32B-Thinking')
  })
})

describe('visionTagImage 失败时抛出真原因（v0.1.430，同款吞错修法）', () => {
  it('平台拒绝时报错里有真原因，不再是光秃秃的「调用失败」', async () => {
    vi.mocked(callChat).mockResolvedValue({ ok: false, text: '', error: '调用失败：接口返回 400：Invalid model' })
    let errMsg = ''
    try {
      await visionTagImage({
        route: { kind: 'account', key: 'acct:1', label: 'Qwen/Qwen3-VL-8B-Instruct', accountId: 'acct-silicon', modelId: 'Qwen/Qwen3-VL-8B-Instruct' },
        freeOptions: [],
        accounts: [siliconAcct('Qwen/Qwen3-VL-8B-Instruct')],
        sessionPwd: 'pwd',
        imageDataUrl: 'data:image/png;base64,xxx',
      })
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e)
    }
    expect(errMsg).toContain('400')
    expect(errMsg).not.toBe('调用失败')
  })
})
