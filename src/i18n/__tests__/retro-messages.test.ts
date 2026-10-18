import { describe, it, expect } from 'vitest'
import en from '../../../messages/en.json'
import he from '../../../messages/he.json'
import ru from '../../../messages/ru.json'
import eo from '../../../messages/eo.json'

const NAMESPACES = ['retroIsrael', 'retroUkraine', 'retroEnergy', 'retroIndex', 'retroShared'] as const

type Tree = { [k: string]: string | Tree | Tree[] | string[] }

function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node }
  if (Array.isArray(node)) return Object.assign({}, ...node.map((v, i) => flatten(v, `${prefix}.${i}`)))
  if (node && typeof node === 'object') {
    return Object.assign({}, ...Object.entries(node as Tree).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
  }
  return {}
}

// Argument names and rich-text tags a message uses; a translation must use the same set
// or the renderer throws (or silently drops the value).
function placeholders(msg: string): string[] {
  const args = [...msg.matchAll(/\{(\w+)/g)].map(m => m[1])
  const tags = [...msg.matchAll(/<(\w+)>/g)].map(m => `<${m[1]}>`)
  return [...new Set([...args, ...tags])].sort()
}

const flat = (m: Record<string, unknown>) => Object.assign({}, ...NAMESPACES.map(ns => flatten(m[ns], ns))) as Record<string, string>

describe('retro report messages', () => {
  const base = flat(en)

  it('has content for each namespace', () => {
    for (const ns of NAMESPACES) expect(Object.keys(base).some(k => k.startsWith(`${ns}.`))).toBe(true)
  })

  it.each([['he', he], ['ru', ru], ['eo', eo]] as const)('%s has the same keys as en', (_l, m) => {
    expect(Object.keys(flat(m)).sort()).toEqual(Object.keys(base).sort())
  })

  it.each([['he', he], ['ru', ru]] as const)('%s keeps the placeholders and rich-text tags of en', (_l, m) => {
    const loc = flat(m)
    for (const [k, v] of Object.entries(base)) {
      expect(placeholders(loc[k]), k).toEqual(placeholders(v))
    }
  })

  // Quotes originally spoken in Russian have no Latin letters and stay verbatim in the ru copy.
  it.each([['he', he], ['ru', ru]] as const)('%s is actually translated (no copied English prose)', (_l, m) => {
    const loc = flat(m)
    const same = Object.entries(base).filter(([k, v]) => v.length > 40 && /[A-Za-z]/.test(v) && loc[k] === v)
    expect(same.map(([k]) => k)).toEqual([])
  })
})
