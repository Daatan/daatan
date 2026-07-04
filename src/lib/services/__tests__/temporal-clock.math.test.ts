import { describe, it, expect } from 'vitest'
import {
  computeRequote,
  glideValue,
  PIN_LOW,
  PIN_HIGH,
  DEADLINE_AGREEMENT_TOLERANCE_MS,
} from '@/lib/services/temporal-clock'

const day = (n: number) => n * 86_400_000
const at = (isoBase: Date, offsetMs: number) => new Date(isoBase.getTime() + offsetMs)

const T_LAST = new Date('2026-01-01T00:00:00.000Z')
const DEADLINE = new Date('2026-01-31T00:00:00.000Z') // 30 days after t_last

describe('computeRequote — domain guards (Gemini-review finding: unclamped exponent goes negative)', () => {
  it('never goes negative past T_eff: holds the boundary value instead', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(DEADLINE, day(1)), // one day PAST the deadline
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    expect(result).not.toBeNull()
    expect(result!.p).toBeGreaterThanOrEqual(0)
    expect(result!.p).toBe(PIN_LOW) // arrival pins low, not -400
  })

  it('returns null (skip) when T_eff <= t_last (tau_lead already consumed the anchor)', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: T_LAST,
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 40, // T_eff = deadline - 40d, before t_last
      direction: 'ARRIVAL',
    })
    expect(result).toBeNull()
  })
})

describe('computeRequote — monotonicity', () => {
  it('arrival glides monotonically DOWN toward the deadline', () => {
    const points = [0.1, 0.3, 0.5, 0.7, 0.9].map((frac) =>
      computeRequote({
        pLast: 65,
        tLast: T_LAST,
        now: at(T_LAST, frac * day(30)),
        claimDeadline: DEADLINE,
        resolveByDatetime: DEADLINE,
        tauLeadDays: 0,
        direction: 'ARRIVAL',
      })!.p,
    )
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeLessThanOrEqual(points[i - 1])
    }
  })

  it('survival glides monotonically UP toward the deadline', () => {
    const points = [0.1, 0.3, 0.5, 0.7, 0.9].map((frac) =>
      computeRequote({
        pLast: 65,
        tLast: T_LAST,
        now: at(T_LAST, frac * day(30)),
        claimDeadline: DEADLINE,
        resolveByDatetime: DEADLINE,
        tauLeadDays: 0,
        direction: 'SURVIVAL',
      })!.p,
    )
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeGreaterThanOrEqual(points[i - 1])
    }
  })

  it('reproduces the pilot reference curve (P_last=0.65 arrival, quartiles ~0.545/0.408/0.231)', () => {
    const quartiles = [0.25, 0.5, 0.75].map((frac) =>
      computeRequote({
        pLast: 65,
        tLast: T_LAST,
        now: at(T_LAST, frac * day(30)),
        claimDeadline: DEADLINE,
        resolveByDatetime: DEADLINE,
        tauLeadDays: 0,
        direction: 'ARRIVAL',
      })!.p,
    )
    // implied lambda from P_last=0.65 over 30 days: fixed-lambda reference ~ 54.5/40.8/23.1
    expect(quartiles[0]).toBeGreaterThanOrEqual(52)
    expect(quartiles[0]).toBeLessThanOrEqual(57)
    expect(quartiles[1]).toBeGreaterThanOrEqual(38)
    expect(quartiles[1]).toBeLessThanOrEqual(43)
    expect(quartiles[2]).toBeGreaterThanOrEqual(21)
    expect(quartiles[2]).toBeLessThanOrEqual(26)
  })
})

describe('computeRequote — pin vs provisional pin', () => {
  it('cause=pin when at/past T_eff and claimDeadline agrees with resolveByDatetime', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: DEADLINE,
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    expect(result!.cause).toBe('pin')
    expect(result!.deadlinePassed).toBe(true)
  })

  it('cause=pin-provisional when T_eff (tau_lead-adjusted) passed but the literal deadline has not', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(DEADLINE, -day(5)), // 5 days before the literal deadline
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 10, // T_eff = deadline - 10d, already passed at `now`
      direction: 'ARRIVAL',
    })
    expect(result!.cause).toBe('pin-provisional')
    expect(result!.deadlinePassed).toBe(false)
  })

  it('cause=glide well before T_eff', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(T_LAST, day(1)),
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    expect(result!.cause).toBe('glide')
  })
})

