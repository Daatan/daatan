import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalMarket: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    externalMarketPriceSnapshot: {
      create: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/services/embedding', () => ({ embedText: vi.fn() }))

import {
  normalizeGammaMarket,
  polymarketProvider,
  getProviderForUrl,
  resolveMarketByUrl,
  syncLinkedMarkets,
  suggestMarkets,
  suggestMarketsForClaim,
  suggestMarketMatch,
  buildMarketSearchQuery,
  deadlineWeight,
} from '../external-markets'
import { prisma } from '@/lib/prisma'
import { embedText } from '@/lib/services/embedding'

/** Build a minimal fetch Response stand-in. */
function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data } as unknown as Response
}

/** A representative raw Gamma market row (outcomes/prices are JSON strings). */
function gammaRow(overrides: Record<string, unknown> = {}) {
  return {
    conditionId: '0xabc',
    slug: 'will-x-happen',
    question: 'Will X happen?',
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.68", "0.32"]',
    endDate: '2026-12-31T00:00:00Z',
    closed: false,
    ...overrides,
  }
}

/**
 * URL-aware fetch mock. `suggest()` hits `/public-search` (events→markets shape),
 * while `fetchMarket()` hits `/markets?slug=` (a flat array). Route each to the
 * right shape; `searchRows` populates the single search event's `markets[]`.
 */
function gammaFetchMock(searchRows: Record<string, unknown>[], marketRows = [gammaRow()]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/public-search')) {
      return jsonResponse({ events: [{ markets: searchRows }] })
    }
    return jsonResponse(marketRows)
  })
}

describe('polymarketProvider.parseId', () => {
  it('extracts the slug from an event URL', () => {
    expect(polymarketProvider.parseId('https://polymarket.com/event/will-x-happen')).toBe('will-x-happen')
  })

  it('extracts the last segment from a nested market URL', () => {
    expect(polymarketProvider.parseId('https://polymarket.com/market/foo/will-x-happen/')).toBe('will-x-happen')
  })

  it('strips query strings', () => {
    expect(polymarketProvider.parseId('https://polymarket.com/event/will-x-happen?tid=1')).toBe('will-x-happen')
  })

  it('accepts a raw slug as-is', () => {
    expect(polymarketProvider.parseId('will-x-happen')).toBe('will-x-happen')
  })

  it('rejects non-polymarket URLs', () => {
    expect(polymarketProvider.parseId('https://example.com/event/foo')).toBeNull()
  })
})

describe('getProviderForUrl', () => {
  it('routes polymarket.com to the Polymarket provider', () => {
    expect(getProviderForUrl('https://polymarket.com/event/x')?.id).toBe('POLYMARKET')
  })

  it('routes kalshi.com to the Kalshi provider', () => {
    expect(getProviderForUrl('https://kalshi.com/markets/x')?.id).toBe('KALSHI')
  })

  it('returns null for an unsupported host', () => {
    expect(getProviderForUrl('https://example.com/x')).toBeNull()
  })
})

describe('normalizeGammaMarket', () => {
  it('decodes JSON-string outcomes/prices and derives YES probability + url', () => {
    const m = normalizeGammaMarket(gammaRow())
    expect(m).not.toBeNull()
    expect(m!.provider).toBe('POLYMARKET')
    expect(m!.externalId).toBe('0xabc')
    expect(m!.url).toBe('https://polymarket.com/event/will-x-happen')
    expect(m!.outcomes).toEqual(['Yes', 'No'])
    expect(m!.yesProbability).toBe(68)
    expect(m!.resolvedOutcome).toBeNull()
  })

  it('uses the YES-labelled outcome regardless of order', () => {
    const m = normalizeGammaMarket(
      gammaRow({ outcomes: '["No", "Yes"]', outcomePrices: '["0.25", "0.75"]' }),
    )
    expect(m!.yesProbability).toBe(75)
  })

  it('marks a closed market resolved with the winning outcome', () => {
    const m = normalizeGammaMarket(gammaRow({ closed: true, outcomePrices: '["1.0", "0.0"]' }))
    expect(m!.closed).toBe(true)
    expect(m!.resolvedOutcome).toBe('Yes')
  })

  it('clamps and rounds out-of-range prices', () => {
    const m = normalizeGammaMarket(gammaRow({ outcomePrices: '["1.4", "-0.4"]' }))
    expect(m!.yesProbability).toBe(100)
  })

  it('returns null when required fields are missing', () => {
    expect(normalizeGammaMarket({ slug: 'x', question: 'y' })).toBeNull()
  })

  it('returns null when prices and outcomes mismatch', () => {
    expect(normalizeGammaMarket(gammaRow({ outcomePrices: '["0.5"]' }))).toBeNull()
  })
})

