/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../oracle', () => ({
  getAuthorShadowLeaderboard: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthorShadowLeaderboard } from '../oracle'
import { aggregateByOutlet, authorKey, authorsOfOutlet, bylinePeople, getSourceLeaderboard, getAuthorShadowRowsForOutlet, isDeskByline } from '../sourceLeaderboard'
import type { OracleAuthorShadowEntry } from '../oracle'

const mockGetAuthorShadowLeaderboard = vi.mocked(getAuthorShadowLeaderboard)
const mockQueryRaw = vi.mocked(prisma.$queryRaw)

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
    expect(bylinePeople('Reuters')).toEqual([]) // a desk byline names no person
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

describe('rows hidden by the sample-size floor (#2179)', () => {
  it('counts the authors and outlets the floor leaves off, after merging', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 4,
      authors: [
        entry({ author: 'Big One', outlet_name: 'big.com', predictions: 5 }),
        entry({ author: 'Small One', outlet_name: 'big.com', predictions: 1 }),
        entry({ author: 'Lone', outlet_name: 'small.com', predictions: 2 }),
        entry({ author: 'Other', outlet_name: 'small.com', predictions: 1 }),
      ],
    })
    const r = await getSourceLeaderboard('authors', 'skillConservative', 4)
    expect(r.authorRows.map(a => a.author)).toEqual(['Big One'])
    expect(r.outletRows.map(o => o.outletName)).toEqual(['big.com'])
    expect(r).toMatchObject({ minPredictions: 4, hiddenAuthors: 3, hiddenOutlets: 1 })
  })

  it('hides nothing without a floor', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 1,
      authors: [entry({ author: 'Lone', outlet_name: 'small.com', predictions: 1 })],
    })
    expect(await getSourceLeaderboard('authors')).toMatchObject({ hiddenAuthors: 0, hiddenOutlets: 0 })
  })
})

describe('desk bylines: newsroom, agency or the outlet itself (#1904 item 3)', () => {
  it('recognises agencies, newsroom credits and an outlet named in another script', () => {
    for (const b of ['Reuters', 'News Agencies', 'JPOST EDITORIAL', 'Times of Israel Staff', 'מערכת וואלה', 'الجزيرة نت', 'חדשות סרוגים', 'כיכר השבת']) {
      expect(isDeskByline(b), b).toBe(true)
    }
    for (const b of ['Itamar Eichner', 'ליאור בן ארי', 'Guy Bechor', 'Smith, John', 'Itamar Eichner; News Agencies', 'כיכר השבת; יוני גבאי']) {
      expect(isDeskByline(b), b).toBe(false)
    }
  })

  const entries = [
    entry({ author: 'الجزيرة نت', outlet_name: 'aljazeera.net', predictions: 4 }),
    entry({ author: 'Real Person', outlet_name: 'aljazeera.net', predictions: 2 }),
  ]

  it('stays on the authors board marked as a desk, counts toward the outlet, not its people', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 2, authors: entries })
    const { authorRows, outletRows } = await getSourceLeaderboard('authors')
    expect(authorRows.map(r => [r.author, r.isDesk])).toEqual([['الجزيرة نت', true], ['Real Person', false]])
    expect(outletRows[0]).toMatchObject({ outletName: 'aljazeera.net', predictions: 6, authorCount: 1 })
  })

  // #2317: kikar.co.il bylines most pieces "כיכר השבת; <journalist>". The outlet's name is not a
  // person, so the joint rows credit only the journalist and the outlet keeps its solo record.
  it('drops the outlet from a joint "outlet; journalist" byline and keeps only its solo record', async () => {
    expect(bylinePeople('כיכר השבת; יוני גבאי')).toEqual(['יוני גבאי'])
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 2,
      authors: [
        entry({ author: 'כיכר השבת', outlet_name: 'kikar.co.il', predictions: 3 }),
        entry({ author: 'כיכר השבת; יוני גבאי', outlet_name: 'kikar.co.il', predictions: 5 }),
      ],
    })
    const all = await getSourceLeaderboard('authors')
    expect(all.authorRows.map(r => [r.author, r.predictions, r.isDesk])).toEqual(
      expect.arrayContaining([['כיכר השבת', 3, true], ['יוני גבאי', 5, false]]),
    )
    expect(all.authorRows).toHaveLength(2)
    const floored = await getSourceLeaderboard('authors', 'skillConservative', 4)
    expect(floored.authorRows.map(r => r.author)).toEqual(['יוני גבאי'])
    expect(floored.hiddenAuthors).toBe(1)
  })

  it('is listed on its outlet page even when it is the only byline', () => {
    const rows = [entry({ author: 'JPOST EDITORIAL', outlet_name: 'jpost.com', predictions: 8 })]
    expect(bylinePeople('JPOST EDITORIAL')).toEqual([])
    expect(aggregateByOutlet(rows)[0]).toMatchObject({ predictions: 8, authorCount: 0 })
    const listed = authorsOfOutlet(
      [{ id: 'd', author: 'JPOST EDITORIAL', outletName: 'jpost.com', skillConservative: 0, brierScore: 0.3, predictions: 8, articles: 8, isDesk: true }],
      'jpost.com',
    )
    expect(listed.map(r => r.author)).toEqual(['JPOST EDITORIAL'])
  })
})

