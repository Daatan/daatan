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
  getSettlementPinProbability: vi.fn(),
  latestEvidenceAssertsSettlement: vi.fn(),
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
  notifySettledDrift: vi.fn(),
  notifyUnlatchedPin: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import {
  saveClockSnapshot,
  getLatestEvidenceEstimate,
  getSettlementPinProbability,
  latestEvidenceAssertsSettlement,
} from '@/lib/services/context'
import { classifyAndStoreTemporal } from '@/lib/services/temporal-classifier'
import {
  notifyDeadlinePassedQuietly,
  notifyPendingPastDeadline,
  notifyProvisionalImpossibility,
  notifyDeadlineDivergence,
  notifyRequoteSummary,
  notifyHighConfidence,
  notifySettledDrift,
  notifyUnlatchedPin,
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
const settledDriftAlert = vi.mocked(notifySettledDrift)
const getPin = vi.mocked(getSettlementPinProbability)
const unlatchedPinAlert = vi.mocked(notifyUnlatchedPin)
const assertsSettlement = vi.mocked(latestEvidenceAssertsSettlement)

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
    getPin.mockResolvedValue(null)
    assertsSettlement.mockResolvedValue(null)
  })

  it('no-ops the glide machinery on an empty archetype allowlist — only the sweeps run', async () => {
    const summary = await runRequote({ archetypes: [], now: NOW })
    expect(summary.examined).toBe(0)
    expect(findMany).toHaveBeenCalledTimes(3) // #1185 stuck-PENDING + #1490 settled-drift + #1498 unlatched-pin, nothing else
    expect(classify).not.toHaveBeenCalled()
    expect(getAnchor).not.toHaveBeenCalled()
    expect(saveClock).not.toHaveBeenCalled()
  })

  it('anchors on the latest evidence estimate, never on Prediction.confidence directly', async () => {
    findMany.mockResolvedValueOnce([]) // self-heal pass
    findMany.mockResolvedValueOnce([row({ confidence: 999 })] as never) // candidate pass — deliberately wrong if used
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-06-01T00:00:00.000Z'), evidenceAt: null , ciLow: 50, ciHigh: 80, settled: false })

    await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(getAnchor).toHaveBeenCalledWith('pred-1')
    // The write must be derived from the anchor (65), not from confidence=999.
    const call = saveClock.mock.calls[0]?.[0]
    expect(call?.probability).not.toBe(999)
  })

  it('glides the band from the anchor CI, never from the stored row band (daatan#1489)', async () => {
    findMany.mockResolvedValueOnce([]) // self-heal pass
    // The row carries the collapsed band the old code would have re-glided (and compounded).
    findMany.mockResolvedValueOnce([row({ confidence: 53, aiCiLow: 0, aiCiHigh: 0 })] as never)
    getAnchor.mockResolvedValue({
      externalProbability: 53,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      evidenceAt: null,
      settled: false,
      ciLow: 12,
      ciHigh: 93,
    })

    await runRequote({ archetypes: ['diffuse'], now: NOW })

    const call = saveClock.mock.calls[0]?.[0]
    expect(call).toBeDefined()
    expect(call!.aiCiHigh).toBeGreaterThan(0) // the row's [0, 0] must not survive
    expect(call!.aiCiLow!).toBeLessThanOrEqual(call!.probability)
    expect(call!.aiCiHigh!).toBeGreaterThanOrEqual(call!.probability)
  })

  it('re-anchors a corrupted band even when the point has not moved (daatan#1489 self-heal)', async () => {
    findMany.mockResolvedValueOnce([]) // self-heal pass
    // Point stable (so the material-change gate would normally skip) but sitting
    // outside its own stored band — the exact pre-fix prod state.
    findMany.mockResolvedValueOnce([row({ confidence: 65, aiCiLow: 10, aiCiHigh: 20 })] as never)
    getAnchor.mockResolvedValue({
      externalProbability: 65,
      createdAt: new Date(NOW.getTime() - 1000),
      evidenceAt: null,
      settled: false,
      ciLow: 50,
      ciHigh: 80,
    })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.unchanged).toBe(0)
    const call = saveClock.mock.calls[0]?.[0]
    expect(call).toBeDefined()
    expect(call!.aiCiLow!).toBeLessThanOrEqual(call!.probability)
    expect(call!.aiCiHigh!).toBeGreaterThanOrEqual(call!.probability)
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
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date(NOW.getTime() - 1000), evidenceAt: null , ciLow: 50, ciHigh: 80, settled: false })

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
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-04-01T00:00:00.000Z'), evidenceAt: null , ciLow: 50, ciHigh: 80, settled: false })

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
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date(NOW.getTime() - 1000), evidenceAt: null , ciLow: 50, ciHigh: 80, settled: false })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.unchanged).toBe(1)
    expect(saveClock).not.toHaveBeenCalled()
  })

  it('writes a clock snapshot via saveClockSnapshot for a material move, and NEVER calls notifyHighConfidence even when the value crosses 80', async () => {
    findMany.mockResolvedValueOnce([])
    findMany.mockResolvedValueOnce([row({ confidence: 30, claimDirection: 'SURVIVAL' })] as never)
    // Survival glides UP — anchored far in the past so c is near 0, pushing well past 80.
    getAnchor.mockResolvedValue({ externalProbability: 30, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null , ciLow: 15, ciHigh: 45, settled: false })

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
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-04-01T00:00:00.000Z'), evidenceAt: null , ciLow: 50, ciHigh: 80, settled: false })

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
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null , ciLow: 50, ciHigh: 80, settled: false })

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
    getAnchor.mockResolvedValue({ externalProbability: 65, createdAt: new Date('2026-05-01T00:00:00.000Z'), evidenceAt: null , ciLow: 50, ciHigh: 80, settled: false })

    const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

    expect(summary.divergenceAlerts).toBe(1)
    expect(divergenceAlert).toHaveBeenCalledTimes(1)
  })

  it('dryRun computes but writes nothing and sends no alerts', async () => {
    const deadline = new Date('2026-05-01T00:00:00.000Z')
    findMany.mockResolvedValueOnce([row({ claimDeadline: deadline })] as never)
    getAnchor.mockResolvedValue({ externalProbability: 30, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null , ciLow: 15, ciHigh: 45, settled: false })

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
    getAnchor.mockResolvedValue({ externalProbability: 30, createdAt: new Date('2026-01-01T00:00:00.000Z'), evidenceAt: null , ciLow: 15, ciHigh: 45, settled: false })

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
  // daatan#1498: `CANDIDATE_WHERE { settled: false }` is supposed to keep the clock off a
  // settled forecast, but that only holds while a settlement-asserting write actually
  // latches Prediction.settled. In prod, 771 snapshots across 19 ACTIVE forecasts assert
  // settlement with the latch unset — those fall into the candidate set and the glide then
  // anchors on the pin and decays it. The guard re-applies the same rule to the anchor.
  describe('anchor asserts settlement while the latch is false', () => {
    const settledAnchor = (overrides: Record<string, unknown> = {}) => ({
      externalProbability: 97,
      createdAt: new Date('2026-05-15T22:24:00.000Z'),
      evidenceAt: null,
      ciLow: 91,
      ciHigh: 99,
      settled: true,
      ...overrides,
    })

    it('declines to glide it, and counts the violation', async () => {
      findMany.mockResolvedValueOnce([]) // self-heal pass
      findMany.mockResolvedValueOnce([row()] as never) // candidate pass
      getAnchor.mockResolvedValue(settledAnchor())

      const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

      expect(saveClock).not.toHaveBeenCalled()
      expect(summary.skippedUnlatchedPin).toBe(1)
      expect(summary.glided).toBe(0)
      expect(summary.unchanged).toBe(0)
    })

    it('still fires the literal-deadline alert — only the glide is withheld', async () => {
      const past = new Date('2026-05-01T00:00:00.000Z')
      findMany.mockResolvedValueOnce([])
      findMany.mockResolvedValueOnce([row({ claimDeadline: past, resolveByDatetime: past })] as never)
      getAnchor.mockResolvedValue(settledAnchor())

      const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

      expect(deadlineAlert).toHaveBeenCalledTimes(1)
      expect(summary.deadlineAlerts).toBe(1)
      expect(summary.skippedUnlatchedPin).toBe(1)
      expect(saveClock).not.toHaveBeenCalled()
    })

    it('reports the run even though nothing moved — silence is how this went unnoticed', async () => {
      findMany.mockResolvedValueOnce([])
      findMany.mockResolvedValueOnce([row()] as never)
      getAnchor.mockResolvedValue(settledAnchor())

      await runRequote({ archetypes: ['diffuse'], now: NOW })

      expect(summaryAlert).toHaveBeenCalledTimes(1)
      expect(summaryAlert).toHaveBeenCalledWith(expect.objectContaining({ glided: 0, unlatchedPins: 1 }))
    })

    it('leaves an ordinary anchor alone — the guard keys on the assertion, not on being a candidate', async () => {
      findMany.mockResolvedValueOnce([])
      findMany.mockResolvedValueOnce([row()] as never)
      getAnchor.mockResolvedValue(settledAnchor({ externalProbability: 65, settled: false }))

      const summary = await runRequote({ archetypes: ['diffuse'], now: NOW })

      expect(summary.skippedUnlatchedPin).toBe(0)
      expect(saveClock).toHaveBeenCalledTimes(1)
      expect(summary.glided).toBe(1)
    })
  })
  // daatan#1490. Driven through the empty-allowlist path: the glide is irrelevant here
  // and that path runs exactly two findMany queries — the #1185 stuck-PENDING sweep,
  // then this one — so the second mock is unambiguously the settled-drift population.
  describe('settled forecasts that have drifted off their pin', () => {
    const latched = (overrides: Record<string, unknown> = {}) => ({
      id: 'pred-settled-1',
      slug: 'settled-slug',
      claimText: 'The treaty has been signed',
      confidence: 65,
      settledDriftAlertAt: null,
      ...overrides,
    })

    const runSweep = async (rows: unknown[]) => {
      findMany.mockResolvedValueOnce([]) // #1185 stuck-PENDING sweep
      findMany.mockResolvedValueOnce(rows as never) // settled-drift sweep
      return runRequote({ archetypes: [], now: NOW })
    }

    it('queues it for re-verification and pages once', async () => {
      getPin.mockResolvedValue(97)

      const summary = await runSweep([latched()])

      expect(update).toHaveBeenCalledWith({
        where: { id: 'pred-settled-1' },
        data: { awaitingAiResolution: true, settledDriftAlertAt: NOW },
      })
      expect(settledDriftAlert).toHaveBeenCalledTimes(1)
      expect(settledDriftAlert).toHaveBeenCalledWith(expect.objectContaining({ id: 'pred-settled-1' }), 97, 65)
      expect(summary.settledDriftAlerts).toBe(1)
    })

    it('leaves a drift under the threshold alone — 97 next to 92 still tells one story', async () => {
      getPin.mockResolvedValue(97)

      const summary = await runSweep([latched({ confidence: 92 })])

      expect(update).not.toHaveBeenCalled()
      expect(settledDriftAlert).not.toHaveBeenCalled()
      expect(summary.settledDriftAlerts).toBe(0)
    })

    it('does not re-page while the same gap is still open', async () => {
      getPin.mockResolvedValue(97)

      const summary = await runSweep([latched({ settledDriftAlertAt: new Date('2026-05-30T00:00:00.000Z') })])

      expect(settledDriftAlert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(summary.settledDriftAlerts).toBe(0)
    })

    it('re-arms once the gap closes, so a later re-crossing pages again', async () => {
      getPin.mockResolvedValue(97)

      await runSweep([latched({ confidence: 95, settledDriftAlertAt: new Date('2026-05-30T00:00:00.000Z') })])

      expect(update).toHaveBeenCalledWith({
        where: { id: 'pred-settled-1' },
        data: { settledDriftAlertAt: null },
      })
      expect(settledDriftAlert).not.toHaveBeenCalled()
    })

    it('skips a forecast whose pin was never recorded in a snapshot', async () => {
      getPin.mockResolvedValue(null)

      const summary = await runSweep([latched({ confidence: 20 })])

      expect(update).not.toHaveBeenCalled()
      expect(settledDriftAlert).not.toHaveBeenCalled()
      expect(summary.settledDriftAlerts).toBe(0)
    })

    it('counts a failed write as an error instead of aborting the sweep', async () => {
      getPin.mockResolvedValue(97)
      update.mockRejectedValueOnce(new Error('db down'))

      const summary = await runSweep([latched(), latched({ id: 'pred-settled-2' })])

      expect(summary.errors).toBe(1)
      expect(summary.settledDriftAlerts).toBe(1)
    })
  })

  describe('settlement asserted while the latch is unset (#1498)', () => {
    const unlatched = (overrides: Record<string, unknown> = {}) => ({
      id: 'pred-unlatched-1',
      slug: 'unlatched-slug',
      claimText: 'The two sides will sign a formal agreement',
      unlatchedPinAlertAt: null,
      ...overrides,
    })

    const ASSERTED_AT = new Date('2026-05-31T22:24:00.000Z')

    const runSweep = async (rows: unknown[]) => {
      findMany.mockResolvedValueOnce([]) // #1185 stuck-PENDING sweep
      findMany.mockResolvedValueOnce([]) // #1490 settled-drift sweep
      findMany.mockResolvedValueOnce(rows as never) // #1498 unlatched-pin sweep
      return runRequote({ archetypes: [], now: NOW })
    }

    it('flags it back into Awaiting Resolution and pages once', async () => {
      assertsSettlement.mockResolvedValue({ assertedAt: ASSERTED_AT, probability: 97 })

      const summary = await runSweep([unlatched()])

      expect(update).toHaveBeenCalledWith({
        where: { id: 'pred-unlatched-1' },
        data: { awaitingAiResolution: true, unlatchedPinAlertAt: NOW },
      })
      expect(unlatchedPinAlert).toHaveBeenCalledTimes(1)
      expect(unlatchedPinAlert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pred-unlatched-1' }),
        97,
        ASSERTED_AT,
      )
      expect(summary.unlatchedPinAlerts).toBe(1)
    })

    it('never sets the latch itself — the assertion is usually the false positive', async () => {
      assertsSettlement.mockResolvedValue({ assertedAt: ASSERTED_AT, probability: 97 })

      await runSweep([unlatched()])

      const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data
      expect(data).not.toHaveProperty('settled')
      expect(data).not.toHaveProperty('settledAt')
    })

    it('ignores a forecast whose latest evidence has moved on', async () => {
      // An older snapshot asserted settlement — that is what the findMany `some` filter
      // matches — but the newest one does not, so the pin is no longer what we publish.
      assertsSettlement.mockResolvedValue(null)

      const summary = await runSweep([unlatched()])

      expect(update).not.toHaveBeenCalled()
      expect(unlatchedPinAlert).not.toHaveBeenCalled()
      expect(summary.unlatchedPinAlerts).toBe(0)
    })

    it('does not re-page while the same assertion is still standing', async () => {
      assertsSettlement.mockResolvedValue({ assertedAt: ASSERTED_AT, probability: 97 })

      const summary = await runSweep([
        unlatched({ unlatchedPinAlertAt: new Date('2026-05-30T00:00:00.000Z') }),
      ])

      expect(unlatchedPinAlert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(summary.unlatchedPinAlerts).toBe(0)
    })

    it('re-arms once the evidence stops asserting settlement, so a recurrence pages again', async () => {
      assertsSettlement.mockResolvedValue(null)

      await runSweep([unlatched({ unlatchedPinAlertAt: new Date('2026-05-30T00:00:00.000Z') })])

      expect(update).toHaveBeenCalledWith({
        where: { id: 'pred-unlatched-1' },
        data: { unlatchedPinAlertAt: null },
      })
      expect(unlatchedPinAlert).not.toHaveBeenCalled()
    })

    it('pages without a number when the asserting snapshot carries no probability', async () => {
      assertsSettlement.mockResolvedValue({ assertedAt: ASSERTED_AT, probability: null })

      const summary = await runSweep([unlatched()])

      expect(unlatchedPinAlert).toHaveBeenCalledWith(expect.anything(), null, ASSERTED_AT)
      expect(summary.unlatchedPinAlerts).toBe(1)
    })

    it('counts a failed write as an error instead of aborting the sweep', async () => {
      assertsSettlement.mockResolvedValue({ assertedAt: ASSERTED_AT, probability: 97 })
      update.mockRejectedValueOnce(new Error('db down'))

      const summary = await runSweep([unlatched(), unlatched({ id: 'pred-unlatched-2' })])

      expect(summary.errors).toBe(1)
      expect(summary.unlatchedPinAlerts).toBe(1)
    })

    it('survives the sweep query failing on an un-migrated database', async () => {
      findMany.mockResolvedValueOnce([]) // #1185 stuck-PENDING sweep
      findMany.mockResolvedValueOnce([]) // #1490 settled-drift sweep
      findMany.mockRejectedValueOnce(new Error('column "unlatched_pin_alert_at" does not exist'))

      const summary = await runRequote({ archetypes: [], now: NOW })

      expect(summary.errors).toBe(1)
      expect(summary.unlatchedPinAlerts).toBe(0)
      expect(unlatchedPinAlert).not.toHaveBeenCalled()
    })
  })
})