describe('polymarketProvider.fetchMarket', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the normalized first row', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    const m = await polymarketProvider.fetchMarket('will-x-happen')
    expect(m!.externalId).toBe('0xabc')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/markets?slug=will-x-happen'),
      expect.any(Object),
    )
  })

  it('returns null on an empty result', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([]))
    expect(await polymarketProvider.fetchMarket('nope')).toBeNull()
  })

  it('returns null on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(null, false, 500))
    expect(await polymarketProvider.fetchMarket('boom')).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'))
    expect(await polymarketProvider.fetchMarket('boom')).toBeNull()
  })
})

describe('resolveMarketByUrl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses, fetches and upserts the market keyed by provider+externalId', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(prisma.externalMarket.upsert).mockResolvedValue({ id: 'm1' } as never)

    const result = await resolveMarketByUrl('https://polymarket.com/event/will-x-happen')

    expect(result).toEqual({ id: 'm1' })
    expect(prisma.externalMarket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider_externalId: { provider: 'POLYMARKET', externalId: '0xabc' } },
      }),
    )
  })

  it('returns null for an unsupported URL without calling the API', async () => {
    global.fetch = vi.fn()
    expect(await resolveMarketByUrl('https://example.com/x')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns null for a Kalshi URL (provider stub returns nothing yet)', async () => {
    global.fetch = vi.fn()
    expect(await resolveMarketByUrl('https://kalshi.com/markets/abc')).toBeNull()
  })

  it('seeds an initial price snapshot when the market has none yet', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()])) // yesProbability 68
    vi.mocked(prisma.externalMarket.upsert).mockResolvedValue({ id: 'm1' } as never)
    vi.mocked(prisma.externalMarketPriceSnapshot.count).mockResolvedValue(0)

    await resolveMarketByUrl('https://polymarket.com/event/will-x-happen')

    expect(prisma.externalMarketPriceSnapshot.create).toHaveBeenCalledWith({
      data: { marketId: 'm1', probability: 68 },
    })
  })

  it('does not seed a snapshot when the market already has history', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(prisma.externalMarket.upsert).mockResolvedValue({ id: 'm1' } as never)
    vi.mocked(prisma.externalMarketPriceSnapshot.count).mockResolvedValue(5)

    await resolveMarketByUrl('https://polymarket.com/event/will-x-happen')

    expect(prisma.externalMarketPriceSnapshot.create).not.toHaveBeenCalled()
  })
})

