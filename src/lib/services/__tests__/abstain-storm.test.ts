import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  isAbstainStorm,
  ABSTAIN_STORM_MIN_CHECKED,
  ABSTAIN_STORM_SHARE,
} from '@/lib/services/evidence-second-opinion'

describe('isAbstainStorm (daatan#1832)', () => {
  it('flags the 2026-10-11 incident: 10 of 10 abstained', () => {
    expect(isAbstainStorm(10, { oracle_abstain: 10 })).toBe(true)
  })

  it('does not flag the normal 1-3 of 10 baseline', () => {
    expect(isAbstainStorm(10, { oracle_abstain: 1 })).toBe(false)
    expect(isAbstainStorm(10, { oracle_abstain: 3 })).toBe(false)
  })

  it('threshold is inclusive at 80%', () => {
    expect(ABSTAIN_STORM_SHARE).toBe(0.8)
    expect(isAbstainStorm(10, { oracle_abstain: 8 })).toBe(true)
    expect(isAbstainStorm(10, { oracle_abstain: 7 })).toBe(false)
  })

  it('needs a minimum sample: 2 of 2 abstaining is not a storm', () => {
    expect(ABSTAIN_STORM_MIN_CHECKED).toBe(5)
    expect(isAbstainStorm(4, { oracle_abstain: 4 })).toBe(false)
    expect(isAbstainStorm(5, { oracle_abstain: 4 })).toBe(true)
  })

  it('ignores other failure classes and missing data', () => {
    expect(isAbstainStorm(10, { oracle_http: 10 })).toBe(false)
    expect(isAbstainStorm(10, undefined)).toBe(false)
    expect(isAbstainStorm(0, {})).toBe(false)
  })
})
