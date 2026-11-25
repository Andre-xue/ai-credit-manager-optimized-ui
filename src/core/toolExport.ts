// 工具配置导出：把已解密的 Key 生成其他工具能直接使用的配置文本（.env / JSON）。
// 纯函数；明文只在用户主动导出时产生，调用方负责二次确认与审计记录。
export interface ToolExportItem {
  providerId: string
  label: string
  apiKey: string
  apiUrl?: string
}

/** providerId → 环境变量名（大写、非字母数字转下划线），重名追加 _2/_3… */
export function envVarName(providerId: string, taken: Set<string>): string {
  const base = `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
  let name = base
  let i = 2
  while (taken.has(name)) { name = `${base}_${i}`; i++ }
  taken.add(name)
  return name
}

export function buildEnvExport(items: ToolExportItem[], now = new Date()): string {
  const taken = new Set<string>()
  const lines = [
    '# AI 魔方导出 · 请妥善保管，勿提交到代码仓库',
    `# 导出时间：${now.toLocaleString('zh-CN')}`,
    '',
  ]
  for (const it of items) {
    lines.push(`# ${it.label}${it.apiUrl ? ` · ${it.apiUrl}` : ''}`)
    lines.push(`${envVarName(it.providerId, taken)}=${it.apiKey}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function buildJsonExport(items: ToolExportItem[], now = new Date()): string {
  return JSON.stringify({
    exportedBy: 'AI 魔方',
    exportedAt: now.toISOString(),
    keys: items.map(it => ({
      provider: it.providerId,
      label: it.label,
      apiKey: it.apiKey,
      ...(it.apiUrl ? { apiUrl: it.apiUrl } : {}),
    })),
  }, null, 2)
}
