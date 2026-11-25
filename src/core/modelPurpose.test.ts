import { describe, expect, it } from 'vitest'
import { classifyModelPurpose } from './modelPurpose'

// 用例取自 2026-11-23 实拉的 Zen / Kilo 免费清单真实 id
describe('classifyModelPurpose', () => {
  it('通用对话：flash 系归通用、带快速标签', () => {
    expect(classifyModelPurpose('deepseek-v4.1-flash-free').purpose).toBe('通用对话')
    expect(classifyModelPurpose('deepseek-v4.1-flash-free').tags).toContain('快速')
    expect(classifyModelPurpose('mimo-v2.6-flash-free').purpose).toBe('通用对话')
    expect(classifyModelPurpose('inclusionai/ling-3.2-flash:free').purpose).toBe('通用对话')
    expect(classifyModelPurpose('baidu/ernie-5.5-flash-preview:free').purpose).toBe('通用对话')
  })

  it('深度推理：ultra 与 reasoning 优先于看图', () => {
    expect(classifyModelPurpose('nvidia/nemotron-3-ultra-550b-a55b:free').purpose).toBe('深度推理')
    const omni = classifyModelPurpose('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')
    expect(omni.purpose).toBe('深度推理')
    expect(omni.tags).toContain('看图')
    expect(omni.tags).toContain('推理')
  })

  it('看图理解：VL 模型', () => {
    expect(classifyModelPurpose('nemotron-3.5-super-vl-free').purpose).toBe('看图理解')
    expect(classifyModelPurpose('nvidia/nemotron-3.5-super-vl:free').tags).toContain('看图')
  })

  it('代码倾向：flint 系优先于参数量判断', () => {
    expect(classifyModelPurpose('recursive/flint-v1.0:free').purpose).toBe('代码倾向')
    expect(classifyModelPurpose('flint-40b-free').purpose).toBe('代码倾向')
  })

  it('快速轻量：小参数量模型', () => {
    expect(classifyModelPurpose('liquid/lfm-3-1.7b:free').purpose).toBe('快速轻量')
  })

  it('未知小模型回退通用对话', () => {
    expect(classifyModelPurpose('iceman-free').purpose).toBe('通用对话')
    expect(classifyModelPurpose('beam-free').purpose).toBe('通用对话')
    expect(classifyModelPurpose('particle-ai/particle-1:free').purpose).toBe('通用对话')
  })

  it('lightning 带推理倾向的快速标签但归通用（无 reasoning 词）', () => {
    const info = classifyModelPurpose('nemotron-3.5-lightning-free')
    expect(info.purpose).toBe('通用对话')
    expect(info.tags).toContain('快速')
  })
})
