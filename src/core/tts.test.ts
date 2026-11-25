import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanForSpeech, cleanForAutoSpeech, resolveCloneVoiceId, speakAsync } from './tts'
import { buildSilentWavDataUrl } from './qwenTts'

describe('cleanForAutoSpeech 自动朗读清洗（只读文字）', () => {
  it('去掉标点符号与表情，只保留文字', () => {
    const out = cleanForAutoSpeech('你好！这是😀测试，包含。标点？还有**重点**')
    expect(out).not.toMatch(/[！!，,。？?]/)
    expect(out).not.toContain('😀')
    expect(out).toContain('这是测试')
    expect(out).toContain('重点')
  })
  it('保留中文与字母数字', () => {
    expect(cleanForAutoSpeech('第1步打开 App')).toBe('第1步打开 应用')
  })
})

describe('resolveCloneVoiceId AI 朗读音色选择', () => {
  const voices = [
    { id: 'cv-1', voiceId: 'cosyvoice-aaa' },
    { id: 'cv-2', voiceId: 'cosyvoice-bbb' },
  ]
  it('指定的 voiceURI 命中克隆音色时用该音色', () => {
    expect(resolveCloneVoiceId('cosyvoice-bbb', voices, 'cosyvoice-aaa')).toBe('cosyvoice-bbb')
    expect(resolveCloneVoiceId('cv-2', voices, null)).toBe('cosyvoice-bbb')
  })
  it('未指定或不匹配时用全局克隆音色', () => {
    expect(resolveCloneVoiceId(null, voices, 'cosyvoice-aaa')).toBe('cosyvoice-aaa')
    expect(resolveCloneVoiceId('Tingting', voices, 'cosyvoice-aaa')).toBe('cosyvoice-aaa')
  })
  it('无指定且无全局克隆音色时返回 null（走系统音）', () => {
    expect(resolveCloneVoiceId(null, voices, null)).toBeNull()
  })
})

describe('cleanForSpeech 朗读文本清洗', () => {
  it('去掉 markdown 加粗/行内代码/标题/列表符号', () => {
    const raw = '## 标题\n**重点**：用 `code` 调用\n- 第一项\n- 第二项'
    const out = cleanForSpeech(raw)
    expect(out).not.toContain('**')
    expect(out).not.toContain('`')
    expect(out).not.toContain('##')
    expect(out).not.toMatch(/^[-*+]\s/m)
    expect(out).toContain('重点')
    expect(out).toContain('第一项')
  })

  it('去掉 emoji 与链接语法，保留链接文字', () => {
    expect(cleanForSpeech('请问😀 [官网](https://example.com)')).toBe('请问 官网')
  })

  it('把换行合并为中文逗号，避免逐行停顿', () => {
    const out = cleanForSpeech('第一行\n第二行\n第三行')
    expect(out).toBe('第一行，第二行，第三行')
  })

  it('空文本与安全返回', () => {
    expect(cleanForSpeech('')).toBe('')
    expect(cleanForSpeech('**')).toBe('')
  })

  it('去掉固定寒暄开头，避免每次都你好/哈哈', () => {
    expect(cleanForSpeech('你好，小明，今天天气不错')).toBe('小明，今天天气不错')
    expect(cleanForSpeech('哈哈，这个很简单')).toBe('这个很简单')
    expect(cleanForSpeech('您好！请问需要帮忙吗')).toBe('请问需要帮忙吗')
  })

  it('把常见英文缩写转成口语，避免逐字母念', () => {
    const out = cleanForSpeech('这个 API Key 放在 App 里，AI 会处理')
    expect(out).toContain('密钥')
    expect(out).toContain('应用')
    expect(out).toContain('人工智能')
    expect(out).not.toMatch(/\bAPI\b|\bAI\b|\bApp\b/)
  })

  it('保留正常中文标点与句子', () => {
    const s = '这个方案不错。你觉得呢？'
    expect(cleanForSpeech(s)).toBe(s)
  })
})

// Qwen 试听/朗读链路（v0.1.428）：服务没开不回落系统音色、合成有进度、可取消。
// Tauri invoke 与 IndexedDB 都在模块 mock 里桩掉；node 环境没有 AudioContext，
// 合成成功后的播放环节会按预期失败，进度/取消断言不受影响。
const qwenMocks = vi.hoisted(() => ({
  qwenStatus: vi.fn(),
  qwenSynthesize: vi.fn(),
  qwenCancel: vi.fn(),
  loadRef: vi.fn(),
  ensureWav: vi.fn(),
}))

