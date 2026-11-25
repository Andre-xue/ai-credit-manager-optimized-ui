import { describe, it, expect } from 'vitest'
import {
  isQwenVoiceId, newQwenVoiceId, QWENTTS_PORT, QWENTTS_URL, QWENTTS_MODEL_ID, QWEN_VOICE_PREFIX,
  friendlyQwenError, buildSilentWavDataUrl, formatCloneElapsed, describeQwenCloneFailure,
  shouldRetryQwenWarmup, getQwenWarmupState, resetQwenWarmup, isQwenServiceOffError,
  QWENTTS_SYNTH_TIMEOUT_S, QWEN_CLONE_SLOW_HINT_S,
} from './qwenTts'

describe('Qwen3-TTS 本地服务常量（v0.1.400）', () => {
  it('端口与模型 ID 与 Rust 端一致（专属端口，不与 Ollama/ComfyUI/LM Studio 撞）', () => {
    expect(QWENTTS_PORT).toBe(18123)
    expect(QWENTTS_URL).toBe('http://127.0.0.1:18123')
    // 官方 mlx-tts-server 支持表内 0.6B 克隆档（4-bit 量化，权重约 1GB）
    expect(QWENTTS_MODEL_ID).toBe('mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit')
  })
  it('Qwen 音色 ID 前缀判定', () => {
    expect(isQwenVoiceId('qwen-local:qw_abc123')).toBe(true)
    expect(isQwenVoiceId('cosyvoice-v2-xxx')).toBe(false)
    expect(isQwenVoiceId('')).toBe(false)
    expect(isQwenVoiceId(null)).toBe(false)
    expect(isQwenVoiceId(undefined)).toBe(false)
  })
  it('新音色 ID 带前缀且每次不同', () => {
    const a = newQwenVoiceId()
    const b = newQwenVoiceId()
    expect(a.startsWith(QWEN_VOICE_PREFIX)).toBe(true)
    expect(a).not.toBe(b)
    expect(isQwenVoiceId(a)).toBe(true)
  })
})

describe('Qwen 服务端 ffmpeg 报错翻译（v0.1.414 兜底）', () => {
  it('服务端报 ffmpeg 缺失时换成中文指引', () => {
    const raw = '合成失败（HTTP 400）：{"detail":"ref_audio is not WAV and ffmpeg conversion failed: [Errno 2] No such file or directory: \'ffmpeg\'. Install ffmpeg: brew install ffmpeg"}'
    expect(friendlyQwenError(raw)).toBe('参考音频不是 WAV 且本机未装 ffmpeg，请改用 WAV 音频或安装 ffmpeg（终端运行 brew install ffmpeg）')
  })
  it('只有 ref_audio is not WAV 也翻译', () => {
    expect(friendlyQwenError('ref_audio is not WAV')).toContain('请改用 WAV 音频')
  })
  it('其他错误原样返回', () => {
    expect(friendlyQwenError('合成失败（HTTP 500）：内部错误')).toBe('合成失败（HTTP 500）：内部错误')
    expect(friendlyQwenError('服务未运行')).toBe('服务未运行')
  })
})

