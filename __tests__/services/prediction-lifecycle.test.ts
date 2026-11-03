import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, updateMany } = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { findMany, updateMany } } }))

import { transitionExpiredPredictions } from '@/lib/services/prediction-lifecycle'

const NOW = new Date('2026-11-03T22:00:00.000Z') // midnight in Israel, winter time

describe('transitionExpiredPredictions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateMany.mockResolvedValue({ count: 2 })
  })

  it('flips deadlines that have ended in Israel, and leaves the rest', async () => {
    findMany.mockResolvedValue([
      { id: 'ended-today', resolveByDatetime: new Date('2026-11-03T23:59:59.000Z') },
      { id: 'exact-past', resolveByDatetime: new Date('2026-11-03T14:30:00.000Z') },
      { id: 'exact-future', resolveByDatetime: new Date('2026-11-03T23:30:00.000Z') },
    ])

    expect(await transitionExpiredPredictions(NOW)).toBe(2)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ended-today', 'exact-past'] }, status: 'ACTIVE' },
      data: { status: 'PENDING' },
    })
  })

  it('selects by resolveByDatetime, wide enough for a deadline stamped hours ahead', async () => {
    findMany.mockResolvedValue([])
    await transitionExpiredPredictions(NOW)
    const where = findMany.mock.calls[0][0].where
    expect(where.status).toBe('ACTIVE')
    expect(where.resolveByDatetime.lt.getTime()).toBeGreaterThan(new Date('2026-11-04T01:00:00.000Z').getTime())
  })

  it('writes nothing when no deadline has ended', async () => {
    findMany.mockResolvedValue([{ id: 'tonight', resolveByDatetime: new Date('2026-11-04T23:59:59.000Z') }])
    expect(await transitionExpiredPredictions(NOW)).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })
})
