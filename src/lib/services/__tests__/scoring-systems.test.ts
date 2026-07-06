import { describe, it, expect } from 'vitest'
import { SCORING_SYSTEMS, type ScoringContext } from '../scoring-systems'

/** Minimal user fixture; individual tests override the fields they care about. */
function makeUser(overrides: Partial<{ id: string; rs: number; mu: number; sigma: number; eloRating: number }> = {}) {
  return {
    id: 'u1',
    rs: 100,
    mu: 25,
    sigma: 8.333,
    eloRating: 1500,
    ...overrides,
  }
}

/** Empty context; individual tests populate the maps they exercise. */
function makeContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    cuByUser: new Map(),
    resolvedByUser: new Map(),
    brierByUser: new Map(),
    peerScoreByUser: new Map(),
    aiScoreByUser: new Map(),
    rsChangeByUser: new Map(),
    weightedPeerScoreByUser: new Map(),
    eloByUser: new Map(),
    glickoByUser: new Map(),
    ...overrides,
  }
}

function system(key: string) {
  const s = SCORING_SYSTEMS.find((s) => s.key === key)
  if (!s) throw new Error(`No scoring system registered for key ${key}`)
  return s
}

describe('SCORING_SYSTEMS registry', () => {
  it('registers exactly one entry per SortBy key with no duplicates', () => {
    const keys = SCORING_SYSTEMS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  describe('rs', () => {
    it('returns the user reputation score directly', () => {
      expect(system('rs').compute('u1', makeUser({ rs: 250 }), makeContext())).toBe(250)
    })
  })

  describe('accuracy', () => {
    it('returns null when the user has no resolved predictions', () => {
      expect(system('accuracy').compute('u1', makeUser(), makeContext())).toBeNull()
    })

    it('returns null when total resolved is zero', () => {
      const ctx = makeContext({ resolvedByUser: new Map([['u1', { total: 0, correct: 0 }]]) })
      expect(system('accuracy').compute('u1', makeUser(), ctx)).toBeNull()
    })

    it('computes correct/total as a ratio', () => {
      const ctx = makeContext({ resolvedByUser: new Map([['u1', { total: 4, correct: 3 }]]) })
      expect(system('accuracy').compute('u1', makeUser(), ctx)).toBe(0.75)
    })
  })

  describe('totalCorrect', () => {
    it('defaults to 0 with no data', () => {
      expect(system('totalCorrect').compute('u1', makeUser(), makeContext())).toBe(0)
    })

    it('returns the correct count for the user', () => {
      const ctx = makeContext({ resolvedByUser: new Map([['u1', { total: 10, correct: 7 }]]) })
      expect(system('totalCorrect').compute('u1', makeUser(), ctx)).toBe(7)
    })
  })

  describe('cuCommitted', () => {
    it('defaults to 0 with no data', () => {
      expect(system('cuCommitted').compute('u1', makeUser(), makeContext())).toBe(0)
    })

    it('returns the committed CU total', () => {
      const ctx = makeContext({ cuByUser: new Map([['u1', 500]]) })
      expect(system('cuCommitted').compute('u1', makeUser(), ctx)).toBe(500)
    })
  })

  describe('brierScore (lower is better)', () => {
    it('is flagged as lowerIsBetter', () => {
      expect(system('brierScore').lowerIsBetter).toBe(true)
    })

    it('returns null with no brier data', () => {
      expect(system('brierScore').compute('u1', makeUser(), makeContext())).toBeNull()
    })

    it('returns null when avg is explicitly null', () => {
      const ctx = makeContext({ brierByUser: new Map([['u1', { avg: null, count: 0 }]]) })
      expect(system('brierScore').compute('u1', makeUser(), ctx)).toBeNull()
    })

    it('returns the average brier score, including a perfect 0', () => {
      const ctx = makeContext({ brierByUser: new Map([['u1', { avg: 0, count: 5 }]]) })
      expect(system('brierScore').compute('u1', makeUser(), ctx)).toBe(0)
    })

    it('returns the worst-case brier score of 1', () => {
      const ctx = makeContext({ brierByUser: new Map([['u1', { avg: 1, count: 5 }]]) })
      expect(system('brierScore').compute('u1', makeUser(), ctx)).toBe(1)
    })
  })

  describe('peerScore', () => {
    it('returns null with no data', () => {
      expect(system('peerScore').compute('u1', makeUser(), makeContext())).toBeNull()
    })

    it('returns the summed peer score', () => {
      const ctx = makeContext({ peerScoreByUser: new Map([['u1', { sum: 12.5, count: 3 }]]) })
      expect(system('peerScore').compute('u1', makeUser(), ctx)).toBe(12.5)
    })

    it('falls back to null when sum is explicitly null', () => {
      const ctx = makeContext({ peerScoreByUser: new Map([['u1', { sum: null, count: 0 }]]) })
      expect(system('peerScore').compute('u1', makeUser(), ctx)).toBeNull()
    })
  })

  describe('aiScore', () => {
    it('returns null with no data', () => {
      expect(system('aiScore').compute('u1', makeUser(), makeContext())).toBeNull()
    })

    it('returns the stored AI score, including 0', () => {
      const ctx = makeContext({ aiScoreByUser: new Map([['u1', 0]]) })
      expect(system('aiScore').compute('u1', makeUser(), ctx)).toBe(0)
    })
  })

  describe('elo', () => {
    it('falls back to the user column when no per-tag replay exists', () => {
      expect(system('elo').compute('u1', makeUser({ eloRating: 1620 }), makeContext())).toBe(1620)
    })

    it('prefers the context (tag-replayed) value over the user column', () => {
      const ctx = makeContext({ eloByUser: new Map([['u1', 1710]]) })
      expect(system('elo').compute('u1', makeUser({ eloRating: 1500 }), ctx)).toBe(1710)
    })
  })

  describe('glicko', () => {
    it('is not flagged as lowerIsBetter', () => {
      expect(system('glicko').lowerIsBetter).toBe(false)
    })

    it('falls back to the user mu/sigma columns with no per-tag replay', () => {
      const user = makeUser({ mu: 30, sigma: 5 })
      expect(system('glicko').compute('u1', user, makeContext())).toBe(30 - 3 * 5)
    })

    it('uses the per-tag replay mu/sigma when count is unset (global replay)', () => {
      const ctx = makeContext({ glickoByUser: new Map([['u1', { mu: 28, sigma: 4 }]]) })
      expect(system('glicko').compute('u1', makeUser(), ctx)).toBe(28 - 3 * 4)
    })

    it('returns null when the per-tag replay has fewer than 3 predictions', () => {
      const ctx = makeContext({ glickoByUser: new Map([['u1', { mu: 28, sigma: 4, count: 2 }]]) })
      expect(system('glicko').compute('u1', makeUser(), ctx)).toBeNull()
    })

    it('computes the conservative rating once the 3-prediction floor is met', () => {
      const ctx = makeContext({ glickoByUser: new Map([['u1', { mu: 28, sigma: 4, count: 3 }]]) })
      expect(system('glicko').compute('u1', makeUser(), ctx)).toBe(28 - 3 * 4)
    })
  })

  describe('roi', () => {
    it('returns null with no RS-change data', () => {
      expect(system('roi').compute('u1', makeUser(), makeContext())).toBeNull()
    })

    it('returns null below the 3-prediction floor', () => {
      const ctx = makeContext({ rsChangeByUser: new Map([['u1', { sum: 10, count: 2 }]]) })
      expect(system('roi').compute('u1', makeUser(), ctx)).toBeNull()
    })

    it('computes the average RS change once the floor is met', () => {
      const ctx = makeContext({ rsChangeByUser: new Map([['u1', { sum: 30, count: 3 }]]) })
      expect(system('roi').compute('u1', makeUser(), ctx)).toBe(10)
    })

    it('can be negative when RS change is net-negative', () => {
      const ctx = makeContext({ rsChangeByUser: new Map([['u1', { sum: -15, count: 3 }]]) })
      expect(system('roi').compute('u1', makeUser(), ctx)).toBe(-5)
    })
  })

  describe('truthScore', () => {
    it('returns null with no data', () => {
      expect(system('truthScore').compute('u1', makeUser(), makeContext())).toBeNull()
    })

    it('returns null below the 3-prediction floor', () => {
      const ctx = makeContext({ peerScoreByUser: new Map([['u1', { sum: 4, count: 2 }]]) })
      expect(system('truthScore').compute('u1', makeUser(), ctx)).toBeNull()
    })

    it('returns null when sum is explicitly null even with enough predictions', () => {
      const ctx = makeContext({ peerScoreByUser: new Map([['u1', { sum: null, count: 5 }]]) })
      expect(system('truthScore').compute('u1', makeUser(), ctx)).toBeNull()
    })

    it('computes the average peer score once the floor is met', () => {
      const ctx = makeContext({ peerScoreByUser: new Map([['u1', { sum: 9, count: 3 }]]) })
      expect(system('truthScore').compute('u1', makeUser(), ctx)).toBe(3)
    })
  })

  describe('weightedPeerScore', () => {
    it('returns null with no data', () => {
      expect(system('weightedPeerScore').compute('u1', makeUser(), makeContext())).toBeNull()
    })

    it('returns the pre-decayed weighted score, including 0', () => {
      const ctx = makeContext({ weightedPeerScoreByUser: new Map([['u1', 0]]) })
      expect(system('weightedPeerScore').compute('u1', makeUser(), ctx)).toBe(0)
    })

    it('returns a non-zero weighted score', () => {
      const ctx = makeContext({ weightedPeerScoreByUser: new Map([['u1', 4.2]]) })
      expect(system('weightedPeerScore').compute('u1', makeUser(), ctx)).toBe(4.2)
    })
  })
})
