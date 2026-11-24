/**
 * One article's vote on a claim, as the Oracul pool casts it — shared by the sources panel
 * (`ContributingSources`) and the expanded chart's article dots (daatan#2300), so a dot and
 * its badge can never disagree about which side an article is on or what number it voted.
 * Pure — safe to import from client components and server code alike.
 */

export type Side = 'yes' | 'no' | 'neutral'

/** Stance → side: same thresholds as the Oracul-snapshot source chips. */
export function getSide(stance: number | null): Side {
  if (stance == null) return 'neutral'
  if (stance > 0.15) return 'yes'
  if (stance < -0.15) return 'no'
  return 'neutral'
}

/**
 * An article's implied P(YES): (1 + stance) / 2 — the exact vote the Oracul pool casts for
 * it (retro `stance_to_prob`), clamped to [0, 1]. Certainty is the vote's WEIGHT in the pool,
 * not its location, so it must not move this number (#2139). Null stance (a gate-rejected
 * article, never shown) reads as 0.5.
 */
export function stanceProbYes(stance: number | null): number {
  if (stance == null) return 0.5
  return Math.min(1, Math.max(0, (1 + stance) / 2))
}
