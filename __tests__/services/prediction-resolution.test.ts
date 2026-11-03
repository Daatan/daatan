import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Prisma mock ─────────────────────────────────────────────────────────────
const mockTx = {
  prediction: { update: vi.fn() },
  predictionOption: { update: vi.fn() },
  commitment: { update: vi.fn() },
  user: { update: vi.fn() },
  resolutionSnapshot: { create: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
  },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return { id: 'user-1', rs: 50, ...overrides }
}

function makeCommitment(overrides = {}) {
  return {
    id: 'c1',
    userId: 'user-1',
    predictionId: 'pred-1',
    cuCommitted: 100,   // confidence = +100 → p = 1.0 for BINARY
    binaryChoice: true,
    optionId: null,
    user: makeUser(),
    ...overrides,
  }
}

function makePrediction(overrides = {}) {
  return {
    id: 'pred-1',
    status: 'ACTIVE',
    outcomeType: 'BINARY',
    claimText: 'Will X happen?',
    slug: 'will-x-happen',
    tags: [],
    options: [],
    commitments: [makeCommitment()],
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolvePrediction', () => {
  let prisma: any

  beforeEach(async () => {
    vi.clearAllMocks()
    prisma = (await import('@/lib/prisma')).prisma
    mockTx.prediction.update.mockResolvedValue({ id: 'pred-1', status: 'RESOLVED_CORRECT' })
    mockTx.commitment.update.mockResolvedValue({})
    mockTx.user.update.mockResolvedValue({})
    mockTx.predictionOption.update.mockResolvedValue({})
  })

  it('throws 404 when prediction is not found', async () => {
    prisma.prediction.findUnique.mockResolvedValue(null)
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await expect(
      resolvePrediction('missing-id', { outcome: 'correct', resolvedById: 'admin-1' })
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 400 when prediction is not in a resolvable status', async () => {
    prisma.prediction.findUnique.mockResolvedValue(makePrediction({ status: 'DRAFT' }))
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await expect(
      resolvePrediction('pred-1', { outcome: 'correct', resolvedById: 'admin-1' })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when correctOptionId is missing for MULTIPLE_CHOICE', async () => {
    prisma.prediction.findUnique.mockResolvedValue(
      makePrediction({
        outcomeType: 'MULTIPLE_CHOICE',
        options: [{ id: 'opt-1' }, { id: 'opt-2' }],
      })
    )
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await expect(
      resolvePrediction('pred-1', { outcome: 'correct', resolvedById: 'admin-1' })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('correctOptionId is required') })
  })

  it('throws 400 when correctOptionId does not match any option', async () => {
    prisma.prediction.findUnique.mockResolvedValue(
      makePrediction({
        outcomeType: 'MULTIPLE_CHOICE',
        options: [{ id: 'opt-1' }],
      })
    )
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await expect(
      resolvePrediction('pred-1', { outcome: 'correct', resolvedById: 'admin-1', correctOptionId: 'opt-WRONG' })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('does not match') })
  })

  it('correct BINARY — high confidence YES voter gets positive ΔRS', async () => {
    // commitment: cuCommitted=100 → p = (100+100)/200 = 1.0
    // outcome=correct → outcomeNumeric=1
    // brierScore = (1.0 - 1)² = 0, rsChange = round((0.25 - 0) * 100) = 25
    prisma.prediction.findUnique.mockResolvedValue(makePrediction())
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await resolvePrediction('pred-1', { outcome: 'correct', resolvedById: 'admin-1' })

    expect(mockTx.commitment.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { brierScore: 0, rsChange: 25 },
    })
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { rs: 75 },  // max(0, 50 + 25)
    })
  })

  it('wrong BINARY — high confidence YES voter penalised on NO outcome', async () => {
    // commitment: cuCommitted=100 → p = 1.0
    // outcome=wrong → outcomeNumeric=0
    // brierScore = (1.0 - 0)² = 1.0, rsChange = round((0.25 - 1.0) * 100) = -75
    prisma.prediction.findUnique.mockResolvedValue(makePrediction())
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await resolvePrediction('pred-1', { outcome: 'wrong', resolvedById: 'admin-1' })

    expect(mockTx.commitment.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { brierScore: 1, rsChange: -75 },
    })
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { rs: 0 },  // max(0, 50 - 75)
    })
  })

  it('void outcome — no RS change, no brierScore', async () => {
    prisma.prediction.findUnique.mockResolvedValue(makePrediction())
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await resolvePrediction('pred-1', { outcome: 'void', resolvedById: 'admin-1' })

    expect(mockTx.commitment.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { rsChange: 0 },
    })
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { rs: 50 },  // unchanged
    })
  })

  it('floors RS at 0 when loss exceeds current RS', async () => {
    // user.rs = 2, cuCommitted = 100 → p = 1.0, outcome=wrong → rsChange = -75
    // newRs = max(0, 2 - 75) = 0
    prisma.prediction.findUnique.mockResolvedValue(
      makePrediction({ commitments: [makeCommitment({ user: makeUser({ rs: 2 }) })] })
    )
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await resolvePrediction('pred-1', { outcome: 'wrong', resolvedById: 'admin-1' })

    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { rs: 0 },
    })
  })

  it('computes brierScore from cuCommitted for moderate confidence', async () => {
    // cuCommitted = 60 → p = (60+100)/200 = 0.8, outcome=correct → outcomeNumeric=1
    // brierScore = (0.8 - 1)² = 0.04, rsChange = round((0.25 - 0.04) * 100) = 21
    prisma.prediction.findUnique.mockResolvedValue(
      makePrediction({ commitments: [makeCommitment({ cuCommitted: 60 })] })
    )
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await resolvePrediction('pred-1', { outcome: 'correct', resolvedById: 'admin-1' })

    expect(mockTx.commitment.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        brierScore: expect.closeTo(0.04, 5),
        rsChange: 21,
      },
    })
  })

  it('updates prediction status to RESOLVED_CORRECT', async () => {
    prisma.prediction.findUnique.mockResolvedValue(makePrediction())
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await resolvePrediction('pred-1', { outcome: 'correct', resolvedById: 'admin-1' })

    expect(mockTx.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RESOLVED_CORRECT', resolvedById: 'admin-1' }),
      })
    )
  })

  it('updates prediction status to VOID', async () => {
    prisma.prediction.findUnique.mockResolvedValue(makePrediction())
    const { resolvePrediction } = await import('@/lib/services/prediction-resolution')

    await resolvePrediction('pred-1', { outcome: 'void', resolvedById: 'admin-1' })

    expect(mockTx.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'VOID' }),
      })
    )
  })
})
