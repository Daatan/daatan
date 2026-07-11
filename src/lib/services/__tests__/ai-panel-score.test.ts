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