describe('"takes a side" counts (#2231)', () => {
  const group = (o: { author?: string | null; person_name?: string | null; outlet: string; predictions: string[]; leaning?: string[] | null }) => ({
    author: null, person_name: null, leaning: null, ...o,
  })
  const board = (tag?: string) =>
    getSourceLeaderboard('authors', 'skillConservative', 0, tag, { sideCounts: true })
  const lastSql = () => mockQueryRaw.mock.calls.at(-1)![0] as unknown as Prisma.Sql

  beforeEach(() => {
    mockGetAuthorShadowLeaderboard.mockReset()
    mockQueryRaw.mockReset()
  })

  it('counts distinct forecasts matched by personName or raw byline at the same outlet', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 1, authors: [entry({ author: 'Jane Roe', outlet_name: 'janeroe.blog', predictions: 5 })] })
    mockQueryRaw.mockResolvedValue([
      group({ author: 'ג׳יין רו', person_name: 'Jane Roe', outlet: 'janeroe.blog', predictions: ['p1', 'p2'], leaning: ['p1'] }),
      group({ author: 'JANE ROE', outlet: 'janeroe.blog', predictions: ['p2', 'p3'] }),
      group({ author: 'Jane Roe', person_name: 'Someone Else', outlet: 'janeroe.blog', predictions: ['p4'], leaning: ['p4'] }),
      group({ author: 'Jane Roe', outlet: 'other.com', predictions: ['p9'], leaning: ['p9'] }),
      group({ author: 'John Doe', outlet: 'janeroe.blog', predictions: ['p8'], leaning: ['p8'] }),
    ] as never)
    const { authorRows } = await board()
    expect(authorRows[0]).toMatchObject({ author: 'Jane Roe', sideTaken: 2, sideTotal: 4 })
  })

  it('folds alias hostnames into the merged row, and asks only for the board’s outlets', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 2,
      authors: [
        entry({ author: 'Lior Ben Ari', outlet_name: 'ynetnews.com', predictions: 3 }),
        entry({ author: 'ליאור בן ארי', outlet_name: 'ynet.co.il', predictions: 1 }),
      ],
    })
    mockQueryRaw.mockResolvedValue([
      group({ author: 'Lior Ben Ari', outlet: 'ynetnews.com', predictions: ['p1', 'p2'], leaning: ['p1'] }),
      group({ author: 'ליאור בן ארי', outlet: 'ynet.co.il', predictions: ['p2', 'p3'], leaning: ['p2'] }),
    ] as never)
    const { authorRows } = await board()
    expect(authorRows).toHaveLength(1)
    expect(authorRows[0]).toMatchObject({ outletName: 'ynetnews.com', sideTaken: 2, sideTotal: 3 })
    expect(lastSql().values[0]).toEqual(expect.arrayContaining(['ynet.co.il', 'ynetnews.com']))
  })

  it('credits a joint pool byline to each person, split the way the board splits its own rows', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 3,
      authors: [
        entry({ author: 'Itamar Eichner', outlet_name: 'ynet.co.il', predictions: 4 }),
        entry({ author: 'Lior Ben Ari', outlet_name: 'ynet.co.il', predictions: 4 }),
        entry({ author: 'Smith, John', outlet_name: 'ynet.co.il', predictions: 4 }),
      ],
    })
    mockQueryRaw.mockResolvedValue([
      group({ author: 'Itamar Eichner; Lior Ben Ari; News Agencies', outlet: 'ynet.co.il', predictions: ['p1', 'p2'], leaning: ['p1'] }),
      group({ author: 'ליאור בן ארי, איתמר אייכנר', outlet: 'ynetnews.com', predictions: ['p2', 'p3'], leaning: ['p3'] }),
      group({ author: 'Lior Ben Ari', person_name: 'Lior Ben Ari', outlet: 'ynet.co.il', predictions: ['p1', 'p4'] }),
      group({ author: 'Smith, John', outlet: 'ynet.co.il', predictions: ['p5'], leaning: ['p5'] }),
    ] as never)
    const { authorRows } = await board()
    const by = Object.fromEntries(authorRows.map(r => [r.author, `${r.sideTaken}/${r.sideTotal}`]))
    // p1 and p2 reach Lior through two groups each and still count once.
    expect(by).toEqual({ 'Itamar Eichner': '2/3', 'Lior Ben Ari': '2/4', 'Smith, John': '1/1' })
  })

  it('gives desk bylines and unmatched authors no value', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 3,
      authors: [
        entry({ author: 'Reuters', outlet_name: 'reuters.com', predictions: 4 }),
        entry({ author: 'Nobody Matched', outlet_name: 'x.com', predictions: 4 }),
        entry({ author: 'Has Rows', outlet_name: 'x.com', predictions: 4 }),
      ],
    })
    mockQueryRaw.mockResolvedValue([
      group({ author: 'Reuters', outlet: 'reuters.com', predictions: ['p1'], leaning: ['p1'] }),
      group({ author: 'Has Rows', outlet: 'x.com', predictions: ['p1'] }),
    ] as never)
    const { authorRows } = await board()
    const by = Object.fromEntries(authorRows.map(r => [r.author, [r.sideTaken, r.sideTotal]]))
    expect(by).toEqual({ Reuters: [null, null], 'Nobody Matched': [null, null], 'Has Rows': [0, 1] })
    expect(lastSql().values[0]).toEqual(['x.com'])
  })

  it('restricts to the board’s tag only when one is set', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 1, authors: [entry({ author: 'A One', outlet_name: 'x.com', predictions: 4 })] })
    mockQueryRaw.mockResolvedValue([] as never)
    await board('economy')
    expect(lastSql().sql).toContain('"_PredictionToTag"')
    expect(lastSql().values).toContain('economy')
    await board()
    expect(lastSql().sql).not.toContain('"_PredictionToTag"')
  })

  it('counts only public forecasts: isPublic, no drafts, none awaiting approval, no retro simulations', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 1, authors: [entry({ author: 'A One', outlet_name: 'x.com', predictions: 4 })] })
    mockQueryRaw.mockResolvedValue([] as never)
    await board()
    const sql = lastSql().sql.replace(/\s+/g, ' ')
    expect(sql).toContain('p."isPublic" = true')
    expect(sql).toContain(`p.status NOT IN ('DRAFT', 'PENDING_APPROVAL')`)
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM retro_simulations r WHERE r.prediction_id = e."predictionId")')
  })

  it('is only computed when asked for', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 1, authors: [entry({ author: 'A One', outlet_name: 'x.com', predictions: 4 })] })
    const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative', 0)
    expect(mockQueryRaw).not.toHaveBeenCalled()
    expect(authorRows[0].sideTotal).toBeUndefined()
  })

  it('keeps the board up when the pool query fails', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({ count: 1, authors: [entry({ author: 'A One', outlet_name: 'x.com', predictions: 4 })] })
    mockQueryRaw.mockRejectedValue(new Error('db down'))
    const { authorRows } = await board()
    expect(authorRows.map(r => [r.author, r.sideTaken, r.sideTotal])).toEqual([['A One', null, null]])
  })

  it('sorts by rate, ties by sample size, rows without a value last; the default sort is unchanged', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 5,
      authors: [
        entry({ author: 'Three Of Four', outlet_name: 'x.com', skill_conservative: 0.9 }),
        entry({ author: 'Six Of Eight', outlet_name: 'x.com', skill_conservative: 0.1 }),
        entry({ author: 'One Of One', outlet_name: 'x.com', skill_conservative: 0.2 }),
        entry({ author: 'No Rows', outlet_name: 'x.com', skill_conservative: 0.8 }),
        entry({ author: 'Zero Of Two', outlet_name: 'x.com', skill_conservative: 0.3 }),
      ],
    })
    const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`)
    mockQueryRaw.mockResolvedValue([
      group({ author: 'Three Of Four', outlet: 'x.com', predictions: ids(4, 'a'), leaning: ids(3, 'a') }),
      group({ author: 'Six Of Eight', outlet: 'x.com', predictions: ids(8, 'b'), leaning: ids(6, 'b') }),
      group({ author: 'One Of One', outlet: 'x.com', predictions: ids(1, 'c'), leaning: ids(1, 'c') }),
      group({ author: 'Zero Of Two', outlet: 'x.com', predictions: ids(2, 'd') }),
    ] as never)
    const bySide = await getSourceLeaderboard('authors', 'sideRate', 0, undefined, { sideCounts: true })
    expect(bySide.authorRows.map(r => r.author)).toEqual(['One Of One', 'Six Of Eight', 'Three Of Four', 'Zero Of Two', 'No Rows'])
    const byDefault = await getSourceLeaderboard('authors', 'skillConservative', 0, undefined, { sideCounts: true })
    expect(byDefault.authorRows.map(r => r.author)).toEqual(['Three Of Four', 'No Rows', 'Zero Of Two', 'One Of One', 'Six Of Eight'])
  })

  it('leaves outlet rows in the default order under sideRate', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 2,
      authors: [
        entry({ author: 'A', outlet_name: 'weak.com', skill_conservative: -0.2 }),
        entry({ author: 'B', outlet_name: 'strong.com', skill_conservative: 0.6 }),
      ],
    })
    mockQueryRaw.mockResolvedValue([] as never)
    const { outletRows } = await getSourceLeaderboard('outlets', 'sideRate', 0, undefined, { sideCounts: true })
    expect(outletRows.map(r => r.outletName)).toEqual(['strong.com', 'weak.com'])
  })
})

describe('bits vs a coin flip (#2259)', () => {
  beforeEach(() => {
    mockGetAuthorShadowLeaderboard.mockReset()
  })

  it('maps retro\'s bits, null when the board predates them', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 2,
      authors: [entry({ author: 'Bold', outlet_name: 'x.com', bits: 1.23456 }), entry({ author: 'Old', outlet_name: 'x.com' })],
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative', 0)
    expect(Object.fromEntries(authorRows.map(r => [r.author, r.bits]))).toEqual({ Bold: 1.235, Old: null })
  })

  it('sums bits when merging a person\'s rows and across an outlet, skipping rows without them', () => {
    const merged = authorsOfOutlet(
      [
        { id: 's', author: 'Lior Ben Ari', outletName: 'ynet.co.il', skillConservative: 0, brierScore: 0.2, predictions: 1, articles: 1, bits: 0.85 },
        { id: 'j', author: 'Itamar Eichner; Lior Ben Ari', outletName: 'ynet.co.il', skillConservative: 0, brierScore: 0.2, predictions: 2, articles: 2, bits: -0.5 },
        { id: 'o', author: 'Lior Ben Ari', outletName: 'ynet.co.il', skillConservative: 0, brierScore: 0.2, predictions: 1, articles: 1, bits: null },
      ],
      'ynet.co.il',
    )
    const by = Object.fromEntries(merged.map(r => [authorKey(r.author), r.bits]))
    expect(by['lior ben ari']).toBeCloseTo(0.35)
    expect(by['itamar eichner']).toBeCloseTo(-0.5)

    const [outlet] = aggregateByOutlet([
      entry({ author: 'A', outlet_name: 'x.com', bits: 0.85 }),
      entry({ author: 'B', outlet_name: 'x.com', bits: 0.55 }),
      entry({ author: 'C', outlet_name: 'x.com' }),
    ])
    expect(outlet.bits).toBeCloseTo(1.4)
    const [none] = aggregateByOutlet([entry({ author: 'A', outlet_name: 'y.com' })])
    expect(none.bits).toBeNull()
  })

  it('sorts by bits, highest first, rows without bits last', async () => {
    mockGetAuthorShadowLeaderboard.mockResolvedValue({
      count: 3,
      authors: [
        entry({ author: 'Cautious', outlet_name: 'x.com', bits: 0.55, skill_conservative: 0.9 }),
        entry({ author: 'Unscored', outlet_name: 'x.com', skill_conservative: 0.8 }),
        entry({ author: 'Bold', outlet_name: 'x.com', bits: 0.85, skill_conservative: 0.1 }),
      ],
    })
    const { authorRows } = await getSourceLeaderboard('authors', 'bits', 0)
    expect(authorRows.map(r => r.author)).toEqual(['Bold', 'Cautious', 'Unscored'])
  })
})
