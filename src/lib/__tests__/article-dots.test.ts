import { describe, it, expect } from 'vitest'
import { buildArticleDots, type ArticleDotRow } from '../article-dots'

const row = (over: Partial<ArticleDotRow>): ArticleDotRow => ({
  snapshotAt: '2026-11-01T00:00:00.000Z',
  url: 'https://example.com/a',
  stance: 0.4,
  certainty: 0.8,
  title: 'A headline',
  sourceName: 'Example',
  outletName: null,
  ...over,
})

const D1 = '2026-11-01T00:00:00.000Z'
const D2 = '2026-11-02T00:00:00.000Z'
const D3 = '2026-11-03T00:00:00.000Z'

describe('buildArticleDots (daatan#2300)', () => {
  it('collapses an article re-listed by later snapshots into one dot', () => {
    const dots = buildArticleDots([
      row({ snapshotAt: D1 }),
      row({ snapshotAt: D2 }),
      row({ snapshotAt: D3 }),
    ])
    expect(dots).toHaveLength(1)
  })

  it('dedupes by canonical URL: www., tracking params and the fragment are the same article', () => {
    const dots = buildArticleDots([
      row({ snapshotAt: D1, url: 'https://www.example.com/a?utm_source=x#top' }),
      row({ snapshotAt: D2, url: 'https://example.com/a' }),
      row({ snapshotAt: D2, url: 'https://example.com/b' }),
    ])
    expect(dots.map((d) => d.url).sort()).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('places a dot at the FIRST snapshot that lists the article, whatever the input order', () => {
    const [dot] = buildArticleDots([
      row({ snapshotAt: D3 }),
      row({ snapshotAt: D1 }),
      row({ snapshotAt: D2 }),
    ])
    expect(dot.firstSeenAt).toBe(D1)
  })

  it('takes y, size and side from the LATEST reading, at the first-seen time', () => {
    const [dot] = buildArticleDots([
      row({ snapshotAt: D2, stance: -0.6, certainty: 0.3 }),
      row({ snapshotAt: D1, stance: 0.4, certainty: 0.9 }),
    ])
    expect(dot.firstSeenAt).toBe(D1)
    expect(dot.probYes).toBeCloseTo(0.2) // (1 + -0.6) / 2
    expect(dot.certainty).toBe(0.3)
    expect(dot.side).toBe('no')
  })

  it('y is (1 + stance) / 2 — the same vote as the sources badge, not moved by certainty', () => {
    const [dot] = buildArticleDots([row({ stance: 0.3, certainty: 0.75 })])
    expect(dot.probYes).toBeCloseTo(0.65)
    expect(dot.side).toBe('yes')
  })

  it('skips an article whose latest reading has no stance (gate-rejected)', () => {
    const dots = buildArticleDots([
      row({ url: 'https://example.com/kept', stance: 0.1 }),
      row({ url: 'https://example.com/rejected', stance: null }),
    ])
    expect(dots.map((d) => d.url)).toEqual(['https://example.com/kept'])
  })

  it('a stance lost on a later reading drops the dot; a stance gained keeps it', () => {
    const dots = buildArticleDots([
      row({ url: 'https://example.com/lost', snapshotAt: D1, stance: 0.5 }),
      row({ url: 'https://example.com/lost', snapshotAt: D2, stance: null }),
      row({ url: 'https://example.com/gained', snapshotAt: D1, stance: null }),
      row({ url: 'https://example.com/gained', snapshotAt: D2, stance: -0.5 }),
    ])
    expect(dots.map((d) => [d.url, d.firstSeenAt])).toEqual([['https://example.com/gained', D1]])
  })

  it('within one snapshot the later entry is the latest reading', () => {
    const [dot] = buildArticleDots([
      row({ snapshotAt: D1, stance: 0.5 }),
      row({ snapshotAt: D1, url: 'https://www.example.com/a', stance: -0.5 }),
    ])
    expect(dot.side).toBe('no')
  })

  it('uses the same side thresholds as the sources panel (|stance| > 0.15)', () => {
    const sides = buildArticleDots([
      row({ url: 'https://e.com/1', stance: 0.15 }),
      row({ url: 'https://e.com/2', stance: 0.16 }),
      row({ url: 'https://e.com/3', stance: -0.16 }),
    ]).map((d) => [d.url, d.side])
    expect(sides).toEqual([
      ['https://e.com/1', 'neutral'],
      ['https://e.com/2', 'yes'],
      ['https://e.com/3', 'no'],
    ])
  })

  it('keeps the newest non-null title/outlet and links the outlet page via its resolved name', () => {
    const [dot] = buildArticleDots([
      row({ snapshotAt: D1, title: 'Old title', sourceName: 'Ex', outletName: 'Example Outlet' }),
      row({ snapshotAt: D2, title: null, sourceName: null, outletName: null }),
    ])
    expect(dot.title).toBe('Old title')
    expect(dot.outlet).toBe('Ex')
    expect(dot.outletPath).toBe('/sources/Example%20Outlet')
  })

  it('falls back to the article host for the outlet page when no outlet identity resolved', () => {
    const [dot] = buildArticleDots([row({ url: 'https://www.ynet.co.il/news/1', outletName: null })])
    expect(dot.outletPath).toBe('/sources/ynet.co.il')
  })

  it('clamps certainty to [0, 1] and passes a missing one through as null', () => {
    const dots = buildArticleDots([
      row({ url: 'https://e.com/1', certainty: 1.4 }),
      row({ url: 'https://e.com/2', certainty: null }),
    ])
    expect(dots.map((d) => d.certainty)).toEqual([1, null])
  })

  it('ignores rows without a URL or a parseable time, and returns dots oldest first', () => {
    const dots = buildArticleDots([
      row({ url: null }),
      row({ url: '  ' }),
      row({ snapshotAt: 'not a date', url: 'https://e.com/bad' }),
      row({ snapshotAt: D2, url: 'https://e.com/late' }),
      row({ snapshotAt: new Date(D1), url: 'https://e.com/early' }),
    ])
    expect(dots.map((d) => d.url)).toEqual(['https://e.com/early', 'https://e.com/late'])
  })
})
