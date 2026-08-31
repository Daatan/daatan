/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../oracle', () => ({
  getAuthorShadowLeaderboard: vi.fn(),
}))

import { getAuthorShadowLeaderboard } from '../oracle'
import { aggregateByOutlet, getSourceLeaderboard, getAuthorShadowRowsForOutlet } from '../sourceLeaderboard'
import type { OracleAuthorShadowEntry } from '../oracle'

const mockGetAuthorShadowLeaderboard = vi.mocked(getAuthorShadowLeaderboard)

function entry(overrides: Partial<OracleAuthorShadowEntry>): OracleAuthorShadowEntry {
  return {
    id: `${overrides.author} — ${overrides.outlet_name}`,
    author: 'Some Author',
    outlet_name: 'Some Outlet',
    brier_score: 0.25,
    skill_mu: 25,
    skill_sigma: 8.33,
    skill_conservative: 0,
    predictions: 1,
    articles: 1,
    ...overrides,
  }
}

describe('aggregateByOutlet', () => {
  it('weights brier_score and skill_conservative by each author\'s predictions', () => {
    const entries = [
      entry({ author: 'A', outlet_name: 'X', brier_score: 0.2, skill_conservative: 0.5, predictions: 3, articles: 5 }),
      entry({ author: 'B', outlet_name: 'X', brier_score: 0.8, skill_conservative: -0.5, predictions: 1, articles: 2 }),
    ]
    const [row] = aggregateByOutlet(entries)
    // weighted brier = (0.2*3 + 0.8*1) / 4 = 0.35; weighted skill = (0.5*3 + -0.5*1) / 4 = 0.25
    expect(row.brierScore).toBeCloseTo(0.35)
    expect(row.skillConservative).toBeCloseTo(0.25)
    expect(row.authorCount).toBe(2)
    expect(row.predictions).toBe(4)
    expect(row.articles).toBe(7)
  })

  it('keeps outlets with different names as separate rows', () => {
    const entries = [
      entry({ author: 'A', outlet_name: 'X' }),
      entry({ author: 'B', outlet_name: 'Y' }),
    ]
    const rows = aggregateByOutlet(entries)
    expect(rows.map(r => r.outletName).sort()).toEqual(['X', 'Y'])
  })

  it('falls back to a plain mean when total predictions is zero', () => {
    const entries = [
      entry({ author: 'A', outlet_name: 'X', brier_score: 0.2, skill_conservative: 0.4, predictions: 0 }),
      entry({ author: 'B', outlet_name: 'X', brier_score: 0.6, skill_conservative: 0.8, predictions: 0 }),
    ]
    const [row] = aggregateByOutlet(entries)
    expect(row.brierScore).toBeCloseTo(0.4)
    expect(row.skillConservative).toBeCloseTo(0.6)
  })

  it('returns an empty array for no entries', () => {
    expect(aggregateByOutlet([])).toEqual([])
  })
})

describe('getSourceLeaderboard', () => {
  beforeEach(() => {
    mockGetAuthorShadowLeaderboard.mockReset()
  })

  it('fails open to empty rows when the Oracul call returns null', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce(null)
    const result = await getSourceLeaderboard()
    expect(result.authorRows).toEqual([])
    expect(result.outletRows).toEqual([])
  })

  it('sorts author rows by skillConservative descending by default', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [
        entry({ author: 'Low', outlet_name: 'X', skill_conservative: -0.5, brier_score: 0.4 }),
        entry({ author: 'High', outlet_name: 'X', skill_conservative: 0.7, brier_score: 0.1 }),
      ],
      count: 2,
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative')
    expect(authorRows.map(r => r.author)).toEqual(['High', 'Low'])
  })

  it('sorts author rows by brierScore ascending when requested', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [
        entry({ author: 'Worse', outlet_name: 'X', skill_conservative: 0.7, brier_score: 0.4 }),
        entry({ author: 'Better', outlet_name: 'X', skill_conservative: -0.5, brier_score: 0.1 }),
      ],
      count: 2,
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'brierScore')
    expect(authorRows.map(r => r.author)).toEqual(['Better', 'Worse'])
  })

  it('sorts outlet rows the same way as author rows', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [
        entry({ author: 'A', outlet_name: 'Weak Outlet', skill_conservative: -0.2, predictions: 2 }),
        entry({ author: 'B', outlet_name: 'Strong Outlet', skill_conservative: 0.6, predictions: 2 }),
      ],
      count: 2,
    })
    const { outletRows } = await getSourceLeaderboard('outlets', 'skillConservative')
    expect(outletRows.map(r => r.outletName)).toEqual(['Strong Outlet', 'Weak Outlet'])
  })

  it('does not filter by predictions when minPredictions is omitted (default 0)', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [entry({ author: 'Thin', outlet_name: 'X', predictions: 1 })],
      count: 1,
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative')
    expect(authorRows.map(r => r.author)).toEqual(['Thin'])
  })

  it('filters out author rows below minPredictions', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [
        entry({ author: 'Thin', outlet_name: 'X', predictions: 2 }),
        entry({ author: 'Established', outlet_name: 'X', predictions: 10 }),
      ],
      count: 2,
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative', 5)
    expect(authorRows.map(r => r.author)).toEqual(['Established'])
  })

  it('filters outlet rows by their aggregate predictions count, not by dropping thin authors pre-aggregation', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [
        entry({ author: 'A', outlet_name: 'Combined', predictions: 2 }),
        entry({ author: 'B', outlet_name: 'Combined', predictions: 4 }),
        entry({ author: 'C', outlet_name: 'ThinOutlet', predictions: 2 }),
      ],
      count: 3,
    })
    const { outletRows } = await getSourceLeaderboard('outlets', 'skillConservative', 5)
    // Combined: 2+4=6 predictions, clears the bar even though neither author alone would.
    expect(outletRows.map(r => r.outletName)).toEqual(['Combined'])
  })
})

describe('getAuthorShadowRowsForOutlet', () => {
  beforeEach(() => {
    mockGetAuthorShadowLeaderboard.mockReset()
  })

  it('fails open to an empty array when the Oracul call returns null', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce(null)
    expect(await getAuthorShadowRowsForOutlet('Some Outlet')).toEqual([])
  })

  it('filters to only the requested outlet', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [
        entry({ author: 'A', outlet_name: 'X' }),
        entry({ author: 'B', outlet_name: 'Y' }),
      ],
      count: 2,
    })
    const rows = await getAuthorShadowRowsForOutlet('X')
    expect(rows.map(r => r.author)).toEqual(['A'])
  })

  it('sorts by skillConservative descending', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [
        entry({ author: 'Low', outlet_name: 'X', skill_conservative: -0.5 }),
        entry({ author: 'High', outlet_name: 'X', skill_conservative: 0.7 }),
      ],
      count: 2,
    })
    const rows = await getAuthorShadowRowsForOutlet('X')
    expect(rows.map(r => r.author)).toEqual(['High', 'Low'])
  })

  it('returns an empty array when the outlet has no rows', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValueOnce({
      authors: [entry({ author: 'A', outlet_name: 'X' })],
      count: 1,
    })
    expect(await getAuthorShadowRowsForOutlet('Unrelated Outlet')).toEqual([])
  })
})
