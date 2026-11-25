import { describe, expect, it } from 'vitest'
import { isComfyUIBase, buildTxt2ImgWorkflow, buildImg2ImgWorkflow, buildAnimateDiffWorkflow, motionModelsFromNodeInfo, stripComfyCategoryPrefix, resolveComfyModelName } from './comfyui'

describe('ComfyUI 原生协议适配', () => {
  it('按地址识别 ComfyUI（8188 端口或域名含 comfyui）', () => {
    expect(isComfyUIBase('http://127.0.0.1:8188')).toBe(true)
    expect(isComfyUIBase('http://localhost:8188/')).toBe(true)
    expect(isComfyUIBase('http://192.168.1.5:8188/comfyui')).toBe(true)
    expect(isComfyUIBase('http://127.0.0.1:11434')).toBe(false)
    expect(isComfyUIBase('http://127.0.0.1:8080')).toBe(false)
  })

  it('txt2img 工作流包含完整节点链与正确参数', () => {
    const wf = buildTxt2ImgWorkflow('v1-5.safetensors', 'a cat', {
      width: 768, height: 512, steps: 25, cfgScale: 8, seed: 123,
      sampler: 'DPM++ 2M Karras', negativePrompt: 'blurry', n: 2,
    }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(wf['1'].class_type).toBe('CheckpointLoaderSimple')
    expect(wf['1'].inputs.ckpt_name).toBe('v1-5.safetensors')
    expect(wf['2'].inputs.text).toBe('a cat')
    expect(wf['3'].inputs.text).toBe('blurry')
    expect(wf['4'].inputs).toMatchObject({ width: 768, height: 512, batch_size: 2 })
    expect(wf['5'].inputs).toMatchObject({ seed: 123, steps: 25, cfg: 8, sampler_name: 'dpmpp_2m', scheduler: 'karras' })
    expect(wf['5'].inputs.positive).toEqual(['2', 0])
    expect(wf['6'].class_type).toBe('VAEDecode')
    expect(wf['7'].class_type).toBe('SaveImage')
  })

  it('Euler 采样器去掉 Karras 后缀并用 normal 调度', () => {
    const wf = buildTxt2ImgWorkflow('m.safetensors', 'x', { sampler: 'Euler' }) as Record<string, { inputs: Record<string, unknown> }>
    expect(wf['5'].inputs.sampler_name).toBe('euler')
    expect(wf['5'].inputs.scheduler).toBe('normal')
  })

  it('img2img 工作流用 LoadImage + VAEEncode + denoise 强度', () => {
    const wf = buildImg2ImgWorkflow('m.safetensors', 'a cat', 'src.png', { strength: 0.55, seed: 9 }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(wf['4'].class_type).toBe('LoadImage')
    expect(wf['4'].inputs.image).toBe('src.png')
    expect(wf['5'].class_type).toBe('VAEEncode')
    expect(wf['6'].inputs.denoise).toBe(0.55)
    expect(wf['6'].inputs.seed).toBe(9)
    expect(wf['8'].class_type).toBe('SaveImage')
  })
})

describe('AnimateDiff 工作流构造', () => {
  const wf = buildAnimateDiffWorkflow('checkpoints/AnythingV5V3.safetensors', 'mm_sd_v15_v2.ckpt', 'a cat running', {
    negativePrompt: 'blurry', width: 768, height: 432, steps: 20, cfgScale: 7, seed: 42, frames: 16, fps: 8,
  }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>

  it('底模与运动模块正确接线', () => {
    expect(wf['1'].class_type).toBe('CheckpointLoaderSimple')
    expect(wf['1'].inputs.ckpt_name).toBe('checkpoints/AnythingV5V3.safetensors')
    expect(wf['8'].class_type).toBe('ADE_LoadAnimateDiffModel')
    expect(wf['8'].inputs.model_name).toBe('mm_sd_v15_v2.ckpt')
    expect(wf['9'].class_type).toBe('ADE_ApplyAnimateDiffModel')
    // ADE 现行 V3 schema 无 model 输入（旧版才有），不得再传
    expect(wf['9'].inputs.model).toBeUndefined()
    expect(wf['9'].inputs.motion_model).toEqual(['8', 0])
    expect(wf['10'].class_type).toBe('ADE_UseEvolvedSampling')
    expect(wf['10'].inputs.m_models).toEqual(['9', 0])
  })

  it('采样器吃进化采样后的模型，帧数走 batch_size', () => {
    expect(wf['5'].class_type).toBe('KSampler')
    expect(wf['5'].inputs.model).toEqual(['10', 0])
    expect(wf['5'].inputs.sampler_name).toBe('euler_ancestral')
    expect(wf['4'].inputs.batch_size).toBe(16)
    expect(wf['4'].inputs.width).toBe(768)
    expect(wf['4'].inputs.height).toBe(432)
  })

  it('VHS 合成 mp4 输出', () => {
    expect(wf['7'].class_type).toBe('VHS_VideoCombine')
    expect(wf['7'].inputs.images).toEqual(['6', 0])
    expect(wf['7'].inputs.format).toBe('video/h264-mp4')
    expect(wf['7'].inputs.frame_rate).toBe(8)
  })
})

describe('运动模块清单解析（ADE object_info）', () => {
  it('从旧格式节点信息解析 model_name 选项', () => {
    const info = { input: { required: { model_name: [['mm_sd_v15_v2.ckpt', 'mm_sd_v15_v2.5.ckpt'], {}] } } } as Record<string, unknown>
    expect(motionModelsFromNodeInfo(info)).toEqual(['mm_sd_v15_v2.ckpt', 'mm_sd_v15_v2.5.ckpt'])
  })
  it('从 V3 COMBO 格式解析 model_name 选项（实测 ADE 1.6 返回形状）', () => {
    const info = { input: { required: { model_name: ['COMBO', { multiselect: false, options: ['mm_sd_v15_v2.ckpt'] }] } } } as Record<string, unknown>
    expect(motionModelsFromNodeInfo(info)).toEqual(['mm_sd_v15_v2.ckpt'])
  })
  it('节点不存在或结构异常时返回空', () => {
    expect(motionModelsFromNodeInfo(null)).toEqual([])
    expect(motionModelsFromNodeInfo({})).toEqual([])
    expect(motionModelsFromNodeInfo({ input: { required: { model_name: ['notarray'] } } } as Record<string, unknown>)).toEqual([])
  })
})

describe('模型名与服务器清单对齐（v0.1.288）', () => {
  const server = ['Realistic_Vision_V6.0_NV_B1.safetensors', 'AnythingV5V3_v5Pruned.safetensors']
  it('扫盘命名的 checkpoints/ 前缀被剥掉对齐服务器裸名', () => {
    expect(resolveComfyModelName('checkpoints/Realistic_Vision_V6.0_NV_B1.safetensors', server, 'checkpoints'))
      .toBe('Realistic_Vision_V6.0_NV_B1.safetensors')
  })
  it('服务器清单带前缀时反向补上', () => {
    expect(resolveComfyModelName('mm_sd_v15_v2.ckpt', ['animatediff_models/mm_sd_v15_v2.ckpt'], 'animatediff_models'))
      .toBe('animatediff_models/mm_sd_v15_v2.ckpt')
  })
  it('精确命中、清单为空或对不上时原样返回', () => {
    expect(resolveComfyModelName('AnythingV5V3_v5Pruned.safetensors', server, 'checkpoints')).toBe('AnythingV5V3_v5Pruned.safetensors')
    expect(resolveComfyModelName('checkpoints/x.safetensors', [], 'checkpoints')).toBe('checkpoints/x.safetensors')
    expect(resolveComfyModelName('checkpoints/not-there.safetensors', server, 'checkpoints')).toBe('checkpoints/not-there.safetensors')
  })
  it('stripComfyCategoryPrefix 只剥目标分类前缀，子目录保留', () => {
    expect(stripComfyCategoryPrefix('checkpoints/SD15/a.safetensors', 'checkpoints')).toBe('SD15/a.safetensors')
    expect(stripComfyCategoryPrefix('loras/a.safetensors', 'checkpoints')).toBe('loras/a.safetensors')
  })
})

describe('historyErrorDetail（v0.1.288）', () => {
  it('从 status.messages 提取 execution_error 的节点与异常', async () => {
    const { historyErrorDetail } = await import('./comfyui')
    const entry = {
      status: {
        status_str: 'error',
        messages: [
          ['execution_start', { prompt_id: 'x' }],
          ['execution_error', { node_id: '7', node_type: 'VHS_VideoCombine', exception_type: 'RuntimeError', exception_message: 'ffmpeg is not installed' }],
        ],
      },
    }
    expect(historyErrorDetail(entry)).toBe('VHS_VideoCombine 节点执行出错：RuntimeError: ffmpeg is not installed')
  })
  it('无 execution_error 时返回空串', async () => {
    const { historyErrorDetail } = await import('./comfyui')
    expect(historyErrorDetail({ status: { status_str: 'success', messages: [] } })).toBe('')
    expect(historyErrorDetail(null)).toBe('')
    expect(historyErrorDetail({})).toBe('')
  })
})

describe('KSampler 必须接底模输出（v0.1.289 回归）', () => {
  it('文生图工作流 KSampler 的 model 接 CheckpointLoader 输出', () => {
    const wf = buildTxt2ImgWorkflow('AnythingV5V3_v5PrtRE.safetensors', 'a cat', { seed: 1 }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(wf['5'].class_type).toBe('KSampler')
    expect(wf['5'].inputs.model).toEqual(['1', 0])
  })
  it('图生图工作流 KSampler 的 model 同样接上', () => {
    const wf = buildImg2ImgWorkflow('AnythingV5V3_v5PrtRE.safetensors', 'a cat', 'src.png', { seed: 1 }) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(wf['6'].class_type).toBe('KSampler')
    expect(wf['6'].inputs.model).toEqual(['1', 0])
  })
})