describe('Qwen 克隆进度可视化（v0.1.415）', () => {
  it('合成超时常量与 Rust 端一致（600 秒，旧 180 秒会在首次加载中途掐断）', () => {
    expect(QWENTTS_SYNTH_TIMEOUT_S).toBe(600)
    expect(QWEN_CLONE_SLOW_HINT_S).toBe(60)
    expect(QWEN_CLONE_SLOW_HINT_S).toBeLessThan(QWENTTS_SYNTH_TIMEOUT_S)
  })
  it('formatCloneElapsed 只报真实时长：秒内报秒、过 60 秒报分秒', () => {
    expect(formatCloneElapsed(0)).toBe('0 秒')
    expect(formatCloneElapsed(45)).toBe('45 秒')
    expect(formatCloneElapsed(59.9)).toBe('59 秒')
    expect(formatCloneElapsed(60)).toBe('1 分 0 秒')
    expect(formatCloneElapsed(75)).toBe('1 分 15 秒')
    expect(formatCloneElapsed(600)).toBe('10 分 0 秒')
    expect(formatCloneElapsed(-5)).toBe('0 秒')
  })
  it('buildSilentWavDataUrl 写出标准静音 WAV（RIFF/16kHz/单声道/16-bit）', () => {
    const url = buildSilentWavDataUrl()
    expect(url.startsWith('data:audio/wav;base64,')).toBe(true)
    const bytes = Buffer.from(url.split(',')[1], 'base64')
    expect(bytes.length).toBe(44 + 16000 * 0.5 * 2) // 0.5 秒
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString()).toBe('WAVE')
    expect(bytes.readUInt16LE(20)).toBe(1) // PCM
    expect(bytes.readUInt16LE(22)).toBe(1) // 单声道
    expect(bytes.readUInt32LE(24)).toBe(16000)
    expect(bytes.readUInt16LE(34)).toBe(16)
    expect(bytes.subarray(36, 40).toString()).toBe('data')
    expect(bytes.subarray(44).every(b => b === 0)).toBe(true) // 全静音
  })
  it('buildSilentWavDataUrl 时长参数生效', () => {
    const url = buildSilentWavDataUrl(1)
    expect(Buffer.from(url.split(',')[1], 'base64').length).toBe(44 + 16000 * 2)
  })
  it('describeQwenCloneFailure：超时给明确提示 + 重试指引', () => {
    const msg = describeQwenCloneFailure('合成请求失败（请确认 Qwen3-TTS 服务已启动）：error sending request for url (http://127.0.0.1:18123/v1/audio/clone): operation timed out')
    expect(msg).toContain('克隆超时')
    expect(msg).toContain('10 分钟')
    expect(msg).toContain('重新克隆')
  })
  it('describeQwenCloneFailure：非超时仍走 414 的中文翻译（friendlyQwenError 未动）', () => {
    expect(describeQwenCloneFailure('ref_audio is not WAV and ffmpeg conversion failed')).toContain('请改用 WAV 音频')
    expect(describeQwenCloneFailure('合成失败（HTTP 500）：内部错误')).toBe('合成失败（HTTP 500）：内部错误')
  })
  it('shouldRetryQwenWarmup：只对连接不上重试，HTTP 业务错不重试', () => {
    expect(shouldRetryQwenWarmup('合成请求失败（请确认 Qwen3-TTS 服务已启动）：error sending request')).toBe(true)
    expect(shouldRetryQwenWarmup('connection refused')).toBe(true)
    expect(shouldRetryQwenWarmup('合成失败（HTTP 400）：ref_audio is not WAV')).toBe(false)
    expect(shouldRetryQwenWarmup('operation timed out')).toBe(false)
  })
  it('预热状态初始 idle、复位回 idle', () => {
    resetQwenWarmup()
    expect(getQwenWarmupState()).toBe('idle')
  })
})

describe('Qwen 试听/朗读链路（v0.1.428）', () => {
  it('friendlyQwenError：超时给明确原因（试听/朗读路径也走这里，不再透英文原错）', () => {
    const msg = friendlyQwenError('合成请求失败（请确认 Qwen3-TTS 服务已启动）：error sending request for url (http://127.0.0.1:18123/v1/audio/clone): operation timed out')
    expect(msg).toContain('合成超时')
    expect(msg).toContain('10 分钟')
    expect(msg).toContain('服务仍在运行')
  })
  it('friendlyQwenError：克隆路径的超时文案不受影响（describeQwenCloneFailure 优先）', () => {
    expect(describeQwenCloneFailure('operation timed out')).toContain('克隆超时')
  })
  it('isQwenServiceOffError：连接被拒/连不上算服务没开，超时与业务错不算', () => {
    expect(isQwenServiceOffError('合成请求失败（请确认 Qwen3-TTS 服务已启动）：error sending request: Connection refused (os error 61)')).toBe(true)
    expect(isQwenServiceOffError('connection refused')).toBe(true)
    expect(isQwenServiceOffError('failed to connect')).toBe(true)
    expect(isQwenServiceOffError('operation timed out')).toBe(false)
    expect(isQwenServiceOffError('合成请求失败：operation timed out')).toBe(false)
    expect(isQwenServiceOffError('合成失败（HTTP 400）：ref_audio is not WAV')).toBe(false)
    expect(isQwenServiceOffError('合成失败（HTTP 500）：内部错误')).toBe(false)
  })
})
