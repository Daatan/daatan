/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../oracle', () => ({
  getAuthorShadowLeaderboard: vi.fn(),
}))

import { getAuthorShadowLeaderboard } from '../oracle'
import { aggregateByOutlet, authorKey, authorsOfOutlet, bylinePeople, getSourceLeaderboard, getAuthorShadowRowsForOutlet } from '../sourceLeaderboard'
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

describe('outlet domain aliases', () => {
  it('rolls ynetnews.com into ynet.co.il and keeps unrelated outlets apart', () => {
    const rows = aggregateByOutlet([
      entry({ author: 'A', outlet_name: 'ynet.co.il', predictions: 3 }),
      entry({ author: 'B', outlet_name: 'ynetnews.com', predictions: 1 }),
      entry({ author: 'C', outlet_name: 'jpost.com', predictions: 2 }),
    ])
    const ynet = rows.find(r => r.outletName === 'ynet.co.il')
    expect(ynet).toMatchObject({ predictions: 4, authorCount: 2 })
    expect(rows.some(r => r.outletName === 'ynetnews.com')).toBe(false)
    expect(rows).toHaveLength(2)
  })

  it('outlet detail lookup by canonical name includes the alias rows', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 2,
      authors: [entry({ author: 'A', outlet_name: 'ynet.co.il' }), entry({ author: 'B', outlet_name: 'ynetnews.com' })],
    })
    expect(await getAuthorShadowRowsForOutlet('ynet.co.il')).toHaveLength(2)
  })
})

describe('aggregateByOutlet exclusions', () => {
  it('drops rows with a null or blank outlet_name', () => {
    const rows = aggregateByOutlet([
      entry({ author: 'A', outlet_name: null as unknown as string }),
      entry({ author: 'B', outlet_name: '  ' }),
      entry({ author: 'C', outlet_name: 'jpost.com' }),
    ])
    expect(rows.map(r => r.outletName)).toEqual(['jpost.com'])
  })

  it('drops a personal source whose outlet_name is its own author', () => {
    const rows = aggregateByOutlet([
      entry({ author: 'Guy Bechor', outlet_name: 'Guy Bechor' }),
      entry({ author: 'Someone', outlet_name: 'Guy Bechor' }),
      entry({ author: 'C', outlet_name: 'jpost.com' }),
    ])
    expect(rows.map(r => r.outletName)).toEqual(['jpost.com'])
  })
})

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

describe('byline placeholders and repeated authors (#1903)', () => {
  it('does not count the bylineless bucket or alias duplicates as authors, but keeps their predictions', () => {
    const [row] = aggregateByOutlet([
      entry({ author: 'Lior Ben Ari', outlet_name: 'ynet.co.il', predictions: 1 }),
      entry({ author: 'Lior Ben Ari', outlet_name: 'ynetnews.com', predictions: 1 }),
      entry({ author: 'lior ben ari ', outlet_name: 'ynet.co.il', predictions: 1 }),
      entry({ author: 'Nadav Eyal', outlet_name: 'ynet.co.il', predictions: 2 }),
      entry({ author: '(no byline)', outlet_name: 'ynet.co.il', predictions: 1 }),
    ])
    expect(row.authorCount).toBe(2)
    expect(row.predictions).toBe(6)
  })

  it('drops the placeholder from the authors board', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 2,
      authors: [entry({ author: '(no byline)', outlet_name: 'X', predictions: 9 }), entry({ author: 'A', outlet_name: 'X', predictions: 9 })],
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative', 4)
    expect(authorRows.map(r => r.author)).toEqual(['A'])
  })

  it('authorsOfOutlet merges same-name rows across aliases, prediction-weighted, and skips the placeholder', () => {
    const row = (o: Partial<ReturnType<typeof rowBase>>) => ({ ...rowBase(), ...o })
    function rowBase() {
      return { id: 'x', author: 'A', outletName: 'ynet.co.il', skillConservative: 0, brierScore: 0.5, predictions: 1, articles: 1 }
    }
    const out = authorsOfOutlet(
      [
        row({ id: '1', author: 'Lior Ben Ari', outletName: 'ynet.co.il', brierScore: 0.2, skillConservative: 0.4, predictions: 3 }),
        row({ id: '2', author: 'Lior Ben Ari', outletName: 'ynetnews.com', brierScore: 0.6, skillConservative: 0, predictions: 1 }),
        row({ id: '3', author: '(no byline)', outletName: 'ynet.co.il', predictions: 5 }),
        row({ id: '4', author: 'Other', outletName: 'jpost.com', predictions: 9 }),
      ],
      'ynet.co.il',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ author: 'Lior Ben Ari', predictions: 4, outletName: 'ynet.co.il', articles: 2 })
    expect(out[0].brierScore).toBeCloseTo(0.3) // (0.2*3 + 0.6*1) / 4
    expect(out[0].skillConservative).toBeCloseTo(0.3) // (0.4*3 + 0*1) / 4
  })
})

