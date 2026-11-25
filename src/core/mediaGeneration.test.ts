import { describe, it, expect, beforeEach, vi } from 'vitest'
import { autoSaveGeneratedMedia } from './mediaGeneration'

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
;(globalThis as any).localStorage = new MemStorage()

// node 环境缺 FileReader：最小桩，按 readAsDataURL 语义返回 data URL
;(globalThis as any).FileReader = class {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then(buf => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`
      this.onload?.()
    }).catch(() => this.onerror?.())
  }
}

const invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = []
;(globalThis as any).window = {
  __TAURI_INTERNALS__: {
    invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      invokeCalls.push({ cmd, args })
      return `${args.dir}/${args.filename}`
    }),
  },
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII='

function setPrefs(p: unknown) {
  localStorage.setItem('acm.storage.prefs', JSON.stringify(p))
}

describe('autoSaveGeneratedMedia 生成后自动存入数据存储文件夹（v0.1.310）', () => {
  beforeEach(() => { localStorage.clear(); invokeCalls.length = 0 })

  it('已配置 media 文件夹时把结果写入该目录，文件名带类型与时间戳', async () => {
    setPrefs({ enabled: true, media: { enabled: true, dir: '/Users/x/Downloads/App' } })
    const saved = await autoSaveGeneratedMedia([PNG], 'image')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatch(/^\/Users\/x\/Downloads\/App\/ai-image-\d{8}-\d{6}-1\.png$/)
    expect(invokeCalls).toHaveLength(1)
    expect(invokeCalls[0].cmd).toBe('write_binary_to_dir')
    expect(typeof invokeCalls[0].args.contentBase64).toBe('string')
    expect((invokeCalls[0].args.contentBase64 as string).length).toBeGreaterThan(10)
  })

  it('未配置目录 / 总开关关 / media 关时静默跳过、不写文件', async () => {
    setPrefs({ enabled: true, media: { enabled: true, dir: '' } })
    expect(await autoSaveGeneratedMedia([PNG], 'image')).toEqual([])
    setPrefs({ enabled: false, media: { enabled: true, dir: '/x' } })
    expect(await autoSaveGeneratedMedia([PNG], 'image')).toEqual([])
    setPrefs({ enabled: true, media: { enabled: false, dir: '/x' } })
    expect(await autoSaveGeneratedMedia([PNG], 'image')).toEqual([])
    expect(invokeCalls).toHaveLength(0)
  })

  it('多个结果逐个保存、序号递增', async () => {
    setPrefs({ enabled: true, media: { enabled: true, dir: '/d' } })
    const saved = await autoSaveGeneratedMedia([PNG, PNG], 'video')
    expect(saved).toHaveLength(2)
    expect(saved[0]).toContain('-1.')
    expect(saved[1]).toContain('-2.')
  })
})
