import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    contextSnapshot: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([{ id: 'snap-1' }]),
  },
}))

vi.mock('@/lib/services/telegram', () => ({ notifyHighConfidence: vi.fn() }))

import { prisma } from '@/lib/prisma'
import {
  getContextTimeline,
  listContextSnapshots,
  getLatestOracleSnapshot,
  getLatestEvidenceEstimate,
  getProbabilityHistory,
} from '@/lib/services/context'

const findFirstPrediction = vi.mocked(prisma.prediction.findFirst)
const findManySnapshots = vi.mocked(prisma.contextSnapshot.findMany)
const findFirstSnapshot = vi.mocked(prisma.contextSnapshot.findFirst)

describe('kind=clock exclusion filters', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getContextTimeline filters clock rows out of the contextSnapshots include', async () => {
    findFirstPrediction.mockResolvedValue({} as never)
    await getContextTimeline('pred-1')
    const call = findFirstPrediction.mock.calls[0][0] as {
      select: { contextSnapshots: { where?: Record<string, unknown> } }
    }
    expect(call.select.contextSnapshots.where).toEqual({ kind: { not: 'clock' } })
  })

  it('listContextSnapshots filters clock rows out', async () => {
    findManySnapshots.mockResolvedValue([])
    await listContextSnapshots('pred-1')
    const call = findManySnapshots.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(call.where).toMatchObject({ kind: { not: 'clock' } })
  })

  it('getLatestOracleSnapshot filters clock rows out', async () => {
    findFirstSnapshot.mockResolvedValue(null)
    await getLatestOracleSnapshot('pred-1')
    const call = findFirstSnapshot.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(call.where).toMatchObject({ kind: { not: 'clock' } })
  })

  it('getLatestEvidenceEstimate excludes clock rows, abstentions, and null probabilities', async () => {
    findFirstSnapshot.mockResolvedValue(null)
    await getLatestEvidenceEstimate('pred-1')
    const call = findFirstSnapshot.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(call.where).toMatchObject({
      externalProbability: { not: null },
      insufficientData: false,
      kind: { not: 'clock' },
    })
  })
})

describe('getProbabilityHistory — the one reader that INCLUDES clock rows', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not filter by kind, so glide requotes appear in the chart series', async () => {
    findManySnapshots.mockResolvedValue([])
    await getProbabilityHistory('pred-1')
    const call = findManySnapshots.mock.calls[0][0] as {
      where: Record<string, unknown>
      orderBy: Record<string, unknown>
      select: Record<string, unknown>
    }
    expect(call.where).not.toHaveProperty('kind')
    expect(call.where).toMatchObject({
      predictionId: 'pred-1',
      externalProbability: { not: null },
      insufficientData: false,
    })
    expect(call.orderBy).toEqual({ createdAt: 'asc' })
    expect(call.select).toMatchObject({ kind: true, externalProbability: true, createdAt: true })
  })
})
