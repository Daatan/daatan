/**
 * Scoring System Registry
 *
 * Each entry is self-contained: key + compute + sort direction.
 * To add a new scoring system:
 *   1. Add its key to SortBy
 *   2. Add its aggregated data to ScoringContext (if a DB query is needed)
 *   3. Add a ScoringSystem entry to SCORING_SYSTEMS
 *   4. Run the aggregation query in leaderboard.ts and populate the context field
 *
 * The leaderboard service loops over SCORING_SYSTEMS automatically — no other
 * changes to the core loop are required.
 */

export type SortBy =
  | 'rs'
  | 'accuracy'
  | 'totalCorrect'
  | 'cuCommitted'
  | 'brierScore'
  | 'roi'
  | 'truthScore'
  | 'glicko'
  | 'peerScore'
  | 'aiScore'
  | 'elo'
  | 'weightedPeerScore'

/** All pre-aggregated data available to scoring systems during a leaderboard request. */
export interface ScoringContext {
  cuByUser: Map<string, number>
  resolvedByUser: Map<string, { total: number; correct: number }>
  brierByUser: Map<string, { avg: number | null; count: number }>
  peerScoreByUser: Map<string, { sum: number | null; count: number }>
  aiScoreByUser: Map<string, number | null>
  rsChangeByUser: Map<string, { sum: number; count: number }>
  /** Metaculus-style exponential decay: recent predictions weighted more heavily. */
  weightedPeerScoreByUser: Map<string, number | null>
  /** Global stored value (no tag) or materialized per-tag ELO (when tag selected).
   *  null = no per-tag row, i.e. the user never resolved a forecast in this tag → placed last. */
  eloByUser: Map<string, number | null>
  /** Global stored value (no tag) or tag-replayed Glicko-2 (when tag selected).
   *  count is present only in per-tag replays; undefined = stored global (no min threshold). */
  glickoByUser: Map<string, { mu: number; sigma: number; count?: number }>
}

type MinimalUser = {
  id: string
  rs: number
  mu: number
  sigma: number
}

export interface ScoringSystem {
  key: SortBy
  /** Returns the sortable value for this user. null = user has no data → placed last. */
  compute: (userId: string, user: MinimalUser, ctx: ScoringContext) => number | null
  /** Set true for metrics where lower = better (e.g. Brier Score). Default: higher = better. */
  lowerIsBetter?: boolean
}

export const SCORING_SYSTEMS: ScoringSystem[] = [
  {
    key: 'rs',
    compute: (_, user) => user.rs,
  },
  {
    key: 'accuracy',
    compute: (userId, _, ctx) => {
      const r = ctx.resolvedByUser.get(userId)
      if (!r || r.total === 0) return null
      return r.correct / r.total
    },
  },
  {
    key: 'totalCorrect',
    compute: (userId, _, ctx) => ctx.resolvedByUser.get(userId)?.correct ?? 0,
  },
  {
    key: 'cuCommitted',
    compute: (userId, _, ctx) => ctx.cuByUser.get(userId) ?? 0,
  },
  {
    key: 'brierScore',
    lowerIsBetter: true,
    compute: (userId, _, ctx) => {
      const b = ctx.brierByUser.get(userId)
      return b && b.avg != null ? b.avg : null
    },
  },
  {
    key: 'peerScore',
    compute: (userId, _, ctx) => ctx.peerScoreByUser.get(userId)?.sum ?? null,
  },
  {
    key: 'aiScore',
    compute: (userId, _, ctx) => ctx.aiScoreByUser.get(userId) ?? null,
  },
  {
    key: 'elo',
    compute: (userId, _, ctx) => ctx.eloByUser.get(userId) ?? null,
  },
  {
    key: 'glicko',
    lowerIsBetter: false,
    compute: (userId, user, ctx) => {
      const g = ctx.glickoByUser.get(userId)
      const mu = g?.mu ?? user.mu
      const sigma = g?.sigma ?? user.sigma
      // Per-tag replays include count; require ≥3 predictions before surfacing the score
      if (g?.count !== undefined && g.count < 3) return null
      return mu - 3 * sigma
    },
  },
  {
    key: 'roi',
    compute: (userId, _, ctx) => {
      const r = ctx.rsChangeByUser.get(userId)
      if (!r || r.count < 3) return null
      return r.sum / r.count
    },
  },
  {
    key: 'truthScore',
    compute: (userId, _, ctx) => {
      const p = ctx.peerScoreByUser.get(userId)
      if (!p || p.count < 3 || p.sum === null) return null
      return p.sum / p.count
    },
  },
  {
    key: 'weightedPeerScore',
    compute: (userId, _, ctx) => ctx.weightedPeerScoreByUser.get(userId) ?? null,
  },
]
