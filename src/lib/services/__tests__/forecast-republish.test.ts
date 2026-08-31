import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/services/evidence-pool', () => ({ countUsableEvidence: vi.fn() }))
vi.mock('@/lib/services/pooled-estimate', () => ({ resolvePooledEstimate: vi.fn() }))
vi.mock('@/lib/services/context', () => ({ recordEstimate: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { countUsableEvidence } from '@/lib/services/evidence-pool'
import { resolvePooledEstimate } from '@/lib/services/pooled-estimate'
import { recordEstimate } from '@/lib/services/context'
import { republishForecasts } from '../forecast-republish'

const mockPredictions = vi.mocked(prisma.prediction.findMany)
const mockCount = vi.mocked(countUsableEvidence)
const mockResolve = vi.mocked(resolvePooledEstimate)
const mockRecord = vi.mocked(recordEstimate)

const PRED = {
  id: 'p1',
  status: 'ACTIVE',
  claimText: 'Will X happen?',
  claimDirection: null,
  claimDeadline: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  claimArchetype: null,
  confidence: 66,
}

/** A successful whole-pool aggregate: stance 0.4 → 70%. */
function poolResolved(over: Record<string, unknown> = {}) {
  return {
    mean: 0.4,
    std: 0.2,
    ciLow: 0.1,
    ciHigh: 0.7,
    settled: false,
    articlesUsed: 12,
    snapshotSources: [{ url: 'https://a.com/1' }],
    estimateSource: 'pool' as const,
    insufficientData: false,
    reason: null,
    poolSize: 20,
    usableSize: 12,
    singleRunMean: 0,
    ...over,
  }
}

describe('republishForecasts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPredictions.mockResolvedValue([PRED] as never)
    mockCount.mockResolvedValue(12)
    mockResolve.mockResolvedValue(poolResolved() as never)
    mockRecord.mockResolvedValue({ id: 'snap-1' } as never)
  })

  it('writes NOTHING in dry-run — no estimate, no snapshot — while still reporting the would-be number', async () => {
    const r = await republishForecasts(['p1'], false)

    expect(mockRecord).not.toHaveBeenCalled()
    expect(r.mode).toBe('dry-run')
    expect(r.ok).toBe(1)
    expect(r.forecasts[0]).toMatchObject({
      predictionId: 'p1',
      status: 'ok',
      confidenceBefore: 66,
      confidenceAfter: 70,
      poolSize: 20,
      usableSize: 12,
    })
  })

  it('applies through recordEstimate under the republish origin, on the percent scale', async () => {
    const r = await republishForecasts(['p1'], true)

    expect(r.mode).toBe('apply')
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionId: 'p1',
        origin: 'republish',
        probability: 70,
        ciLow: 55,
        ciHigh: 85,
        oracleSnapshot: expect.objectContaining({
          mean: 70,
          ciLow: 55,
          ciHigh: 85,
          articlesUsed: 12,
          sources: [{ url: 'https://a.com/1' }],
        }),
      }),
    )
    expect(r.forecasts[0]).toMatchObject({ status: 'ok', confidenceAfter: 70 })
  })

  it('aggregates via resolvePooledEstimate with the forecast claim fields and a zero single-run sentinel', async () => {
    await republishForecasts(['p1'], false)

    expect(mockResolve).toHaveBeenCalledWith(
      'p1',
      { mean: 0, std: 0, ciLow: 0, ciHigh: 0, settled: false, articlesUsed: 0 },
      [],
      null,
      null,
      new Map(),
      PRED.createdAt,
      null,
      'Will X happen?',
    )
  })

  it('reports a re-publish that reproduces the published number as unchanged — and still writes it', async () => {
    // The write is deliberate: it re-anchors the temporal clock even when the number
    // is identical; recordEstimate marks it non-material so the glide clock is unmoved.
    mockResolve.mockResolvedValue(poolResolved({ mean: 0.32 }) as never) // → 66 = confidenceBefore

    const r = await republishForecasts(['p1'], true)

    expect(r.unchanged).toBe(1)
    expect(r.ok).toBe(0)
    expect(mockRecord).toHaveBeenCalledTimes(1)
    expect(r.forecasts[0]).toMatchObject({ status: 'unchanged', confidenceBefore: 66, confidenceAfter: 66 })
  })

  it('fails an unknown forecast id without aborting the rest of the batch', async () => {
    const r = await republishForecasts(['ghost', 'p1'], true)

    expect(r.failed).toBe(1)
    expect(r.ok).toBe(1)
    expect(r.forecasts[0]).toMatchObject({ predictionId: 'ghost', status: 'failed', reason: 'not_found' })
    expect(r.forecasts[1]).toMatchObject({ predictionId: 'p1', status: 'ok' })
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-ACTIVE forecast — a fresh estimate on a resolved forecast rewrites history', async () => {
    mockPredictions.mockResolvedValue([{ ...PRED, status: 'RESOLVED' }] as never)

    const r = await republishForecasts(['p1'], true)

    expect(r.forecasts[0]).toMatchObject({ status: 'failed', reason: 'not_active' })
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('skips a forecast with no usable pool rows before ever calling the Oracul', async () => {
    mockCount.mockResolvedValue(0)

    const r = await republishForecasts(['p1'], true)

    expect(r.forecasts[0]).toMatchObject({ status: 'failed', reason: 'empty_pool', usableSize: 0 })
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('never falls back to the sentinel single run when the pool cannot be read', async () => {
    // resolvePooledEstimate's single-run fallback is meaningless here — nothing was
    // searched or extracted — so an unreadable pool is a failure, not a zero-estimate.
    mockResolve.mockResolvedValue(
      poolResolved({ estimateSource: 'single-run', poolSize: null, usableSize: null }) as never,
    )

    const r = await republishForecasts(['p1'], true)

    expect(r.forecasts[0]).toMatchObject({ status: 'failed', reason: 'pool_unreadable' })
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('reports an insufficient (off-topic) pool with its own reason and writes nothing', async () => {
    mockResolve.mockResolvedValue(
      poolResolved({ estimateSource: 'pool-insufficient', insufficientData: true, reason: 'all_articles_off_topic' }) as never,
    )

    const r = await republishForecasts(['p1'], true)

    expect(r.forecasts[0]).toMatchObject({ status: 'failed', reason: 'all_articles_off_topic' })
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('survives a forecast whose write throws and keeps going', async () => {
    mockPredictions.mockResolvedValue([PRED, { ...PRED, id: 'p2', confidence: 40 }] as never)
    mockRecord.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ id: 'snap-2' } as never)

    const r = await republishForecasts(['p1', 'p2'], true)

    expect(r.failed).toBe(1)
    expect(r.ok).toBe(1)
    expect(r.forecasts[0]).toMatchObject({ predictionId: 'p1', status: 'failed', reason: 'error' })
    expect(r.forecasts[1]).toMatchObject({ predictionId: 'p2', status: 'ok' })
  })
})
