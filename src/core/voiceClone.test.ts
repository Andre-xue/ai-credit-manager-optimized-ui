import { describe, it, expect, afterEach } from 'vitest'
import {
  isWavDataUrl, dataUrlToBlob, encodePcm16Wav, ensureWavDataUrl,
  trimAudioBlob, MAX_REF_AUDIO_SECONDS,
} from './voiceClone'

async function blobToBase64(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).toString('base64')
}

describe('Qwen 参考音频 WAV 归一化（v0.1.414）', () => {
  it('encodePcm16Wav 写出标准 WAV 头与 16-bit PCM', async () => {
    const blob = encodePcm16Wav([new Float32Array([0.5, -1, 1, 0])], 16000)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + 4 * 2)
    const buf = new DataView(await blob.arrayBuffer())
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf.buffer.slice(o, o + n)))
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(str(12, 4)).toBe('fmt ')
    expect(buf.getUint16(20, true)).toBe(1) // PCM
    expect(buf.getUint16(22, true)).toBe(1) // 单声道
    expect(buf.getUint32(24, true)).toBe(16000)
    expect(buf.getUint16(34, true)).toBe(16)
    expect(str(36, 4)).toBe('data')
    expect(buf.getInt16(44, true)).toBe(0x3fff) // 0.5 → 16383
    expect(buf.getInt16(46, true)).toBe(-0x8000) // -1 → -32768
    expect(buf.getInt16(48, true)).toBe(0x7fff) // 1 → 32767
  })

  it('encodePcm16Wav 双声道交错、原采样率保留', async () => {
    const blob = encodePcm16Wav([new Float32Array([0.25, 0.5]), new Float32Array([-0.25, -0.5])], 44100)
    expect(blob.size).toBe(44 + 2 * 2 * 2)
    const buf = new DataView(await blob.arrayBuffer())
    expect(buf.getUint16(22, true)).toBe(2)
    expect(buf.getUint32(24, true)).toBe(44100)
    expect(buf.getInt16(44, true)).toBe(0x1fff) // 左 0.25
    expect(buf.getInt16(46, true)).toBe(-0x2000) // 右 -0.25
  })

  it('isWavDataUrl 只认带 RIFF 头的真 WAV', async () => {
    const wav = encodePcm16Wav([new Float32Array([0, 0])], 16000)
    const wavUrl = `data:audio/wav;base64,${await blobToBase64(wav)}`
    expect(isWavDataUrl(wavUrl)).toBe(true)
    expect(isWavDataUrl(wavUrl.replace('audio/wav', 'audio/x-wav'))).toBe(true)
    // mime 是 wav 但内容不是 RIFF（假 WAV）→ 不认
    const fake = `data:audio/wav;base64,${Buffer.from('ID3xxxxxxx').toString('base64')}`
    expect(isWavDataUrl(fake)).toBe(false)
    // MP3 mime → 不认
    expect(isWavDataUrl('data:audio/mpeg;base64,SUQzBAAAAAAA')).toBe(false)
    expect(isWavDataUrl('not-a-data-url')).toBe(false)
    expect(isWavDataUrl('')).toBe(false)
  })

  it('dataUrlToBlob 还原 base64 data URL 的字节与 MIME', async () => {
    const blob = dataUrlToBlob('data:audio/mpeg;base64,SUQzBAAAAAAA')
    expect(blob).not.toBeNull()
    expect(blob?.type).toBe('audio/mpeg')
    expect(blob?.size).toBe(9) // 'ID3' + 6 个零字节
    expect(new Uint8Array(await blob!.arrayBuffer())[0]).toBe(0x49) // 'I' of ID3
    expect(dataUrlToBlob('data:audio/wav,hello')).toBeNull() // 非 base64 不支持
    expect(dataUrlToBlob('garbage')).toBeNull()
  })

  it('ensureWavDataUrl：真 WAV 直接放行，不碰 AudioContext', async () => {
    const wav = encodePcm16Wav([new Float32Array([0.1, -0.1])], 22050)
    const wavUrl = `data:audio/wav;base64,${await blobToBase64(wav)}`
    const r = await ensureWavDataUrl(wavUrl)
    expect(r).toEqual({ ok: true, dataUrl: wavUrl, converted: false })
  })

  it('ensureWavDataUrl：浏览器解不开的格式在调用服务端前就明确报错', async () => {
    // node 测试环境没有 window.AudioContext，转换必然失败 → 走报错分支
    const r = await ensureWavDataUrl('data:audio/mpeg;base64,SUQzBAAAAAAA')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('无法转换为 WAV')
      expect(r.error).toContain('WAV / MP3 / M4A')
    }
    const bad = await ensureWavDataUrl('garbage-not-a-data-url')
    expect(bad.ok).toBe(false)
  })
})

describe('参考音频限时长（v0.1.428）', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
  })

  function installFakeAudioContext(durationS: number) {
    const ch = new Float32Array(Math.floor(16000 * durationS)).fill(0.25)
    class FakeCtx {
      async decodeAudioData() {
        return { duration: durationS, sampleRate: 16000, numberOfChannels: 1, getChannelData: () => ch }
      }
      close() { /* ignore */ }
    }
    ;(globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx }
  }

  it('MAX_REF_AUDIO_SECONDS 为 15 秒', () => {
    expect(MAX_REF_AUDIO_SECONDS).toBe(15)
  })

  it('node 环境无 Audio/AudioContext 时 fail-open：返回原 blob、不阻断导入', async () => {
    const blob = new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' })
    const r = await trimAudioBlob(blob)
    expect(r.trimmed).toBe(false)
    expect(r.blob).toBe(blob)
  })

  it('30 秒音频只取前 15 秒、重编码为 WAV', async () => {
    installFakeAudioContext(30)
    const blob = new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' })
    const r = await trimAudioBlob(blob)
    expect(r.trimmed).toBe(true)
    expect(r.originalDurationS).toBe(30)
    expect(r.durationS).toBe(15)
    expect(r.blob.type).toBe('audio/wav')
    expect(r.blob.size).toBe(44 + 15 * 16000 * 2)
    const buf = new DataView(await r.blob.arrayBuffer())
    expect(String.fromCharCode(...new Uint8Array(buf.buffer.slice(0, 4)))).toBe('RIFF')
    expect(buf.getInt16(44, true)).toBe(0x1fff) // 0.25 → 8191，取的是开头
  })

  it('10 秒音频不截取、返回原 blob', async () => {
    installFakeAudioContext(10)
    const blob = new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' })
    const r = await trimAudioBlob(blob)
    expect(r.trimmed).toBe(false)
    expect(r.blob).toBe(blob)
    expect(r.originalDurationS).toBe(10)
    expect(r.durationS).toBe(10)
  })
})