describe('syncLinkedMarkets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never)
  })

  it('snapshots each linked market and reports counts', async () => {
    vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET' },
    ] as never)
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))

    const result = await syncLinkedMarkets()

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('counts a market as failed when its fetch returns nothing', async () => {
    vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'gone', externalId: '0xabc', provider: 'POLYMARKET' },
    ] as never)
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([]))

    const result = await syncLinkedMarkets()

    expect(result).toEqual({ synced: 0, failed: 1 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('suggestMarkets', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns normalized candidates from public-search events with provider + url', async () => {
    global.fetch = gammaFetchMock([gammaRow()])
    const out = await suggestMarkets('will x happen')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      provider: 'POLYMARKET',
      externalId: '0xabc',
      yesProbability: 68,
      url: 'https://polymarket.com/event/will-x-happen',
    })
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/public-search?q='),
      expect.any(Object),
    )
  })

  it('skips closed markets and dedupes by externalId', async () => {
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0xopen', slug: 'a' }),
      gammaRow({ conditionId: '0xopen', slug: 'a' }), // dup
      gammaRow({ conditionId: '0xclosed', slug: 'b', closed: true }),
    ])
    const out = await suggestMarkets('will x happen')
    expect(out).toHaveLength(1)
    expect(out[0].externalId).toBe('0xopen')
  })

  it('retries with the first two words when the full query finds nothing', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/public-search')) {
        // Empty unless the query is exactly the two-word fallback "iran peace".
        const hit = url.endsWith('q=' + encodeURIComponent('iran peace'))
        return jsonResponse({ events: hit ? [{ markets: [gammaRow()] }] : [] })
      }
      return jsonResponse([gammaRow()])
    })
    global.fetch = fetchSpy
    const out = await suggestMarkets('iran peace deal memorandum')
    expect(out).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns [] for an empty query without calling the API', async () => {
    global.fetch = vi.fn()
    expect(await suggestMarkets('  ')).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('buildMarketSearchQuery', () => {
  it('reduces a verbose claim to salient keywords and drops boilerplate', () => {
    const q = buildMarketSearchQuery(
      'A memorandum of understanding (MoU) or a peace deal between Iran and the USA will be officially signed',
    )
    // Parenthetical "(MoU)" and stopwords/boilerplate ("officially", "signed") gone.
    expect(q).not.toContain('mou')
    expect(q).not.toContain('officially')
    expect(q).not.toContain('signed')
    // "usa" normalized to "us" (the literal token "usa" zeroes out Polymarket search).
    expect(q).not.toMatch(/\busa\b/)
    expect(q.split(' ')).toContain('iran')
    expect(q.split(' ')).toContain('peace')
  })

  it('promotes capitalized proper nouns to the front even without entities', () => {
    // Polymarket weights leading tokens, so "Iran"/"USA" must lead, not the
    // boilerplate "memorandum"/"understanding" that opens the sentence.
    const q = buildMarketSearchQuery(
      'A memorandum of understanding (MoU) or a peace deal between Iran and the USA will be officially signed',
    )
    expect(q.split(' ').slice(0, 2)).toEqual(['iran', 'us'])
  })

  it('caps the query length', () => {
    const q = buildMarketSearchQuery(
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo',
    )
    expect(q.split(' ').length).toBeLessThanOrEqual(6)
  })

  it('puts extracted entities first and dedupes', () => {
    const q = buildMarketSearchQuery('peace deal happens', ['Iran', 'Iran'])
    expect(q.startsWith('iran')).toBe(true)
    expect(q.split(' ').filter(w => w === 'iran')).toHaveLength(1)
  })
})

describe('suggestMarketsForClaim', () => {
  beforeEach(() => vi.clearAllMocks())

  it('re-ranks candidates by similarity to the claim', async () => {
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0xfar', slug: 'far', question: 'Unrelated question?' }),
      gammaRow({ conditionId: '0xnear', slug: 'near', question: 'Iran peace deal signed?' }),
    ])
    vi.mocked(embedText).mockImplementation(async (t: string) =>
      t.includes('Iran') ? [1, 0, 0] : [0, 1, 0],
    )
    const out = await suggestMarketsForClaim('Will Iran sign a peace deal?', ['Iran'])
    expect(out[0].externalId).toBe('0xnear')
  })

  it('falls back to search order when embeddings are unavailable', async () => {
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0x1', slug: 's1' }),
      gammaRow({ conditionId: '0x2', slug: 's2' }),
    ])
    vi.mocked(embedText).mockResolvedValue(null)
    const out = await suggestMarketsForClaim('Will Iran sign a peace deal?', ['Iran'])
    expect(out.map(m => m.externalId)).toEqual(['0x1', '0x2'])
  })

  it('down-ranks an equally-similar market whose resolution date is far from the deadline', async () => {
    // Both candidates are textually identical (cosine 1); only the resolution
    // date differs — the one a year off the deadline must lose.
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0xfar', slug: 'far', endDate: '2027-12-31T00:00:00Z' }),
      gammaRow({ conditionId: '0xnear', slug: 'near', endDate: '2026-06-30T00:00:00Z' }),
    ])
    vi.mocked(embedText).mockResolvedValue([1, 0, 0])
    const out = await suggestMarketsForClaim(
      'Will X happen by mid 2026?',
      [],
      5,
      new Date('2026-06-30T00:00:00Z'),
    )
    expect(out[0].externalId).toBe('0xnear')
  })
})

