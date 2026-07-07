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
      createMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    prediction: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/services/embedding', () => ({ embedText: vi.fn() }))
vi.mock('@/lib/services/context', () => ({ getLatestEvidenceEstimate: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({ notifyMarketDivergence: vi.fn() }))

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
  parseHistoryPayload,
  samplePoints,
} from '../external-markets'
import { prisma } from '@/lib/prisma'
import { embedText } from '@/lib/services/embedding'
import { getLatestEvidenceEstimate } from '@/lib/services/context'
import { notifyMarketDivergence } from '@/lib/services/telegram'

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
 * `fetchMarket()` hits `/markets?slug=` (a flat array), and history backfill hits
 * the CLOB `/prices-history` endpoint. Route each to the right shape; `searchRows`
 * populates the single search event's `markets[]`.
 */
function gammaFetchMock(
  searchRows: Record<string, unknown>[],
  marketRows = [gammaRow()],
  history: { t: number; p: number }[] = [],
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/public-search')) {
      return jsonResponse({ events: [{ markets: searchRows }] })
    }
    if (String(input).includes('/prices-history')) {
      return jsonResponse({ history })
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

  it('backfills provider history before seeding when the market has a history id', async () => {
    const past = Math.floor(Date.now() / 1000) - 86_400 // one day ago
    global.fetch = gammaFetchMock(
      [],
      [gammaRow({ clobTokenIds: '["yes-token", "no-token"]' })],
      [{ t: past, p: 0.4 }, { t: past + 3600, p: 0.55 }],
    )
    vi.mocked(prisma.externalMarket.upsert).mockResolvedValue({ id: 'm1' } as never)
    vi.mocked(prisma.externalMarketPriceSnapshot.count).mockResolvedValue(0)

    await resolveMarketByUrl('https://polymarket.com/event/will-x-happen')

    expect(prisma.externalMarketPriceSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        { marketId: 'm1', probability: 40, createdAt: new Date(past * 1000) },
        { marketId: 'm1', probability: 55, createdAt: new Date((past + 3600) * 1000) },
      ],
    })
    // The live seed still lands after the historical points.
    expect(prisma.externalMarketPriceSnapshot.create).toHaveBeenCalledWith({
      data: { marketId: 'm1', probability: 68 },
    })
  })

  it('falls back to the plain seed when the history fetch fails', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/prices-history')
        ? jsonResponse({}, false, 500)
        : jsonResponse([gammaRow({ clobTokenIds: '["yes-token", "no-token"]' })]),
    )
    vi.mocked(prisma.externalMarket.upsert).mockResolvedValue({ id: 'm1' } as never)
    vi.mocked(prisma.externalMarketPriceSnapshot.count).mockResolvedValue(0)

    await resolveMarketByUrl('https://polymarket.com/event/will-x-happen')

    expect(prisma.externalMarketPriceSnapshot.createMany).not.toHaveBeenCalled()
    expect(prisma.externalMarketPriceSnapshot.create).toHaveBeenCalledWith({
      data: { marketId: 'm1', probability: 68 },
    })
  })
})

