/**
 * A Brier score in words, for readers who don't know what 0.18 means (daatan#2320).
 *
 * The cut-offs are the ones the leaderboards already colour by (`brierTone` in
 * components/leaderboard/LeaderboardParts.tsx reads this), so a word and its colour never
 * disagree. 0.25 is what always answering 50/50 scores. elections' `trackRecordLabel` uses the
 * same scale with 0.18 for its middle cut; ours stays at 0.2 because the colours were here first.
 */
export type BrierGrade = 'excellent' | 'good' | 'fair' | 'poor'

export function brierGrade(brier: number): BrierGrade {
  if (brier <= 0.1) return 'excellent'
  if (brier <= 0.2) return 'good'
  if (brier < 0.25) return 'fair'
  return 'poor'
}
