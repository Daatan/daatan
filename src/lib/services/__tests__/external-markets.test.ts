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
  suggestMarketMatch,
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

  it('returns normalized candidates with provider + url', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    const out = await suggestMarkets('will x happen')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      provider: 'POLYMARKET',
      externalId: '0xabc',
      yesProbability: 68,
      url: 'https://polymarket.com/event/will-x-happen',
    })
  })

  it('returns [] for an empty query without calling the API', async () => {
    global.fetch = vi.fn()
    expect(await suggestMarkets('  ')).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('suggestMarketMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.externalMarket.upsert).mockResolvedValue({ id: 'm1' } as never)
  })

  it('returns the best candidate when similarity clears the threshold', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(embedText).mockResolvedValue([1, 0, 0]) // claim == candidate → cosine 1

    const match = await suggestMarketMatch('Will X definitely happen this year?')

    expect(match).not.toBeNull()
    expect(match!.externalMarketId).toBe('m1')
    expect(match!.score).toBe(100)
    expect(match!.providerLabel).toBe('Polymarket')
  })

  it('returns null when no candidate is similar enough', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(embedText).mockImplementation(async (t: string) =>
      t.includes('definitely') ? [1, 0, 0] : [0, 1, 0], // orthogonal → cosine 0
    )

    expect(await suggestMarketMatch('Will X definitely happen this year?')).toBeNull()
  })

  it('returns null when embeddings are unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(embedText).mockResolvedValue(null)

    expect(await suggestMarketMatch('Will X definitely happen this year?')).toBeNull()
  })

  it('returns null for a too-short claim without calling out', async () => {
    global.fetch = vi.fn()
    expect(await suggestMarketMatch('short')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
