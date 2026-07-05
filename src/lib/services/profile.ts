import { prisma } from '@/lib/prisma'
import type { Prediction } from '@/components/forecasts/ForecastCard'

const DECAY = 0.95
export const PAGE_SIZE = 20

export type ProfileTab = 'created' | 'participated' | 'resolved'

export interface TopicStat {
  name: string
  slug: string
  count: number
  peerScoreAvg: number
}

export interface CommitmentForList {
  id: string
  probability: number | null
  binaryChoice: boolean | null
  cuCommitted: number
  brierScore: number | null
  peerScore: number | null
  rsChange: number | null
  createdAt: Date
  prediction: Prediction
}

export interface CalibrationPoint {
  predicted: number // bucket midpoint, e.g. 0.05, 0.15, …, 0.95
  actual: number    // fraction of YES outcomes in this bucket
  count: number
}

export interface ProfileScores {
  avgBrierScore: number | null
  brierCount: number
  peerScoreSum: number | null
  peerScoreCount: number
  aiScoreSum: number | null
  aiScoreCount: number
  rsTagDelta: number | null
  truthScore: number | null
  weightedPeerScore: number | null
  weightedPeerCount: number
  roi: number | null
  accuracy: number | null
  accuracyResolved: number
  topicBreakdown: TopicStat[]
  calibration: CalibrationPoint[]
}

export interface ProfileTabResult {
  tab: ProfileTab
  page: number
  createdTotal: number
  participatedTotal: number
  resolvedTotal: number
  createdItems: Prediction[]
  participatedItems: CommitmentForList[]
  resolvedItems: CommitmentForList[]
}

const authorSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  rs: true,
  role: true,
} as const

const predictionInclude = {
  author: { select: authorSelect },
  tags: { select: { name: true, slug: true } },
  _count: { select: { commitments: true } },
} as const

export async function loadProfileScores({
  userId,
  selectedTag,
}: {
  userId: string
  selectedTag: string | null
}): Promise<ProfileScores> {
  const tagFilter = selectedTag
    ? { prediction: { tags: { some: { slug: selectedTag } } } }
    : {}
  const predTagFilter = selectedTag
    ? { tags: { some: { slug: selectedTag } } }
    : {}

  const [
    brierStats,
    rsTagStats,
    peerScoreStats,
    aiScoreStats,
    rsNetStats,
    weightedPeerRows,
    accuracyRows,
    topicStats,
    calibrationRows,
  ] = await Promise.all([
    prisma.commitment.aggregate({
      where: { userId, brierScore: { not: null as null }, ...tagFilter },
      _avg: { brierScore: true },
      _count: { brierScore: true },
    }),
    prisma.commitment.aggregate({
      where: { userId, rsChange: { not: null as null }, ...tagFilter },
      _sum: { rsChange: true },
    }),
    prisma.commitment.aggregate({
      where: { userId, peerScore: { not: null as null }, ...tagFilter },
      _sum: { peerScore: true },
      _count: { peerScore: true },
    }),
    prisma.commitment.aggregate({
      where: { userId, aiScore: { not: null as null }, ...tagFilter },
      _sum: { aiScore: true },
      _count: { aiScore: true },
    }),
    prisma.commitment.aggregate({
      where: { userId, rsChange: { not: null as null }, ...tagFilter },
      _sum: { rsChange: true },
      _count: { rsChange: true },
    }),
    prisma.commitment.findMany({
      where: {
        userId,
        peerScore: { not: null as null },
        prediction: {
          resolvedAt: { not: null as null },
          ...predTagFilter,
        },
      },
      select: {
        peerScore: true,
        prediction: { select: { resolvedAt: true } },
      },
    }),
    prisma.commitment.findMany({
      where: {
        userId,
        rsChange: { not: null as null },
        prediction: {
          status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
          ...predTagFilter,
        },
      },
      select: { rsChange: true },
    }),
    prisma.tag.findMany({
      where: {
        predictions: {
          some: { commitments: { some: { userId, peerScore: { not: null } } } },
        },
      },
      select: {
        name: true,
        slug: true,
        predictions: {
          where: { commitments: { some: { userId, peerScore: { not: null } } } },
          select: {
            commitments: {
              where: { userId, peerScore: { not: null } },
              select: { peerScore: true },
            },
          },
        },
      },
      take: 8,
    }),
    prisma.commitment.findMany({
      where: {
        userId,
        probability: { not: null as null },
        prediction: {
          status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
          ...predTagFilter,
        },
      },
      select: {
        probability: true,
        prediction: { select: { status: true } },
      },
    }),
  ])

  const avgBrierScore =
    brierStats._count.brierScore > 0 && brierStats._avg.brierScore != null
      ? Math.round(brierStats._avg.brierScore * 1000) / 1000
      : null

  const rsTagDelta = selectedTag ? (rsTagStats._sum.rsChange ?? null) : null
  const peerScoreSum =
    peerScoreStats._count.peerScore > 0 ? (peerScoreStats._sum.peerScore ?? null) : null
  const aiScoreSum =
    aiScoreStats._count.aiScore > 0 ? (aiScoreStats._sum.aiScore ?? null) : null

  const truthScore =
    peerScoreStats._count.peerScore >= 3 && peerScoreSum !== null
      ? Math.round((peerScoreSum / peerScoreStats._count.peerScore) * 10000) / 10000
      : null

  const roi =
    rsNetStats._count.rsChange >= 3
      ? Math.round(((rsNetStats._sum.rsChange ?? 0) / rsNetStats._count.rsChange) * 100) / 100
      : null

  const now = Date.now()
  let wpSum = 0
  let wpTotal = 0
  for (const row of weightedPeerRows) {
    if (!row.prediction.resolvedAt || row.peerScore === null) continue
    const days = (now - row.prediction.resolvedAt.getTime()) / 86_400_000
    const w = DECAY ** (days / 30)
    wpSum += row.peerScore * w
    wpTotal += w
  }
  const weightedPeerScore =
    weightedPeerRows.length >= 3 && wpTotal > 0
      ? Math.round((wpSum / wpTotal) * 10000) / 10000
      : null

  const accuracyResolved = accuracyRows.length
  const accuracyCorrect = accuracyRows.filter(r => (r.rsChange ?? 0) > 0).length
  const accuracy =
    accuracyResolved >= 3
      ? Math.round((accuracyCorrect / accuracyResolved) * 1000) / 1000
      : null

  const topicBreakdown = topicStats
    .map(tag => {
      const allScores = tag.predictions.flatMap(p => p.commitments.map(c => c.peerScore!))
      const sum = allScores.reduce((a, b) => a + b, 0)
      return {
        name: tag.name,
        slug: tag.slug,
        count: allScores.length,
        peerScoreAvg:
          allScores.length > 0
            ? Math.round((sum / allScores.length) * 10000) / 10000
            : 0,
      }
    })
    .sort((a, b) => b.count - a.count)

  const buckets = Array.from({ length: 10 }, (_, i) => ({ sum: 0, count: 0, midpoint: (i + 0.5) / 10 }))
  for (const row of calibrationRows) {
    if (row.probability === null) continue
    const b = Math.min(Math.floor(row.probability * 10), 9)
    buckets[b].sum += row.prediction.status === 'RESOLVED_CORRECT' ? 1 : 0
    buckets[b].count++
  }
  const calibration: CalibrationPoint[] = buckets
    .filter(b => b.count > 0)
    .map(b => ({ predicted: b.midpoint, actual: b.sum / b.count, count: b.count }))

  return {
    avgBrierScore,
    brierCount: brierStats._count.brierScore,
    peerScoreSum,
    peerScoreCount: peerScoreStats._count.peerScore,
    aiScoreSum,
    aiScoreCount: aiScoreStats._count.aiScore,
    rsTagDelta,
    truthScore,
    weightedPeerScore,
    weightedPeerCount: weightedPeerRows.length,
    roi,
    accuracy,
    accuracyResolved,
    topicBreakdown,
    calibration,
  }
}

