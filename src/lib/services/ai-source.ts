/**
 * Where a commitment's `aiProbabilityAtCommit` came from (daatan#2271).
 *
 * `predictions.confidence` is written by every analysis path, not only the Oracul's: the LLM
 * fallback writes it too, and a forecast can carry a value before any analysis ran. On top of
 * that, a stake with no confidence gets a claim-text-only LLM guess backfilled afterwards. All
 * of these used to be graded as "Oracul". Anything labelled Oracul (the Showdown board, the
 * "vs AI" sums, the Oracul row on the AI tab) reads only `ORACUL_SOURCE`.
 */
export type AiSource = 'oracle' | 'llm' | 'unknown' | 'claim_llm' | 'oracle_inverted'

export const ORACUL_SOURCE: AiSource = 'oracle'
export const CLAIM_LLM_SOURCE: AiSource = 'claim_llm'
/**
 * The Oracul's estimate, but of the opposite event (daatan#2273): the forecast's resolution
 * rules inverted its claim (#1802), and since #1430 the Oracul estimates the rules. Set only by a
 * migration, never at commit time. Not `ORACUL_SOURCE`, so no Oracul board or "vs AI" sum counts it.
 */
export const ORACUL_INVERTED_SOURCE: AiSource = 'oracle_inverted'

/**
 * Classify by the latest non-clock context snapshot that carries a probability at or before the
 * stake. `oracleMean` is set exactly on snapshots with the Oracle payload (a trigger mirrors it
 * from `oracle_snapshot`), so it tells the Oracul from the LLM fallback without reading the blob.
 * The migration that backfilled history (20261121000000) applies the same rule in SQL.
 */
export function aiSourceFromSnapshot(latest: { oracleMean: number | null } | null): AiSource {
  if (latest == null) return 'unknown'
  return latest.oracleMean != null ? 'oracle' : 'llm'
}
