import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: { groupBy: vi.fn() },
    prediction: { findMany: vi.fn() },
    evidenceHealthAlert: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    panelPaymentFailure: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { checkEvidenceHealth, alertKey, PANEL_402_LOOKBACK_HOURS } from '@/lib/services/evidence-health'
import { USABLE_POOL_ROW_WHERE, isUsablePoolRow } from '@/lib/services/evidence-pool'
import type { EvidenceHealthIssue } from '@/lib/services/telegram'

const groupBy = vi.mocked(prisma.evidencePoolArticle.groupBy)
const findActive = vi.mocked(prisma.prediction.findMany)
const alerts = vi.mocked(prisma.evidenceHealthAlert)
const panel402 = vi.mocked(prisma.panelPaymentFailure.findMany)

/** total/failed per source → the `groupBy(['source','status'])` rows Prisma returns. */
type SourceFixture = Record<string, { total: number; failed: number }>

function windowRows(fixture: SourceFixture) {
  const rows: Array<{ source: string; status: string; _count: { _all: number } }> = []
  for (const [source, { total, failed }] of Object.entries(fixture)) {
    if (failed > 0) rows.push({ source, status: 'FAILED', _count: { _all: failed } })
    if (total - failed > 0) rows.push({ source, status: 'COMPLETE', _count: { _all: total - failed } })
  }
  return rows
}

/**
 * Dispatch on the query shape rather than call order: the two window queries and
 * the per-forecast coverage query all go through the same `groupBy` mock, and the
 * third is issued a microtask later than the first two.
 */
function stubPool(recent: SourceFixture, baseline: SourceFixture, covered: string[] = []) {
  groupBy.mockImplementation((async (args: {
    by: string[]
    where: { addedAt?: { lte?: Date } }
  }) => {
    if (args.by[0] === 'predictionId') {
      return covered.map((id) => ({ predictionId: id, _count: { _all: 1 } }))
    }
    // The baseline window is the one bounded on both sides.
    return windowRows(args.where.addedAt?.lte ? baseline : recent)
  }) as never)
}

/** A pool healthy enough that no overall check fires — 25% failed on both sides. */
const HEALTHY_BASELINE: SourceFixture = {
  'hnaftali.com': { total: 100, failed: 37 },
  'ynet.co.il': { total: 400, failed: 100 },
  'smalltown.example': { total: 20, failed: 5 },
  'jamestown.org': { total: 50, failed: 10 },
  'al-monitor.com': { total: 100, failed: 15 },
}

