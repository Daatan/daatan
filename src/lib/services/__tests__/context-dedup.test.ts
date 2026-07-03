import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contextSnapshot: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    predictionTranslation: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyHighConfidence: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { saveNewsIndexerMatch } from '@/lib/services/context'

const findFirst = vi.mocked(prisma.contextSnapshot.findFirst)

const sources = [
  { url: 'https://jpost.com/a', title: 'A', source: 'jpost.com', publishedDate: null },
  { url: 'https://ynet.co.il/b', title: 'B', source: 'ynet.co.il', publishedDate: null },
]

const input = () => ({
  predictionId: 'pred-1',
  sources,
  externalProbability: 67,
  ciLow: 40,
  ciHigh: 90,
  oracleSnapshot: { mean: 0.3443, std: 0.43 },
})

/** The latest stored snapshot as the dedup query returns it. */
const storedMatch = (overrides: Record<string, unknown> = {}) => ({
  externalReasoning: 'TruthMachine Oracle (news-indexer match)',
  externalProbability: 67,
  // Stored order intentionally differs from the incoming order — URL-set identity.
  sources: [sources[1], sources[0]],
  oracleSnapshot: { mean: 0.3443, std: 0.43 },
  ...overrides,
})

describe('saveNewsIndexerMatch dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never)
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      confidence: 67,
      claimText: 'claim',
      slug: 's',
    } as never)
  })

  it('skips the write when the latest snapshot is the same measurement', async () => {
    findFirst.mockResolvedValue(storedMatch() as never)
    await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('writes when the probability changed', async () => {
    findFirst.mockResolvedValue(storedMatch({ externalProbability: 65 }) as never)
    await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('writes when the Oracle mean changed even at the same rounded probability', async () => {
    findFirst.mockResolvedValue(
      storedMatch({ oracleSnapshot: { mean: 0.3401, std: 0.43 } }) as never,
    )
    await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('writes when the source set changed', async () => {
    findFirst.mockResolvedValue(storedMatch({ sources: [sources[0]] }) as never)
    await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('writes when the latest snapshot is not a news-indexer match', async () => {
    findFirst.mockResolvedValue(storedMatch({ externalReasoning: 'analyze run' }) as never)
    await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })

  it('writes when there is no previous snapshot at all', async () => {
    findFirst.mockResolvedValue(null as never)
    await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
  })
})