describe('one person, several spellings (#1904)', () => {
  it('authorKey ignores case, periods, quotes and spacing', () => {
    expect(authorKey('SETH J. FRANTZMAN')).toBe(authorKey('Seth J Frantzman'))
    expect(authorKey("  Ze'ev   Smith ")).toBe(authorKey('Zeev Smith'))
    expect(authorKey('Nadav Eyal')).not.toBe(authorKey('Nadav Eyal Jr'))
  })

  it('authorKey maps the listed Hebrew spellings onto the English one', () => {
    expect(authorKey('איתמר אייכנר')).toBe(authorKey('Itamar Eichner'))
    expect(authorKey('ליאור בן ארי')).toBe(authorKey('Lior Ben Ari'))
  })

  it('counts and merges them as one author', () => {
    const [row] = aggregateByOutlet([
      entry({ author: 'SETH J FRANTZMAN', outlet_name: 'jpost.com', predictions: 2 }),
      entry({ author: 'SETH J. FRANTZMAN', outlet_name: 'jpost.com', predictions: 1 }),
      entry({ author: 'Itamar Eichner', outlet_name: 'jpost.com', predictions: 1 }),
      entry({ author: 'איתמר אייכנר', outlet_name: 'jpost.com', predictions: 1 }),
    ])
    expect(row.authorCount).toBe(2)
    const merged = authorsOfOutlet(
      [
        { id: '1', author: 'SETH J FRANTZMAN', outletName: 'jpost.com', skillConservative: 0, brierScore: 0.4, predictions: 2, articles: 1 },
        { id: '2', author: 'SETH J. FRANTZMAN', outletName: 'jpost.com', skillConservative: 0, brierScore: 0.7, predictions: 1, articles: 1 },
      ],
      'jpost.com',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].predictions).toBe(3)
    expect(merged[0].brierScore).toBeCloseTo(0.5)
  })
})