describe('price-history parsing', () => {
  it('parses CLOB points into snapshot-ready rows, clamped and sorted ascending', () => {
    const out = parseHistoryPayload({
      history: [
        { t: 200, p: 1.2 },
        { t: 100, p: 0.335 },
        { t: 150, p: -0.1 },
        { t: 'junk', p: 0.5 },
        { p: 0.5 },
      ],
    })
    expect(out).toEqual([
      { createdAt: new Date(100_000), probability: 34 },
      { createdAt: new Date(150_000), probability: 0 },
      { createdAt: new Date(200_000), probability: 100 },
    ])
  })

  it('returns empty for a malformed payload', () => {
    expect(parseHistoryPayload(null)).toEqual([])
    expect(parseHistoryPayload({ history: 'nope' })).toEqual([])
  })

  it('drops consecutive candles at the same price — a flat run is one measurement', () => {
    const out = parseHistoryPayload({
      history: [
        { t: 100, p: 0.2 },
        { t: 200, p: 0.2 },
        { t: 300, p: 0.2 },
        { t: 400, p: 0.5 },
        { t: 500, p: 0.5 },
      ],
    })
    expect(out).toEqual([
      { createdAt: new Date(100_000), probability: 20 },
      { createdAt: new Date(400_000), probability: 50 },
    ])
  })

  it('samplePoints keeps everything under the cap and always keeps the last point', () => {
    const points = Array.from({ length: 10 }, (_, i) => i)
    expect(samplePoints(points, 20)).toHaveLength(10)
    const sampled = samplePoints(points, 4)
    expect(sampled).toHaveLength(4)
    expect(sampled[0]).toBe(0)
    expect(sampled[sampled.length - 1]).toBe(9)
  })
})

