import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/env'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getOracleForecast, type ArticleInput } from '@/lib/services/oracle'
import { stanceToPercent, stanceStdToPercent, enrichOracleSources } from '@/lib/services/oracle-snapshot'
import { saveNewsIndexerMatch } from '@/lib/services/context'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import { addArticlesToPool, shadowCompareRecompute } from '@/lib/services/evidence-pool'
import { notifyNewsArticleMatched } from '@/lib/services/telegram'
import { createLogger } from '@/lib/logger'

const log = createLogger('news-indexer-context')

export const dynamic = 'force-dynamic'

// One article in the evidence set. `similarity` is per-article so the trigger
// (the article that fired this push) can be reported even when several are sent.
const articleItemSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  snippet: z.string(),
  source: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  similarity: z.number().min(0).max(1).optional(),
})

// Accepts two shapes:
//   • new:    { predictionId, articles: [...], triggerArticleUrl? }
//   • legacy: { predictionId, articleUrl, articleTitle, articleSnippet, ... , similarity }
// The legacy single-article fields are normalized into a 1-element `articles` set,
// so existing news-indexer callers keep working during the rollout.
const bodySchema = z
  .object({
    predictionId: z.string().min(1),
    articles: z.array(articleItemSchema).min(1).optional(),
    triggerArticleUrl: z.string().url().optional(),
    // legacy single-article fields
    articleUrl: z.string().url().optional(),
    articleTitle: z.string().min(1).optional(),
    articleSnippet: z.string().optional(),
    articleSource: z.string().nullable().optional(),
    publishedAt: z.string().nullable().optional(),
    similarity: z.number().min(0).max(1).optional(),
  })
  .refine(
    (b) => (b.articles && b.articles.length > 0) || (b.articleUrl && b.articleTitle),
    { message: 'Provide either `articles[]` or the single-article fields' },
  )

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-news-indexer-secret')
  if (!env.NEWS_INDEXER_SECRET || !secret || secret !== env.NEWS_INDEXER_SECRET) {
    return apiError('Unauthorized', 401)
  }

  try {
    const body = bodySchema.parse(await request.json())

    const prediction = await prisma.prediction.findUnique({
      where: { id: body.predictionId },
      select: {
        id: true,
        claimText: true,
        status: true,
        slug: true,
        confidence: true,
        claimDirection: true,
        claimDeadline: true,
      },
    })

    if (!prediction) return apiError('Prediction not found', 404)
    if (prediction.status !== 'ACTIVE') return apiError('Prediction is not active', 409)

    // Normalize to a single evidence set, regardless of which shape arrived.
    const items =
      body.articles && body.articles.length > 0
        ? body.articles
        : [
            {
              url: body.articleUrl!,
              title: body.articleTitle!,
              snippet: body.articleSnippet ?? '',
              source: body.articleSource ?? null,
              publishedAt: body.publishedAt ?? null,
              similarity: body.similarity,
            },
          ]

    // The "trigger" is the article that fired this push — used for the Telegram
    // line and the top-level enrichment news-indexer writes to its ledger row.
    const triggerUrl = body.triggerArticleUrl ?? items[0].url
    const triggerItem = items.find((a) => a.url === triggerUrl) ?? items[0]
    const triggerSimilarity = triggerItem.similarity ?? body.similarity ?? 0

    const articles: ArticleInput[] = items.map((a) => ({
      url: a.url,
      title: a.title,
      snippet: a.snippet,
      source: a.source ?? undefined,
      publishedDate: a.publishedAt ?? undefined,
    }))

    const { forecast: oracleForecast } = await getOracleForecast(
      prediction.claimText,
      { articles, claimDirection: prediction.claimDirection, claimDeadline: prediction.claimDeadline },
      { source: 'news-indexer', predictionId: prediction.id },
    )

    let probability: number | null = null
    // Only set alongside probability, in the same block below — kept in this
    // outer scope so the Telegram notify call (after the block) can read them.
    let ciLow: number | null = null
    let ciHigh: number | null = null
    // False for a re-delivered push saveNewsIndexerMatch recognized as a dedup
    // (see context.ts) — nothing changed, so nothing should notify either.
    let wasStored = false

    // Per-article enrichment from the Oracle, keyed by url, so news-indexer can map
    // each article in the set back to its own forecast_match row.
    const enrichedSources = (oracleForecast?.sources ?? []).map((s) => ({
      url: s.url,
      stance: s.stance ?? null,
      certainty: s.certainty ?? null,
      claim: s.claims?.[0] ?? null,
    }))

    if (oracleForecast) {
      probability = stanceToPercent(oracleForecast.mean)
      ciLow = stanceToPercent(oracleForecast.ci_low)
      ciHigh = stanceToPercent(oracleForecast.ci_high)

      // Attach authors to the Oracle's sources (it omits them); best-effort, never blocks the
      // estimate. Mirrors /api/forecasts/[id]/context. Without this the snapshot records the
      // outlet but no byline, and every consumer of `oracleSnapshot.sources[].author` — notably
      // elections.daatan.com's tracked commentators — can never match a person.
      const articleMeta = await getArticleMetaByUrl(oracleForecast.sources.map((s) => s.url))
      const authorByUrl = new Map([...articleMeta.entries()].map(([url, m]) => [url, m.author]))
      const oracleSources = enrichOracleSources(oracleForecast.sources, articles, authorByUrl)

      // Evidence pool shadow-write + recompute shadow-compare (retro
      // docs/ORACLE_VARIABLES.md §6 part 2, step 6) — additive only, never
      // blocks or alters the estimate below. Chained (not parallel) so the
      // recompute reads a pool that already includes this run's articles.
      addArticlesToPool(prediction.id, oracleSources, 'news-indexer')
        .then(() =>
          shadowCompareRecompute(
            prediction.id,
            {
              mean: oracleForecast.mean,
              ciLow: oracleForecast.ci_low,
              ciHigh: oracleForecast.ci_high,
              settled: oracleForecast.settled ?? false,
            },
            prediction.claimDirection,
            prediction.claimDeadline,
          ),
        )
        .catch((err) =>
          log.warn({ predictionId: prediction.id, err }, 'evidence pool shadow-write/recompute-compare failed'),
        )

      const { stored } = await saveNewsIndexerMatch({
        predictionId: prediction.id,
        sources: items.map((a) => ({
          url: a.url,
          title: a.title,
          source: a.source ?? null,
          publishedDate: a.publishedAt ?? null,
        })),
        externalProbability: probability,
        ciLow,
        ciHigh,
        oracleSnapshot: {
          mean: probability,
          std: stanceStdToPercent(oracleForecast.std),
          ciLow,
          ciHigh,
          articlesUsed: oracleForecast.articles_used,
          settled: oracleForecast.settled ?? false,
          sources: oracleSources,
        },
        settled: oracleForecast.settled ?? false,
      })
      wasStored = stored

      log.info(
        {
          predictionId: prediction.id,
          probability,
          stored,
          articles: items.length,
          similarity: triggerSimilarity,
          // How many of the Oracle's sources carried a byline — the signal that makes
          // per-commentator attribution possible downstream. 0 means the lookup found none.
          bylines: oracleSources.filter((s) => s.author != null).length,
          oracleSources: oracleSources.length,
        },
        'news-indexer: oracle updated',
      )
    } else {
      log.info(
        { predictionId: prediction.id, articles: items.length, similarity: triggerSimilarity },
        'news-indexer: oracle returned null, skipping probability update',
      )
    }

    // Notify only when the push produced an estimate AND it was actually stored.
    // news-indexer re-pushes the same article set on every poll cycle while its
    // cooldown rolls — the Oracle-null case is one such retry (no estimate to
    // report yet), and a repeat push that lands on an identical measurement is
    // another (saveNewsIndexerMatch's dedup catches that one, hence `wasStored`).
    // Skipping both means every notification reflects a real change.
    if (probability !== null && wasStored) {
      void notifyNewsArticleMatched(
        { id: prediction.id, claimText: prediction.claimText, slug: prediction.slug },
        { title: triggerItem.title, url: triggerItem.url, source: triggerItem.source ?? null },
        { similarity: triggerSimilarity, articleCount: items.length },
        { probability, previous: prediction.confidence, ciLow, ciHigh },
      )
    }

    // Top-level fields echo the trigger article's enrichment (back-compat with the
    // single-article contract); `sources` carries the whole set for the multi push.
    const triggerEnrich = enrichedSources.find((s) => s.url === triggerUrl) ?? enrichedSources[0]
    return NextResponse.json({
      ok: true,
      stance: triggerEnrich?.stance ?? null,
      certainty: triggerEnrich?.certainty ?? null,
      claim: triggerEnrich?.claim ?? null,
      probability,
      sources: enrichedSources,
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to process news-indexer context push')
  }
}
