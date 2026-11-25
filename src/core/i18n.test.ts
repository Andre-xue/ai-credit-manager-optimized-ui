// i18n 覆盖完整性：所有 t('…') 字面量键必须在 DICT 中有四语译文且占位符一致；
// DICT 自身每条也必须四语齐全、占位符与键一致。
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DICT } from './i18nDict'

const LANGS = ['zh-TW', 'en', 'ja', 'ko'] as const
const CJK = /[一-鿿]/
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

function extractKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  const files = walk(join(process.cwd(), 'src')).filter(f =>
    !f.endsWith('.test.ts') && !f.endsWith('.test.tsx') &&
    !/[\\/]i18n(Dict\w*)?\.ts$/.test(f))
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/(?<![\w.])t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const key = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
      if (CJK.test(key) && !keys.has(key)) keys.set(key, f)
    }
    for (const m of src.matchAll(/(?<![\w.])t\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const key = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      if (CJK.test(key) && !keys.has(key)) keys.set(key, f)
    }
  }
  return keys
}

describe('i18n 词条完整性', () => {
  it('DICT 每条四语齐全且占位符与键一致', () => {
    const bad: string[] = []
    for (const [key, entry] of Object.entries(DICT)) {
      for (const lang of LANGS) {
        const v = entry[lang]
        if (!v) { bad.push(`缺 ${lang}：${key}`); continue }
        if (placeholders(v) !== placeholders(key)) bad.push(`占位符不一致(${lang})：${key} -> ${v}`)
      }
    }
    expect(bad, bad.slice(0, 40).join('\n')).toEqual([])
  })

  it('所有 t() 字面量键都有词条', () => {
    const keys = extractKeys()
    const missing: string[] = []
    for (const [key, file] of keys) {
      if (!DICT[key]) missing.push(`${key}  (${file.split('/src/')[1]})`)
    }
    expect(missing, `缺词条 ${missing.length} 条：\n` + missing.slice(0, 120).join('\n')).toEqual([])
  })
})
