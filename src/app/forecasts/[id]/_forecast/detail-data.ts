import { prisma } from '@/lib/prisma'
import { listComments } from '@/lib/services/comment'
import type { Comment } from '@/components/comments/CommentThread'
import { getContextTimeline, getProbabilityHistory } from '@/lib/services/context'
import { getPanelSeries } from '@/lib/services/ai-panel-read'
import { getForecastVoters } from '@/lib/services/forecast-sources'
import { countUsableEvidence } from '@/lib/services/evidence-pool'
import { getRealCreator } from '@/lib/services/daatan-author'
import { latestProbabilityUpdateISO } from '@/lib/forecast-seo-schema'
import type { Snapshot as ContextSnapshot } from '@/components/forecasts/ContextTimeline'
import { slimContextSnapshots } from '@/lib/slim-context-snapshots'

/*
 * Server-side data for ForecastDetailClient, shared by `/forecasts/[id]` and
 * `/[locale]/forecasts/[id]` (daatan#2351). The locale route used to carry its own copy,
 * which drifted for months: it dropped `insufficientData`, never passed
 * `usableEvidenceCount`, and listed only news-indexer sources. Only what is genuinely
 * per-locale (translations, metadata, JSON-LD, URLs) stays in the routes.
 */

const SSR_COMMENT_LIMIT = 50

async function getInitialComments(predictionId: string): Promise<Comment[]> {
  const { comments } = await listComments({ predictionId, page: 1, limit: SSR_COMMENT_LIMIT })
  return comments.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
  })) as Comment[]
}

async function getInitialContextSnapshots(predictionId: string): Promise<ContextSnapshot[]> {
  const data = await getContextTimeline(predictionId)
  if (!data) return []
  return slimContextSnapshots(data.contextSnapshots.map((s) => ({
    id: s.id,
    summary: s.summary,
    sources: (s.sources as ContextSnapshot['sources']) ?? [],
    createdAt: s.createdAt.toISOString(),
    externalProbability: s.externalProbability,
    externalReasoning: s.externalReasoning,
    oracleSnapshot: (s.oracleSnapshot as ContextSnapshot['oracleSnapshot']) ?? null,
    insufficientData: s.insufficientData,
  })))
}

/** The forecast by id or slug, with dates as ISO strings and Json columns in the client view-model shape. */
export async function getForecastDetail(idOrSlug: string) {
  const prediction = await prisma.prediction.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          rs: true,
          eloRating: true,
          role: true,
          twitterHandle: true,
        },
      },
      newsAnchor: true,
      tags: { select: { id: true, name: true, slug: true } },
      options: { orderBy: { displayOrder: 'asc' } },
      commitments: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, username: true, image: true } },
          option: { select: { id: true, text: true } },
        },
      },
      externalMarket: {
        include: {
          snapshots: {
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true, probability: true },
          },
        },
      },
      _count: { select: { commitments: true } },
    },
  })

  if (!prediction) return null

  const { outcomePayload, evidenceLinks } = prediction
  return {
    ...prediction,
    createdAt: prediction.createdAt.toISOString(),
    resolveByDatetime: prediction.resolveByDatetime.toISOString(),
    contextUpdatedAt: prediction.contextUpdatedAt?.toISOString(),
    publishedAt: prediction.publishedAt?.toISOString(),
    resolvedAt: prediction.resolvedAt?.toISOString(),
    lockedAt: prediction.lockedAt?.toISOString(),
    claimDeadline: prediction.claimDeadline?.toISOString() ?? null,
    outcomePayload:
      outcomePayload && typeof outcomePayload === 'object' && !Array.isArray(outcomePayload)
        ? outcomePayload
        : undefined,
    evidenceLinks: Array.isArray(evidenceLinks)
      ? evidenceLinks.filter((x): x is string => typeof x === 'string')
      : undefined,
    commitments: prediction.commitments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    externalMarket: prediction.externalMarket
      ? {
          provider: prediction.externalMarket.provider,
          slug: prediction.externalMarket.slug,
          url: prediction.externalMarket.url,
          question: prediction.externalMarket.question,
          outcomes: prediction.externalMarket.outcomes,
          resolved: prediction.externalMarket.resolved,
          endDate: prediction.externalMarket.endDate?.toISOString() ?? null,
          snapshots: prediction.externalMarket.snapshots.map((s) => ({
            createdAt: s.createdAt.toISOString(),
            probability: s.probability,
          })),
        }
      : null,
  }
}

/** Everything ForecastDetailClient takes besides the forecast itself (and its localization flag). */
export async function loadForecastDetailProps(
  prediction: { id: string; updatedAt: Date },
  viewer: { id?: string; role?: string } | null | undefined,
) {
  // The AI panel is a hidden, opt-in source (docs/LASSO.md §8): only load and pass its
  // series when THIS viewer enabled it in Settings. Read from the DB rather than the
  // session token so the toggle takes effect without re-login. Anonymous viewers never see it.
  const showAiPanel = viewer?.id
    ? (await prisma.user.findUnique({ where: { id: viewer.id }, select: { showAiPanel: true } }))
        ?.showAiPanel ?? false
    : false
  // Who really created a forecast published as Daatan (#2301): admins only, never in props otherwise.
  const realCreator = viewer?.role === 'ADMIN' ? await getRealCreator(prediction.id) : null

  const [
    initialComments,
    initialContextSnapshots,
    initialContributingSources,
    probabilityHistory,
    aiPanelSeries,
    usableEvidenceCount,
  ] = await Promise.all([
    getInitialComments(prediction.id),
    getInitialContextSnapshots(prediction.id),
    getForecastVoters(prediction.id),
    getProbabilityHistory(prediction.id),
    showAiPanel ? getPanelSeries(prediction.id) : Promise.resolve([]),
    // daatan#1475: how many pool rows the aggregate could use right now. Zero means the
    // published number has nothing behind it a reader could inspect — the gauge says so
    // rather than presenting it unqualified. A live count, so it clears itself the moment
    // one extraction succeeds.
    countUsableEvidence(prediction.id),
  ])
  // Chart series: includes kind='clock' glide requotes (unlike the event
  // timeline above) so the daily time-decay adjustment shows as movement.
  const initialProbabilityHistory = probabilityHistory.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    externalProbability: s.externalProbability,
    kind: s.kind,
  }))

  return {
    initialComments,
    initialContextSnapshots,
    initialContributingSources,
    initialProbabilityHistory,
    // Latest probability-update timestamp (daatan#1295): the page copy's "as of" date and
    // the FAQPage dateModified.
    lastUpdatedISO: latestProbabilityUpdateISO(prediction.updatedAt, initialProbabilityHistory),
    aiPanelSeries,
    showAiPanel,
    usableEvidenceCount,
    realCreator,
  }
}
