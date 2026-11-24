import { describe, it, expect } from 'vitest'
import { buildArticleDots, type ArticleDotRow } from '../article-dots'

const D1 = '2026-11-01T00:00:00.000Z'
const D2 = '2026-11-02T00:00:00.000Z'
const D3 = '2026-11-03T00:00:00.000Z'

/** One entry of the latest pool (read at D3), first seen at D1 unless overridden. */
const row = (over: Partial<ArticleDotRow>): ArticleDotRow => ({
  readAt: D3,
  firstSeenAt: D1,
  url: 'https://example.com/a',
  stance: 0.4,
  certainty: 0.8,
  title: 'A headline',
  sourceName: 'Example',
  outletName: null,
  poolSize: 1,
  ...over,
})

describe('buildArticleDots (daatan#2300)', () => {
  it('places each article at its first sighting, with its current reading', () => {
    const [dot] = buildArticleDots([row({ firstSeenAt: D2, stance: -0.6, certainty: 0.3 })])
    expect(dot.firstSeenAt).toBe(D2)
    expect(dot.probYes).toBeCloseTo(0.2) // (1 + -0.6) / 2
    expect(dot.certainty).toBe(0.3)
    expect(dot.side).toBe('no')
  })

  it('dedupes by canonical URL: www., tracking params and the fragment are the same article', () => {
    const dots = buildArticleDots([
      row({ url: 'https://www.example.com/a?utm_source=x#top' }),
      row({ url: 'https://example.com/a' }),
      row({ url: 'https://example.com/b' }),
    ])
    expect(dots.map((d) => d.url).sort()).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('a merged article is first seen at the EARLIEST sighting of any of its URLs, whatever the order', () => {
    const [dot] = buildArticleDots([
      row({ url: 'https://example.com/a', firstSeenAt: D2 }),
      row({ url: 'https://www.example.com/a', firstSeenAt: D1 }),
    ])
    expect(dot.firstSeenAt).toBe(D1)
  })

  it('the later pool entry of a merged article is its reading', () => {
    const [dot] = buildArticleDots([
      row({ stance: 0.5 }),
      row({ url: 'https://www.example.com/a', stance: -0.5 }),
    ])
    expect(dot.side).toBe('no')
    expect(dot.url).toBe('https://www.example.com/a')
  })

  it('a row the delta chain could not place counts as first seen at the reading', () => {
    const dots = buildArticleDots([
      row({ url: 'https://e.com/1', firstSeenAt: null }),
      row({ url: 'https://e.com/2', firstSeenAt: 'not a date' }),
    ])
    expect(dots.map((d) => d.firstSeenAt)).toEqual([D3, D3])
  })

  it('y is (1 + stance) / 2 — the same vote as the sources badge, not moved by certainty', () => {
    const [dot] = buildArticleDots([row({ stance: 0.3, certainty: 0.75 })])
    expect(dot.probYes).toBeCloseTo(0.65)
    expect(dot.side).toBe('yes')
  })

  it('skips an article with no stance (gate-rejected), even when a merged twin had one', () => {
    const dots = buildArticleDots([
      row({ url: 'https://example.com/kept', stance: 0.1 }),
      row({ url: 'https://example.com/rejected', stance: null }),
      row({ url: 'https://example.com/lost', stance: 0.5 }),
      row({ url: 'https://www.example.com/lost', stance: null }),
    ])
    expect(dots.map((d) => d.url)).toEqual(['https://example.com/kept'])
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

  it('keeps the last non-null title/outlet and links the outlet page via its resolved name', () => {
    const [dot] = buildArticleDots([
      row({ title: 'Old title', sourceName: 'Ex', outletName: 'Example Outlet' }),
      row({ url: 'https://www.example.com/a', title: null, sourceName: null, outletName: null }),
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

  it('ignores rows without a URL or a parseable reading time, and returns dots oldest first', () => {
    const dots = buildArticleDots([
      row({ url: null }),
      row({ url: '  ' }),
      row({ readAt: 'not a date', url: 'https://e.com/bad' }),
      row({ firstSeenAt: D2, url: 'https://e.com/late' }),
      row({ firstSeenAt: new Date(D1), url: 'https://e.com/early' }),
    ])
    expect(dots.map((d) => d.url)).toEqual(['https://e.com/early', 'https://e.com/late'])
  })
})
