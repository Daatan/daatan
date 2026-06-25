import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findFirst: vi.fn() },
    predictionSlugAlias: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/services/embedding', () => ({
  embedText: vi.fn(),
  embedAndStoreForecast: vi.fn(),
}))
vi.mock('@/lib/services/indexnow', () => ({ notifyIndexNow: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { getForecastById, getCanonicalSlugForAlias } from '../forecast'

const mockFindFirst = vi.mocked(prisma.prediction.findFirst)
const mockAliasFind = vi.mocked(prisma.predictionSlugAlias.findUnique)

describe('getForecastById', () => {
  beforeEach(() => vi.clearAllMocks())

  // Regression: the detail page refetches /api/forecasts/[id] on mount and overwrites
  // the SSR prediction. If this query omits externalMarket, the linked market (and its
  // chart line) is silently wiped after first paint. See app/forecasts/[id]/page.tsx.
  it('includes externalMarket + its price snapshots', async () => {
    mockFindFirst.mockResolvedValue(null as never)

    await getForecastById('spacex-starship-orbit-next')

    const arg = mockFindFirst.mock.calls[0][0] as { include?: Record<string, unknown> }
    const em = arg.include?.externalMarket as { select?: { snapshots?: unknown } } | undefined
    expect(em).toBeTruthy()
    expect(em?.select?.snapshots).toBeTruthy()
  })
})

describe('getCanonicalSlugForAlias', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the current canonical slug for a retired alias', async () => {
    mockAliasFind.mockResolvedValue({ prediction: { slug: 'at-least-two-arab-parties-2026' } } as never)
    expect(await getCanonicalSlugForAlias('2026-1')).toBe('at-least-two-arab-parties-2026')
    expect(mockAliasFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: '2026-1' } }),
    )
  })

  it('returns null when the slug is not a known alias', async () => {
    mockAliasFind.mockResolvedValue(null as never)
    expect(await getCanonicalSlugForAlias('nope')).toBeNull()
  })
})
