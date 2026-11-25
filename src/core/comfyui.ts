// ComfyUI 原生 API 适配：POST /prompt 提交工作流 → GET /history/{id} 查询结果 → GET /view 取图。
// ComfyUI 不提供 OpenAI 兼容 /v1/images/generations，必须走这套自己的协议。
// 桌面端通过 Rust comfyui_api 命令代理（绕 CORS + 二进制取图）；Web 端直连（可能受 CORS 限制）。

import type { ImageOptions } from './providerCall'

export interface ComfyResult {
  ok: boolean
  images: string[]   // data URL（本地取图后转）
  error?: string
  taskId?: string
}

export function isComfyUIBase(base: string): boolean {
  const b = base.toLowerCase()
  return /:8188\b|:8189\b|:8288\b|comfyui/.test(b)
}

/** UI 采样器显示名 → ComfyUI sampler_name 合法枚举值 */
export function comfySamplerName(sampler: string): string {
  const s = sampler.toLowerCase()
  if (s.includes('dpm++ 2m sde') || s.includes('dpmpp_2m_sde')) return 'dpmpp_2m_sde'
  if (s.includes('dpm++ 2m') || s.includes('dpmpp_2m')) return 'dpmpp_2m'
  if (s.includes('dpm++ sde')) return 'dpmpp_sde'
  if (s.includes('dpm')) return 'dpmpp_2m'
  if (s.includes('euler a') || s.includes('eulera')) return 'euler_ancestral'
  if (s.includes('euler')) return 'euler'
  if (s.includes('ddim')) return 'ddim'
  if (s.includes('unipc')) return 'uni_pc'
  if (s.includes('lms')) return 'lms'
  if (s.includes('heun')) return 'heun'
  return 'dpmpp_2m'
}

/** 构造一个标准的 SD txt2img 工作流（Checkpoint → CLIP 正负 → EmptyLatent → KSampler → VAE → SaveImage） */
export function buildTxt2ImgWorkflow(model: string, prompt: string, opts?: ImageOptions): Record<string, unknown> {
  const w = opts?.width ?? 1024
  const h = opts?.height ?? 1024
  const steps = opts?.steps ?? 20
  const cfg = opts?.cfgScale ?? 7
  const seed = opts?.seed ?? Math.floor(Math.random() * 4294967295)
  const sampler = opts?.sampler || 'DPM++ 2M Karras'
  const scheduler = /karras/i.test(sampler) ? 'karras' : 'normal'
  const samplerName = comfySamplerName(sampler)
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: opts?.negativePrompt ?? '', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: opts?.n ?? 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        seed, steps, cfg, sampler_name: samplerName, scheduler,
        positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], denoise: 1,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'acm_local' } },
  }
}

/** 构造 img2img 工作流（LoadImage → VAEEncode → KSampler denoise → VAEDecode → SaveImage）
 *  注意：源图需先通过 ComfyUI 的 /upload/image 上传，此处 base64 源图通过 data URI 传入由桥接处理。 */
export function buildImg2ImgWorkflow(model: string, prompt: string, imageName: string, opts?: ImageOptions): Record<string, unknown> {
  const wf = buildTxt2ImgWorkflow(model, prompt, opts) as Record<string, Record<string, unknown>>
  const steps = opts?.steps ?? 20
  const cfg = opts?.cfgScale ?? 7
  const seed = opts?.seed ?? Math.floor(Math.random() * 4294967295)
  const sampler = opts?.sampler || 'DPM++ 2M Karras'
  const scheduler = /karras/i.test(sampler) ? 'karras' : 'normal'
  const samplerName = comfySamplerName(sampler)
  return {
    '1': wf['1'], '2': wf['2'], '3': wf['3'],
    '4': { class_type: 'LoadImage', inputs: { image: imageName } },
    '5': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } },
    '6': {
      class_type: 'KSampler',
      inputs: { model: ['1', 0], seed, steps, cfg, sampler_name: samplerName, scheduler, positive: ['2', 0], negative: ['3', 0], latent_image: ['5', 0], denoise: opts?.strength ?? 0.7 },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'acm_local_i2i' } },
  }
}

/** 调用桌面端 Rust comfyui_api 命令 */
async function invokeComfy(base: string, endpoint: string, method: string, body: unknown, wantImage: boolean): Promise<string> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<string> } }
  const invoke = w.__TAURI_INTERNALS__?.invoke
  if (!invoke) throw new Error('桌面接口不可用（ComfyUI 生图需在桌面客户端使用）')
  return invoke('comfyui_api', {
    baseUrl: base, endpoint, method,
    bodyJson: body ? JSON.stringify(body) : '', wantImage,
  })
}

