import { prisma } from '@/lib/prisma'
import { panelSeriesLabel, isControlModel } from '@/lib/llm/panel/roster'
import { ORACLE_MEMBER, MARKET_MEMBER } from '@/lib/services/ai-panel-score'

export interface MemberLeaderboardRow {
  model: string
  /** 'ungrounded', 'grounded-indexer', or 'sentinel' for the oracle/market rows — the
   *  mode axis of member identity: a grounded twin is a separate row from its sibling. */
  mode: string
  /** Prompt-template fingerprint the row's scores were produced under; null for the
   *  'oracle'/'market' sentinels. Part of member identity (docs/LASSO.md §6). */
  promptVersion: string | null
  label: string
  /** Mean matched-time Brier (lower is better); 0 = perfect, 0.25 = a coin flip. */
  avgBrier: number
  /** Commitments this member was scored on — the sample size behind avgBrier. */
  count: number
  isOracle: boolean
  /** The linked prediction market (Polymarket/Kalshi) — a benchmark, not an LLM. Scored
   *  only over market-linked forecasts, so its `count` is typically lower than a model's. */
  isMarket: boolean
  /** The roster's deliberately-weak falsification member — from the roster's `control`
   *  flag, never re-derived from the model name. */
  isControl: boolean
}

export interface AiLeaderboard {
  members: MemberLeaderboardRow[]
  /** Humans on the SAME commitments, so the comparison is apples-to-apples. Null until
   *  at least one AI-scored commitment has a human Brier. */
  humanAvgBrier: number | null
  humanCount: number
}

/**
 * How each panel member (and the Oracul) scored on matched-time Brier, vs humans on the
 * same commitments (docs/LASSO.md §7). This is the feature's payoff: do LLMs forecast
 * better than the crowd, the Oracul, or each other?
 *
 * Read-only. `ai_member_scores` is comparable to `Commitment.brierScore` because both are
 * computed at the same instant against the same outcome — the entire reason matched-time
 * exists. A member with fewer than `minCount` scores is omitted so a lucky single call
 * doesn't top the board.
 */
export async function getAiLeaderboard(minCount = 5): Promise<AiLeaderboard> {
  // Grouped by the full member identity (model, mode, promptVersion), never model
  // alone: scores produced under different prompt templates — or by a grounded twin vs
  // its ungrounded sibling — are different members (docs/LASSO.md §6, §9a) and must
  // never be averaged into one row. Sentinels ('oracle'/'market') have a null
  // promptVersion and the 'sentinel' mode → one row each.
  const grouped = await prisma.aiMemberScore.groupBy({
    by: ['model', 'mode', 'promptVersion'],
    _avg: { brierScore: true },
    _count: { brierScore: true },
  })

  const qualifying = grouped.filter(
    (g) => g._count.brierScore >= minCount && g._avg.brierScore != null,
  )
  // Label rows plainly until a model actually spans prompt versions; only then add a
  // fingerprint suffix so the two series are distinguishable on the board.
  const versionsPerMember = new Map<string, number>()
  for (const g of qualifying) {
    const k = `${g.model}:${g.mode}`
    versionsPerMember.set(k, (versionsPerMember.get(k) ?? 0) + 1)
  }

  const members: MemberLeaderboardRow[] = qualifying
    .map((g) => {
      const baseLabel =
        g.model === ORACLE_MEMBER
          ? 'Oracul'
          : g.model === MARKET_MEMBER
            ? 'Market'
            : panelSeriesLabel(g.model, g.mode)
      const pv = g.promptVersion
      const ambiguous = pv != null && (versionsPerMember.get(`${g.model}:${g.mode}`) ?? 0) > 1
      return {
        model: g.model,
        mode: g.mode,
        promptVersion: pv,
        label: ambiguous ? `${baseLabel} · ${pv.slice(0, 6)}` : baseLabel,
        avgBrier: Math.round((g._avg.brierScore as number) * 1000) / 1000,
        count: g._count.brierScore,
        isOracle: g.model === ORACLE_MEMBER,
        isMarket: g.model === MARKET_MEMBER,
        isControl: isControlModel(g.model),
      }
    })
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
