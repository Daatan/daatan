import { describe, it, expect } from 'vitest'
import { communityProbability } from '@/lib/forecast-math'

describe('communityProbability', () => {
  it('returns null with no commitments', () => {
    expect(communityProbability([])).toBeNull()
  })

  it('maps a single stake to its stated P(YES), not a 100% YES share', () => {
    // The bug this fixes: one YES voter staking +30 is 65%, not 100%.
    expect(communityProbability([{ cuCommitted: 30 }])).toBe(65)
  })

  it('treats 0 as 50%, +100 as 100%, -100 as 0%', () => {
    expect(communityProbability([{ cuCommitted: 0 }])).toBe(50)
    expect(communityProbability([{ cuCommitted: 100 }])).toBe(100)
    expect(communityProbability([{ cuCommitted: -100 }])).toBe(0)
  })

  it('averages across committers', () => {
    // (90% + 10%) / 2 = 50%
    expect(communityProbability([{ cuCommitted: 80 }, { cuCommitted: -80 }])).toBe(50)
  })
})