describe('checkEvidenceHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findActive.mockResolvedValue([] as never)
    alerts.findMany.mockResolvedValue([] as never)
    alerts.createMany.mockResolvedValue({ count: 1 } as never)
    alerts.deleteMany.mockResolvedValue({ count: 0 } as never)
    panel402.mockResolvedValue([] as never)
  })

  it('fires on a source whose failure rate departs from its own baseline, and only that source', async () => {
    stubPool(
      {
        'hnaftali.com': { total: 50, failed: 40 }, // 37% → 80%, both windows well-populated
        'ynet.co.il': { total: 400, failed: 100 }, // 25% → 25%, no move
        'al-monitor.com': { total: 10, failed: 10 }, // 100%, but only 10 recent rows
      },
      HEALTHY_BASELINE,
    )

    const { fired } = await checkEvidenceHealth()

    const rateAlerts = fired.filter((i) => i.kind === 'source_failure_rate')
    expect(rateAlerts).toEqual([
      { kind: 'source_failure_rate', source: 'hnaftali.com', recentPct: 80, baselinePct: 37, recentRows: 50 },
    ])
  })

  it('fires on a source that went silent while its siblings kept flowing', async () => {
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE)

    const { fired } = await checkEvidenceHealth()

    // jamestown.org (50 baseline rows) qualifies; smalltown.example (20) is below
    // the volume guard, so its silence is not evidence of anything.
    expect(fired.filter((i) => i.kind === 'source_silent')).toEqual([
      { kind: 'source_silent', source: 'hnaftali.com', baselineRows: 100 },
      { kind: 'source_silent', source: 'jamestown.org', baselineRows: 50 },
      { kind: 'source_silent', source: 'al-monitor.com', baselineRows: 100 },
    ])
  })

  it('reports one pipeline-wide alert instead of one per source when ingestion collapses', async () => {
    stubPool({ 'ynet.co.il': { total: 20, failed: 5 } }, HEALTHY_BASELINE)

    const { fired } = await checkEvidenceHealth()

    expect(fired).toEqual([
      { kind: 'overall_volume_collapse', recentPerDay: 3, baselinePerDay: 24 },
    ])
    expect(fired.some((i) => i.kind === 'source_silent')).toBe(false)
  })

  it('fires when the overall failed share worsens, but not when it improves', async () => {
    const worse: SourceFixture = { 'ynet.co.il': { total: 400, failed: 200 } } // 25% → 50%
    stubPool(worse, HEALTHY_BASELINE)
    const degraded = await checkEvidenceHealth()
    expect(degraded.fired).toContainEqual({ kind: 'overall_failure_rate', recentPct: 50, baselinePct: 25 })

    vi.clearAllMocks()
    findActive.mockResolvedValue([] as never)
    alerts.findMany.mockResolvedValue([] as never)
    alerts.createMany.mockResolvedValue({ count: 1 } as never)
    panel402.mockResolvedValue([] as never)
    stubPool({ 'ynet.co.il': { total: 400, failed: 20 } }, HEALTHY_BASELINE) // 25% → 5%
    const improved = await checkEvidenceHealth()
    expect(improved.fired.some((i) => i.kind === 'overall_failure_rate')).toBe(false)
  })

  it('fires per ACTIVE forecast whose pool holds nothing aggregation can read', async () => {
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE, ['p-has-evidence'])
    findActive.mockResolvedValue([
      { id: 'p-has-evidence', claimText: 'covered', slug: 'covered' },
      { id: 'p-empty', claimText: 'Israel strikes Iran by October', slug: 'israel-iran' },
    ] as never)

    const { fired } = await checkEvidenceHealth()

    expect(fired).toContainEqual({
      kind: 'forecast_no_evidence',
      predictionId: 'p-empty',
      claimText: 'Israel strikes Iran by October',
      slug: 'israel-iran',
    })
    // The alert asks the same question the aggregate does — a half-extracted row
    // (COMPLETE but missing certainty, credibility or relevance) is not evidence and
    // must not mask an empty pool. Pinned to the shared filter rather than restated
    // here, so the two cannot drift apart again (daatan#1475).
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['predictionId'],
        where: expect.objectContaining({ ...USABLE_POOL_ROW_WHERE }),
      }),
    )
  })

  it('counts a forecast as empty when its only rows are half-extracted', async () => {
    // The regression this collapse fixes: the old alert asked for a stance and nothing
    // else, so a pool of stance-only rows read as covered while the aggregate saw none.
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE, [])
    findActive.mockResolvedValue([{ id: 'p-half', claimText: 'half extracted', slug: 'half' }] as never)

    const { fired } = await checkEvidenceHealth()

    expect(fired).toContainEqual({
      kind: 'forecast_no_evidence',
      predictionId: 'p-half',
      claimText: 'half extracted',
      slug: 'half',
    })
    expect(isUsablePoolRow({
      excluded: false, status: 'COMPLETE', stance: 0.4,
      certainty: null, credibilityWeight: 1, relevanceScore: 0.6,
    })).toBe(false)
  })

  it('does not re-fire a condition already alerted on, and counts it as suppressed', async () => {
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE)
    alerts.findMany.mockResolvedValue([
      { key: 'source-silent:jamestown.org' },
      { key: 'source-silent:al-monitor.com' },
      { key: 'source-silent:hnaftali.com' },
    ] as never)

    const { fired, suppressed } = await checkEvidenceHealth()

    expect(fired).toEqual([])
    expect(suppressed).toBe(3)
    expect(alerts.createMany).not.toHaveBeenCalled()
  })

  it('releases the keys whose condition cleared, so the next occurrence pages again', async () => {
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE)
    alerts.findMany.mockResolvedValue([
      { key: 'source-silent:jamestown.org' }, // still silent
      { key: 'source-silent:bbc.co.uk' }, // recovered — no longer in the active set
      { key: 'overall-failure' },
    ] as never)

    await checkEvidenceHealth()

    expect(alerts.deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['source-silent:bbc.co.uk', 'overall-failure'] } },
    })
  })

  it('only counts a claim as fired when this run actually won the insert', async () => {
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE)
    // A concurrent run inserted the row between our read and our write.
    alerts.createMany.mockResolvedValue({ count: 0 } as never)

    const { fired, suppressed } = await checkEvidenceHealth()

    expect(fired).toEqual([])
    expect(suppressed).toBe(3)
  })

  it('fires one panel-payment alert on a recorded 402 burst, summing rows across the day boundary', async () => {
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE)
    const lastSeen = new Date('2026-08-19T05:12:00Z')
    panel402.mockResolvedValue([
      { day: '2026-08-18', count: 3, lastSeenAt: new Date('2026-08-18T23:58:00Z'), lastModel: 'x-ai/grok-4' },
      { day: '2026-08-19', count: 572, lastSeenAt: lastSeen, lastModel: 'qwen/qwen3-235b-a22b-2507' },
    ] as never)

    const { fired } = await checkEvidenceHealth(new Date('2026-08-19T06:00:00Z'))

    expect(fired.filter((i) => i.kind === 'panel_payment_failure')).toEqual([
      {
        kind: 'panel_payment_failure',
        count: 575,
        lastSeenAt: lastSeen,
        lastModel: 'qwen/qwen3-235b-a22b-2507',
      },
    ])
  })

  it('looks back one digest cadence plus slack, so an aged-out burst cannot re-fire', async () => {
    stubPool({ 'ynet.co.il': { total: 400, failed: 100 } }, HEALTHY_BASELINE)
    const now = new Date('2026-08-20T05:00:00Z')

    const { fired } = await checkEvidenceHealth(now)

    expect(fired.some((i) => i.kind === 'panel_payment_failure')).toBe(false)
    expect(panel402).toHaveBeenCalledWith({
      where: {
        lastSeenAt: { gt: new Date(now.getTime() - PANEL_402_LOOKBACK_HOURS * 60 * 60 * 1000) },
      },
    })
  })

  it('suppresses an ongoing 402 burst already alerted on, and releases the key once it clears', async () => {
    // Recent mirrors the baseline exactly, so the ONLY active condition is the burst.
    stubPool(HEALTHY_BASELINE, HEALTHY_BASELINE)
    alerts.findMany.mockResolvedValue([{ key: 'panel-payment' }] as never)
    panel402.mockResolvedValue([
      { day: '2026-08-19', count: 572, lastSeenAt: new Date(), lastModel: 'qwen/qwen3-235b-a22b-2507' },
    ] as never)

    const ongoing = await checkEvidenceHealth()
    expect(ongoing.fired.some((i) => i.kind === 'panel_payment_failure')).toBe(false)
    expect(ongoing.suppressed).toBe(1)
    expect(alerts.deleteMany).not.toHaveBeenCalled()

    // Burst aged out of the window: the key is released, arming the next exhaustion.
    panel402.mockResolvedValue([] as never)
    const cleared = await checkEvidenceHealth()
    expect(cleared.suppressed).toBe(0)
    expect(alerts.deleteMany).toHaveBeenCalledWith({ where: { key: { in: ['panel-payment'] } } })
  })

  it('propagates a query failure instead of reporting a clean pipeline', async () => {
    groupBy.mockRejectedValue(new Error('connection terminated') as never)

    await expect(checkEvidenceHealth()).rejects.toThrow('connection terminated')
    expect(alerts.deleteMany).not.toHaveBeenCalled()
  })
})

