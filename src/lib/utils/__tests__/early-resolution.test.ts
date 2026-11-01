import { describe, it, expect } from 'vitest'
import { detectEarlyResolution, effectiveDeadline } from '../early-resolution'

// daatan#2076 fixture: "The Winds of Winter by Dec 31 2026", resolved on 2026-11-01.
const now = new Date('2026-11-01T15:20:56Z')
const deadline = new Date('2026-12-31T23:59:59Z')

describe('detectEarlyResolution', () => {
  it.each(['wrong', 'unresolvable'] as const)('flags %s before the deadline', (outcome) => {
    expect(detectEarlyResolution(outcome, deadline, deadline, now)).toEqual({ isEarly: true, deadline })
  })

  it.each(['correct', 'void'] as const)('never flags %s', (outcome) => {
    expect(detectEarlyResolution(outcome, deadline, deadline, now).isEarly).toBe(false)
  })

  it('does not flag after the deadline', () => {
    expect(detectEarlyResolution('wrong', deadline, deadline, new Date('2027-01-01T00:00:00Z')).isEarly).toBe(false)
  })

  it('prefers claimDeadline, falls back to resolveByDatetime, accepts ISO strings', () => {
    expect(detectEarlyResolution('wrong', '2026-10-31T00:00:00Z', deadline, now).isEarly).toBe(false)
    expect(detectEarlyResolution('wrong', null, deadline.toISOString(), now).isEarly).toBe(true)
  })

  it('does not flag when no deadline is known', () => {
    expect(effectiveDeadline(null, undefined)).toBeNull()
    expect(detectEarlyResolution('wrong', null, 'not-a-date', now)).toEqual({ isEarly: false, deadline: null })
  })
})
