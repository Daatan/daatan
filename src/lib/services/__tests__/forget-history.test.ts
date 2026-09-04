import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * daatan#1701 "Forget History": detach a user from their own resolved
 * commitments (anonymize/detach, not delete) and reset derived scoring.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commitment: { count: vi.fn(), updateMany: vi.fn() },
    userTagRating: { deleteMany: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { forgetHistory } from '../user'

const count = vi.mocked(prisma.commitment.count)
const transaction = vi.mocked(prisma.$transaction)

beforeEach(() => {
  vi.clearAllMocks()
  transaction.mockResolvedValue([] as never)
})

describe('forgetHistory', () => {
  it('refuses when the user has commitments on non-terminal forecasts', async () => {
    count.mockResolvedValue(1)

    const result = await forgetHistory('user-1')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    expect(count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        prediction: { status: { notIn: ['RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE'] } },
      },
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('detaches resolved commitments and resets scoring to defaults when nothing is open', async () => {
    count.mockResolvedValue(0)

    const result = await forgetHistory('user-1')

    expect(result.ok).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(prisma.commitment.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: { userId: null },
    })
    expect(prisma.userTagRating.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        rs: 100,
        mu: 1500,
        sigma: 350,
        volatility: 0.06,
        eloRating: 1500,
        totalPredictions: 0,
        correctPredictions: 0,
      },
    })
  })
})
