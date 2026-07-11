import { prisma } from '@/lib/prisma'
import { panelMemberLabel } from '@/lib/llm/panel/roster'
import { ORACLE_MEMBER } from '@/lib/services/ai-panel-score'

export interface MemberLeaderboardRow {
  model: string
  label: string
  /** Mean matched-time Brier (lower is better); 0 = perfect, 0.25 = a coin flip. */
  avgBrier: number
  /** Commitments this member was scored on — the sample size behind avgBrier. */
  count: number
  isOracle: boolean
}

export interface AiLeaderboard {
  members: MemberLeaderboardRow[]
  /** Humans on the SAME commitments, so the comparison is apples-to-apples. Null until
   *  at least one AI-scored commitment has a human Brier. */
  humanAvgBrier: number | null
  humanCount: number
}

/**
 * How each panel member (and the Oracle) scored on matched-time Brier, vs humans on the
 * same commitments (docs/LASSO.md §7). This is the feature's payoff: do LLMs forecast
 * better than the crowd, the Oracle, or each other?
 *
 * Read-only. `ai_member_scores` is comparable to `Commitment.brierScore` because both are
 * computed at the same instant against the same outcome — the entire reason matched-time
 * exists. A member with fewer than `minCount` scores is omitted so a lucky single call
 * doesn't top the board.
 */
export async function getAiLeaderboard(minCount = 5): Promise<AiLeaderboard> {
  const grouped = await prisma.aiMemberScore.groupBy({
    by: ['model'],
    _avg: { brierScore: true },
    _count: { brierScore: true },
  })

  const members: MemberLeaderboardRow[] = grouped
    .filter((g) => g._count.brierScore >= minCount && g._avg.brierScore != null)
    .map((g) => ({
      model: g.model,
      label: g.model === ORACLE_MEMBER ? 'Oracle' : panelMemberLabel(g.model),
      avgBrier: Math.round((g._avg.brierScore as number) * 1000) / 1000,
      count: g._count.brierScore,
      isOracle: g.model === ORACLE_MEMBER,
    }))
    .sort((a, b) => a.avgBrier - b.avgBrier)

  // Humans on the commitments that carry AT LEAST ONE member score — the same population
  // the members were graded on, so "AI vs human" is a fair comparison rather than the
  // panel being measured on a different (easier or harder) set of forecasts.
  const scoredCommitmentIds = await prisma.aiMemberScore.findMany({
    distinct: ['commitmentId'],
    select: { commitmentId: true },
  })
  const humanAgg =
    scoredCommitmentIds.length > 0
      ? await prisma.commitment.aggregate({
          where: {
            id: { in: scoredCommitmentIds.map((c) => c.commitmentId) },
            brierScore: { not: null },
          },
          _avg: { brierScore: true },
          _count: { brierScore: true },
        })
      : null

  return {
    members,
    humanAvgBrier:
      humanAgg?._avg.brierScore != null
        ? Math.round(humanAgg._avg.brierScore * 1000) / 1000
        : null,
    humanCount: humanAgg?._count.brierScore ?? 0,
  }
}
