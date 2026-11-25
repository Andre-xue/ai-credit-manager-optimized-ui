import { describe, it, expect } from 'vitest'
import {
  isVoiceConfigAccount, VOICE_CONFIG_CATEGORY, categoryForModel, categoryFromNote,
} from './modelCategories'

describe('语音配置(APP)账户识别', () => {
  it('按 providerId 识别', () => {
    expect(isVoiceConfigAccount('voice-config', undefined)).toBe(true)
    expect(isVoiceConfigAccount('openai', '普通')).toBe(false)
  })
  it('按 note 前缀识别', () => {
    expect(isVoiceConfigAccount(undefined, '[语音配置(APP)] 我的Key')).toBe(true)
    expect(isVoiceConfigAccount(undefined, ' [语音配置(APP)]')).toBe(true)
    expect(isVoiceConfigAccount(undefined, '[通用型] 聊天')).toBe(false)
  })
  it('categoryForModel 对语音配置返回隐藏分类', () => {
    expect(categoryForModel('[语音配置(APP)] 我的Key')).toBe(VOICE_CONFIG_CATEGORY)
  })
  it('普通分类不受影响', () => {
    expect(categoryForModel('[通用型] 聊天')).toBe('通用型')
    expect(categoryForModel('[本地型] ollama')).toBe('本地型')
    expect(categoryFromNote('[生图型] 绘图')).toBe('生图型')
  })
})

describe('AI 图像/视频账户按备注分类筛选', () => {
  const accounts = [
    { id: 'img', label: '硅基流动-生图', note: '[生图型] 硅基', providerId: 'siliconflow' },
    { id: 'vid', label: '硅基流动-视频', note: '[视频型] 硅基', providerId: 'siliconflow' },
    { id: 'chat', label: '硅基流动-对话', note: '[对话型] 硅基', providerId: 'siliconflow' },
  ]
  it('生图页只保留生图型账户，视频页只保留视频型账户', () => {
    const imageAccounts = accounts.filter(a => categoryFromNote(a.note) === '生图型')
    const videoAccounts = accounts.filter(a => categoryFromNote(a.note) === '视频型')
    expect(imageAccounts.map(a => a.id)).toEqual(['img'])
    expect(videoAccounts.map(a => a.id)).toEqual(['vid'])
  })
  it('无分类的账户不会混入任一页面', () => {
    const noCategory = [{ id: 'x', label: '硅基流动', note: '' }]
    expect(noCategory.filter(a => categoryFromNote(a.note) === '生图型')).toEqual([])
    expect(noCategory.filter(a => categoryFromNote(a.note) === '视频型')).toEqual([])
  })
})