/** Web 端直连 ComfyUI（localhost 通常允许，但跨域时可能失败） */
async function fetchComfy(base: string, endpoint: string, method: string, body: unknown, wantImage: boolean): Promise<string> {
  const res = await fetch(`${base.replace(/\/+$/, '')}/${endpoint.replace(/^\//, '')}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`ComfyUI 接口返回 ${res.status}`)
  if (wantImage) {
    const buf = await res.arrayBuffer()
    let bin = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `data:image/png;base64,${btoa(bin)}`
  }
  return res.text()
}

const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const call = (base: string, endpoint: string, method: string, body: unknown, wantImage: boolean) =>
  isDesktop() ? invokeComfy(base, endpoint, method, body, wantImage) : fetchComfy(base, endpoint, method, body, wantImage)

/** 解析 object_info 里组合框（combo）输入的选项清单，兼容两种序列化格式：
 *  旧格式（经典 INPUT_TYPES 节点）：[选项数组, 附加参数]
 *  V3 格式（io schema 节点，如 ADE Gen2 加载器）：["COMBO", { options: 选项数组 }]
 *  （2026-11-21 实测 ComfyUI 0.46 + ADE 1.6：model_name 即 V3 格式，只读 [0] 会拿到字符串 "COMBO" 而误判清单为空） */
export function comboOptionsFromSpec(spec: unknown): string[] {
  if (!Array.isArray(spec)) return []
  const arr = Array.isArray(spec[0]) ? spec[0] : (spec[1] as { options?: unknown } | undefined)?.options
  return Array.isArray(arr) ? arr.filter((x: unknown): x is string => typeof x === 'string') : []
}

/** 剥掉模型名的分类目录前缀：扫盘清单是相对 models 根目录的路径（checkpoints/xxx.safetensors），
 *  ComfyUI 加载器的合法值是相对分类目录的路径（xxx.safetensors，即 object_info 的格式） */
export function stripComfyCategoryPrefix(name: string, category: 'checkpoints' | 'animatediff_models'): string {
  const prefix = category + '/'
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/** 把选中的模型名对齐到当前服务器 object_info 的合法值：精确命中优先；否则试剥/补分类前缀；
 *  都对不上或清单为空时原样返回（错误由服务器返回）。
 *  背景（2026-11-21 实测）：扫盘命名的 checkpoints/Realistic_Vision.safetensors 被服务器以
 *  value_not_in_list 拒收（400 prompt_outputs_failed_validation）——同一文件在不同来源下有两种命名，
 *  提交前必须按当前服务器的清单对齐（用户有两套 ComfyUI 实例，命名以正在服务的那套为准）。 */
export function resolveComfyModelName(selected: string, serverList: string[], category: 'checkpoints' | 'animatediff_models'): string {
  if (!selected || !serverList.length || serverList.includes(selected)) return selected
  const stripped = stripComfyCategoryPrefix(selected, category)
  if (stripped !== selected && serverList.includes(stripped)) return stripped
  const prefixed = category + '/' + selected
  if (serverList.includes(prefixed)) return prefixed
  return selected
}

/** 从 ComfyUI 实时 API 拉取可用 checkpoint 列表；失败返回空数组由调用方回退到扫目录 */
export async function fetchComfyCheckpoints(base: string): Promise<string[]> {
  try {
    const text = await call(base, 'object_info/CheckpointLoaderSimple', 'GET', undefined, false)
    const json = JSON.parse(text)
    return comboOptionsFromSpec(json?.CheckpointLoaderSimple?.input?.required?.ckpt_name)
  } catch { return [] }
}

/** 拉取单个节点的 object_info（节点不存在/未安装对应扩展时返回 null） */
async function fetchComfyNodeInfo(base: string, className: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await call(base, `object_info/${className}`, 'GET', undefined, false)
    const json = JSON.parse(text)
    return (json?.[className] as Record<string, unknown>) ?? null
  } catch { return null }
}

/** 从 ADE_LoadAnimateDiffModel 的 object_info 解析运动模块清单（model_name 组合选项） */
export function motionModelsFromNodeInfo(info: Record<string, unknown> | null): string[] {
  const req = (info?.input as { required?: Record<string, unknown> } | undefined)?.required
  return comboOptionsFromSpec(req?.model_name)
}

/** 拉取 AnimateDiff 运动模块列表（ADE_LoadAnimateDiffModel 的 model_name 选项，即 models/animatediff_models 目录）；
 *  ADE 扩展未安装时返回空数组 */
export async function fetchComfyMotionModules(base: string): Promise<string[]> {
  return motionModelsFromNodeInfo(await fetchComfyNodeInfo(base, 'ADE_LoadAnimateDiffModel'))
}

export type MotionModuleState = 'ready' | 'no-extension' | 'no-files'

/** 运动模块可用状态：区分「扩展没装（ADE 节点不存在）」与「扩展已装但没扫到文件」——两者的解决办法完全不同 */
export async function fetchComfyMotionModuleStatus(base: string): Promise<{ state: MotionModuleState; models: string[] }> {
  const info = await fetchComfyNodeInfo(base, 'ADE_LoadAnimateDiffModel')
  if (!info) return { state: 'no-extension', models: [] }
  const models = motionModelsFromNodeInfo(info)
  return models.length ? { state: 'ready', models } : { state: 'no-files', models: [] }
}

export interface AnimateDiffOptions {
  negativePrompt?: string
  width: number
  height: number
  steps?: number
  cfgScale?: number
  seed?: number
  /** 帧数：无上下文选项时按 AnimateDiff 原生上下文固定 16 */
  frames?: number
  /** 输出帧率（VHS 合成用） */
  fps?: number
}

/** 构造 AnimateDiff 文生视频工作流（需 ComfyUI-AnimateDiff-Evolved + VideoHelperSuite 扩展）：
 *  Checkpoint → ADE 加载/应用运动模块 → EvolvedSampling → KSampler(euler_ancestral) → VAE → VHS 合成 mp4 */
export function buildAnimateDiffWorkflow(checkpoint: string, motionModel: string, prompt: string, opts: AnimateDiffOptions): Record<string, unknown> {
  const steps = opts.steps ?? 20
  const cfg = opts.cfgScale ?? 7
  const seed = opts.seed ?? Math.floor(Math.random() * 4294967295)
  const frames = opts.frames ?? 16
  const fps = opts.fps ?? 8
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: opts.negativePrompt ?? '', clip: ['1', 1] } },
    '8': { class_type: 'ADE_LoadAnimateDiffModel', inputs: { model_name: motionModel } },
    // 注意：ADE 现行 V3 schema 的 ApplyAnimateDiffModel 没有 model 输入（旧版才有），多传会被现行版拒/误处理，故只给 motion_model + 起止百分比
    '9': { class_type: 'ADE_ApplyAnimateDiffModel', inputs: { motion_model: ['8', 0], start_percent: 0, end_percent: 1 } },
    '10': { class_type: 'ADE_UseEvolvedSampling', inputs: { model: ['1', 0], beta_schedule: 'sqrt_linear (AnimateDiff)', m_models: ['9', 0] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: opts.width, height: opts.height, batch_size: frames } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg, sampler_name: 'euler_ancestral', scheduler: 'normal',
        model: ['10', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], denoise: 1,
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['6', 0], frame_rate: fps, loop_count: 0, filename_prefix: 'acm_anim',
        format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 19,
        save_metadata: true, pingpong: false, save_output: true,
      },
    },
  }
}

/** 查询 AnimateDiff 任务状态；完成时返回视频 data URL（VHS 输出在 history 的 gifs 字段） */
export async function comfyPollVideo(base: string, promptId: string): Promise<{ done: boolean; videos: string[]; status: string; errorDetail: string }> {
  const text = await call(base, `history/${encodeURIComponent(promptId)}`, 'GET', undefined, false)
  const json = JSON.parse(text)
  const entry = json[promptId]
  if (!entry) return { done: false, videos: [], status: '排队中', errorDetail: '' }
  const status = String(entry.status?.status_str ?? entry.status ?? '')
  const outputs = entry.outputs ?? {}
  const videos: string[] = []
  for (const node of Object.values(outputs) as { gifs?: { filename: string; subfolder?: string; type?: string }[] }[]) {
    for (const g of node.gifs ?? []) {
      const q = `view?filename=${encodeURIComponent(g.filename)}&subfolder=${encodeURIComponent(g.subfolder ?? '')}&type=${encodeURIComponent(g.type ?? 'output')}`
      const raw = await call(base, q, 'GET', undefined, true)
      const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
      videos.push(`data:video/mp4;base64,${b64}`)
    }
  }
  const done = /success|complete/i.test(status) || videos.length > 0
  return { done, videos, status: status || (videos.length ? '完成' : '生成中'), errorDetail: historyErrorDetail(entry) }
}

/** 一键 AnimateDiff 生视频：扩展预检 → 提交 → 轮询（最长约 5 分钟）→ 取 mp4 */
export async function comfyGenerateAnimateDiff(
  base: string, checkpoint: string, motionModel: string, prompt: string, opts: AnimateDiffOptions,
  onProgress: (pct: number, label: string) => void,
  alive: () => boolean,
): Promise<ComfyResult> {
  try {
    if (!(await fetchComfyNodeInfo(base, 'ADE_LoadAnimateDiffModel'))) {
      return { ok: false, images: [], error: '未检测到 AnimateDiff 扩展节点（ADE_LoadAnimateDiffModel）。请先在 ComfyUI 中安装 ComfyUI-AnimateDiff-Evolved 扩展，并确认运动模块在 models/animatediff_models 目录，重启 ComfyUI 后再试' }
    }
    if (!(await fetchComfyNodeInfo(base, 'VHS_VideoCombine'))) {
      return { ok: false, images: [], error: '未检测到 VideoHelperSuite 扩展节点（VHS_VideoCombine）。请先在 ComfyUI 中安装 ComfyUI-VideoHelperSuite 扩展，重启 ComfyUI 后再试' }
    }
    const resolvedCkpt = resolveComfyModelName(checkpoint, await fetchComfyCheckpoints(base), 'checkpoints')
    const resolvedMotion = resolveComfyModelName(motionModel, await fetchComfyMotionModules(base), 'animatediff_models')
    const workflow = buildAnimateDiffWorkflow(resolvedCkpt, resolvedMotion, prompt, opts)
    onProgress(25, 'AnimateDiff 工作流已构造，正在提交…')
    const promptId = await comfySubmit(base, workflow)
    onProgress(40, '任务已提交，ComfyUI 排队中…')
    // 等待上限 15 分钟：M1 级别机器跑 16 帧 × 20 步 AnimateDiff 常见 5–10 分钟，
    // 旧上限 5 分钟会在任务其实还在正常生成时误报超时（2026-11-21 用户实测「卡在 88%」即此）。
    // 进度改为按已等待时间如实爬升（封顶 95%），文案带已等待时长，不再假装快完成。
    const startedAt = Date.now()
    for (let i = 0; i < 450 && alive(); i++) {
      await new Promise(r => setTimeout(r, 2000))
      if (!alive()) return { ok: false, images: [], error: '已取消' }
      const r = await comfyPollVideo(base, promptId)
      if (r.videos.length) return { ok: true, images: r.videos, taskId: promptId }
      const waited = Math.floor((Date.now() - startedAt) / 1000)
      const waitedText = `${Math.floor(waited / 60)}:${String(waited % 60).padStart(2, '0')}`
      onProgress(Math.min(95, 40 + (i + 1) * 0.12), /生成中|排队/.test(r.status) || !r.status ? `生成中…（已等待 ${waitedText}，本地 AnimateDiff 通常需 5–10 分钟）` : r.status)
      if (/error|fail|cancel/i.test(r.status)) return { ok: false, images: [], error: `ComfyUI 任务失败：${r.errorDetail || r.status}`, taskId: promptId }
      if (r.done && !r.videos.length) return { ok: false, images: [], error: '任务完成但未找到输出视频（检查 VHS_VideoCombine 节点）', taskId: promptId }
    }
    return { ok: false, images: [], error: '等待超时（15 分钟）。任务可能仍在 ComfyUI 里运行，完成后视频会出现在 ComfyUI 的 output 目录', taskId: promptId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, images: [], error: `ComfyUI 调用失败：${msg}` }
  }
}

/** 提交工作流，返回 prompt_id */
export async function comfySubmit(base: string, workflow: Record<string, unknown>): Promise<string> {
  const clientId = `acm-${Date.now()}`
  const text = await call(base, 'prompt', 'POST', { prompt: workflow, client_id: clientId }, false)
  const json = JSON.parse(text)
  if (json.node_errors && Object.keys(json.node_errors).length) {
    const first = Object.values(json.node_errors)[0] as { errors?: { message?: string }[] }
    throw new Error(`工作流节点错误：${first?.errors?.[0]?.message ?? '参数不合法'}`)
  }
  const id = json.prompt_id
  if (!id) throw new Error(`ComfyUI 未返回任务 ID：${text.slice(0, 120)}`)
  return String(id)
}

/** 查询任务状态；完成时返回图片列表（data URL） */
/** 从 history 条目的 status.messages 里提取 execution_error 的可读详情（节点类型 + 异常信息）。
 *  没有它，任务失败只能看到一句 status_str 的 "error"，无从排障（2026-11-21 实测 AnimateDiff 失败即如此）。 */
export function historyErrorDetail(entry: unknown): string {
  const messages = (entry as { status?: { messages?: unknown } } | null)?.status?.messages
  if (!Array.isArray(messages)) return ''
  for (const msg of messages) {
    if (Array.isArray(msg) && msg[0] === 'execution_error') {
      const d = (msg[1] ?? {}) as { node_type?: unknown; exception_type?: unknown; exception_message?: unknown }
      const node = d.node_type ? `${String(d.node_type)} 节点` : '未知节点'
      const ex = [d.exception_type, d.exception_message].filter(x => typeof x === 'string' && x).join(': ')
      return ex ? `${node}执行出错：${ex.slice(0, 300)}` : `${node}执行出错`
    }
  }
  return ''
}

export async function comfyPoll(base: string, promptId: string): Promise<{ done: boolean; images: string[]; status: string; errorDetail: string }> {
  const text = await call(base, `history/${encodeURIComponent(promptId)}`, 'GET', undefined, false)
  const json = JSON.parse(text)
  const entry = json[promptId]
  if (!entry) return { done: false, images: [], status: '排队中', errorDetail: '' }
  const status = String(entry.status?.status_str ?? entry.status ?? '')
  const outputs = entry.outputs ?? {}
  const images: string[] = []
  for (const node of Object.values(outputs) as { images?: { filename: string; subfolder?: string; type?: string }[] }[]) {
    for (const img of node.images ?? []) {
      const q = `view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`
      const b64 = await call(base, q, 'GET', undefined, true)
      images.push(b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`)
    }
  }
  const done = /success|complete/i.test(status) || images.length > 0
  return { done, images, status: status || (images.length ? '完成' : '生成中'), errorDetail: historyErrorDetail(entry) }
}

