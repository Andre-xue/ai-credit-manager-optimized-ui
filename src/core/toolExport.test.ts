import { describe, expect, it } from 'vitest'
import { buildEnvExport, buildJsonExport, envVarName } from './toolExport'

describe('toolExport', () => {
  it('envVarName：大写化 + 重名追加序号', () => {
    const taken = new Set<string>()
    expect(envVarName('deepseek', taken)).toBe('DEEPSEEK_API_KEY')
    expect(envVarName('deepseek', taken)).toBe('DEEPSEEK_API_KEY_2')
    expect(envVarName('silicon-flow.cn', taken)).toBe('SILICON_FLOW_CN_API_KEY')
  })

  it('.env 导出含注释与键值', () => {
    const out = buildEnvExport([{ providerId: 'kim', label: 'Kimi 主力', apiKey: 'sk-x', apiUrl: 'https://api.moonshot.cn/v1' }], new Date('2026-11-20T10:00:00'))
    expect(out).toContain('# Kimi 主力 · https://api.moonshot.cn/v1')
    expect(out).toContain('KIM_API_KEY=sk-x')
  })

  it('JSON 导出结构完整', () => {
    const out = JSON.parse(buildJsonExport([{ providerId: 'glm', label: 'GLM', apiKey: 'k1' }], new Date('2026-11-20T10:00:00')))
    expect(out.keys).toEqual([{ provider: 'glm', label: 'GLM', apiKey: 'k1' }])
  })
})
