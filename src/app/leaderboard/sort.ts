// Column sorting for /leaderboard (header click flips best-first / worst-first).

export type SortBy = 'elo' | 'accuracy' | 'brierScore' | 'peerScore' | 'aiScore'
export type SortDir = 'best' | 'worst'

export const LOWER_IS_BETTER: Partial<Record<SortBy, true>> = { brierScore: true }

// The API returns the top `limit` in best-first order; "worst first" reverses it
// client-side, so the request asks for the API maximum to cover everyone.
export const FETCH_LIMIT = '100'

export type LeaderboardUser = {
  id: string
  name: string | null
  username: string | null
  image: string | null
  eloRating: number | null
  totalCorrect: number
  totalResolved: number
  accuracy: number | null
  avgBrierScore: number | null
  brierCount: number
  peerScoreSum: number | null
  aiScoreSum: number | null
}

export function sortValue(user: LeaderboardUser, key: SortBy): number | null {
  switch (key) {
    case 'elo': return user.eloRating
    case 'accuracy': return user.accuracy
    case 'brierScore': return user.avgBrierScore
    case 'peerScore': return user.peerScoreSum
    case 'aiScore': return user.aiScoreSum
  }
}

/** Worst first = the ranked users reversed, with unranked (null) users still last. */
export function orderForDisplay(users: LeaderboardUser[], key: SortBy, dir: SortDir): LeaderboardUser[] {
  if (dir === 'best') return users
  const ranked = users.filter(u => sortValue(u, key) !== null)
  const unranked = users.filter(u => sortValue(u, key) === null)
  return [...ranked].reverse().concat(unranked)
}

export const formatSigned = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`)

