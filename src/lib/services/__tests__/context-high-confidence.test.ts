import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contextSnapshot: {
      create: vi.fn(),
    },
    predictionTranslation: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn().mockResolvedValue([{ id: 'snap-1' }]),
  },
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyHighConfidence: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { notifyHighConfidence } from '@/lib/services/telegram'
import { saveContextUpdate, saveNewsIndexerMatch, saveOracleSnapshotOnly } from '@/lib/services/context'

const findUnique = vi.mocked(prisma.prediction.findUnique)
const notify = vi.mocked(notifyHighConfidence)

function mockPrevious(confidence: number | null) {
  findUnique.mockResolvedValue({
    confidence,
    claimText: 'The Knicks will win the finals',
    slug: 'knicks-finals',
  } as never)
}

const matchInput = (probability: number) => ({
  predictionId: 'pred-1',
  sources: [],
  externalProbability: probability,
  ciLow: probability - 10,
  ciHigh: Math.min(100, probability + 10),
  oracleSnapshot: {},
})

describe('high-confidence crossing alert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([{ id: 'snap-1' }] as never)
  })

  it('fires when confidence crosses 80 from below', async () => {
    mockPrevious(65)
    await saveNewsIndexerMatch(matchInput(82))
    expect(notify).toHaveBeenCalledWith(
      { id: 'pred-1', claimText: 'The Knicks will win the finals', slug: 'knicks-finals' },
      82,
      65,
      false,
    )
  })

  it('fires when there was no previous estimate', async () => {
    mockPrevious(null)
    await saveNewsIndexerMatch(matchInput(85))
    expect(notify).toHaveBeenCalledWith(expect.anything(), 85, null, false)
  })

  it('does not re-fire while hovering above the threshold', async () => {
    mockPrevious(82)
    await saveNewsIndexerMatch(matchInput(84))
    expect(notify).not.toHaveBeenCalled()
  })

  it('does not fire below the threshold', async () => {
    mockPrevious(65)
    await saveNewsIndexerMatch(matchInput(79))
    expect(notify).not.toHaveBeenCalled()
  })

  it('fires at exactly 80', async () => {
    mockPrevious(79)
    await saveNewsIndexerMatch(matchInput(80))
    expect(notify).toHaveBeenCalled()
  })

  it('passes the settled flag through', async () => {
    mockPrevious(70)
    await saveNewsIndexerMatch({ ...matchInput(97), settled: true })
    expect(notify).toHaveBeenCalledWith(expect.anything(), 97, 70, true)
  })

  it('fires from saveContextUpdate', async () => {
    mockPrevious(50)
    await saveContextUpdate({
      predictionId: 'pred-1',
      summary: 'summary',
      sources: [],
      externalProbability: 90,
      externalReasoning: null,
      oracleSnapshot: null,
      confidence: 90,
      aiCiLow: 80,
      aiCiHigh: 99,
      now: new Date('2026-07-02T00:00:00Z'),
    })
    expect(notify).toHaveBeenCalledWith(expect.anything(), 90, 50, false)
  })

  it('does not fire from saveContextUpdate on abstention', async () => {
    mockPrevious(50)
    await saveContextUpdate({
      predictionId: 'pred-1',
      summary: 'summary',
      sources: [],
      externalProbability: null,
      externalReasoning: null,
      oracleSnapshot: null,
      confidence: 90,
      aiCiLow: null,
      aiCiHigh: null,
      insufficientData: true,
      now: new Date('2026-07-02T00:00:00Z'),
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('fires from saveOracleSnapshotOnly', async () => {
    mockPrevious(null)
    await saveOracleSnapshotOnly({
      predictionId: 'pred-1',
      oracleSnapshot: {},
      confidence: 97,
      aiCiLow: 94,
      aiCiHigh: 99,
      settled: true,
    })
    expect(notify).toHaveBeenCalledWith(expect.anything(), 97, null, true)
  })

  it('does not fire when confidence is null', async () => {
    mockPrevious(50)
    await saveOracleSnapshotOnly({
      predictionId: 'pred-1',
      oracleSnapshot: {},
      confidence: null,
      aiCiLow: null,
      aiCiHigh: null,
    })
    expect(notify).not.toHaveBeenCalled()
  })
})
