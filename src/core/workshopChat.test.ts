import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from './types'
import { loadWorkshopRoutes, runWorkshopChat, resolveWorkshopModel, defaultChatEngine } from './workshopChat'

vi.mock('./crypto', () => ({ decryptSecret: async () => 'test-key' }))

const acct = (providerId: string, label: string, apiUrl = 'https://api.example.com', id = 'a1'): Account => ({
  id, providerId, label, mode: 'api', apiUrl,
  encryptedKey: 'enc', modelCapability: 'chat', note: '[通用型]',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
})

afterEach(() => vi.unstubAllGlobals())

const okFetch = (text = '推荐：舌尖上的中国') => vi.fn().mockResolvedValue({
  ok: true,
  text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }),
})

/** 平台 400 拒绝（模型名不认）：directFetch 抛「接口返回 400：…」 */
const errFetch = (detail = "Model 'Kimi' does not exist") => vi.fn().mockResolvedValue({
  ok: false, status: 400,
  text: async () => JSON.stringify({ error: { message: detail, code: 'invalid_model' } }),
})

const modelSent = (fetchMock: ReturnType<typeof okFetch>) =>
  JSON.parse(String(fetchMock.mock.calls[0][1].body)).model as string

describe('defaultChatEngine（v0.1.430：平台首选对话模型）', () => {
  it('有旗舰款的取旗舰', () => {
    expect(defaultChatEngine('kim')).toBe('kimi-k3.1-pro')
    expect(defaultChatEngine('deepseek')).toBe('deepseek-flash')
    expect(defaultChatEngine('glm')).toBe('glm-4.6')
    expect(defaultChatEngine('qwen')).toBe('qwen4-max')
  })
  it('未收录的平台返回 undefined', () => {
    expect(defaultChatEngine('siliconflow')).toBeUndefined()
    expect(defaultChatEngine('custom-endpoint')).toBeUndefined()
  })
})

describe('runWorkshopChat 自有账户不再拿账户名当模型发（v0.1.430）', () => {
  it('Kimi 账户发 kimi-k3.1-pro，而不是「Kimi」', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const text = await runWorkshopChat({
      route: { kind: 'account', key: 'acct:a1', label: 'Kimi', accountId: 'a1' },
      freeOptions: [], accounts: [acct('kim', 'Kimi', 'https://api.moonshot.cn')],
      sessionPwd: 'pwd', system: '你是找剧助手', user: '科幻',
    })
    expect(text).toContain('舌尖上的中国')
    expect(modelSent(fetchMock)).toBe('kimi-k3.1-pro')
  })

  it('DeepSeek 账户发 deepseek-flash，而不是「DeepSeek」', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    await runWorkshopChat({
      route: { kind: 'account', key: 'acct:a1', label: 'DeepSeek', accountId: 'a1' },
      freeOptions: [], accounts: [acct('deepseek', 'DeepSeek', 'https://api.deepseek.com')],
      sessionPwd: 'pwd', system: '你是找剧助手', user: '喜剧',
    })
    expect(modelSent(fetchMock)).toBe('deepseek-flash')
  })

  it('GLM 账户发 glm-4.6，而不是「GLM」', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    await runWorkshopChat({
      route: { kind: 'account', key: 'acct:a1', label: 'GLM', accountId: 'a1' },
      freeOptions: [], accounts: [acct('glm', 'GLM', 'https://open.bigmodel.cn/api/paas/v4')],
      sessionPwd: 'pwd', system: '你是找剧助手', user: '爱情',
    })
    expect(modelSent(fetchMock)).toBe('glm-4.6')
  })

  it('label 本身就是目录里的模型 id 时优先用 label', () => {
    expect(resolveWorkshopModel(acct('kim', 'kimi-k3'))).toBe('kimi-k3')
    expect(resolveWorkshopModel(acct('glm', 'glm-4.5-flash'))).toBe('glm-4.5-flash')
  })

  it('未收录的平台回落到备注/标签里的模型 id（旧行为保留）', () => {
    expect(resolveWorkshopModel(acct('siliconflow', 'Qwen/Qwen3-32B'))).toBe('Qwen/Qwen3-32B')
    expect(resolveWorkshopModel(acct('custom-endpoint', 'my-model-1'))).toBe('my-model-1')
  })

  it('路线自带的 modelId/engine 优先', () => {
    const a = acct('kim', 'Kimi')
    expect(resolveWorkshopModel(a, { kind: 'account', key: 'acct:a1:m', label: 'x', accountId: 'a1', modelId: 'kimi-k3' })).toBe('kimi-k3')
    expect(resolveWorkshopModel(a, { kind: 'account', key: 'acct:a1', label: 'x', accountId: 'a1', engine: 'kimi-k3.1-pro-highspeed' })).toBe('kimi-k3.1-pro-highspeed')
  })
})

describe('runWorkshopChat 失败时抛出真原因（v0.1.430）', () => {
  it('平台 400 拒绝时报错里有 400 与平台原文，不再是光秃秃的「调用失败」', async () => {
    vi.stubGlobal('fetch', errFetch("Model 'GLM' does not exist"))
    let errMsg = ''
    try {
      await runWorkshopChat({
        route: { kind: 'account', key: 'acct:a1', label: 'GLM', accountId: 'a1' },
        freeOptions: [], accounts: [acct('glm', 'GLM', 'https://open.bigmodel.cn/api/paas/v4')],
        sessionPwd: 'pwd', system: '你是找剧助手', user: '爱情',
      })
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e)
    }
    expect(errMsg).toContain('400')
    expect(errMsg).toContain('does not exist')
    expect(errMsg).not.toBe('调用失败')
  })
})

describe('loadWorkshopRoutes 给自有账户路线带上 engine（v0.1.430）', () => {
  it('Kimi/GLM/DeepSeek 路线都带真实模型 id', async () => {
    const { routes } = await loadWorkshopRoutes([
      acct('kim', 'Kimi', 'https://api.moonshot.cn', 'k1'),
      acct('glm', 'GLM', 'https://open.bigmodel.cn/api/paas/v4', 'g1'),
      acct('deepseek', 'DeepSeek', 'https://api.deepseek.com', 'd1'),
    ])
    const byId = new Map(routes.filter(r => r.kind === 'account').map(r => [r.accountId, r]))
    expect((byId.get('k1') as { engine?: string } | undefined)?.engine).toBe('kimi-k3.1-pro')
    expect((byId.get('g1') as { engine?: string } | undefined)?.engine).toBe('glm-4.6')
    expect((byId.get('d1') as { engine?: string } | undefined)?.engine).toBe('deepseek-flash')
    const engines = routes.filter(r => r.kind === 'account').map(r => (r as { engine?: string }).engine)
    expect(engines).toContain('kimi-k3.1-pro')
    expect(engines).toContain('glm-4.6')
    expect(engines).toContain('deepseek-flash')
    expect(engines).not.toContain('Kimi')
    expect(engines).not.toContain('GLM')
    expect(engines).not.toContain('DeepSeek')
  })
})