describe('suggestMarketMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.externalMarket.upsert).mockResolvedValue({ id: 'm1' } as never)
  })

  it('returns the best candidate when similarity clears the threshold', async () => {
    global.fetch = gammaFetchMock([gammaRow()])
    vi.mocked(embedText).mockResolvedValue([1, 0, 0]) // claim == candidate → cosine 1

    const match = await suggestMarketMatch('Will X definitely happen this year?')

    expect(match).not.toBeNull()
    expect(match!.externalMarketId).toBe('m1')
    expect(match!.score).toBe(100)
    expect(match!.providerLabel).toBe('Polymarket')
  })

  it('returns null when no candidate is similar enough', async () => {
    global.fetch = gammaFetchMock([gammaRow()])
    vi.mocked(embedText).mockImplementation(async (t: string) =>
      t.includes('definitely') ? [1, 0, 0] : [0, 1, 0], // orthogonal → cosine 0
    )

    expect(await suggestMarketMatch('Will X definitely happen this year?')).toBeNull()
  })

  it('returns null when embeddings are unavailable', async () => {
    global.fetch = gammaFetchMock([gammaRow()])
    vi.mocked(embedText).mockResolvedValue(null)

    expect(await suggestMarketMatch('Will X definitely happen this year?')).toBeNull()
  })

  it('returns null for a too-short claim without calling out', async () => {
    global.fetch = vi.fn()
    expect(await suggestMarketMatch('short')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a same-question match whose market resolves far from the deadline', async () => {
    // cosine 1, but the only candidate resolves ~2 years off → adjusted score
    // decays below MATCH_THRESHOLD, so it must not auto-link (the Knicks mislink).
    global.fetch = gammaFetchMock([gammaRow({ endDate: '2027-12-31T00:00:00Z' })])
    vi.mocked(embedText).mockResolvedValue([1, 0, 0])
    const match = await suggestMarketMatch(
      'Will X definitely happen this year?',
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(match).toBeNull()
  })

  it('keeps a same-question match when the market resolves near the deadline', async () => {
    global.fetch = gammaFetchMock([gammaRow({ endDate: '2026-12-31T00:00:00Z' })])
    vi.mocked(embedText).mockResolvedValue([1, 0, 0])
    const match = await suggestMarketMatch(
      'Will X definitely happen this year?',
      new Date('2026-12-15T00:00:00Z'), // 16 days < grace → no penalty
    )
    expect(match).not.toBeNull()
    expect(match!.score).toBe(100)
  })
})

describe('deadlineWeight', () => {
  it('is 1 within the grace window or when a date is unknown', () => {
    const d = new Date('2026-06-01T00:00:00Z')
    expect(deadlineWeight(d, d)).toBe(1)
    expect(deadlineWeight(new Date('2026-06-20T00:00:00Z'), d)).toBe(1) // 19d < grace
    expect(deadlineWeight(null, d)).toBe(1)
    expect(deadlineWeight(d, null)).toBe(1)
  })

  it('decays as the deadline gap grows', () => {
    const d = new Date('2026-01-01T00:00:00Z')
    const wYear = deadlineWeight(new Date('2027-01-01T00:00:00Z'), d)
    expect(wYear).toBeGreaterThan(0)
    expect(wYear).toBeLessThan(0.6)
    // A two-year gap is penalized harder than a one-year gap.
    expect(deadlineWeight(new Date('2028-01-01T00:00:00Z'), d)).toBeLessThan(wYear)
  })
})