describe('normalizeGammaMarket historyId', () => {
  it('picks the CLOB token aligned with the YES outcome', () => {
    const m = normalizeGammaMarket(
      gammaRow({
        outcomes: '["No", "Yes"]',
        outcomePrices: '["0.32", "0.68"]',
        clobTokenIds: '["no-token", "yes-token"]',
      }),
    )
    expect(m?.historyId).toBe('yes-token')
  })

  it('is null when the row carries no token ids', () => {
    expect(normalizeGammaMarket(gammaRow())?.historyId).toBeNull()
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

  it('heals a pre-backfill market: fills history older than its only snapshot', async () => {
    vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET' },
    ] as never)
    const firstSnapshotAt = new Date('2026-07-01T00:00:00Z')
    const older = Math.floor(firstSnapshotAt.getTime() / 1000) - 86_400
    const newer = Math.floor(firstSnapshotAt.getTime() / 1000) + 86_400
    global.fetch = gammaFetchMock(
      [],
      [gammaRow({ clobTokenIds: '["yes-token", "no-token"]' })],
      [{ t: older, p: 0.25 }, { t: newer, p: 0.3 }],
    )
    vi.mocked(prisma.externalMarketPriceSnapshot.count).mockResolvedValue(1)
    vi.mocked(prisma.externalMarketPriceSnapshot.findFirst).mockResolvedValue({
      createdAt: firstSnapshotAt,
    } as never)

    const result = await syncLinkedMarkets()

    expect(result).toEqual({ synced: 1, failed: 0 })
    // Only the point OLDER than the existing snapshot is inserted.
    expect(prisma.externalMarketPriceSnapshot.createMany).toHaveBeenCalledWith({
      data: [{ marketId: 'm1', probability: 25, createdAt: new Date(older * 1000) }],
    })
  })

  it('does not attempt a heal when the series already has history', async () => {
    vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET' },
    ] as never)
    global.fetch = gammaFetchMock([], [gammaRow({ clobTokenIds: '["yes-token", "no-token"]' })])
    vi.mocked(prisma.externalMarketPriceSnapshot.count).mockResolvedValue(7)

    await syncLinkedMarkets()

    expect(prisma.externalMarketPriceSnapshot.createMany).not.toHaveBeenCalled()
  })

  it('skips writing a new snapshot when the price has not changed since the last sync', async () => {
    vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET' },
    ] as never)
    // gammaRow()'s default outcomePrices ["0.68", "0.32"] → market YES probability 68.
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(prisma.externalMarketPriceSnapshot.findFirst).mockResolvedValue({ probability: 68 } as never)

    const result = await syncLinkedMarkets()

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(prisma.externalMarketPriceSnapshot.create).not.toHaveBeenCalled()
    expect(prisma.externalMarket.update).toHaveBeenCalledOnce()
  })

  it('writes a new snapshot when the price has changed since the last sync', async () => {
    vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET' },
    ] as never)
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(prisma.externalMarketPriceSnapshot.findFirst).mockResolvedValue({ probability: 50 } as never)

    const result = await syncLinkedMarkets()

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(prisma.externalMarketPriceSnapshot.create).toHaveBeenCalledWith({
      data: { marketId: 'm1', probability: 68 },
    })
  })

  it('writes a snapshot on a market\'s first-ever sync (no prior snapshot to compare)', async () => {
    vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET' },
    ] as never)
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(prisma.externalMarketPriceSnapshot.findFirst).mockResolvedValue(null)

    await syncLinkedMarkets()

    expect(prisma.externalMarketPriceSnapshot.create).toHaveBeenCalledWith({
      data: { marketId: 'm1', probability: 68 },
    })
  })

  describe('market vs Oracle divergence', () => {
    // gammaRow()'s default outcomePrices ["0.68", "0.32"] → market YES probability 68.
    const prediction = (overrides: Record<string, unknown> = {}) => ({
      id: 'p1',
      claimText: 'Will X happen?',
      slug: 'will-x-happen',
      externalMarketInverted: false,
      marketDivergenceAlertAt: null,
      ...overrides,
    })

    beforeEach(() => {
      global.fetch = gammaFetchMock([])
    })

    it('notifies and stamps the alert when the gap first crosses the threshold', async () => {
      vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
        { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET', predictions: [prediction()] },
      ] as never)
      vi.mocked(getLatestEvidenceEstimate).mockResolvedValue({ externalProbability: 40, createdAt: new Date() } as never)
      vi.mocked(prisma.prediction.updateMany).mockResolvedValue({ count: 1 } as never)

      await syncLinkedMarkets()

      // market 68 vs oracle 40 → 28pt gap, above the 20pt threshold.
      expect(prisma.prediction.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', marketDivergenceAlertAt: null },
        data: { marketDivergenceAlertAt: expect.any(Date) },
      })
      expect(notifyMarketDivergence).toHaveBeenCalledWith(
        { id: 'p1', claimText: 'Will X happen?', slug: 'will-x-happen' },
        68,
        40,
        28,
      )
    })

    it('does not notify when a concurrent run already claimed the crossing', async () => {
      vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
        { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET', predictions: [prediction()] },
      ] as never)
      vi.mocked(getLatestEvidenceEstimate).mockResolvedValue({ externalProbability: 40, createdAt: new Date() } as never)
      // Another runner already flipped null → set between our read and our claim attempt.
      vi.mocked(prisma.prediction.updateMany).mockResolvedValue({ count: 0 } as never)

      await syncLinkedMarkets()

      expect(notifyMarketDivergence).not.toHaveBeenCalled()
    })

    it('does not re-notify while already alerted and still divergent', async () => {
      vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
        {
          id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET',
          predictions: [prediction({ marketDivergenceAlertAt: new Date('2026-07-01') })],
        },
      ] as never)
      vi.mocked(getLatestEvidenceEstimate).mockResolvedValue({ externalProbability: 40, createdAt: new Date() } as never)

      await syncLinkedMarkets()

      expect(notifyMarketDivergence).not.toHaveBeenCalled()
      expect(prisma.prediction.update).not.toHaveBeenCalled()
    })

    it('re-arms (clears the alert) once the gap closes', async () => {
      vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
        {
          id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET',
          predictions: [prediction({ marketDivergenceAlertAt: new Date('2026-07-01') })],
        },
      ] as never)
      // market 68 vs oracle 60 → 8pt gap, back under the threshold.
      vi.mocked(getLatestEvidenceEstimate).mockResolvedValue({ externalProbability: 60, createdAt: new Date() } as never)

      await syncLinkedMarkets()

      expect(notifyMarketDivergence).not.toHaveBeenCalled()
      expect(prisma.prediction.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { marketDivergenceAlertAt: null },
      })
    })

    it('stays alerted in the hysteresis band (below the alert threshold but above the rearm bar)', async () => {
      vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
        {
          id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET',
          predictions: [prediction({ marketDivergenceAlertAt: new Date('2026-07-01') })],
        },
      ] as never)
      // market 68 vs oracle 50 → 18pt gap: under the 20pt alert bar but above
      // the 15pt rearm bar, so it must neither re-notify nor clear the alert.
      vi.mocked(getLatestEvidenceEstimate).mockResolvedValue({ externalProbability: 50, createdAt: new Date() } as never)

      await syncLinkedMarkets()

      expect(notifyMarketDivergence).not.toHaveBeenCalled()
      expect(prisma.prediction.update).not.toHaveBeenCalled()
      expect(prisma.prediction.updateMany).not.toHaveBeenCalled()
    })

    it('inverts the market probability for a prediction linked in the opposite direction', async () => {
      vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
        { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET', predictions: [prediction({ externalMarketInverted: true })] },
      ] as never)
      // Inverted: 100 - 68 = 32 vs oracle 40 → 8pt gap, under the threshold.
      vi.mocked(getLatestEvidenceEstimate).mockResolvedValue({ externalProbability: 40, createdAt: new Date() } as never)

      await syncLinkedMarkets()

      expect(notifyMarketDivergence).not.toHaveBeenCalled()
    })

    it('skips a prediction with no Oracle estimate yet', async () => {
      vi.mocked(prisma.externalMarket.findMany).mockResolvedValue([
        { id: 'm1', slug: 'will-x-happen', externalId: '0xabc', provider: 'POLYMARKET', predictions: [prediction()] },
      ] as never)
      vi.mocked(getLatestEvidenceEstimate).mockResolvedValue(null)

      await syncLinkedMarkets()

      expect(notifyMarketDivergence).not.toHaveBeenCalled()
      expect(prisma.prediction.update).not.toHaveBeenCalled()
    })
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

  it('keeps at most two markets per event, most-traded first', async () => {
    // All three sit in a single search event; the cap + volume ranking keep the
    // two highest-volume ones and drop the rest so one event can't flood recall.
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0xa', slug: 'a', volume: '10' }),
      gammaRow({ conditionId: '0xb', slug: 'b', volume: '100' }),
      gammaRow({ conditionId: '0xc', slug: 'c', volume: '50' }),
    ])
    const out = await suggestMarkets('will x happen')
    expect(out.map(m => m.externalId)).toEqual(['0xb', '0xc'])
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

  it('returns [] when embeddings are unavailable (no unscored fallback)', async () => {
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0x1', slug: 's1' }),
      gammaRow({ conditionId: '0x2', slug: 's2' }),
    ])
    vi.mocked(embedText).mockResolvedValue(null)
    const out = await suggestMarketsForClaim('Will Iran sign a peace deal?', ['Iran'])
    expect(out).toEqual([])
  })

  it('drops candidates below the similarity floor, returning [] when none clear it', async () => {
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0xfar', slug: 'far', question: 'Totally unrelated question?' }),
    ])
    // Claim and candidate embed orthogonally → cosine 0, under PANEL_MATCH_FLOOR.
    vi.mocked(embedText).mockImplementation(async (t: string) =>
      t.includes('Iran') ? [1, 0, 0] : [0, 1, 0],
    )
    const out = await suggestMarketsForClaim('Will Iran sign a peace deal?', ['Iran'])
    expect(out).toEqual([])
  })

  it('attaches a 0–100 match score to each returned candidate', async () => {
    global.fetch = gammaFetchMock([
      gammaRow({ conditionId: '0xnear', slug: 'near', question: 'Iran peace deal signed?' }),
    ])
    vi.mocked(embedText).mockResolvedValue([1, 0, 0]) // claim == candidate → cosine 1
    const out = await suggestMarketsForClaim('Will Iran sign a peace deal?', ['Iran'])
    expect(out).toHaveLength(1)
    expect(out[0].score).toBe(100)
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