describe('computeRequote — deadline divergence', () => {
  const resolveBy = at(DEADLINE, day(10)) // 10 days after claimDeadline — beyond tolerance

  it('is divergent when claimDeadline and resolveByDatetime disagree beyond tolerance', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(T_LAST, day(5)),
      claimDeadline: DEADLINE,
      resolveByDatetime: resolveBy,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    expect(result!.divergent).toBe(true)
    expect(result!.horizon.getTime()).toBe(resolveBy.getTime()) // glides toward the LATER date
  })

  it('never hard-pins while divergent AND still-unresolved (only claimDeadline has passed)', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(DEADLINE, day(1)), // past claimDeadline, but resolveBy (10d later) has not passed
      claimDeadline: DEADLINE,
      resolveByDatetime: resolveBy,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    expect(result!.divergent).toBe(true)
    expect(result!.cause).toBe('glide') // not 'pin' — the disagreement is still unresolved
  })

  it('converges to a hard pin once BOTH dates have passed, resolving the disagreement by default', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(resolveBy, day(1)), // past both claimDeadline and resolveBy
      claimDeadline: DEADLINE,
      resolveByDatetime: resolveBy,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    // Once both are moot, the divergence flag itself clears (see the test
    // below) — this is the deliberate escape hatch so an unreviewed
    // divergence alert doesn't strand a forecast in 'glide' forever.
    expect(result!.divergent).toBe(false)
    expect(result!.cause).toBe('pin')
  })

  it('is NOT divergent once both dates are in the past, even beyond tolerance', () => {
    const result = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(resolveBy, day(30)), // long past both
      claimDeadline: DEADLINE,
      resolveByDatetime: resolveBy,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    expect(result!.divergent).toBe(false)
  })

  it('tolerance edge: 71 hours apart agrees, 73 hours apart diverges', () => {
    const near = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(T_LAST, day(5)),
      claimDeadline: DEADLINE,
      resolveByDatetime: at(DEADLINE, 71 * 3600_000),
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    const far = computeRequote({
      pLast: 80,
      tLast: T_LAST,
      now: at(T_LAST, day(5)),
      claimDeadline: DEADLINE,
      resolveByDatetime: at(DEADLINE, 73 * 3600_000),
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })
    expect(near!.divergent).toBe(false)
    expect(far!.divergent).toBe(true)
    expect(DEADLINE_AGREEMENT_TOLERANCE_MS).toBe(72 * 3600_000)
  })
})

describe('computeRequote — output bounds and rounding', () => {
  it('clamps output to [PIN_LOW, PIN_HIGH] even mid-glide', () => {
    const result = computeRequote({
      pLast: 99,
      tLast: T_LAST,
      now: at(T_LAST, day(1)),
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'SURVIVAL',
    })
    expect(result!.p).toBeLessThanOrEqual(PIN_HIGH)
    expect(result!.p).toBeGreaterThanOrEqual(PIN_LOW)
  })

  it('handles pLast=0 without a discontinuity approaching the boundary (survival)', () => {
    // c=0.01 (1% of the window left) — without the P_EPSILON guard, 0^c stays
    // exactly 0 for any c>0 and only jumps to 1 at c=0 exactly (0^0=1 in JS).
    // With the epsilon clamp the approach is smooth: already near 97 here,
    // not stuck at the pre-fix bug's 0.
    const nearBoundary = computeRequote({
      pLast: 0,
      tLast: T_LAST,
      now: at(DEADLINE, -0.3 * day(1)),
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'SURVIVAL',
    })!.p
    const atBoundary = computeRequote({
      pLast: 0,
      tLast: T_LAST,
      now: DEADLINE,
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'SURVIVAL',
    })!.p
    expect(atBoundary).toBe(PIN_HIGH)
    expect(nearBoundary).toBeGreaterThan(85)
  })

  it('handles pLast=100 without a discontinuity approaching the boundary (arrival)', () => {
    const nearBoundary = computeRequote({
      pLast: 100,
      tLast: T_LAST,
      now: at(DEADLINE, -0.3 * day(1)),
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })!.p
    const atBoundary = computeRequote({
      pLast: 100,
      tLast: T_LAST,
      now: DEADLINE,
      claimDeadline: DEADLINE,
      resolveByDatetime: DEADLINE,
      tauLeadDays: 0,
      direction: 'ARRIVAL',
    })!.p
    expect(atBoundary).toBe(PIN_LOW)
    expect(nearBoundary).toBeLessThan(15)
  })
})

describe('glideValue', () => {
  it('collapses to the boundary at c=0', () => {
    expect(glideValue(70, 0, 'ARRIVAL')).toBe(0)
    expect(glideValue(70, 0, 'SURVIVAL')).toBe(100)
  })

  it('is identity-ish at c=1 (returns close to the input)', () => {
    expect(glideValue(70, 1, 'ARRIVAL')).toBeGreaterThanOrEqual(69)
    expect(glideValue(70, 1, 'ARRIVAL')).toBeLessThanOrEqual(71)
  })

  it('preserves order between a low and high CI bound (never crosses)', () => {
    const low = glideValue(40, 0.5, 'ARRIVAL')
    const high = glideValue(80, 0.5, 'ARRIVAL')
    expect(low).toBeLessThanOrEqual(high)
  })
})
