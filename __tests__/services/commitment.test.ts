import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Prisma mock ────────────────────────────────────────────────────────────
vi.mock('@/lib/prisma', () => ({
  prisma: {
    commitment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    prediction: { update: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

// ─── Side-effect mocks ───────────────────────────────────────────────────────
vi.mock('@/lib/services/telegram', () => ({ notifyNewCommitment: vi.fn(), notifyServerError: vi.fn() }))
vi.mock('@/lib/services/notification', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal commitment object for mocking. */
function makeCommitment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    userId: 'user-1',
    predictionId: 'pred-1',
    binaryChoice: true,
    optionId: null,
    cuCommitted: 70,
    rsSnapshot: 1.0,
    createdAt: new Date(),
    rsChange: null,
    brierScore: null,
    prediction: {
      id: 'pred-1',
      status: 'ACTIVE',
      lockedAt: new Date(),
      claimText: 'Will X happen?',
      slug: 'will-x-happen',
      options: [],
    },
    ...overrides,
  }
}

// ─── removeCommitment ────────────────────────────────────────────────────────

describe('removeCommitment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when commitment not found', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { removeCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null)

    const result = await removeCommitment('user-1', 'pred-1')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })

  it('returns 400 when prediction is not ACTIVE', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { removeCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(
      makeCommitment({ prediction: { status: 'RESOLVED_CORRECT', lockedAt: new Date(), claimText: 'X', slug: null, options: [] } }) as any,
    )

    const result = await removeCommitment('user-1', 'pred-1')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })

  it('deletes the commitment and returns success', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { removeCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(makeCommitment() as any)
    vi.mocked(prisma.commitment.delete).mockResolvedValue(makeCommitment() as any)

    const result = await removeCommitment('user-1', 'pred-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.success).toBe(true)
    }
    expect(prisma.commitment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
  })
})

// ─── updateCommitment ────────────────────────────────────────────────────────

describe('updateCommitment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 404 when commitment not found', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { updateCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

    const result = await updateCommitment('user-1', 'pred-1', { confidence: 50 })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })

  it('returns 400 when prediction is not ACTIVE', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { updateCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(
      makeCommitment({ prediction: { status: 'PENDING', lockedAt: null, claimText: 'X', slug: null, options: [] } }) as any,
    )
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1', rs: 1 } as any)

    const result = await updateCommitment('user-1', 'pred-1', { confidence: 50 })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })

  it('updates confidence and derives binaryChoice', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { updateCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(
      makeCommitment({ prediction: { status: 'ACTIVE', outcomeType: 'BINARY', lockedAt: null, claimText: 'X', slug: null, options: [] } }) as any,
    )
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1', rs: 1 } as any)
    const updated = makeCommitment({ cuCommitted: -50, binaryChoice: false })
    vi.mocked(prisma.commitment.update).mockResolvedValue({ ...updated, user: {}, option: null } as any)

    const result = await updateCommitment('user-1', 'pred-1', { confidence: -50 })

    expect(result.ok).toBe(true)
    expect(prisma.commitment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cuCommitted: -50,
        binaryChoice: false,
      }),
    }))
  })
})
