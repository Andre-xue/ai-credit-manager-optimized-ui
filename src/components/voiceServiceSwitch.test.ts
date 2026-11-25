// v0.1.427 接线回归守卫：语音配置页「声音克隆」区的 Qwen3-TTS 服务开关
// 必须接 App 层的 serviceController（与设置页同一个开关、同一份状态），
// 而不是各处自造开关。源码级断言（与 i18n.test.ts 同类做法）：
// 改了接线这里先挂，而不是等用户在真机上发现开关不同步。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const voiceSettings = readFileSync(join(process.cwd(), 'src/components/VoiceSettings.tsx'), 'utf8')
const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')

describe('语音配置页 Qwen3-TTS 服务开关接线（v0.1.427）', () => {
  it('VoiceSettings 接受 serviceController 并把它喂给 qwentts 的 ServiceSwitch', () => {
    expect(voiceSettings).toContain('serviceController?: ServiceController')
    expect(voiceSettings).toContain('<ServiceSwitch controller={serviceController} serviceKey="qwentts" />')
  })

  it('App 把 serviceController 传给 VoiceSettings（手机端传 undefined）', () => {
    expect(app).toContain('serviceController={isPhone ? undefined : serviceController}')
    const m = app.match(/<VoiceSettings[^>]*>/)
    expect(m?.[0]).toContain('serviceController={isPhone ? undefined : serviceController}')
  })

  it('开关在别处切换时本页刷新 Qwen 状态徽标（监听本地服务变更事件）', () => {
    expect(voiceSettings).toContain('LOCAL_SERVICE_CHANGED_EVENT')
    expect(voiceSettings).toContain("detail?.key === 'qwentts'")
    expect(voiceSettings).toContain('void refreshQwenStatus()')
  })

  it('克隆区不再把用户支去设置页开开关', () => {
    expect(voiceSettings).not.toContain('服务开关在「设置 → 本地模型服务 → Qwen3-TTS」')
    expect(voiceSettings).toContain('服务开关就在上方')
  })
})
