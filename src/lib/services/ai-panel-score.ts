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
