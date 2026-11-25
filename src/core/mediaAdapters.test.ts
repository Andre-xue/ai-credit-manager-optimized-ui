import { describe, expect, it } from 'vitest'
import type { Account } from './types'
import {
  detectMediaStyle, buildImageRequest, buildVideoRequest,
  extractTaskId, extractVideoUrl, videoTaskTerminal, describeModel, describeModels,
  filterMediaModels,
} from './mediaAdapters'

const acct = (apiUrl: string, providerId = 'custom'): Account => ({
  id: 'a1', providerId, label: 'test', mode: 'api', apiUrl,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
})

describe('服务商协议自动识别', () => {
  it('识别硅基流动（域名/备注/服务商 ID 任一命中）', () => {
    expect(detectMediaStyle(acct('https://api.siliconflow.cn/v1'))).toBe('siliconflow-video')
    expect(detectMediaStyle(acct('https://api.example.com', 'siliconflow'))).toBe('siliconflow-video')
    expect(detectMediaStyle({ ...acct('https://api.x.com'), label: '硅基流动' })).toBe('siliconflow-video')
  })
  it('其他服务商走 OpenAI 兼容', () => {
    expect(detectMediaStyle(acct('https://api.openai.com/v1', 'openai'))).toBe('openai-compatible')
    expect(detectMediaStyle(acct('http://127.0.0.1:11434/v1', 'local-ollama'))).toBe('openai-compatible')
  })
})

describe('协议请求体构造', () => {
  it('硅基生图用 image_size + num_inference_steps', () => {
    const r = buildImageRequest('siliconflow-video', 'Kwai-Kolors/Kolors', '猫', { size: '1024x1536', n: 2 })
    expect(r.path).toBe('/images/generations')
    expect((r.body as Record<string, unknown>).image_size).toBe('1024x1536')
    expect((r.body as Record<string, unknown>).num_inference_steps).toBe(20)
    expect((r.body as Record<string, unknown>).size).toBeUndefined()
  })
  it('硅基视频用 /video/submit 且 duration 限制在 5-15', () => {
    const r = buildVideoRequest('siliconflow-video', 'MiniMaxAI/MiniMax-H3', '猫', { duration: 99, ratio: '9:16', image: 'data:image/png;base64,x' })
    expect(r.submitPath).toBe('/video/submit')
    expect((r.body as Record<string, unknown>).duration).toBe(15)
    expect((r.body as Record<string, unknown>).ratio).toBe('9:16')
    expect(((r.body as Record<string, unknown>).images as { url: string; role: string }[])[0].role).toBe('first_frame')
    expect(r.statusPath).toBe('/video/status')
    expect(r.statusBody?.('abc')).toEqual({ requestId: 'abc' })
  })
  it('通用视频走 /videos/generations', () => {
    const r = buildVideoRequest('openai-compatible', 'some-video', '海浪', { duration: 5 })
    expect(r.submitPath).toBe('/videos/generations')
    expect((r.body as Record<string, unknown>).duration).toBe(5)
  })
})

describe('响应字段解析', () => {
  it('提取 requestId / id / task_id', () => {
    expect(extractTaskId({ requestId: 'r1' })).toBe('r1')
    expect(extractTaskId({ id: 123 })).toBe('123')
    expect(extractTaskId({ data: { task_id: 't1' } })).toBe('t1')
    expect(extractTaskId({})).toBe('')
  })
  it('提取硅基 results.videos[0].url 与通用字段', () => {
    expect(extractVideoUrl({ status: 'Succeed', results: { videos: [{ url: 'https://v.example.com/a.mp4' }] } })).toBe('https://v.example.com/a.mp4')
    expect(extractVideoUrl({ url: 'https://v.example.com/b.mp4' })).toBe('https://v.example.com/b.mp4')
    expect(extractVideoUrl({ data: { url: 'https://v.example.com/c.mp4' } })).toBe('https://v.example.com/c.mp4')
  })
  it('识别四种任务状态', () => {
    expect(videoTaskTerminal({ status: 'Succeed' })).toEqual({ done: true, failed: false, status: 'SUCCEED' })
    expect(videoTaskTerminal({ status: 'InQueue' }).done).toBe(false)
    expect(videoTaskTerminal({ status: 'InProgress' }).done).toBe(false)
    expect(videoTaskTerminal({ status: 'Failed' }).failed).toBe(true)
  })
})

