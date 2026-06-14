import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    polymarketMarket: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    polymarketPriceSnapshot: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import {
  parseSlug,
  normalizeGammaMarket,
  fetchMarketBySlug,
  resolveMarketByUrl,
  syncLinkedMarkets,
  suggestMarkets,
} from '../polymarket'
import { prisma } from '@/lib/prisma'

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

describe('parseSlug', () => {
  it('extracts the slug from an event URL', () => {
    expect(parseSlug('https://polymarket.com/event/will-x-happen')).toBe('will-x-happen')
  })

  it('extracts the last segment from a nested market URL', () => {
    expect(parseSlug('https://polymarket.com/market/foo/will-x-happen/')).toBe('will-x-happen')
  })

  it('strips query strings', () => {
    expect(parseSlug('https://polymarket.com/event/will-x-happen?tid=123')).toBe('will-x-happen')
  })

  it('accepts a raw slug as-is', () => {
    expect(parseSlug('will-x-happen')).toBe('will-x-happen')
  })

  it('rejects non-polymarket URLs', () => {
    expect(parseSlug('https://example.com/event/foo')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(parseSlug('   ')).toBeNull()
  })
})

describe('normalizeGammaMarket', () => {
  it('decodes JSON-string outcomes/prices and derives YES probability', () => {
    const m = normalizeGammaMarket(gammaRow())
    expect(m).not.toBeNull()
    expect(m!.outcomes).toEqual(['Yes', 'No'])
    expect(m!.yesProbability).toBe(68)
    expect(m!.closed).toBe(false)
    expect(m!.resolvedOutcome).toBeNull()
  })

  it('uses the YES-labelled outcome regardless of order', () => {
    const m = normalizeGammaMarket(
      gammaRow({ outcomes: '["No", "Yes"]', outcomePrices: '["0.25", "0.75"]' }),
    )
    expect(m!.yesProbability).toBe(75)
  })

  it('marks a closed market resolved with the winning outcome', () => {
    const m = normalizeGammaMarket(
      gammaRow({ closed: true, outcomePrices: '["1.0", "0.0"]' }),
    )
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
    expect(
      normalizeGammaMarket(gammaRow({ outcomePrices: '["0.5"]' })),
    ).toBeNull()
  })
})

describe('fetchMarketBySlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the normalized first row', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    const m = await fetchMarketBySlug('will-x-happen')
    expect(m!.conditionId).toBe('0xabc')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/markets?slug=will-x-happen'),
      expect.any(Object),
    )
  })

  it('returns null on an empty result', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([]))
    expect(await fetchMarketBySlug('nope')).toBeNull()
  })

  it('returns null on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(null, false, 500))
    expect(await fetchMarketBySlug('boom')).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'))
    expect(await fetchMarketBySlug('boom')).toBeNull()
  })
})

describe('resolveMarketByUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses, fetches and upserts the market', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    vi.mocked(prisma.polymarketMarket.upsert).mockResolvedValue({ id: 'm1' } as never)

    const result = await resolveMarketByUrl('https://polymarket.com/event/will-x-happen')

    expect(result).toEqual({ id: 'm1' })
    expect(prisma.polymarketMarket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conditionId: '0xabc' } }),
    )
  })

  it('returns null for an unparseable URL without calling the API', async () => {
    global.fetch = vi.fn()
    expect(await resolveMarketByUrl('not a url')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('syncLinkedMarkets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never)
  })

  it('snapshots each linked market and reports counts', async () => {
    vi.mocked(prisma.polymarketMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'will-x-happen', conditionId: '0xabc' },
    ] as never)
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))

    const result = await syncLinkedMarkets()

    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('counts a market as failed when its fetch returns nothing', async () => {
    vi.mocked(prisma.polymarketMarket.findMany).mockResolvedValue([
      { id: 'm1', slug: 'gone', conditionId: '0xabc' },
    ] as never)
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([]))

    const result = await syncLinkedMarkets()

    expect(result).toEqual({ synced: 0, failed: 1 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('suggestMarkets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns normalized candidates with a polymarket URL', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([gammaRow()]))
    const out = await suggestMarkets('will x happen')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      conditionId: '0xabc',
      yesProbability: 68,
      url: 'https://polymarket.com/event/will-x-happen',
    })
  })

  it('returns [] for an empty query without calling the API', async () => {
    global.fetch = vi.fn()
    expect(await suggestMarkets('  ')).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('returns [] when the API fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(null, false, 500))
    expect(await suggestMarkets('x')).toEqual([])
  })
})
