/**
 * Matched-time Brier for the AI panel at resolution (docs/LASSO.md §7).
 *
 * A human stakes once; the panel updates daily. So we do NOT score the panel on all its
 * estimates — that flatters it (an estimate the day before resolution is nearly free).
 * Instead each commitment is scored against the panel run that was CURRENT when the user
 * staked (`Commitment.aiRunIdAtCommit`), so a member and the human are compared on the
 * same claim, the same instant, the same information.
 */

/** OUTCOME encoding matches prediction-resolution.ts: 1 = the staked side resolved true. */
export interface MatchedMemberEstimate {
  model: string
  /** 0–100, or null when the member abstained on that run. */
  probability: number | null
}

export interface MemberBrier {
  model: string
  brierScore: number
}

/** Sentinel model id for the Oracle needle, scored as a member for zero extra calls. */
export const ORACLE_MEMBER = 'oracle'

/** Sentinel model id for the linked prediction market (Polymarket/Kalshi), scored as a
 *  matched-time benchmark so the leaderboard can answer "does a model beat the market?". */
export const MARKET_MEMBER = 'market'

/**
 * Matched-time Brier for the linked market on one commitment. Pure.
 *
 * Reconstructs the market's price as of the commit instant from its snapshot history
 * (the latest snapshot at or before `commitAt`), applies the forecast's polarity, and
 * scores it against the outcome — the same matched-time basis as the models and humans.
 * Returns null when the forecast has no linked market or no snapshot predates the commit
 * (so an unlinked forecast simply contributes nothing to the market row).
 *
 * @param snapshots the market's price history: `{ createdAt, probability }` (raw 0–100).
 * @param inverted `Prediction.externalMarketInverted` — the market asks the opposite question.
 */
export function computeMarketScore(
  snapshots: { createdAt: Date; probability: number }[],
  inverted: boolean,
  commitAt: Date,
  outcomeNumeric: number,
): number | null {
  let latest: number | null = null
  let latestTs = -Infinity
  for (const s of snapshots) {
    const ts = s.createdAt.getTime()
    if (ts <= commitAt.getTime() && ts >= latestTs) {
      latest = s.probability
      latestTs = ts
    }
  }
  if (latest == null) return null

  const display = inverted ? 100 - latest : latest
  const p = display / 100
  return (p - outcomeNumeric) ** 2
}

/**
 * Per-member Brier for one commitment. Pure: given the run's member estimates and the
 * Oracle probability at commit time, return one `{model, brierScore}` per member that had
 * a number. Abstentions are skipped (no estimate → no score, never a fabricated 0.25).
 *
 * @param oracleProbability `Commitment.aiProbabilityAtCommit`, on 0–1 (already the scale
 *        the resolution code uses), or null when the Oracle had no estimate at commit time.
 * @param outcomeNumeric 1 or 0 — the same value the human's Brier is computed against.
 */
export function computeMemberScores(
  members: MatchedMemberEstimate[],
  oracleProbability: number | null,
  outcomeNumeric: number,
): MemberBrier[] {
  const rows: MemberBrier[] = []

  for (const m of members) {
    if (m.probability == null) continue
    const p = m.probability / 100
    rows.push({ model: m.model, brierScore: (p - outcomeNumeric) ** 2 })
  }

  if (oracleProbability != null) {
    rows.push({ model: ORACLE_MEMBER, brierScore: (oracleProbability - outcomeNumeric) ** 2 })
  }

  return rows
}
