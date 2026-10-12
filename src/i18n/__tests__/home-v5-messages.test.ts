import { describe, it, expect } from 'vitest'
import en from '../../../messages/en.json'
import he from '../../../messages/he.json'
import ru from '../../../messages/ru.json'
import eo from '../../../messages/eo.json'

function leafPaths(o: unknown, prefix = ''): string[] {
  if (typeof o !== 'object' || o === null) return [prefix]
  return Object.entries(o).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k))
}

describe('HomeV5 messages', () => {
  const expected = leafPaths(en.HomeV5).sort()

  it.each([['he', he], ['ru', ru], ['eo', eo]] as const)('%s has the same keys as en', (_l, m) => {
    expect(leafPaths(m.HomeV5).sort()).toEqual(expected)
  })

  it.each([['en', en], ['he', he], ['ru', ru], ['eo', eo]] as const)('%s has no empty strings', (_l, m) => {
    const empty = leafPaths(m.HomeV5).filter((p) => !p.split('.').reduce((a: any, k) => a[k], m.HomeV5))
    expect(empty).toEqual([])
  })
})
