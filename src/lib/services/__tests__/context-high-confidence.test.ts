import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    $transaction: vi.fn().mockResolvedValue([{ id: 'snap-1' }]),
  },
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyHighConfidence: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { notifyHighConfidence } from '@/lib/services/telegram'
import { saveContextUpdate, saveNewsIndexerMatch, saveOracleSnapshotOnly, saveClockSnapshot } from '@/lib/services/context'

const findUnique = vi.mocked(prisma.prediction.findUnique)
const update = vi.mocked(prisma.prediction.update)
const notify = vi.mocked(notifyHighConfidence)

function mockPrevious(confidence: number | null) {
  findUnique.mockResolvedValue({
    confidence,
    claimText: 'The Knicks will win the finals',
    slug: 'knicks-finals',
  } as never)
}

/** A pool that backs a settlement claim under the daatan#1525 bar: two settling
 *  votes out of two rows, i.e. unanimous. */
const settledPool = { mean: 97, sources: [{ settled: true }, { settled: true }] }

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
    vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue(null as never)
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

  it('passes the settled flag through when the pin is evidence-backed', async () => {
    mockPrevious(70)
    await saveNewsIndexerMatch({
      ...matchInput(97),
      settled: true,
      oracleSnapshot: { sources: [{ source: 'wire-a', settled: true }, { source: 'wire-b', settled: true }] },
    })
    expect(notify).toHaveBeenCalledWith(expect.anything(), 97, 70, true)
  })

  it('a settlement pin with a single settling vote does not alert (daatan#1248)', async () => {
    // The pin's 97 is settlement_stance, a constant above the bar by
    // construction — an unverifiable pin must not page the channel.
    mockPrevious(70)
    await saveNewsIndexerMatch({
      ...matchInput(97),
      settled: true,
      oracleSnapshot: { sources: [{ source: 'wire-a', settled: true }, { source: 'color', settled: null }] },
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('a settlement pin without its snapshot does not alert (daatan#1248)', async () => {
    mockPrevious(70)
    await saveNewsIndexerMatch({ ...matchInput(97), settled: true })
    expect(notify).not.toHaveBeenCalled()
  })

  it('an organic 97 with settling rows in the pool alerts as unsettled', async () => {
    // settled=false: the rows' flags alone are not a pin — the gate keys on
    // the Oracul's settled verdict, not on row inspection.
    mockPrevious(70)
    await saveNewsIndexerMatch({
      ...matchInput(97),
      oracleSnapshot: { sources: [{ source: 'wire-a', settled: true }, { source: 'wire-b', settled: true }] },
    })
    expect(notify).toHaveBeenCalledWith(expect.anything(), 97, 70, false)
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
      oracleSnapshot: { sources: [{ source: 'wire-a', settled: true }, { source: 'wire-b', settled: true }] },
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

describe('settled persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([{ id: 'snap-1' }] as never)
    vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue(null as never)
  })

  it('saveNewsIndexerMatch writes settled+settledAt when settled', async () => {
    mockPrevious(70)
    await saveNewsIndexerMatch({ ...matchInput(97), oracleSnapshot: settledPool, settled: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ settled: true, settledAt: expect.any(Date) }),
      }),
    )
  })

  it('saveNewsIndexerMatch does not write settled when not settled', async () => {
    mockPrevious(70)
    await saveNewsIndexerMatch(matchInput(75))
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).not.toHaveProperty('settled')
    expect(call.data).not.toHaveProperty('settledAt')
  })

  it('saveOracleSnapshotOnly writes settled+settledAt when settled', async () => {
    mockPrevious(null)
    await saveOracleSnapshotOnly({
      predictionId: 'pred-1',
      oracleSnapshot: settledPool,
      confidence: 97,
      aiCiLow: 94,
      aiCiHigh: 99,
      settled: true,
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ settled: true, settledAt: expect.any(Date) }),
      }),
    )
  })

  it('saveContextUpdate writes settled+settledAt when settled', async () => {
    mockPrevious(50)
    await saveContextUpdate({
      predictionId: 'pred-1',
      summary: 'summary',
      sources: [],
      externalProbability: 97,
      externalReasoning: null,
      oracleSnapshot: settledPool,
      confidence: 97,
      aiCiLow: 94,
      aiCiHigh: 99,
      settled: true,
      now: new Date('2026-07-04T00:00:00Z'),
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ settled: true, settledAt: new Date('2026-07-04T00:00:00Z') }),
      }),
    )
  })

  it('saveContextUpdate does not clear settled on an abstained (insufficientData) run', async () => {
    mockPrevious(50)
    await saveContextUpdate({
      predictionId: 'pred-1',
      summary: 'summary',
      sources: [],
      externalProbability: null,
      externalReasoning: null,
      oracleSnapshot: null,
      confidence: null,
      aiCiLow: null,
      aiCiHigh: null,
      insufficientData: true,
      now: new Date('2026-07-04T00:00:00Z'),
    })
    const call = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).not.toHaveProperty('settled')
    expect(call.data).not.toHaveProperty('settledAt')
  })
})

describe('saveClockSnapshot — cause-aware alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([{ id: 'snap-clock' }] as never)
  })

  it('never calls notifyHighConfidence, even when the written value crosses 80', async () => {
    await saveClockSnapshot({
      predictionId: 'pred-1',
      probability: 92,
      aiCiLow: 85,
      aiCiHigh: 97,
      meta: { engineVersion: 'glide-v1', cause: 'glide' },
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('writes the snapshot with kind=clock and updates prediction.confidence, without touching detailsText', async () => {
    await saveClockSnapshot({
      predictionId: 'pred-1',
      probability: 42,
      aiCiLow: 30,
      aiCiHigh: 55,
      meta: { engineVersion: 'glide-v1', cause: 'glide' },
    })

    const createCall = vi.mocked(prisma.contextSnapshot.create).mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    expect(createCall.data.kind).toBe('clock')
    expect(createCall.data.externalProbability).toBe(42)

    const updateCall = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateCall.data.confidence).toBe(42)
    expect(updateCall.data).not.toHaveProperty('detailsText')
    expect(updateCall.data).not.toHaveProperty('settled')
  })
})
