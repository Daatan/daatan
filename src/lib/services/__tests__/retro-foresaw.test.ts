import { describe, expect, it, vi, beforeEach } from 'vitest'

const { findMany, findFirst } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { retroSimulation: { findMany, findFirst } } }))

import { BOARD_MIN_EVENTS, classifyStance, getForesawEvent, getForesawSourceBoard, listForesawEvents, outletSide } from '../retro-foresaw'

const source = (url: string, stance: number, extra: Record<string, unknown> = {}) => ({
  url, source: `${url.split('/')[2]}`, stance, certainty: 0.8, claims: ['c'], ...extra,
})

function row(overrides: Record<string, unknown> = {}, evidence: unknown = undefined) {
  return {
    eventText: 'Houthis took Bab el-Mandeb',
    eventDate: new Date('2026-11-15T00:00:00Z'),
    eventUrl: 'https://e.com/report',
    asOf: new Date('2026-11-08T00:00:00Z'),
    outcome: 'correct',
    oraculProbability: 0.66,
    prediction: { slug: 'bab-el-mandeb', claimText: 'Yemeni forces will withdraw by Nov 30' },
    evidence: evidence ?? {
      search: { q: 'secret-ish query' },
      sent: [
        { url: 'https://a.com/1', title: 'A one', source: 'a.com', publishedAt: '2026-11-01T10:00:00Z', similarity: 0.5, hadText: true },
        { url: 'https://b.com/2', title: 'B two', source: 'b.com', publishedAt: '2026-11-05T10:00:00Z', similarity: 0.5, hadText: true },
        { url: 'https://c.com/3', title: 'C three', source: 'c.com', publishedAt: '2026-10-20T10:00:00Z', similarity: 0.5, hadText: true },
      ],
      oracul: {
        mean: 0.32, articlesUsed: 3, logId: 'log1',
        sources: [source('https://a.com/1', -0.3), source('https://b.com/2', 0.35), source('https://c.com/3', 0.1)],
      },
      reports: [{ url: 'https://r.com/x', source: 'r.com', publishedDate: '2026-11-15', claim: 'took it' }],
    },
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('classifyStance', () => {
  it.each([
    [0.3, 'correct', 'called'],
    [0.29, 'correct', 'neutral'],
    [-0.3, 'correct', 'against'],
    [-0.29, 'correct', 'neutral'],
    [-0.3, 'wrong', 'called'],
    [0.3, 'wrong', 'against'],
  ] as const)('stance %s with outcome %s is %s (±0.3 inclusive)', (stance, outcome, side) => {
    expect(classifyStance(stance, outcome)).toBe(side)
  })
})

describe('listForesawEvents', () => {
  it('queries only approved retro simulations with evidence', async () => {
    findMany.mockResolvedValue([])
    await listForesawEvents()
    const where = findMany.mock.calls[0][0].where
    expect(where.prediction.status).toEqual({ in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] })
    expect(where.evidence).toHaveProperty('not')
    expect(where.eventText).toEqual({ not: null })
  })

  it('summarises counts and skips rows whose evidence does not parse', async () => {
    findMany.mockResolvedValue([row(), row({ prediction: { slug: 'broken', claimText: 'x' } }, { sent: [] })])
    const events = await listForesawEvents()
    expect(events).toEqual([{
      slug: 'bab-el-mandeb', eventText: 'Houthis took Bab el-Mandeb', eventDate: '2026-11-15', asOf: '2026-11-08',
      outcome: 'correct', oraculProbability: 0.66, called: 1, against: 1, total: 3,
    }])
  })
})

describe('getForesawEvent', () => {
  it('lists the used articles newest first, with titles from the sent set and no search internals', async () => {
    findFirst.mockResolvedValue(row())
    const event = await getForesawEvent('bab-el-mandeb')
    expect(findFirst.mock.calls[0][0].where.prediction.slug).toBe('bab-el-mandeb')
    expect(event?.articles.map((a) => [a.url, a.title, a.publishedDate, a.side])).toEqual([
      ['https://b.com/2', 'B two', '2026-11-05', 'called'],
      ['https://a.com/1', 'A one', '2026-11-01', 'against'],
      ['https://c.com/3', 'C three', '2026-10-20', 'neutral'],
    ])
    expect(event?.reports).toEqual([{ url: 'https://r.com/x', outlet: 'r.com', publishedDate: '2026-11-15' }])
    expect(event?.hasWeights).toBe(false)
    expect(event?.articles.every((a) => a.weightShare === null)).toBe(true)
    expect(JSON.stringify(event)).not.toContain('secret-ish')
    expect(JSON.stringify(event)).not.toContain('log1')
  })

  it('computes each article’s share of the pooling weight when the factors are stored', async () => {
    const w = (credibilityWeight: number, recencyWeight: number, relevanceScore: number, publishedDate: string) =>
      ({ credibilityWeight, evidenceWeight: 1, recencyWeight, relevanceScore, publishedDate })
    const r = row()
    const ev = r.evidence as { oracul: { sources: Record<string, unknown>[] } }
    ev.oracul.sources = [
      source('https://a.com/1', -0.3, w(1, 0.25, 1, '2026-11-01')), // 0.25
      source('https://b.com/2', 0.35, w(1, 1, 0.5, '2026-11-05')), // 0.25
      source('https://c.com/3', 0.1, w(2, 0.25, 1, '2026-10-20')), // 0.5
    ]
    findFirst.mockResolvedValue(r)
    const event = await getForesawEvent('bab-el-mandeb')
    expect(event?.hasWeights).toBe(true)
    expect(Object.fromEntries(event!.articles.map((a) => [a.url, a.weightShare]))).toEqual({
      'https://a.com/1': 0.25, 'https://b.com/2': 0.25, 'https://c.com/3': 0.5,
    })
  })

  it('returns null for an unknown slug', async () => {
    findFirst.mockResolvedValue(null)
    expect(await getForesawEvent('nope')).toBeNull()
  })
})

describe('outletSide', () => {
  it.each([
    [['called', 'neutral'], 'called'],
    [['against'], 'against'],
    [['called', 'against'], 'neutral'],
    [['neutral', 'neutral'], 'neutral'],
  ] as const)('%j → %s', (sides, side) => {
    expect(outletSide([...sides])).toBe(side)
  })
})

describe('getForesawSourceBoard', () => {
  /** One shown event whose Oracul set holds these [outlet, stance] articles. */
  const eventRow = (slug: string, eventDate: string, articles: [string, number][], outcome = 'correct') =>
    row(
      { prediction: { slug, claimText: `Claim ${slug}` }, eventText: `Event ${slug}`, eventDate: new Date(`${eventDate}T00:00:00Z`), outcome },
      {
        sent: [],
        oracul: { sources: articles.map(([outlet, stance], i) => ({ url: `https://${outlet}/${slug}/${i}`, source: outlet, stance })) },
        reports: [],
      },
    )

  it('scores each outlet once per event, merges aliases, applies the floor and sorts by called, share, total', async () => {
    findMany.mockResolvedValue([
      // Two articles from one outlet in one event count once; ynetnews.com is ynet.co.il.
      eventRow('e3', '2026-11-15', [['a.com', 0.6], ['a.com', 0.1], ['ynetnews.com', -0.5], ['b.com', 0.4], ['solo.com', 0.9]]),
      eventRow('e2', '2026-11-10', [['a.com', -0.4], ['ynet.co.il', 0.0], ['b.com', 0.3], ['c.com', 0.5]]),
      // Called and against from one outlet in one event: neutral.
      eventRow('e1', '2026-11-01', [['a.com', 0.5], ['c.com', 0.5], ['c.com', -0.5], ['b.com', 0.0]]),
    ])
    const board = await getForesawSourceBoard()
    expect(board.eventCount).toBe(3)
    expect(board.hiddenOutlets).toBe(1) // solo.com: one event
    expect(board.rows.map((r) => [r.outlet, r.called, r.against, r.total])).toEqual([
      ['a.com', 2, 1, 3],
      ['b.com', 2, 0, 3],
      ['c.com', 1, 0, 2],
      ['ynet.co.il', 0, 1, 2],
    ])
    expect(board.rows[0].events).toEqual([
      { slug: 'e3', eventText: 'Event e3', side: 'called' },
      { slug: 'e2', eventText: 'Event e2', side: 'against' },
      { slug: 'e1', eventText: 'Event e1', side: 'called' },
    ])
    expect(board.rows[2].events.find((e) => e.slug === 'e1')?.side).toBe('neutral')
  })

  it('breaks a tie in events called by the higher share', async () => {
    findMany.mockResolvedValue([
      eventRow('e1', '2026-11-01', [['wide.com', 0.5], ['narrow.com', 0.5]]),
      eventRow('e2', '2026-11-02', [['wide.com', 0.0], ['narrow.com', 0.0]]),
      eventRow('e3', '2026-11-03', [['wide.com', 0.0]]),
    ])
    expect((await getForesawSourceBoard()).rows.map((r) => r.outlet)).toEqual(['narrow.com', 'wide.com'])
  })

  it('reads sides against the outcome, so a NO event is called by a negative stance', async () => {
    findMany.mockResolvedValue([
      eventRow('no1', '2026-11-01', [['x.com', -0.5]], 'wrong'),
      eventRow('no2', '2026-11-02', [['x.com', 0.5]], 'wrong'),
    ])
    expect((await getForesawSourceBoard()).rows).toEqual([
      expect.objectContaining({ outlet: 'x.com', called: 1, against: 1, total: 2 }),
    ])
  })

  it('lists no outlet below the floor and uses the same visibility gate as the hub', async () => {
    findMany.mockResolvedValue([eventRow('e1', '2026-11-01', [['a.com', 0.5]])])
    const board = await getForesawSourceBoard()
    expect(BOARD_MIN_EVENTS).toBe(2)
    expect(board).toEqual({ eventCount: 1, rows: [], hiddenOutlets: 1 })
    expect(findMany.mock.calls[0][0].where.prediction.status).toEqual({ in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] })
  })
})
