import { prisma } from '@/lib/prisma'
import type { NumberFeedbackField } from '@prisma/client'

// Same casting convention as elections.ts's OracleSnapshotShape — oracleSnapshot is an
// untyped Json column; this reads only the fields the drill-down table needs.
type OracleSnapshotShape = { mean?: number | null; ciLow?: number | null; ciHigh?: number | null; articlesUsed?: number | null } | null

export interface RatingFeedbackVote {
  id: string
  createdAt: Date
  rating: number
  raterName: string | null
  raterUser: { id: string; name: string | null; username: string | null } | null
  flaggedFields: NumberFeedbackField[]
  note: string | null
  article: { title: string | null; url: string; source: string | null }
  prediction: { id: string; claimText: string; slug: string | null }
  snapshotSimilarity: number | null
  oracle: { mean: number | null; ciLow: number | null; ciHigh: number | null; articlesUsed: number | null } | null
}

export interface RaterBreakdown {
  raterName: string
  count: number
  avgRating: number
  nonFiveCount: number
}

export interface RatingFeedbackStats {
  promptsSent: number
  totalVotes: number
  responseRate: number // percent, one decimal
  ratingDistribution: number[] // index 0 = count of "1" .. index 4 = count of "5"
  byRater: RaterBreakdown[]
  votes: RatingFeedbackVote[]
}

/**
 * Aggregate the manual number-rating feedback loop (daatan#1223) for the admin Ratings
 * tab (daatan#1312): how many prompts were sent, how many got a vote, the rating
 * distribution and per-rater breakdown, and a per-vote drill-down joining the article,
 * prediction, and the frozen Oracul numbers the rater actually saw.
 *
 * No `take` limit: current volume (tens of rows as of 2026-08) makes fetching everything
 * both correct and cheap. Revisit with real pagination — and stop computing distribution/
 * byRater over the full set — only once this grows into the thousands.
 */
export async function getRatingFeedbackStats(): Promise<RatingFeedbackStats> {
  const [promptsSent, feedback] = await Promise.all([
    prisma.articleRatingPrompt.count(),
    prisma.evidencePoolArticleFeedback.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        rater: { select: { id: true, name: true, username: true } },
        prompt: {
          include: {
            evidencePoolArticle: {
              include: { prediction: { select: { id: true, claimText: true, slug: true } } },
            },
          },
        },
      },
    }),
  ])

  const snapshotIds = [
    ...new Set(feedback.map((f) => f.prompt.contextSnapshotId).filter((id): id is string => id != null)),
  ]
  const snapshots =
    snapshotIds.length > 0
      ? await prisma.contextSnapshot.findMany({
          where: { id: { in: snapshotIds } },
          select: { id: true, oracleSnapshot: true },
        })
      : []
  const snapshotById = new Map(snapshots.map((s) => [s.id, s.oracleSnapshot as OracleSnapshotShape]))

  const distribution = [0, 0, 0, 0, 0]
  const raterMap = new Map<string, { count: number; sum: number; nonFive: number }>()
  for (const f of feedback) {
    distribution[f.rating - 1]++
    const key = f.raterName ?? f.rater?.name ?? f.rater?.username ?? 'Unknown'
    const e = raterMap.get(key) ?? { count: 0, sum: 0, nonFive: 0 }
    e.count++
    e.sum += f.rating
    if (f.rating !== 5) e.nonFive++
    raterMap.set(key, e)
  }
  const byRater: RaterBreakdown[] = [...raterMap.entries()]
    .map(([raterName, v]) => ({
      raterName,
      count: v.count,
      avgRating: Math.round((v.sum / v.count) * 100) / 100,
      nonFiveCount: v.nonFive,
    }))
    .sort((a, b) => b.count - a.count)

  const votes: RatingFeedbackVote[] = feedback.map((f) => {
    const snap = f.prompt.contextSnapshotId ? (snapshotById.get(f.prompt.contextSnapshotId) ?? null) : null
    return {
      id: f.id,
      createdAt: f.createdAt,
      rating: f.rating,
      raterName: f.raterName,
      raterUser: f.rater,
      flaggedFields: f.flaggedFields,
      note: f.note,
      article: {
        title: f.prompt.evidencePoolArticle.title,
        url: f.prompt.evidencePoolArticle.url,
        source: f.prompt.evidencePoolArticle.source,
      },
      prediction: f.prompt.evidencePoolArticle.prediction,
      snapshotSimilarity: f.prompt.snapshotSimilarity,
      oracle: snap
        ? {
            mean: snap.mean ?? null,
            ciLow: snap.ciLow ?? null,
            ciHigh: snap.ciHigh ?? null,
            articlesUsed: snap.articlesUsed ?? null,
          }
        : null,
    }
  })

  return {
    promptsSent,
    totalVotes: feedback.length,
    responseRate: promptsSent > 0 ? Math.round((feedback.length / promptsSent) * 1000) / 10 : 0,
    ratingDistribution: distribution,
    byRater,
    votes,
  }
}
