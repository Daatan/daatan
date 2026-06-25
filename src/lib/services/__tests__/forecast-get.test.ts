import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findFirst: vi.fn() } },
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
import { getForecastById } from '../forecast'

const mockFindFirst = vi.mocked(prisma.prediction.findFirst)

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
