import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mockError }),
}))

import { isExpectedClaimCollision, logPrismaErrorEvent } from '@/lib/prisma-log'

// What Prisma actually emits for the deliberate claim collision (daatan#1502):
// the driver adapter renders the first field quoted, the second not.
const CLAIM_COLLISION_MESSAGE =
  'Invalid `prisma.evidencePoolArticle.create()` invocation:\n\n\n' +
  'Unique constraint failed on the fields: (`"predictionId"`, `url_hash`)'

const event = (message: string) => ({
  timestamp: new Date(),
  message,
  target: 'quaint',
})

beforeEach(() => {
  mockError.mockClear()
})

describe('isExpectedClaimCollision', () => {
  it('matches the (predictionId, url_hash) unique-constraint message', () => {
    expect(isExpectedClaimCollision(CLAIM_COLLISION_MESSAGE)).toBe(true)
  })

  it('matches the bare single-line form', () => {
    expect(
      isExpectedClaimCollision(
        'Unique constraint failed on the fields: (`"predictionId"`, `url_hash`)',
      ),
    ).toBe(true)
  })

  it('does not match a P2002 on a different constraint', () => {
    expect(
      isExpectedClaimCollision('Unique constraint failed on the fields: (`slug`)'),
    ).toBe(false)
  })

  it('does not match non-P2002 errors', () => {
    expect(isExpectedClaimCollision('Timed out fetching a new connection from the pool')).toBe(
      false,
    )
  })
})

describe('logPrismaErrorEvent', () => {
  it('drops the expected claim-collision event', () => {
    logPrismaErrorEvent(event(CLAIM_COLLISION_MESSAGE))
    expect(mockError).not.toHaveBeenCalled()
  })

  it('still logs a P2002 on any other constraint', () => {
    logPrismaErrorEvent(event('Unique constraint failed on the fields: (`slug`)'))
    expect(mockError).toHaveBeenCalledTimes(1)
    expect(mockError).toHaveBeenCalledWith(
      { target: 'quaint' },
      'Unique constraint failed on the fields: (`slug`)',
    )
  })

  it('still logs non-P2002 error events', () => {
    logPrismaErrorEvent(event('Timed out fetching a new connection from the pool'))
    expect(mockError).toHaveBeenCalledTimes(1)
  })
})
