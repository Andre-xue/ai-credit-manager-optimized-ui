import { describe, it, expect } from 'vitest'
import { detectModelCapability, shouldHideFromChat, isMotionModule } from './modelCapability'

describe('模型能力识别', () => {
  it('识别嵌入模型（含标签变体）', () => {
    for (const name of ['nomic-embed-text:latest', 'nomic-embed-text', 'mxbai-embed-large', 'bge-m3', 'text-embedding-3-small']) {
      const r = detectModelCapability(name)
      expect(r.capability, name).toBe('embedding')
      expect(shouldHideFromChat(r), name).toBe(true)
    }
  })
  it('识别翻译模型', () => {
    const r = detectModelCapability('hy-mt2:1.8b')
    expect(r.capability).toBe('translation')
    expect(r.chatCapable).toBe(true) // 翻译走 chat 接口，保留但不推荐
  })
  it('识别通用对话模型', () => {
    for (const name of ['llama3.2:3b', 'qwen2.5:3b', 'deepseek-v4-pro-4b-uncensored:latest', 'gemma2:9b']) {
      const r = detectModelCapability(name)
      expect(r.capability, name).toBe('chat')
      expect(shouldHideFromChat(r), name).toBe(false)
    }
  })
  it('识别图像与音频模型', () => {
    expect(detectModelCapability('llava:latest').capability).toBe('image')
    expect(detectModelCapability('whisper-large-v3').capability).toBe('audio')
    expect(shouldHideFromChat(detectModelCapability('llava'))).toBe(true)
  })
  it('识别 ComfyUI/SD 绘图模型（带目录前缀）', () => {
    const comfyModels = [
      'checkpoints/AnythingV5V3_v5PrtRE.safetensors',
      'checkpoints/Realistic_Vision_V6.0_NV_B1.safetensors',
      'checkpoints/v1-5-pruned-emaonly-fp16.safetensors',
      'checkpoints/dreamshaper_8.safetensors',   // 通用名兜底
      'loras/some_lora.safetensors',             // LoRA 也算图像类
    ]
    for (const name of comfyModels) {
      const r = detectModelCapability(name)
      expect(r.capability, name).toBe('image')
      expect(shouldHideFromChat(r), name).toBe(true)
    }
  })
  it('AnimateDiff 运动模块识别为视频·运动模块（不是图像底模）', () => {
    for (const name of ['animatediff_models/mm_sd_v15_v2.ckpt', 'mm_sd_v15_v2.ckpt', 'models/motion_module.ckpt']) {
      expect(isMotionModule(name), name).toBe(true)
      const r = detectModelCapability(name)
      expect(r.capability, name).toBe('video')
      expect(r.label, name).toBe('视频·运动模块')
      expect(shouldHideFromChat(r), name).toBe(true)
    }
    // 真 checkpoint 不得误判为运动模块
    expect(isMotionModule('checkpoints/AnythingV5V3_v5PrtRE.safetensors')).toBe(false)
    expect(isMotionModule('checkpoints/v1-5-pruned-emaonly-fp16.safetensors')).toBe(false)
  })
  it('绘图规则不误伤对话模型', () => {
    for (const name of ['llama3.2:3b', 'qwen2.5:3b', 'deepseek-v4-pro-4b-uncensored:latest']) {
      expect(detectModelCapability(name).capability, name).toBe('chat')
    }
  })
  it('未知模型默认可聊天（保守，避免误杀）', () => {
    const r = detectModelCapability('my-custom-model')
    expect(r.capability).toBe('unknown')
    expect(shouldHideFromChat(r)).toBe(false)
  })
})
