import { describe, expect, it } from 'vitest'
import { computeMemberScores, ORACLE_MEMBER } from '../ai-panel-score'

describe('computeMemberScores (matched-time Brier)', () => {
  it('scores each member: (p/100 − outcome)²', () => {
    const rows = computeMemberScores(
      [
        { model: 'x-ai/grok-4.3', probability: 80 },
        { model: 'deepseek/deepseek-chat', probability: 40 },
      ],
      null,
      1, // resolved true
    )
    expect(rows).toEqual([
      { model: 'x-ai/grok-4.3', brierScore: expect.closeTo(0.04, 6) }, // (0.8-1)²
      { model: 'deepseek/deepseek-chat', brierScore: expect.closeTo(0.36, 6) }, // (0.4-1)²
    ])
  })

  it('scores a false outcome symmetrically', () => {
    const [row] = computeMemberScores([{ model: 'm', probability: 80 }], null, 0)
    expect(row.brierScore).toBeCloseTo(0.64, 6) // (0.8-0)²
  })

  it('skips abstained members — never a fabricated score', () => {
    const rows = computeMemberScores(
      [
        { model: 'a', probability: null },
        { model: 'b', probability: 50 },
      ],
      null,
      1,
    )
    expect(rows.map((r) => r.model)).toEqual(['b'])
  })

  it('scores the Oracle from its commit-time probability (already 0–1)', () => {
    const rows = computeMemberScores([], 0.9, 1)
    expect(rows).toEqual([{ model: ORACLE_MEMBER, brierScore: expect.closeTo(0.01, 6) }])
  })

  it('omits the Oracle when it had no estimate at commit time', () => {
    expect(computeMemberScores([{ model: 'm', probability: 50 }], null, 1)).toHaveLength(1)
  })

  it('returns nothing when there is neither a member number nor an Oracle estimate', () => {
    expect(computeMemberScores([{ model: 'm', probability: null }], null, 1)).toEqual([])
  })
})

import { computeMarketScore, MARKET_MEMBER } from '../ai-panel-score'

describe('computeMarketScore (matched-time market benchmark)', () => {
  const snaps = [
    { createdAt: new Date('2026-07-01T00:00:00Z'), probability: 60 },
    { createdAt: new Date('2026-07-03T00:00:00Z'), probability: 80 },
  ]

  it('uses the latest price at or before the commit instant', () => {
    // commit on 07-02 → sees the 07-01 price (60), not the later 80.
    const b = computeMarketScore(snaps, false, new Date('2026-07-02T00:00:00Z'), 1)
    expect(b).toBeCloseTo(0.16, 6) // (0.6-1)²
  })

  it('applies inverted polarity (100 − price)', () => {
    const b = computeMarketScore(snaps, true, new Date('2026-07-02T00:00:00Z'), 1)
    expect(b).toBeCloseTo(0.36, 6) // (0.4-1)²
  })

  it('is null when no snapshot predates the commit', () => {
    expect(computeMarketScore(snaps, false, new Date('2026-06-01T00:00:00Z'), 1)).toBeNull()
  })

  it('is null for an unlinked forecast (no snapshots)', () => {
    expect(computeMarketScore([], false, new Date('2026-07-02T00:00:00Z'), 1)).toBeNull()
  })

  it('MARKET_MEMBER is a distinct sentinel from the Oracle', () => {
    expect(MARKET_MEMBER).toBe('market')
    expect(MARKET_MEMBER).not.toBe(ORACLE_MEMBER)
  })
})
