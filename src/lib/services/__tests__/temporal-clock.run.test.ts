import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/services/context', () => ({
  saveClockSnapshot: vi.fn(),
  getLatestEvidenceEstimate: vi.fn(),
}))

vi.mock('@/lib/services/temporal-classifier', () => ({
  classifyAndStoreTemporal: vi.fn(),
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyDeadlinePassedQuietly: vi.fn(),
  notifyPendingPastDeadline: vi.fn(),
  notifyProvisionalImpossibility: vi.fn(),
  notifyDeadlineDivergence: vi.fn(),
  notifyRequoteSummary: vi.fn(),
  notifyHighConfidence: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { saveClockSnapshot, getLatestEvidenceEstimate } from '@/lib/services/context'
import { classifyAndStoreTemporal } from '@/lib/services/temporal-classifier'
import {
  notifyDeadlinePassedQuietly,
  notifyPendingPastDeadline,
  notifyProvisionalImpossibility,
  notifyDeadlineDivergence,
  notifyRequoteSummary,
  notifyHighConfidence,
} from '@/lib/services/telegram'
import { runRequote } from '@/lib/services/temporal-clock'

const findMany = vi.mocked(prisma.prediction.findMany)
const update = vi.mocked(prisma.prediction.update)
const saveClock = vi.mocked(saveClockSnapshot)
const getAnchor = vi.mocked(getLatestEvidenceEstimate)
const classify = vi.mocked(classifyAndStoreTemporal)
const deadlineAlert = vi.mocked(notifyDeadlinePassedQuietly)
const pendingAlert = vi.mocked(notifyPendingPastDeadline)
const provisionalAlert = vi.mocked(notifyProvisionalImpossibility)
const divergenceAlert = vi.mocked(notifyDeadlineDivergence)
const summaryAlert = vi.mocked(notifyRequoteSummary)
const highConfidenceAlert = vi.mocked(notifyHighConfidence)

const NOW = new Date('2026-06-01T06:00:00.000Z')

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'pred-1',
  slug: 'pred-1-slug',
  claimText: 'X will happen by end of June',
  confidence: 65,
  aiCiLow: 55,
  aiCiHigh: 75,
  claimDeadline: new Date('2026-06-30T23:59:59.999Z'),
  claimDirection: 'ARRIVAL',
  tauLeadDays: 0,
  resolveByDatetime: new Date('2026-06-30T23:59:59.999Z'),
  deadlinePassedAlertAt: null,
  teffProvisionalAlertAt: null,
  divergenceAlertAt: null,
  ...overrides,
})

describe('runRequote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findMany.mockResolvedValue([] as never) // base default — the #1185 sweep query in tests that don't queue it
    update.mockResolvedValue({} as never)
    saveClock.mockResolvedValue(undefined)
    classify.mockResolvedValue(null)
  })

  it('no-ops the glide machinery on an empty archetype allowlist — only the #1185 sweep runs', async () => {
    const summary = await runRequote({ archetypes: [], now: NOW })
    expect(summary.examined).toBe(0)
    expect(findMany).toHaveBeenCalledTimes(1) // the sweep query, nothing else
    expect(classify).not.toHaveBeenCalled()
    expect(getAnchor).not.toHaveBeenCalled()
    expect(saveClock).not.toHaveBeenCalled()
  })

  it('anchors on the latest evidence estimate, never on Prediction.confidence directly', async () => {
    findMany.mockResolvedValueOnce([]) // self-heal pass
    findMany.mockResolvedValueOnce([row({ confidence: 999 })] as never) // candidate pass — deliberately wrong if used
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-06-01T00:00:00.000Z'), evidenceAt: null })

    await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(getAnchor).toHaveBeenCalledWith('pred-1')
    // The write must be derived from the anchor (65), not from confidence=999.
    const call = saveClock.mock.calls[0]?.[0]
    expect(call?.probability).not.toBe(999)
  })

  it('skips a candidate with no anchor, without writing', async () => {
    findMany.mockResolvedValueOnce([])
    findMany.mockResolvedValueOnce([row()] as never)
    getAnchor.mockResolvedValue(null)

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.skippedNoAnchor).toBe(1)
    expect(saveClock).not.toHaveBeenCalled()
  })

  it('skips a write when the move is below MATERIAL_CHANGE_PTS', async () => {
    findMany.mockResolvedValueOnce([])
    // t_last very close to `now` so c stays close to 1 → p stays ~= 65.
    findMany.mockResolvedValueOnce([row({ confidence: 65 })] as never)
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date(NOW.getTime() - 1000), evidenceAt: null })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.unchanged).toBe(1)
    expect(saveClock).not.toHaveBeenCalled()
  })

  // daatan#1265 — publish-time precedence (system-model §6.2) puts the impossibility pin
  // ABOVE abstention: it is priced from question metadata alone and needs no articles, so
  // "we have no evidence" must not withhold "this can no longer happen".
  it('writes the impossibility pin onto an ABSTAINED forecast, whose null confidence used to zero the delta', async () => {
    findMany.mockResolvedValueOnce([])
    // Abstained row (confidence null) whose deadline has already passed → cause 'pin'.
    findMany.mockResolvedValueOnce([row({
      confidence: null,
      claimDeadline: new Date('2026-05-01T00:00:00.000Z'),
      resolveByDatetime: new Date('2026-05-01T00:00:00.000Z'),
    })] as never)
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-04-01T00:00:00.000Z'), evidenceAt: null })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    // Before the fix: prevConfidence fell back to result.p, delta was exactly 0, and the
    // row was counted `unchanged` with no write at all.
    expect(summary.unchanged).toBe(0)
    expect(saveClock).toHaveBeenCalledTimes(1)
    // An ARRIVAL claim past its deadline pins to the floor — it can no longer happen.
    expect(saveClock.mock.calls[0][0].probability).toBe(3)
  })

  it('still counts an immaterial GLIDE on a null-confidence row as unchanged — the pin carve-out is not a blanket bypass', async () => {
    findMany.mockResolvedValueOnce([])
    // Deadline still in the future → cause 'glide', not a pin.
    findMany.mockResolvedValueOnce([row({ confidence: null })] as never)
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date(NOW.getTime() - 1000), evidenceAt: null })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.unchanged).toBe(1)
    expect(saveClock).not.toHaveBeenCalled()
  })

  it('writes a clock snapshot via saveClockSnapshot for a material move, and NEVER calls notifyHighConfidence even when the value crosses 80', async () => {
    findMany.mockResolvedValueOnce([])
    findMany.mockResolvedValueOnce([row({ confidence: 30, claimDirection: 'SURVIVAL' })] as never)
    // Survival glides UP — anchored far in the past so c is near 0, pushing well past 80.
    getAnchor.mockResolvedValue({ externalProbability: 30, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null })

    await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(saveClock).toHaveBeenCalledTimes(1)
    const call = saveClock.mock.calls[0][0]
    expect(call.predictionId).toBe('pred-1')
    expect(call.probability).toBeGreaterThan(80)
    expect(highConfidenceAlert).not.toHaveBeenCalled()
  })

  it('fires the literal-deadline-passed alert once, then dedupes on the second run', async () => {
    const deadline = new Date('2026-05-01T00:00:00.000Z') // already passed relative to NOW
    findMany.mockResolvedValue([]) // self-heal, both runs
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row({ claimDeadline: deadline })] as never)
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-04-01T00:00:00.000Z'), evidenceAt: null })

    const first = await runRequote({ archetypes: ['diffuse'], now: NOW })
    expect(first.deadlineAlerts).toBe(1)
    expect(deadlineAlert).toHaveBeenCalledTimes(1)

    // Second run: the row now reports the stamped alert timestamp.
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      row({ claimDeadline: deadline, deadlinePassedAlertAt: NOW }),
    ] as never)
    const second = await runRequote({ archetypes: ['diffuse'], now: new Date(NOW.getTime() + 3600_000) })
    expect(second.deadlineAlerts).toBe(0)
    expect(deadlineAlert).toHaveBeenCalledTimes(1) // still just once total
  })

  it('fires a provisional-impossibility alert distinct from the deadline-passed alert', async () => {
    // tau_lead pushes T_eff before now, but the literal deadline is still ahead.
    const deadline = new Date('2026-07-01T00:00:00.000Z')
    findMany.mockResolvedValueOnce([])
    findMany.mockResolvedValueOnce([
      row({ claimDeadline: deadline, resolveByDatetime: deadline, tauLeadDays: 45 }),
    ] as never)
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.provisionalAlerts).toBe(1)
    expect(provisionalAlert).toHaveBeenCalledTimes(1)
    expect(deadlineAlert).not.toHaveBeenCalled() // literal deadline hasn't passed
  })

  it('fires a divergence alert when claimDeadline and resolveByDatetime disagree', async () => {
    findMany.mockResolvedValueOnce([])
    findMany.mockResolvedValueOnce([
      row({
        claimDeadline: new Date('2026-06-30T00:00:00.000Z'),
        resolveByDatetime: new Date('2026-07-15T00:00:00.000Z'),
      }),
    ] as never)
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-05-01T00:00:00.000Z'), evidenceAt: null })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.divergenceAlerts).toBe(1)
    expect(divergenceAlert).toHaveBeenCalledTimes(1)
  })

  it('dryRun computes but writes nothing and sends no alerts', async () => {
    const deadline = new Date('2026-05-01T00:00:00.000Z')
    findMany.mockResolvedValueOnce([row({ claimDeadline: deadline })] as never)
    getAnchor.mockResolvedValue({ externalProbability: 30, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW, dryRun: true })

    expect(summary.examined).toBe(1)
    expect(saveClock).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(classify).not.toHaveBeenCalled()
    expect(deadlineAlert).not.toHaveBeenCalled()
    expect(summaryAlert).not.toHaveBeenCalled()
  })

  it('self-heals unclassified ACTIVE forecasts, bounded per run', async () => {
    const unclassified = Array.from({ length: 8 }, (_, i) => ({
      id: `unc-${i}`,
      claimText: 'X',
      resolveByDatetime: new Date('2027-01-01'),
      outcomeType: 'BINARY',
    }))
    findMany.mockResolvedValueOnce(unclassified as never) // self-heal candidates
    findMany.mockResolvedValueOnce([]) // requote candidates
    classify.mockResolvedValue(null)

    await runRequote({ archetypes: ['diffuse'], now: NOW })

    // findMany itself is called with take: <= 5 for the self-heal query —
    // verify the bound was requested rather than classifying all 8.
    const selfHealCall = findMany.mock.calls[0][0] as { take?: number }
    expect(selfHealCall.take).toBeLessThanOrEqual(5)
  })

  it('does not self-heal in dryRun mode', async () => {
    findMany.mockResolvedValueOnce([])
    await runRequote({ archetypes: ['diffuse'], now: NOW, dryRun: true })
    expect(classify).not.toHaveBeenCalled()
  })

  it('sends a fleet summary digest only when something moved, and never in dryRun', async () => {
    findMany.mockResolvedValueOnce([])
    findMany.mockResolvedValueOnce([row({ confidence: 30, claimDirection: 'SURVIVAL' })] as never)
    getAnchor.mockResolvedValue({ externalProbability: 30, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null })

    await runRequote({ archetypes: ['diffuse'], now: NOW })
    expect(summaryAlert).toHaveBeenCalledTimes(1)
  })

  describe('stuck-PENDING sweep (#1185)', () => {
    const stuck = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'pred-stuck',
      slug: 'stuck-slug',
      claimText: 'Y will happen by May 29',
      claimDeadline: new Date('2026-05-29T00:00:00.000Z'),
      ...overrides,
    })

    it('alerts on the clean channel and stamps deadlinePassedAlertAt', async () => {
      findMany.mockResolvedValueOnce([stuck()] as never)

      const summary = await runRequote({ archetypes: [], now: NOW })

      expect(pendingAlert).toHaveBeenCalledWith(
        { id: 'pred-stuck', claimText: 'Y will happen by May 29', slug: 'stuck-slug' },
        new Date('2026-05-29T00:00:00.000Z'),
      )
      expect(update).toHaveBeenCalledWith({
        where: { id: 'pred-stuck' },
        data: { deadlinePassedAlertAt: NOW },
      })
      expect(summary.pendingDeadlineAlerts).toBe(1)
    })

    it('queries only never-alerted PENDING preds past the 12h grace window', async () => {
      await runRequote({ archetypes: [], now: NOW })

      const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
      expect(where).toMatchObject({
        status: 'PENDING',
        resolvedAt: null,
        deadlinePassedAlertAt: null,
        claimDeadline: { lt: new Date(NOW.getTime() - 12 * 3600_000) },
      })
    })

    it('is skipped entirely in dryRun', async () => {
      await runRequote({ archetypes: [], now: NOW, dryRun: true })
      expect(findMany).not.toHaveBeenCalled()
      expect(pendingAlert).not.toHaveBeenCalled()
    })

    it('a failed stamp counts as an error without aborting the rest of the sweep', async () => {
      findMany.mockResolvedValueOnce([stuck(), stuck({ id: 'pred-stuck-2' })] as never)
      update.mockRejectedValueOnce(new Error('db down'))

      const summary = await runRequote({ archetypes: [], now: NOW })

      expect(pendingAlert).toHaveBeenCalledTimes(2)
      expect(summary.pendingDeadlineAlerts).toBe(1)
      expect(summary.errors).toBe(1)
    })

    it('runs after a normal glide pass too, not only on an empty allowlist', async () => {
      findMany.mockResolvedValueOnce([]) // self-heal
      findMany.mockResolvedValueOnce([]) // glide candidates
      findMany.mockResolvedValueOnce([stuck()] as never) // sweep

      const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

      expect(pendingAlert).toHaveBeenCalledTimes(1)
      expect(summary.pendingDeadlineAlerts).toBe(1)
    })
  })
})
