/**
 * Community probability for a binary forecast: the mean of committers' stated
 * estimates. Each commit's implied P(YES) is (cuCommitted + 100) / 200 — the
 * signed confidence stake (−100..100, so 0 → 50%, +100 → 100%, −100 → 0%).
 * This matches the canonical definition in commitment.ts
 * (communityProbabilityAtCommit). It is deliberately NOT a CU-weighted YES/NO
 * share, which over-reports consensus (a handful of all-YES stakes → 100%).
 * Returns a 0–100 integer, or null when there are no commitments.
 *
 * Single source of truth — the feed card and the forecast detail page both read
 * this so the same forecast never shows two different community numbers.
 */
export function communityProbability(commits: { cuCommitted: number }[]): number | null {
  if (commits.length === 0) return null
  const mean = commits.reduce((sum, c) => sum + (c.cuCommitted + 100) / 200, 0) / commits.length
  return Math.round(mean * 100)
}
