/**
 * daatan#1777: forecasts are created as DRAFT, so the post-classification estimate
 * trigger in createForecast only ever fires for a forecast that was published
 * immediately. A draft published later, or a forecast approved from the queue, is
 * picked up by the publish/approve trigger instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { update: vi.fn() },
  },
}))
vi.mock('@/lib/services/embedding', () => ({
  embedText: vi.fn(),
  embedAndStoreForecast: vi.fn(),
}))
vi.mock('@/lib/services/indexnow', () => ({ notifySearchEngines: vi.fn() }))
const scheduleCreationEstimate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/creation-estimate', () => ({ scheduleCreationEstimate }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { publishForecast, approveForecast } from '../forecast'

describe.each([
  ['publishForecast', publishForecast],
  ['approveForecast', approveForecast],
])('%s', (_name, fn) => {
  beforeEach(() => vi.clearAllMocks())

  it('schedules the creation estimate for the now-ACTIVE forecast', async () => {
    vi.mocked(prisma.prediction.update).mockResolvedValue({ id: 'pred-1', slug: 's', isPublic: true } as never)
    await fn('pred-1')
    expect(scheduleCreationEstimate).toHaveBeenCalledWith('pred-1')
  })
})
