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
import { saveContextUpdate, saveNewsIndexerMatch, saveOracleSnapshotOnly, saveClockSnapshot } from '@/lib/services/context'

const findUnique = vi.mocked(prisma.prediction.findUnique)
const update = vi.mocked(prisma.prediction.update)

function mockPrevious(confidence: number | null) {
  findUnique.mockResolvedValue({
    confidence,
    claimText: 'The Knicks will win the finals',
    slug: 'knicks-finals',
  } as never)
}

function updatedData(): Record<string, unknown> {
  return (update.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

const matchInput = (probability: number) => ({
  predictionId: 'pred-1',
  sources: [],
  externalProbability: probability,
  ciLow: probability - 10,
  ciHigh: Math.min(100, probability + 10),
  oracleSnapshot: {},
})

describe('awaitingAiResolution — symmetric 90/10 flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([{ id: 'snap-1' }] as never)
    vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue(null as never)
    mockPrevious(50)
  })

  describe('saveNewsIndexerMatch', () => {
    it('sets the flag at exactly 90', async () => {
      await saveNewsIndexerMatch(matchInput(90))
      expect(updatedData().awaitingAiResolution).toBe(true)
    })

    it('does not set the flag at 89', async () => {
      await saveNewsIndexerMatch(matchInput(89))
      expect(updatedData().awaitingAiResolution).toBe(false)
    })

    it('sets the flag at exactly 10', async () => {
      await saveNewsIndexerMatch(matchInput(10))
      expect(updatedData().awaitingAiResolution).toBe(true)
    })

    it('does not set the flag at 11', async () => {
      await saveNewsIndexerMatch(matchInput(11))
      expect(updatedData().awaitingAiResolution).toBe(false)
    })

    it('clears the flag once a later read lands back inside the band', async () => {
      mockPrevious(95)
      await saveNewsIndexerMatch(matchInput(52))
      expect(updatedData().awaitingAiResolution).toBe(false)
    })
  })

  describe('saveContextUpdate', () => {
    it('sets the flag when the new confidence qualifies', async () => {
      await saveContextUpdate({
        predictionId: 'pred-1',
        summary: 'summary',
        sources: [],
        externalProbability: 94,
        externalReasoning: null,
        oracleSnapshot: null,
        confidence: 94,
        aiCiLow: 88,
        aiCiHigh: 99,
        now: new Date('2026-07-08T00:00:00Z'),
      })
      expect(updatedData().awaitingAiResolution).toBe(true)
    })

    it('forces the flag false on an abstained (insufficientData) run', async () => {
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
        now: new Date('2026-07-08T00:00:00Z'),
      })
      expect(updatedData().awaitingAiResolution).toBe(false)
    })

    it('leaves the flag untouched when this run produced no confidence (e.g. a timeout)', async () => {
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
        now: new Date('2026-07-08T00:00:00Z'),
      })
      expect(updatedData()).not.toHaveProperty('awaitingAiResolution')
    })
  })

  describe('saveOracleSnapshotOnly', () => {
    it('sets the flag when confidence qualifies', async () => {
      await saveOracleSnapshotOnly({
        predictionId: 'pred-1',
        oracleSnapshot: {},
        confidence: 6,
        aiCiLow: 1,
        aiCiHigh: 15,
      })
      expect(updatedData().awaitingAiResolution).toBe(true)
    })

    it('does not touch the prediction at all when confidence is null', async () => {
      await saveOracleSnapshotOnly({
        predictionId: 'pred-1',
        oracleSnapshot: {},
        confidence: null,
        aiCiLow: null,
        aiCiHigh: null,
      })
      // recordEstimate: no probability ⇒ no prediction.update op — flag, needle
      // and band are all preserved (previously the band was blanked anyway).
      expect(update).not.toHaveBeenCalled()
    })
  })

  describe('saveClockSnapshot', () => {
    it('sets the flag when the glided probability qualifies', async () => {
      await saveClockSnapshot({
        predictionId: 'pred-1',
        probability: 93,
        aiCiLow: 85,
        aiCiHigh: 98,
        meta: { engineVersion: 'glide-v1', cause: 'glide' },
      })
      expect(updatedData().awaitingAiResolution).toBe(true)
    })

    it('clears the flag when the glided probability lands back inside the band', async () => {
      await saveClockSnapshot({
        predictionId: 'pred-1',
        probability: 55,
        aiCiLow: 40,
        aiCiHigh: 70,
        meta: { engineVersion: 'glide-v1', cause: 'glide' },
      })
      expect(updatedData().awaitingAiResolution).toBe(false)
    })
  })

  describe('settlement pins are their own class (daatan#1248)', () => {
    // A pin's confidence is settlement_stance (~97), a policy constant — it
    // clears any level band by construction. So a pin enters the band as a
    // settlement claim, gated on the settling votes its own snapshot carries,
    // and never via the level check.
    const pinInput = (settlingRows: Array<boolean | null>) => ({
      ...matchInput(97),
      settled: true,
      oracleSnapshot: {
        sources: settlingRows.map((settled, i) => ({ source: `outlet-${i}`, settled })),
      },
    })

    it('a pin backed by two settling votes enters the band', async () => {
      await saveNewsIndexerMatch(pinInput([true, true, null]))
      expect(updatedData().awaitingAiResolution).toBe(true)
    })

    it('a pin with a single settling vote does not enter the band', async () => {
      await saveNewsIndexerMatch(pinInput([true, false, null]))
      expect(updatedData().awaitingAiResolution).toBe(false)
    })

    it('a pin without its snapshot fails closed', async () => {
      await saveNewsIndexerMatch({ ...matchInput(97), settled: true, oracleSnapshot: {} })
      expect(updatedData().awaitingAiResolution).toBe(false)
    })

    it('a malformed sources payload counts as zero settling votes', async () => {
      await saveNewsIndexerMatch({
        ...matchInput(97),
        settled: true,
        oracleSnapshot: { sources: 'not-an-array' },
      })
      expect(updatedData().awaitingAiResolution).toBe(false)
    })

    it('an organic 97 still enters via the level band', async () => {
      await saveNewsIndexerMatch(matchInput(97))
      expect(updatedData().awaitingAiResolution).toBe(true)
    })

    it('settling rows without the settled verdict do not change the level band', async () => {
      // settled=false + settling rows: not a pin — 55 stays inside the band.
      await saveNewsIndexerMatch({
        ...matchInput(55),
        oracleSnapshot: { sources: [{ source: 'a', settled: true }, { source: 'b', settled: true }] },
      })
      expect(updatedData().awaitingAiResolution).toBe(false)
    })
  })
})
