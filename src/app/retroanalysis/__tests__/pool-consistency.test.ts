import { describe, expect, it } from 'vitest'
import { analyses } from '../data'
import ukrainePool from '../ukraine-2022/pool.json'
import ukraineRows from '../ukraine-2022/rows.json'
import israelPool from '../israel-2022/pool.json'
import israelRows from '../israel-2022/rows.json'
import energyPool from '../energy-2022/pool.json'
import energyRows from '../energy-2022/rows.json'

// The pools are hand-embedded JSON, so a bad edit would pass CI silently (#1899).
// These checks keep the published aggregates internally consistent.

interface Study {
  id: string
  pool: { g: string; r: string; d: string }[]
  rows: unknown[]
  groups: string[]
  regions: string[]
}

const studies: Study[] = [
  { id: 'ukraine-2022', pool: ukrainePool, rows: ukraineRows, groups: ['west', 'analysts', 'ua', 'ru'], regions: ['west', 'ua', 'ru'] },
  { id: 'israel-2022', pool: israelPool, rows: israelRows, groups: ['polls', 'media', 'bloc', 'anti'], regions: ['he', 'il_en', 'ru', 'ar', 'intl'] },
  { id: 'energy-2022', pool: energyPool, rows: energyRows, groups: ['banks', 'agencies', 'insiders', 'press'], regions: ['en', 'ru', 'eu', 'ar'] },
]

const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})
const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0)

// Same cutoffs the reports use: P >= 0.6 expects, P <= 0.4 does not, otherwise uncertain.
const sideOf = (p: number, hi: string, mid: string, lo: string) => (p >= 0.6 ? hi : p <= 0.4 ? lo : mid)

describe.each(studies)('retroanalysis pool: $id', ({ id, pool, rows, groups, regions }) => {
  it('group counts sum to the pool size and use only known groups', () => {
    const byGroup = count(pool.map(r => r.g))
    expect(Object.keys(byGroup).filter(g => !groups.includes(g))).toEqual([])
    expect(sum(byGroup)).toBe(pool.length)
  })

  it('region counts sum to the pool size and use only known regions', () => {
    const byRegion = count(pool.map(r => r.r))
    expect(Object.keys(byRegion).filter(r => !regions.includes(r))).toEqual([])
    expect(sum(byRegion)).toBe(pool.length)
  })

  it('has a date on every row and a display sample no larger than the pool', () => {
    expect(pool.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.d))).toBe(true)
    expect(rows.length).toBeLessThanOrEqual(pool.length)
  })

  it("index page's stated n matches the pool", () => {
    const a = analyses.find(x => x.id === id)
    expect(a).toBeDefined()
    const tagN = Number(/([\d,]+) RATED/.exec(a!.tag)?.[1].replace(/,/g, ''))
    expect(tagN).toBe(pool.length)
    // Any "N statements" in the description is either the whole pool or one group's count.
    const byGroup = Object.values(count(pool.map(r => r.g)))
    for (const m of a!.description.matchAll(/(\d[\d,]*) statements/g)) {
      const n = Number(m[1].replace(/,/g, ''))
      expect([pool.length, ...byGroup]).toContain(n)
    }
  })
})

describe('retroanalysis pool: side agrees with P thresholds', () => {
  it('ukraine-2022', () => {
    const bad = ukrainePool.filter(r => r.s !== sideOf(r.p, 'i', 'u', 'n'))
    expect(bad).toEqual([])
  })

  it('israel-2022', () => {
    const bad = israelPool.filter(r => r.s !== sideOf(r.p, 'bloc61', 'uncertain', 'no61'))
    expect(bad).toEqual([])
  })

  it('energy-2022: P is in [0, 1] and each row rates at least one leg', () => {
    for (const r of energyPool as { pb: number | null; pt: number | null }[]) {
      expect(r.pb != null || r.pt != null).toBe(true)
      for (const p of [r.pb, r.pt]) if (p != null) expect(p >= 0 && p <= 1).toBe(true)
    }
  })
})