vi.mock('./qwenTts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./qwenTts')>()
  return {
    ...orig,
    qwenTtsStatus: (...args: unknown[]) => qwenMocks.qwenStatus(...args),
    qwenTtsSynthesize: (...args: unknown[]) => qwenMocks.qwenSynthesize(...args),
    qwenTtsCancelSynthesize: (...args: unknown[]) => qwenMocks.qwenCancel(...args),
    loadQwenVoiceRef: (...args: unknown[]) => qwenMocks.loadRef(...args),
  }
})

vi.mock('./voiceClone', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./voiceClone')>()
  return {
    ...orig,
    getClonedVoiceId: () => 'qwen-local:qw_test',
    listClonedVoices: () => [{ id: 'cv-1', voiceId: 'qwen-local:qw_test' }],
    ensureWavDataUrl: (...args: unknown[]) => qwenMocks.ensureWav(...args),
  }
})

vi.mock('./edgeTts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./edgeTts')>()
  return { ...orig, getSpeakPref: () => '' }
})

vi.mock('./voice-download', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./voice-download')>()
  return { ...orig, getTtsConfig: () => ({ provider: 'qwentts', endpoint: '', mode: 'direct' }) }
})

vi.mock('./openExternal', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./openExternal')>()
  return { ...orig, isNativeApp: () => false, isDesktopApp: () => true }
})

describe('speakAsync Qwen 分支（v0.1.428）', () => {
  const WAV = buildSilentWavDataUrl(0.5)
  const RUNNING = { installed: true, running: true, url: 'http://127.0.0.1:18123', python: '3.12', pythonOk: true, modelCached: true, lastLog: '' }
  const STOPPED = { ...RUNNING, running: false, url: null }

  beforeEach(() => {
    vi.clearAllMocks()
    qwenMocks.qwenStatus.mockResolvedValue(RUNNING)
    qwenMocks.loadRef.mockResolvedValue({ voiceId: 'qwen-local:qw_test', name: 't', dataUrl: WAV, refText: '你好', createdAt: 1 })
    qwenMocks.ensureWav.mockResolvedValue({ ok: true, dataUrl: WAV, converted: false })
    qwenMocks.qwenSynthesize.mockResolvedValue(WAV)
  })

  it('服务没开：不调合成、不回落系统音色，onQwenServiceOff 收到「服务没开」', async () => {
    qwenMocks.qwenStatus.mockResolvedValue(STOPPED)
    const onQwenServiceOff = vi.fn()
    const onFallback = vi.fn()
    const ok = await speakAsync('你好', null, undefined, onFallback, { onQwenServiceOff })
    expect(ok).toBe(false)
    expect(onQwenServiceOff).toHaveBeenCalledTimes(1)
    expect(onQwenServiceOff.mock.calls[0][0]).toContain('服务没开')
    expect(onFallback).not.toHaveBeenCalled()
    expect(qwenMocks.qwenSynthesize).not.toHaveBeenCalled()
    expect(qwenMocks.ensureWav).not.toHaveBeenCalled()
  })

  it('服务没开且调用方没给 onQwenServiceOff：走 onFallback 提示，同样不合成', async () => {
    qwenMocks.qwenStatus.mockResolvedValue(STOPPED)
    const onFallback = vi.fn()
    const ok = await speakAsync('你好', null, undefined, onFallback)
    expect(ok).toBe(false)
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback.mock.calls[0][0]).toContain('服务没开')
    expect(qwenMocks.qwenSynthesize).not.toHaveBeenCalled()
  })

  it('合成进行中：onSynthProgress 每秒上报已等待秒数（0/1/2…）', async () => {
    qwenMocks.qwenSynthesize.mockImplementation(() => new Promise(res => setTimeout(() => res(WAV), 2500)))
    const progress: number[] = []
    // 注意：文本不能是光秃秃的「你好」，cleanForSpeech 会把问候开头去掉变空串
    await speakAsync('这是克隆音色的试听。', null, undefined, vi.fn(), { onSynthProgress: (el) => progress.push(el) })
    expect(qwenMocks.qwenSynthesize).toHaveBeenCalledTimes(1)
    expect(progress).toContain(0)
    expect(progress).toContain(1)
    expect(progress).toContain(2)
    expect(progress[0]).toBe(0)
  })

  it('合成卡住时取消：调 qwentts_cancel_synthesize、静默结束，不弹回落提示', async () => {
    qwenMocks.qwenSynthesize.mockImplementation(() => new Promise(() => {}))
    const token = { cancelled: false }
    const onFallback = vi.fn()
    const p = speakAsync('这是克隆音色的试听。', null, undefined, onFallback, { cancelToken: token })
    await new Promise(r => setTimeout(r, 1200))
    token.cancelled = true
    const ok = await p
    expect(ok).toBe(false)
    expect(qwenMocks.qwenCancel).toHaveBeenCalled()
    expect(onFallback).not.toHaveBeenCalled()
  })
})
