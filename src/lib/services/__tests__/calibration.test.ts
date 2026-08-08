import { describe, it, expect, vi } from 'vitest'
import { buildCalibrationRecord } from '../calibration'

/**
 * daatan#1233 — what a calibration record must capture.
 *
 * The selection rules are the whole substance of this feature: every number in
 * the record is one the glide overwrites, so picking the wrong snapshot silently
 * scores the system against something it never published. These tests pin the
 * three decisions that are easy to get backwards.
 */

const RESOLVED = new Date('2026-08-01T12:00:00Z')
const day = (n: number) => new Date(RESOLVED.getTime() - n * 24 * 60 * 60 * 1000)

const snap = (over: Partial<Parameters<typeof buildCalibrationRecord>[0]['snapshots'][number]> & { createdAt: Date }) => ({
  externalProbability: 60,
  kind: 'evidence',
  origin: 'analyze',
  oracleSnapshot: null,
  ...over,
})

const build = (snapshots: Parameters<typeof buildCalibrationRecord>[0]['snapshots']) =>
  buildCalibrationRecord({ predictionId: 'p1', outcome: 'correct', resolvedAt: RESOLVED, snapshots })

describe('buildCalibrationRecord', () => {
  it('takes the last published probability before resolution', () => {
    const r = build([
      snap({ createdAt: day(20), externalProbability: 30 }),
      snap({ createdAt: day(2), externalProbability: 80 }),
    ])
    expect(r.pFinal).toBe(80)
    expect(r.pFinalAt).toEqual(day(2))
  })

  it('counts a clock requote as the final published number', () => {
    // The glide's requote is what the page showed. Scoring the system means
    // scoring what it said, not what its last piece of evidence said — and the
    // stored kind is what lets a later fit separate the two.
    const r = build([
      snap({ createdAt: day(5), externalProbability: 70, kind: 'evidence', origin: 'analyze' }),
      snap({ createdAt: day(1), externalProbability: 55, kind: 'clock', origin: 'clock' }),
    ])
    expect(r.pFinal).toBe(55)
    expect(r.pFinalKind).toBe('clock')
    expect(r.pFinalOrigin).toBe('clock')
  })

  it('reads the horizons as of 7 and 30 days before resolution, not the nearest snapshot', () => {
    const r = build([
      snap({ createdAt: day(40), externalProbability: 10 }),
      snap({ createdAt: day(29), externalProbability: 20 }), // AFTER the 30d mark
      snap({ createdAt: day(8), externalProbability: 30 }),
      snap({ createdAt: day(6), externalProbability: 40 }),  // AFTER the 7d mark
      snap({ createdAt: day(0), externalProbability: 50 }),
    ])
    expect(r.p30d).toBe(10)
    expect(r.p7d).toBe(30)
    expect(r.pFinal).toBe(50)
  })

  it('leaves a horizon null when the forecast had said nothing by then', () => {
    const r = build([snap({ createdAt: day(3), externalProbability: 90 })])
    expect(r.p30d).toBeNull()
    expect(r.p7d).toBeNull()
    expect(r.pFinal).toBe(90)
  })

  it('ignores snapshots published after resolution', () => {
    const r = build([
      snap({ createdAt: day(1), externalProbability: 65 }),
      snap({ createdAt: new Date(RESOLVED.getTime() + 60_000), externalProbability: 99 }),
    ])
    expect(r.pFinal).toBe(65)
  })

  it('skips rows that carry no probability when choosing the final one', () => {
    const r = build([
      snap({ createdAt: day(4), externalProbability: 45 }),
      snap({ createdAt: day(1), externalProbability: null }),
    ])
    expect(r.pFinal).toBe(45)
    expect(r.pFinalAt).toEqual(day(4))
  })

  it('carries the Oracle interval and pin state from the final snapshot', () => {
    // ciLow/ciHigh are probability PERCENT, not the Oracle's raw stance — the
    // conversion happens before storage. The CI-honesty check (audit F16, first
    // measured at r = -0.07) is what these two columns exist for.
    const r = build([
      snap({
        createdAt: day(1),
        externalProbability: 97,
        oracleSnapshot: { mean: 97, ciLow: 91, ciHigh: 100, settled: true },
      }),
    ])
    expect(r.ciLow).toBe(91)
    expect(r.ciHigh).toBe(100)
    expect(r.settledAtFinal).toBe(true)
  })

  it('tolerates a malformed or absent oracleSnapshot', () => {
    expect(build([snap({ createdAt: day(1) })]).ciLow).toBeUndefined()
    const r = build([snap({ createdAt: day(1), oracleSnapshot: 'not an object' as never })])
    expect(r.ciLow).toBeUndefined()
    expect(r.pFinal).toBe(60)
  })

  it('splits the history into clock and evidence counts', () => {
    const r = build([
      snap({ createdAt: day(9), kind: 'evidence' }),
      snap({ createdAt: day(8), kind: 'clock' }),
      snap({ createdAt: day(7), kind: 'clock' }),
      snap({ createdAt: day(1), kind: 'evidence' }),
    ])
    expect(r.clockSnapshots).toBe(2)
    expect(r.evidenceSnapshots).toBe(2)
  })

  it('does not depend on the input being sorted', () => {
    const rows = [
      snap({ createdAt: day(1), externalProbability: 80 }),
      snap({ createdAt: day(20), externalProbability: 30 }),
    ]
    expect(build(rows).pFinal).toBe(80)
    expect(build([...rows].reverse()).pFinal).toBe(80)
  })
})

/**
 * daatan#1234 check #3 — disputed/disputeNote are create-only: once a
 * calibration record exists, only a future manual admin action should
 * change them, so a later re-resolution's upsert must never touch them.
 */
describe('recordCalibration — dispute flag', () => {
  function makeClient() {
    return {
      contextSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
      calibrationRecord: { upsert: vi.fn().mockResolvedValue({}) },
    }
  }

  it('sets disputed + disputeNote on create when the resolution overrode a pin', async () => {
    const { recordCalibration } = await import('../calibration')
    const client = makeClient()

    await recordCalibration(
      {
        predictionId: 'p1',
        outcome: 'correct',
        resolvedAt: new Date('2026-08-01T12:00:00Z'),
        disputed: true,
        disputeNote: "Oracle settled this 'wrong' at confidence=3; resolver declared 'correct'",
      },
      client as never,
    )

    const call = client.calibrationRecord.upsert.mock.calls[0][0]
    expect(call.create.disputed).toBe(true)
    expect(call.create.disputeNote).toBe("Oracle settled this 'wrong' at confidence=3; resolver declared 'correct'")
    expect(call.update.disputed).toBeUndefined()
    expect(call.update.disputeNote).toBeUndefined()
  })

  it('omits disputed/disputeNote from create when there is no dispute', async () => {
    const { recordCalibration } = await import('../calibration')
    const client = makeClient()

    await recordCalibration(
      { predictionId: 'p1', outcome: 'correct', resolvedAt: new Date('2026-08-01T12:00:00Z') },
      client as never,
    )

    const call = client.calibrationRecord.upsert.mock.calls[0][0]
    expect(call.create.disputed).toBeUndefined()
    expect(call.create.disputeNote).toBeUndefined()
  })
})
