import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/env'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getOracleForecast, type ArticleInput } from '@/lib/services/oracle'
import { stanceToPercent, stanceStdToPercent, enrichOracleSources } from '@/lib/services/oracle-snapshot'
import { saveNewsIndexerMatch } from '@/lib/services/context'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import {
  addArticlesToPool,
  claimArticlesForExtraction,
  failClaimedArticles,
} from '@/lib/services/evidence-pool'
import { resolvePooledEstimate, type ResolvedPoolEstimate } from '@/lib/services/pooled-estimate'
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
    // Trigger article's gatekeeper verdict (news-indexer's POST /relevance result), top-level in
    // both body shapes. Threaded into the Oracle ArticleInput so it can reuse the verdict instead
    // of re-judging. Optional: the matcher fast-path push omits it. See MATCHING_ARCHITECTURE.md §3.
    relevance: z.number().min(0).max(1).nullable().optional(),
    isPrediction: z.boolean().nullable().optional(),
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
        createdAt: true,
        claimArchetype: true,
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
      // Reuse the gatekeeper verdict news-indexer already computed for the TRIGGER article, so the
      // Oracle skips re-judging it (pairs with retro's reuse_supplied_relevance flag). Only the
      // trigger carries a verdict — the evidence neighbours were never judged. Fail-open: absent
      // verdict, or the Oracle flag off, and it judges exactly as today.
      ...(a.url === triggerUrl && body.relevance != null && body.isPrediction != null
        ? { relevance: body.relevance, isPrediction: body.isPrediction }
        : {}),
    }))

    // Atomic claim gate (evidence-pool.ts) — fixes a confirmed race where
    // news-indexer's at-least-once webhook delivery let two near-simultaneous
    // pushes for the same article both call the (slow, non-deterministic)
    // extractor and both persist a snapshot. If every article in this push is
    // either already-extracted-with-identical-content or claimed by another
    // still-fresh in-flight request, there is nothing new to extract — skip
    // the Oracle call entirely rather than paying for a redundant/racy run.
    const claimResults = await claimArticlesForExtraction(
      prediction.id,
      items.map((a) => ({
        url: a.url,
        title: a.title,
        snippet: a.snippet,
        source: a.source ?? null,
        publishedAt: a.publishedAt ?? null,
      })),
      'news-indexer',
    )
    if (!claimResults.some((r) => r === 'claimed')) {
      log.info(
        { predictionId: prediction.id, articles: items.length },
        'news-indexer: all articles already claimed/unchanged, skipping oracle call',
      )
      return NextResponse.json({
        ok: true,
        stance: null,
        certainty: null,
        claim: null,
        probability: null,
        sources: [],
        skipped: 'unchanged',
      })
    }

    let oracleForecast: Awaited<ReturnType<typeof getOracleForecast>>['forecast']
    try {
      ;({ forecast: oracleForecast } = await getOracleForecast(
        prediction.claimText,
        {
          articles,
          claimDirection: prediction.claimDirection,
          claimDeadline: prediction.claimDeadline,
          claimCreatedAt: prediction.createdAt,
          claimArchetype: prediction.claimArchetype,
        },
        { source: 'news-indexer', predictionId: prediction.id },
      ))
    } catch (err) {
      await failClaimedArticles(prediction.id, items.map((a) => a.url), 'extractor_error')
      throw err
    }

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
      // The Oracle's claim-aware relevance for this article. It was being dropped here — the same
      // way `author` was, before #1067 — so news-indexer could never see WHY an article counted,
      // only that it did. It is the one number that explains a match: the embedding cosine says
      // how similar the text looks, this says whether it actually bears on the claim.
      relevance: s.relevance_score ?? null,
    }))

    // The article that triggered this push — its enrichment is what both the Telegram
    // notification and the top-level (single-article, back-compat) response fields report.
    const triggerEnrich = enrichedSources.find((s) => s.url === triggerUrl) ?? enrichedSources[0]

    if (oracleForecast) {
      // Attach authors to the Oracle's sources (it omits them); best-effort, never blocks the
      // estimate. Mirrors /api/forecasts/[id]/context. Without this the snapshot records the
      // outlet but no byline, and every consumer of `oracleSnapshot.sources[].author` — notably
      // elections.daatan.com's tracked commentators — can never match a person.
      const articleMeta = await getArticleMetaByUrl(oracleForecast.sources.map((s) => s.url))
      const authorByUrl = new Map([...articleMeta.entries()].map(([url, m]) => [url, m.author]))
      const identityByUrl = new Map(
        [...articleMeta.entries()].map(([url, m]) => [url, {
          personId: m.personId ?? null, personName: m.personName ?? null,
          outletId: m.outletId ?? null, outletName: m.outletName ?? null,
        }]),
      )
      const oracleSources = enrichOracleSources(oracleForecast.sources, articles, authorByUrl, identityByUrl)

      // The Oracle run above is an EXTRACTION step, not the estimate. A push usually
      // carries a single freshly-matched article, and `/forecast` over one article returns
      // little more than that article's stance rescaled — so trusting it made the persisted
      // estimate lurch to wherever the newest article pointed (one live forecast swung
      // 1% → 99% in 19 minutes on two articles reporting the same event). So: persist this
      // run's extractions into the pool, then aggregate the WHOLE pool. `resolvePooledEstimate`
      // is the shared decision (also used by analyze/backfill): pool aggregate when usable,
      // this run as fallback when the pool can't be read, ABSTAIN when the pool is off-topic.
      // Pass the authors already fetched for this push so overlapping pool URLs aren't re-queried.
      let resolved: ResolvedPoolEstimate | null = null
      try {
        await addArticlesToPool(prediction.id, oracleSources, 'news-indexer')
        // The pool write above flips this run's extracted claims to COMPLETE. Anything
        // this run claimed that the Oracle omitted from its sources (gatekeeper-rejected,
        // most commonly) would otherwise stay PENDING forever: news-indexer dedups its
        // matches, so no later push comes along to re-claim it — 985 such rows had
        // accumulated by 2026-07-16. failClaimedArticles only touches rows still
        // PENDING, so the set-difference against what completed happens in SQL. Scoped
        // to this run's own claims so a concurrent run's fresh in-flight claim survives.
        await failClaimedArticles(
          prediction.id,
          items.filter((_, i) => claimResults[i] === 'claimed').map((a) => a.url),
          'oracle_omitted',
        )
        resolved = await resolvePooledEstimate(
          prediction.id,
          {
            mean: oracleForecast.mean,
            std: oracleForecast.std,
            ciLow: oracleForecast.ci_low,
            ciHigh: oracleForecast.ci_high,
            settled: oracleForecast.settled ?? false,
            articlesUsed: oracleForecast.articles_used,
          },
          oracleSources,
          prediction.claimDirection,
          prediction.claimDeadline,
          authorByUrl,
          prediction.createdAt,
          prediction.claimArchetype,
        )
      } catch (err) {
        log.warn({ predictionId: prediction.id, err }, 'evidence pool write/recompute failed')
      }
      // A throw above (e.g. addArticlesToPool failed) leaves `resolved` null — fall back to
      // this run, exactly as resolvePooledEstimate does when it can't read the pool itself.
      const est: ResolvedPoolEstimate = resolved ?? {
        mean: oracleForecast.mean,
        std: oracleForecast.std,
        ciLow: oracleForecast.ci_low,
        ciHigh: oracleForecast.ci_high,
        settled: oracleForecast.settled ?? false,
        articlesUsed: oracleForecast.articles_used,
        snapshotSources: oracleSources,
        estimateSource: 'single-run',
        insufficientData: false,
        reason: null,
        poolSize: null,
        singleRunMean: oracleForecast.mean,
      }

      const matchSources = items.map((a) => ({
        url: a.url,
        title: a.title,
        source: a.source ?? null,
        publishedDate: a.publishedAt ?? null,
      }))

      if (est.insufficientData) {
        // The whole pool is off-topic — abstain rather than persist a number built from
        // articles the Oracle judged irrelevant. Nulls confidence/CI; `probability` stays
        // null so the notify block below is skipped. (A forecast with any prior on-topic
        // evidence can't reach here: those rows keep their relevance in the accumulating pool.)
        const { stored } = await saveNewsIndexerMatch({
          predictionId: prediction.id,
          sources: matchSources,
          externalProbability: null,
          ciLow: null,
          ciHigh: null,
          insufficientData: true,
          oracleSnapshot: { sources: [], insufficient: true, reason: est.reason },
        })
        wasStored = stored
        log.info(
          {
            predictionId: prediction.id,
            articles: items.length,
            similarity: triggerSimilarity,
            estimateSource: 'pool-insufficient',
            poolSize: est.poolSize,
            reason: est.reason,
            singleRunMean: est.singleRunMean,
          },
          'news-indexer: oracle abstained (off-topic pool)',
        )
      } else {
        probability = stanceToPercent(est.mean)
        ciLow = stanceToPercent(est.ciLow)
        ciHigh = stanceToPercent(est.ciHigh)

        const { stored } = await saveNewsIndexerMatch({
          predictionId: prediction.id,
          sources: matchSources,
          externalProbability: probability,
          ciLow,
          ciHigh,
          oracleSnapshot: {
            mean: probability,
            std: stanceStdToPercent(est.std),
            ciLow,
            ciHigh,
            articlesUsed: est.articlesUsed,
            settled: est.settled,
            // The whole usable pool on the pool path (`sources.length === articlesUsed`),
            // this push's sources on the single-run fallback — see resolvePooledEstimate.
            sources: est.snapshotSources,
          },
          settled: est.settled,
        })
        wasStored = stored

        log.info(
          {
            predictionId: prediction.id,
            probability,
            stored,
            articles: items.length,
            similarity: triggerSimilarity,
            // Which path produced the number, and how far the single run would have been —
            // a large `singleRunDelta` is the signature of one article yanking the estimate.
            estimateSource: est.estimateSource,
            poolSize: est.poolSize,
            articlesUsed: est.articlesUsed,
            singleRunMean: est.singleRunMean,
            singleRunDelta: est.estimateSource === 'pool' ? Math.abs(est.singleRunMean - est.mean) : null,
            // How many of THIS push's Oracle sources carried a byline — the signal that makes
            // per-commentator attribution possible downstream. 0 means the lookup found none.
            bylines: oracleSources.filter((s) => s.author != null).length,
            oracleSources: oracleSources.length,
            // What actually landed in the persisted snapshot's `sources` and how many carried
            // a byline — the attribution coverage of the stored record.
            snapshotSources: est.snapshotSources.length,
            snapshotBylines: est.snapshotSources.filter((s) => s.author != null).length,
          },
          'news-indexer: oracle updated',
        )
      }
    } else {
      // No estimate to report, but the claim itself still succeeded (the
      // extractor ran, just produced nothing usable) — release it immediately
      // rather than leaving these articles blocked for the full staleness
      // window before a later push can retry them.
      await failClaimedArticles(prediction.id, items.map((a) => a.url), 'oracle_null')
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
        {
          title: triggerItem.title,
          url: triggerItem.url,
          source: triggerItem.source ?? null,
          stance: triggerEnrich?.stance ?? null,
          relevance: triggerEnrich?.relevance ?? null,
        },
        { similarity: triggerSimilarity, articleCount: items.length },
        { probability, previous: prediction.confidence, ciLow, ciHigh },
      )
    }

    // Top-level fields echo the trigger article's enrichment (back-compat with the
    // single-article contract); `sources` carries the whole set for the multi push.
    return NextResponse.json({
      ok: true,
      stance: triggerEnrich?.stance ?? null,
      certainty: triggerEnrich?.certainty ?? null,
      claim: triggerEnrich?.claim ?? null,
      relevance: triggerEnrich?.relevance ?? null,
      probability,
      // The estimate this push REPLACED. news-indexer records it so a match can be read as a
      // movement (63% → 71%) rather than a bare number, which is what makes a digest legible.
      // `prediction.confidence` is still the pre-push value here — saveNewsIndexerMatch has run,
      // but `prediction` is the object we loaded before it.
      previousProbability: prediction.confidence ?? null,
      sources: enrichedSources,
    })
  } catch (error) {
    return handleRouteError(error, 'Failed to process news-indexer context push')
  }
}