describe('模型优缺点知识库与用途过滤', () => {
  it('已知模型给出优缺点与适用场景', () => {
    const info = describeModel('Kwai-Kolors/Kolors', 'image')
    expect(info.pros.length).toBeGreaterThan(0)
    expect(info.cons.length).toBeGreaterThan(0)
    expect(info.best).toBeTruthy()
    expect(describeModel('MiniMaxAI/MiniMax-H3', 'video').pros.join()).toContain('首尾帧')
  })
  it('未收录模型返回通用说明不臆造', () => {
    const info = describeModel('some-unknown-image-v7', 'image')
    expect(info.pros.join()).toContain('通用生图接口')
    expect(info.cons.join()).toContain('以服务商文档为准')
  })
  it('批量说明数量与输入一致', () => {
    expect(describeModels(['a', 'b'], 'video')).toHaveLength(2)
  })
  it('用途过滤：图像只留生图、视频只留视频', () => {
    const ids = ['Kwai-Kolors/Kolors', 'Qwen/Qwen-Image', 'MiniMaxAI/MiniMax-H3', 'Wan-AI/Wan2.2-T2V-A14B', 'deepseek-ai/DeepSeek-V4', 'BAAI/bge-m3']
    const imgs = filterMediaModels(ids, 'image')
    expect(imgs).toContain('Kwai-Kolors/Kolors')
    expect(imgs).not.toContain('MiniMaxAI/MiniMax-H3')
    const vids = filterMediaModels(ids, 'video')
    expect(vids).toContain('MiniMaxAI/MiniMax-H3')
    expect(vids).toContain('Wan-AI/Wan2.2-T2V-A14B')
    expect(vids).not.toContain('Kwai-Kolors/Kolors')
  })
})

describe('火山方舟 / 百炼视频适配', () => {
  it('按域名识别两家协议', () => {
    expect(detectMediaStyle(acct('https://ark.cn-beijing.volces.com/api/v3', 'doubao'))).toBe('volcengine-ark-video')
    expect(detectMediaStyle(acct('https://dashscope.aliyuncs.com/api/v1', 'qwen'))).toBe('dashscope-video')
  })
  it('方舟提交体：content 数组含文本与首帧，状态走 GET 路径', () => {
    const r = buildVideoRequest('volcengine-ark-video', 'doubao-seedance-1-0-pro', '海浪', { image: 'https://x/y.jpg', duration: 10, ratio: '9:16' })
    expect(r.submitPath).toBe('/contents/generations/tasks')
    const content = (r.body as any).content as any[]
    expect(content[0]).toEqual({ type: 'text', text: '海浪' })
    expect(content[1].type).toBe('image_url')
    expect(content[1].role).toBe('first_frame')
    expect(r.statusGetPath!('tid1')).toBe('/contents/generations/tasks/tid1')
    expect(extractVideoUrl({ content: { video_url: 'https://v/1.mp4' }, status: 'succeeded' })).toBe('https://v/1.mp4')
    expect(videoTaskTerminal({ status: 'succeeded' }).done).toBe(true)
    expect(videoTaskTerminal({ status: 'expired' }).failed).toBe(true)
  })
  it('百炼提交体：input/parameters 分离 + 异步头，任务号在 output 里', () => {
    const r = buildVideoRequest('dashscope-video', 'wan2.2-t2v-plus', '城市夜景', { duration: 5 })
    expect(r.submitPath).toContain('/services/aigc/video-generation/video-synthesis')
    expect(r.headers?.['X-DashScope-Async']).toBe('enable')
    expect((r.body as any).input.prompt).toBe('城市夜景')
    expect((r.body as any).parameters.duration).toBe(5)
    expect(extractTaskId({ output: { task_id: 'task-9' } })).toBe('task-9')
    expect(extractVideoUrl({ output: { task_status: 'SUCCEEDED', video_url: 'https://v/2.mp4' } })).toBe('https://v/2.mp4')
    expect(videoTaskTerminal({ output: { task_status: 'SUCCEEDED' } }).done).toBe(true)
    expect(videoTaskTerminal({ output: { task_status: 'FAILED' } }).failed).toBe(true)
  })
})
