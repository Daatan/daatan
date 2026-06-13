import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/env'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getOracleForecast, type ArticleInput } from '@/lib/services/oracle'
import { saveNewsIndexerMatch } from '@/lib/services/context'
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
      select: { id: true, claimText: true, status: true },
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

    const oracleForecast = await getOracleForecast(
      prediction.claimText,
      { articles },
      { source: 'news-indexer', predictionId: prediction.id },
    )

    let probability: number | null = null

    // Per-article enrichment from the Oracle, keyed by url, so news-indexer can map
    // each article in the set back to its own forecast_match row.
    const enrichedSources = (oracleForecast?.sources ?? []).map((s) => ({
      url: s.url,
      stance: s.stance ?? null,
      certainty: s.certainty ?? null,
      claim: s.claims?.[0] ?? null,
    }))

    if (oracleForecast) {
      const toPercent = (v: number) => Math.round(((v + 1) / 2) * 100)
      probability = toPercent(oracleForecast.mean)
      const ciLow = toPercent(oracleForecast.ci_low)
      const ciHigh = toPercent(oracleForecast.ci_high)

      await saveNewsIndexerMatch({
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
          mean: oracleForecast.mean,
          std: oracleForecast.std,
          ciLow,
          ciHigh,
          articlesUsed: oracleForecast.articles_used,
          sources: oracleForecast.sources.map((s) => ({
            sourceId: s.source_id,
            sourceName: s.source_name,
            url: s.url,
            stance: s.stance,
            certainty: s.certainty,
            credibilityWeight: s.credibility_weight,
            claims: s.claims,
          })),
        },
      })

      log.info(
        { predictionId: prediction.id, probability, articles: items.length, similarity: triggerSimilarity },
        'news-indexer: oracle updated',
      )
    } else {
      log.info(
        { predictionId: prediction.id, articles: items.length, similarity: triggerSimilarity },
        'news-indexer: oracle returned null, skipping probability update',
      )
    }

    void notifyNewsArticleMatched(
      { id: prediction.id, claimText: prediction.claimText },
      { title: triggerItem.title, url: triggerItem.url, source: triggerItem.source ?? null },
      triggerSimilarity,
      probability,
      items.length,
    )

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
