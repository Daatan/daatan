import { describe, it, expect } from 'vitest'
import { formatSigned, orderForDisplay, type LeaderboardUser } from '../sort'

const u = (id: string, over: Partial<LeaderboardUser> = {}): LeaderboardUser => ({
  id, name: id, username: id, image: null, eloRating: null, totalCorrect: 0, totalResolved: 0,
  accuracy: null, avgBrierScore: null, brierCount: 0, peerScoreSum: null, aiScoreSum: null, ...over,
})

describe('leaderboard column sort', () => {
  // The API order is best-first with unranked users last.
  const apiOrder = [
    u('a', { avgBrierScore: 0.1 }), u('b', { avgBrierScore: 0.2 }), u('c', { avgBrierScore: 0.3 }), u('none'),
  ]

  it('keeps the API order for best-first', () => {
    expect(orderForDisplay(apiOrder, 'brierScore', 'best').map(x => x.id)).toEqual(['a', 'b', 'c', 'none'])
  })

  it('reverses ranked users for worst-first but keeps unranked users last', () => {
    expect(orderForDisplay(apiOrder, 'brierScore', 'worst').map(x => x.id)).toEqual(['c', 'b', 'a', 'none'])
  })

  it('treats a null in the active column as unranked even if other columns have values', () => {
    const rows = [u('p', { peerScoreSum: 1 }), u('q', { peerScoreSum: -1 }), u('r', { avgBrierScore: 0.2 })]
    expect(orderForDisplay(rows, 'peerScore', 'worst').map(x => x.id)).toEqual(['q', 'p', 'r'])
  })

  it('formats peer/AI sums with a sign', () => {
    expect([formatSigned(0.987), formatSigned(-0.16), formatSigned(0), formatSigned(null)]).toEqual(['+0.99', '-0.16', '0.00', '—'])
  })
})