describe('alertKey', () => {
  it('keys each condition by its subject, so unrelated conditions never share state', () => {
    const cases: Array<[EvidenceHealthIssue, string]> = [
      [{ kind: 'source_silent', source: 'bbc.co.uk', baselineRows: 42 }, 'source-silent:bbc.co.uk'],
      [
        { kind: 'source_failure_rate', source: 'bbc.co.uk', recentPct: 80, baselinePct: 20, recentRows: 30 },
        'source-failure:bbc.co.uk',
      ],
      [
        { kind: 'forecast_no_evidence', predictionId: 'cml6ukq9u', claimText: 'x', slug: null },
        'forecast-empty:cml6ukq9u',
      ],
      [{ kind: 'overall_failure_rate', recentPct: 60, baselinePct: 40 }, 'overall-failure'],
      [{ kind: 'overall_volume_collapse', recentPerDay: 3, baselinePerDay: 40 }, 'overall-volume'],
      [
        { kind: 'panel_payment_failure', count: 572, lastSeenAt: new Date(), lastModel: 'qwen/qwen3' },
        'panel-payment',
      ],
    ]
    for (const [issue, key] of cases) expect(alertKey(issue)).toBe(key)
  })

  it('bounds the key so a long source name cannot overflow the column', () => {
    const key = alertKey({ kind: 'source_silent', source: 'x'.repeat(400), baselineRows: 40 })
    expect(key.length).toBeLessThanOrEqual(200)
  })
})