export async function loadProfileTab({
  userId,
  isPublic,
  selectedTag,
  tab,
  page,
}: {
  userId: string
  isPublic: boolean
  selectedTag: string | null
  tab: ProfileTab
  page: number
}): Promise<ProfileTabResult> {
  const publicFilter = isPublic ? { isPublic: true as const } : {}
  const predTagFilter = selectedTag ? { tags: { some: { slug: selectedTag } } } : {}
  const skip = (Math.max(1, page) - 1) * PAGE_SIZE

  const [createdTotal, participatedTotal, resolvedTotal] = await Promise.all([
    prisma.prediction.count({
      where: { authorId: userId, ...publicFilter, ...predTagFilter },
    }),
    prisma.commitment.count({
      where: { userId, prediction: { ...publicFilter, ...predTagFilter } },
    }),
    prisma.commitment.count({
      where: {
        userId,
        prediction: {
          status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
          ...publicFilter,
          ...predTagFilter,
        },
      },
    }),
  ])

  if (tab === 'created') {
    const items = await prisma.prediction.findMany({
      where: { authorId: userId, ...publicFilter, ...predTagFilter },
      include: predictionInclude,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip,
    })
    return {
      tab,
      page,
      createdTotal,
      participatedTotal,
      resolvedTotal,
      createdItems: items,
      participatedItems: [],
      resolvedItems: [],
    }
  }

  const resolvedStatuses: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] = ['RESOLVED_CORRECT', 'RESOLVED_WRONG']
  const commitmentPredFilter =
    tab === 'participated'
      ? { ...publicFilter, ...predTagFilter }
      : { status: { in: resolvedStatuses }, ...publicFilter, ...predTagFilter }

  const items = await prisma.commitment.findMany({
    where: { userId, prediction: commitmentPredFilter },
    include: { prediction: { include: predictionInclude } },
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE,
    skip,
  })

  const commitItems = items

  return {
    tab,
    page,
    createdTotal,
    participatedTotal,
    resolvedTotal,
    createdItems: [],
    participatedItems: tab === 'participated' ? commitItems : [],
    resolvedItems: tab === 'resolved' ? commitItems : [],
  }
}
