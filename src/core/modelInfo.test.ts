import { describe, it, expect } from 'vitest'
import { kbModelInfo, inferModelInfo, civitaiQueryOf, mapCivitaiItem, baseNameOf } from './modelInfo'

describe('本地模型资料：知识库', () => {
  it('Ethan 现有四个文件全部命中精选资料', () => {
    const motion = kbModelInfo('animatediff_models/mm_sd_v15_v2.ckpt')
    expect(motion?.source).toBe('kb')
    expect(motion?.tagline).toContain('运动模块')
    expect(kbModelInfo('checkpoints/AnythingV5V3_v5PrtRE.safetensors')?.tagline).toContain('Anything')
    expect(kbModelInfo('checkpoints/Realistic_Vision_V6.0_NV_B1.safetensors')?.tagline).toContain('Realistic Vision')
    expect(kbModelInfo('checkpoints/v1-5-pruned-emaonly-fp16.safetensors')?.tagline).toContain('1.5')
  })
  it('LoRA/VAE/ControlNet 给出非底模说明', () => {
    expect(kbModelInfo('loras/style_lora.safetensors')?.tagline).toContain('LoRA')
    expect(kbModelInfo('vae/kl-f8-anime2.safetensors')?.tagline).toContain('VAE')
    expect(kbModelInfo('controlnet/control_v11p_sd15_openpose.pth')?.tagline).toContain('ControlNet')
  })
  it('未知模型知识库未命中，推断兜底标注 infer', () => {
    expect(kbModelInfo('checkpoints/some_new_model_2026.safetensors')).toBeNull()
    const inf = inferModelInfo('checkpoints/some_new_model_2026.safetensors')
    expect(inf.source).toBe('infer')
    expect(inf.pros.length).toBeGreaterThan(0)
    expect(inferModelInfo('checkpoints/big_xl_model.safetensors').tagline).toContain('SDXL')
  })
})

describe('Civitai 查询与映射', () => {
  it('文件名清洗为搜索词', () => {
    expect(civitaiQueryOf('checkpoints/Realistic_Vision_V6.0_NV_B1.safetensors')).toBe('Realistic Vision')
    expect(civitaiQueryOf('AnythingV5V3_v5PrtRE.safetensors')).toBe('AnythingV5V3')
    expect(baseNameOf('a/b/model.ckpt')).toBe('model')
  })
  it('命中结果映射出简介/标签/热度与来源链接', () => {
    const info = mapCivitaiItem({
      id: 4201, name: 'Realistic Vision V6.0 B1', type: 'Checkpoint',
      description: '<p>Promo https://example.com skip me.</p><p>Realistic Vision is a photorealistic Stable Diffusion model focused on portraits and lifelike skin textures for creators.</p>',
      tags: ['photorealistic', 'portrait'],
      stats: { downloadCount: 250000, rating: 4.8, ratingCount: 1200 },
    }, 'Realistic Vision')
    expect(info?.source).toBe('civitai')
    expect(info?.sourceUrl).toBe('https://civitai.com/models/4201')
    expect(info?.style).toContain('photorealistic')
    expect(info?.intro).toContain('photorealistic Stable Diffusion')
    expect(info?.intro).not.toContain('Promo')
    expect(info?.stats).toContain('下载 25.0 万')
  })
  it('不相关结果被拒绝', () => {
    expect(mapCivitaiItem({ id: 1, name: 'Completely Different Thing', type: 'Checkpoint' }, 'Realistic Vision')).toBeNull()
  })
})