/** 上传图片到 ComfyUI（img2img 用），返回服务端文件名 */
export async function comfyUpload(base: string, dataUrl: string, name: string): Promise<string> {
  // ComfyUI /upload/image 需要 multipart/form-data；桌面端桥接目前只支持 JSON，
  // 因此这里在 Web 端用 FormData 直连；桌面端提示用户先手动上传。
  if (!dataUrl.startsWith('data:image/')) throw new Error('源图格式不正确')
  const blob = await (await fetch(dataUrl)).blob()
  const form = new FormData()
  form.append('image', blob, name)
  form.append('type', 'input')
  const res = await fetch(`${base.replace(/\/+$/, '')}/upload/image`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`上传源图失败（HTTP ${res.status}），桌面端请使用 OpenAI 兼容服务做图生图`)
  const json = await res.json()
  return String(json.name ?? name)
}

/** 一键生图：提交 → 轮询 → 取图。onProgress 回调用于驱动进度条。 */
export async function comfyGenerate(
  base: string, model: string, prompt: string, opts: ImageOptions | undefined,
  onProgress: (pct: number, label: string) => void,
  alive: () => boolean,
): Promise<ComfyResult> {
  try {
    // 提交前按当前服务器的 object_info 清单对齐模型名（扫盘/历史命名的 checkpoints/ 前缀会被服务器拒）
    const resolvedModel = resolveComfyModelName(model, await fetchComfyCheckpoints(base), 'checkpoints')
    let workflow: Record<string, unknown>
    if (opts?.sourceImage) {
      const name = await comfyUpload(base, opts.sourceImage, `acm_src_${Date.now()}.png`)
      workflow = buildImg2ImgWorkflow(resolvedModel, prompt, name, opts)
    } else {
      workflow = buildTxt2ImgWorkflow(resolvedModel, prompt, opts)
    }
    onProgress(25, '工作流已构造，正在提交…')
    const promptId = await comfySubmit(base, workflow)
    onProgress(40, '任务已提交，ComfyUI 排队中…')
    for (let i = 0; i < 120 && alive(); i++) {
      await new Promise(r => setTimeout(r, 2000))
      if (!alive()) return { ok: false, images: [], error: '已取消' }
      const r = await comfyPoll(base, promptId)
      if (r.images.length) return { ok: true, images: r.images, taskId: promptId }
      onProgress(Math.min(90, 40 + (i + 1) * 0.8), r.status || '生成中…')
      if (/error|fail|cancel/i.test(r.status)) return { ok: false, images: [], error: `ComfyUI 任务失败：${r.errorDetail || r.status}`, taskId: promptId }
      if (r.done && !r.images.length) return { ok: false, images: [], error: '任务完成但未找到输出图片（检查工作流 SaveImage 节点）', taskId: promptId }
    }
    return { ok: false, images: [], error: '等待超时（4 分钟），请到 ComfyUI 页面查看任务状态', taskId: promptId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, images: [], error: `ComfyUI 调用失败：${msg}` }
  }
}
