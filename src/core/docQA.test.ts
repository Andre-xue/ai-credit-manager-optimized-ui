import { describe, it, expect } from 'vitest'
import { chunkText, cosineSimilarity, buildContextPrompt, filterEmbeddingModels, shouldWarnEmbed } from './docQA'
import type { DocChunk } from './docQA'

describe('文档问答核心逻辑', () => {
  it('短文本不切块', () => {
    expect(chunkText('短文本')).toEqual(['短文本'])
  })
  it('长文本按大小切块且有重叠', () => {
    const text = '甲'.repeat(500) + '。' + '乙'.repeat(500)
    const chunks = chunkText(text, 300, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.length <= 301)).toBe(true)
  })
  it('空文本返回空数组', () => {
    expect(chunkText('   ')).toEqual([])
  })
  it('余弦相似度：相同向量为1，正交为0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([], [1])).toBe(0)
  })
  it('组装上下文含引用且要求不编造', () => {
    const chunk: DocChunk = { id: 'd#0', docId: 'd', docName: '手册.txt', index: 0, text: '重置密码请点这里', vector: [] }
    const prompt = buildContextPrompt('怎么重置密码?', [{ chunk, score: 0.9 }])
    expect(prompt).toContain('手册.txt')
    expect(prompt).toContain('重置密码请点这里')
    expect(prompt).toContain('不要编造')
    expect(prompt).toContain('怎么重置密码?')
  })
})

describe('文档问答嵌入模型选择与检测', () => {
  it('从已装模型筛出嵌入类', () => {
    expect(filterEmbeddingModels(['llama3.2:3b', 'nomic-embed-text:latest', 'qwen2.5:3b', 'bge-m3']))
      .toEqual(['nomic-embed-text:latest', 'bge-m3'])
  })
  it('去重后保留嵌入模型', () => {
    expect(filterEmbeddingModels(['nomic-embed-text', 'nomic-embed-text'])).toEqual(['nomic-embed-text'])
  })
  it('所选模型不在已装列表时提示', () => {
    expect(shouldWarnEmbed(true, ['nomic-embed-text'], 'bge-m3')).toBe(true)
    expect(shouldWarnEmbed(true, ['nomic-embed-text'], 'nomic-embed-text')).toBe(false)
  })
  it('未拉取过列表不误报', () => {
    expect(shouldWarnEmbed(false, [], 'nomic-embed-text')).toBe(false)
  })
})

describe('关键词检索打分（云端无Ollama降级）', () => {
  it('相关文本得分高于无关文本', async () => {
    const { keywordScore } = await import('./docQA')
    const q = '怎么重置密码'
    const relevant = keywordScore(q, '如果忘记登录密码，可以在设置页面重置密码。点击重置密码按钮即可。')
    const irrelevant = keywordScore(q, '今天天气很好，适合出去散步和运动。')
    expect(relevant).toBeGreaterThan(irrelevant)
    expect(relevant).toBeGreaterThan(0)
    expect(irrelevant).toBe(0)
  })
  it('英文关键词也能匹配', async () => {
    const { keywordScore } = await import('./docQA')
    expect(keywordScore('reset password', 'You can reset password in settings.')).toBeGreaterThan(0)
    expect(keywordScore('reset password', '完全不相关的中文内容')).toBe(0)
  })
})
