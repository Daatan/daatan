import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commitment: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/services/telegram', () => ({ notifyNewCommitment: vi.fn() }))
vi.mock('@/lib/services/notification', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/services/ai-estimate', () => ({ triggerAiProbabilityEstimate: vi.fn() }))

type Row = {
  brierScore: number | null
  rsChange: number | null
  prediction: { status: string }
}

const row = (status: string, brierScore: number | null, rsChange = 0): Row => ({
  brierScore,
  rsChange,
  prediction: { status },
})

describe('getCommitmentStats', () => {
  beforeEach(() => vi.clearAllMocks())

  // Regression: the old logic keyed correct/wrong off `cuReturned`, which the
  // abandoned CU economy never writes — so every resolved commitment was "wrong"
  // and accuracy was pinned at 0%.
  it('counts a resolved commitment with brierScore < 0.25 as correct', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { getCommitmentStats } = await import('../commitment')

    vi.mocked(prisma.commitment.findMany).mockResolvedValue([
      row('RESOLVED_CORRECT', 0.05),
      row('RESOLVED_WRONG', 0.49),
    ] as never)

    const stats = await getCommitmentStats('user-1')

    expect(stats.resolved).toBe(2)
    expect(stats.correct).toBe(1)
    expect(stats.wrong).toBe(1)
    expect(stats.accuracy).toBe(50)
  })

  // Mirrors the resolution engine's own boundary (prediction-resolution.ts).
  it('treats brierScore < 0.25 as correct and >= 0.25 as wrong', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { getCommitmentStats } = await import('../commitment')

    vi.mocked(prisma.commitment.findMany).mockResolvedValue([
      row('RESOLVED_CORRECT', 0.2499),
      row('RESOLVED_CORRECT', 0.25),
    ] as never)

    const stats = await getCommitmentStats('user-1')
    expect(stats.correct).toBe(1)
    expect(stats.wrong).toBe(1)
    expect(stats.accuracy).toBe(50)
  })

  it('excludes unscored (void) resolved and pending commitments from the accuracy base', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { getCommitmentStats } = await import('../commitment')

    vi.mocked(prisma.commitment.findMany).mockResolvedValue([
      row('RESOLVED_CORRECT', 0.1),
      row('RESOLVED_WRONG', null),
      row('ACTIVE', null),
      row('PENDING', null),
    ] as never)

    const stats = await getCommitmentStats('user-1')
    expect(stats.total).toBe(4)
    expect(stats.resolved).toBe(2)
    expect(stats.correct).toBe(1)
    expect(stats.wrong).toBe(0)
    expect(stats.accuracy).toBe(100)
    expect(stats.pending).toBe(2)
    expect(stats.brierCount).toBe(1)
  })

  it('returns null accuracy and avgBrierScore when nothing is scored', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { getCommitmentStats } = await import('../commitment')

    vi.mocked(prisma.commitment.findMany).mockResolvedValue([] as never)

    const stats = await getCommitmentStats('user-1')
    expect(stats.accuracy).toBeNull()
    expect(stats.avgBrierScore).toBeNull()
  })
})