describe('joint bylines are split (#1904)', () => {
  it('splits on ; & and, drops agencies/datelines, keeps solo and bylineless alone', () => {
    expect(bylinePeople('Itamar Eichner; Lior Ben Ari; News Agencies')).toEqual(['Itamar Eichner', 'Lior Ben Ari'])
    expect(bylinePeople('איתמר אייכנר; ליאור בן ארי; דניאל אדלסון; ניו יורק')).toEqual(['איתמר אייכנר', 'ליאור בן ארי', 'דניאל אדלסון'])
    expect(bylinePeople('Sean Williams, The Motley Fool')).toEqual(['Sean Williams'])
    expect(bylinePeople('Jane Doe and John Roe')).toEqual(['Jane Doe', 'John Roe'])
    expect(bylinePeople('ליאור בן ארי, איתמר אייכנר')).toEqual(['ליאור בן ארי', 'איתמר אייכנר'])
    expect(bylinePeople('Smith, John')).toEqual(['Smith, John'])
    expect(bylinePeople('Reuters')).toEqual(['Reuters'])
    expect(bylinePeople('(no byline)')).toEqual([])
    expect(bylinePeople('News Agencies; The Motley Fool')).toEqual([])
  })

  it('credits each named person the joint row in full and merges it with their solo row', () => {
    const base = { skillConservative: 0, articles: 1, outletName: 'ynet.co.il' }
    const out = authorsOfOutlet(
      [
        { ...base, id: 's', author: 'Lior Ben Ari', brierScore: 0.2, predictions: 1 },
        { ...base, id: 'j', author: 'ליאור בן ארי, איתמר אייכנר', brierScore: 0.6, predictions: 1 },
        { ...base, id: 'k', author: 'Itamar Eichner; Lior Ben Ari; News Agencies', brierScore: 0.4, predictions: 2 },
      ],
      'ynet.co.il',
    )
    const by = Object.fromEntries(out.map(r => [authorKey(r.author), r]))
    expect(Object.keys(by).sort()).toEqual(['itamar eichner', 'lior ben ari'])
    expect(by['lior ben ari'].predictions).toBe(4) // 1 solo + 1 + 2
    expect(by['lior ben ari'].brierScore).toBeCloseTo((0.2 + 0.6 + 0.4 * 2) / 4)
    expect(by['itamar eichner'].predictions).toBe(3) // 1 + 2
  })

  it('counts people, not ledger rows, and leaves outlet totals untouched', () => {
    const [row] = aggregateByOutlet([
      entry({ author: 'Itamar Eichner; Lior Ben Ari', outlet_name: 'ynet.co.il', predictions: 2 }),
      entry({ author: 'Lior Ben Ari', outlet_name: 'ynet.co.il', predictions: 1 }),
      entry({ author: 'News Agencies; The Motley Fool', outlet_name: 'ynet.co.il', predictions: 1 }),
    ])
    expect(row.authorCount).toBe(2)
    expect(row.predictions).toBe(4) // the outlet's own record is not multiplied
  })

  it('the authors board shows the individuals', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 2,
      authors: [
        entry({ author: 'A One; B Two', outlet_name: 'X', predictions: 3 }),
        entry({ author: 'A One', outlet_name: 'X', predictions: 2 }),
      ],
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative', 4)
    expect(authorRows.map(r => [r.author, r.predictions])).toEqual([['A One', 5]])
  })
})

describe('per-topic board (#1917)', () => {
  it('asks the Oracul for the tag’s board and leaves the default call untagged', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 0, authors: [] })
    await getSourceLeaderboard('outlets', 'skillConservative', 0, 'economy')
    expect(mockGetAuthorShadowLeaderboard).toHaveBeenLastCalledWith(undefined, 'economy')
    await getSourceLeaderboard('outlets')
    expect(mockGetAuthorShadowLeaderboard).toHaveBeenLastCalledWith(undefined, undefined)
  })
})

describe('an outlet filed under its own name in another script (#1904 item 3)', () => {
  const entries = [
    entry({ author: 'الجزيرة نت', outlet_name: 'aljazeera.net', predictions: 4 }),
    entry({ author: 'Real Person', outlet_name: 'aljazeera.net', predictions: 2 }),
  ]

  it('is not an author, but still counts toward the outlet', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 2, authors: entries })
    const { authorRows, outletRows } = await getSourceLeaderboard('authors')
    expect(authorRows.map(r => r.author)).toEqual(['Real Person'])
    expect(outletRows[0]).toMatchObject({ outletName: 'aljazeera.net', predictions: 6, authorCount: 1 })
  })

  it('leaves the outlet page with no listed authors when it has only that byline', () => {
    const rows = [entry({ author: 'חדשות סרוגים', outlet_name: 'srugim.co.il', predictions: 8 })]
    expect(bylinePeople('חדשות סרוגים')).toEqual([])
    expect(aggregateByOutlet(rows)[0]).toMatchObject({ predictions: 8, authorCount: 0 })
  })
})
