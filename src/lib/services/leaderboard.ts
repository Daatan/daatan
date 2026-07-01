import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { ensureTagRatingsSeeded } from '@/lib/services/tag-ratings'
import { SCORING_SYSTEMS, type SortBy, type ScoringContext } from '@/lib/services/scoring-systems'

export type { SortBy }

// Metaculus-style exponential decay: weight = 0.95^(days/30).
// A prediction resolved 30 days ago counts as 95% of one resolved today.
const DECAY = 0.95

export const getLeaderboard = async (limit: number, sortBy: SortBy, tagSlug?: string) => {
  // Resolve tag slug → id and seed per-tag ratings lazily if not yet populated
  let tagId: string | undefined
  if (tagSlug) {
    const tag = await prisma.tag.findUnique({ where: { slug: tagSlug }, select: { id: true } })
    tagId = tag?.id
    if (tagId) await ensureTagRatingsSeeded(tagId, tagSlug)
  }

  const users = await prisma.user.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      rs: true,
      mu: true,
      sigma: true,
      eloRating: true,
      totalPredictions: true,
      correctPredictions: true,
      _count: { select: { predictions: true, commitments: true } },
    },
  })

  const userIds = users.map(u => u.id)
  const tagFilter: Prisma.CommitmentWhereInput =
    tagSlug ? { prediction: { tags: { some: { slug: tagSlug } } } } : {}
  const now = Date.now()

  const [
    cuSums,
    rsGainSums,
    resolvedCommitments,
    brierScoreSums,
    peerScoreSums,
    aiScoreSums,
    rsChangeSums,
    weightedPeerRows,
    tagRatingRows,
  ] = await Promise.all([
    prisma.commitment.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, ...tagFilter },
      _sum: { cuCommitted: true },
    }),
    prisma.commitment.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, rsChange: { gt: 0 }, ...tagFilter },
      _sum: { rsChange: true },
    }),
    prisma.commitment.findMany({
      where: {
        userId: { in: userIds },
        prediction: {
          status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
          ...(tagSlug ? { tags: { some: { slug: tagSlug } } } : {}),
        },
        rsChange: { not: null },
      },
      select: { userId: true, rsChange: true },
    }),
    prisma.commitment.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, brierScore: { not: null }, ...tagFilter },
      _avg: { brierScore: true },
      _count: { brierScore: true },
    }),
    prisma.commitment.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, peerScore: { not: null }, ...tagFilter },
      _sum: { peerScore: true },
      _count: { peerScore: true },
    }),
    prisma.commitment.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, aiScore: { not: null }, ...tagFilter },
      _sum: { aiScore: true },
    }),
    // Net RS change (all resolved, positive + negative) — used for ROI
    prisma.commitment.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, rsChange: { not: null }, ...tagFilter },
      _sum: { rsChange: true },
      _count: { rsChange: true },
    }),
    // Individual rows for time-weighted peer score (need resolvedAt for decay)
    prisma.commitment.findMany({
      where: {
        userId: { in: userIds },
        peerScore: { not: null },
        prediction: {
          resolvedAt: { not: null },
          ...(tagSlug ? { tags: { some: { slug: tagSlug } } } : {}),
        },
      },
      select: {
        userId: true,
        peerScore: true,
        prediction: { select: { resolvedAt: true } },
      },
    }),
    // Per-tag ELO + Glicko-2: read from materialized UserTagRating table.
    // Already seeded above via ensureTagRatingsSeeded; falls back to global values for missing rows.
    tagId
      ? prisma.userTagRating.findMany({
          where: { tagId, userId: { in: userIds } },
          select: { userId: true, elo: true, mu: true, sigma: true },
        })
      : Promise.resolve(null),
  ])

  // --- Build lookup maps ---

  const cuByUser = new Map(cuSums.map(s => [s.userId, s._sum.cuCommitted ?? 0]))
  const rsGainByUser = new Map(rsGainSums.map(s => [s.userId, s._sum.rsChange ?? 0]))

  const resolvedByUser = new Map<string, { total: number; correct: number }>()
  for (const c of resolvedCommitments) {
    const entry = resolvedByUser.get(c.userId) ?? { total: 0, correct: 0 }
    entry.total++
    if ((c.rsChange ?? 0) > 0) entry.correct++
    resolvedByUser.set(c.userId, entry)
  }

  const brierByUser = new Map(brierScoreSums.map(s => [s.userId, {
    avg: s._avg.brierScore,
    count: s._count.brierScore,
  }]))

  const peerScoreByUser = new Map(peerScoreSums.map(s => [s.userId, {
    sum: s._sum.peerScore ?? null,
    count: s._count.peerScore,
  }]))

  const aiScoreByUser = new Map(aiScoreSums.map(s => [s.userId, s._sum.aiScore ?? null]))

  const rsChangeByUser = new Map(rsChangeSums.map(s => [s.userId, {
    sum: s._sum.rsChange ?? 0,
    count: s._count.rsChange,
  }]))

  // Metaculus-style time-weighted peer score: Σ(score × decay^(days/30)) / Σ(decay^(days/30))
  const wpAccum = new Map<string, { wSum: number; wTotal: number; count: number }>()
  for (const row of weightedPeerRows) {
    if (!row.prediction.resolvedAt) continue
    const days = (now - row.prediction.resolvedAt.getTime()) / 86_400_000
    const w = DECAY ** (days / 30)
    const entry = wpAccum.get(row.userId) ?? { wSum: 0, wTotal: 0, count: 0 }
    entry.wSum += row.peerScore! * w
    entry.wTotal += w
    entry.count++
    wpAccum.set(row.userId, entry)
  }
  const weightedPeerScoreByUser = new Map<string, number | null>()
  for (const [userId, { wSum, wTotal, count }] of wpAccum) {
    weightedPeerScoreByUser.set(userId, count >= 3 ? wSum / wTotal : null)
  }

  // ELO + Glicko-2: per-tag from materialized table when tag selected; stored global otherwise.
  // Falls back to global values for users with no per-tag row.
  const tagRatingByUser = tagRatingRows
    ? new Map(tagRatingRows.map(r => [r.userId, r]))
    : null

  const eloByUser = new Map(
    users.map(u => [u.id, tagRatingByUser?.get(u.id)?.elo ?? u.eloRating]),
  )

  const glickoByUser = new Map<string, { mu: number; sigma: number }>(
    users.map(u => {
      const r = tagRatingByUser?.get(u.id)
      return [u.id, r ? { mu: r.mu, sigma: r.sigma } : { mu: u.mu, sigma: u.sigma }]
    }),
  )

  const ctx: ScoringContext = {
    cuByUser,
    resolvedByUser,
    brierByUser,
    peerScoreByUser,
    aiScoreByUser,
    rsChangeByUser,
    weightedPeerScoreByUser,
    eloByUser,
    glickoByUser,
  }

  const activeSystem = SCORING_SYSTEMS.find(s => s.key === sortBy) ?? SCORING_SYSTEMS[0]

  const leaderboard = users.map(user => {
    const resolved = resolvedByUser.get(user.id) ?? { total: 0, correct: 0 }
    const brier = brierByUser.get(user.id)
    const ps = peerScoreByUser.get(user.id)
    const rsc = rsChangeByUser.get(user.id)
    const g = glickoByUser.get(user.id) ?? { mu: user.mu, sigma: user.sigma }
    const elo = eloByUser.get(user.id) ?? user.eloRating

    return {
      id: user.id,
      name: user.name,
      username: user.username,
      image: user.image,
      rs: user.rs,
      mu: g.mu,
      sigma: g.sigma,
      glickoRank: g.mu - 3 * g.sigma,
      eloRating: elo,
      totalPredictions: user.totalPredictions,
      correctPredictions: user.correctPredictions,
      totalCommitments: user._count.commitments,
      totalResolved: resolved.total,
      totalCorrect: resolved.correct,
      accuracy: resolved.total > 0 ? Math.round((resolved.correct / resolved.total) * 100) : null,
      totalCuCommitted: cuByUser.get(user.id) ?? 0,
      totalRsGained: Math.round((rsGainByUser.get(user.id) ?? 0) * 100) / 100,
      avgBrierScore: (brier && brier.count > 0 && brier.avg != null)
        ? Math.round(brier.avg * 1000) / 1000
        : null,
      brierCount: brier?.count ?? 0,
      peerScoreSum: ps?.sum ?? null,
      aiScoreSum: aiScoreByUser.get(user.id) ?? null,
      roi: rsc && rsc.count >= 3
        ? Math.round((rsc.sum / rsc.count) * 100) / 100
        : null,
      truthScore: ps && ps.count >= 3 && ps.sum !== null
        ? Math.round((ps.sum / ps.count) * 10000) / 10000
        : null,
      weightedPeerScore: weightedPeerScoreByUser.get(user.id) ?? null,
    }
  })

  // Sort using the active system's comparator from the registry
  leaderboard.sort((a, b) => {
    const minUser = (u: typeof a) => ({ id: u.id, rs: u.rs, mu: u.mu, sigma: u.sigma, eloRating: u.eloRating })
    const va = activeSystem.compute(a.id, minUser(a), ctx)
    const vb = activeSystem.compute(b.id, minUser(b), ctx)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    return activeSystem.lowerIsBetter ? va - vb : vb - va
  })

  return leaderboard.slice(0, limit)
}

export const getTopReputation = async (limit: number) => {
  return prisma.user.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      rs: true,
      _count: { select: { predictions: true, commitments: true } },
    },
    orderBy: { rs: 'desc' },
    take: limit,
  })
}
