import { describe, it, expect } from 'vitest'
import { VOICE_PROVIDERS, voiceProviderLabel } from './voiceProviders'

describe('VoiceStudio 语音服务商', () => {
  it('已加入服务商目录且推荐', () => {
    const p = VOICE_PROVIDERS.find(x => x.id === 'voicestudio')
    expect(p).toBeDefined()
    expect(p?.recommended).toBe(true)
    expect(p?.docs).toContain('VoiceStudio')
    expect(p?.free).toContain('AGPL')
  })
  it('标签可解析', () => {
    expect(voiceProviderLabel('voicestudio')).toBe('VoiceStudio')
  })
  it('本地服务与 VoiceStudio 都在目录里', () => {
    const ids = VOICE_PROVIDERS.map(p => p.id)
    expect(ids).toContain('local')
    expect(ids).toContain('voicestudio')
    expect(ids.indexOf('voicestudio')).toBeLessThan(ids.indexOf('aliyun'))
  })
})
