import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/env'
import { prisma } from '@/lib/prisma'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getOracleForecast, isTransportNullReason, type ArticleInput } from '@/lib/services/oracle'
import { scheduleOracleReask } from '@/lib/services/oracle-backfill'
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
import { hashUrl } from '@/lib/utils/hash'

const log = createLogger('news-indexer-context')

export const dynamic = 'force-dynamic'

/**
 * Wire cap on a forwarded article body.
 *
 * Matches the Oracle's own `max_article_chars` (4000): it truncates to that the moment it
 * accepts the body, so a longer payload is discarded on arrival having crossed two hops. A
 * schema `.max()` rather than a silent `.slice()` — this is the trust boundary, and a producer
 * sending 10 MB bodies should learn it from a 400, not have it quietly trimmed here.
 */
const ARTICLE_TEXT_MAX_CHARS = 4000

// One article in the evidence set. `similarity` is per-article so the trigger
// (the article that fired this push) can be reported even when several are sent.
const articleItemSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  snippet: z.string(),
  source: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  similarity: z.number().min(0).max(1).optional(),
  /** The article body news-indexer already holds in S3 (news-indexer#201). Forwarded to the
   *  Oracle as `ArticleInput.text`, which it has always accepted — "if omitted, oracle fetches
   *  via trafilatura" — and which nothing ever filled: 1.5% of its 88,033 article reads were
   *  pre-fetched, and 19% fell through to running the extractor over title+snippet (~215 chars).
   *  Capped here, not just upstream: this route is the trust boundary, and the Oracle truncates
   *  at 4,000 anyway, so anything longer is discarded after crossing two hops. */
  text: z.string().max(ARTICLE_TEXT_MAX_CHARS).nullable().optional(),
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
    // The legacy body spells its fields `article*`; inside `articles[]` the same value is
    // plain `text`. news-indexer sends whichever matches the shape it is sending.
    articleText: z.string().max(ARTICLE_TEXT_MAX_CHARS).nullable().optional(),
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
              text: body.articleText ?? null,
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
      // The body news-indexer archived at ingest (news-indexer#201 / daatan#1255). Absent — which
      // is every push until news-indexer's `PUSH_ARTICLE_TEXT` is on, and afterwards any article
      // with nothing in S3 — leaves the Oracle fetching the origin exactly as it does today.
      text: a.text ?? undefined,
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

    // Only the newly-claimed articles go to the extractor. Sending the whole
    // (unfiltered) batch here — even after confirming at least one is new —
    // used to re-extract and overwrite already-pooled, content-unchanged
    // articles too, which is the actual mechanism behind daatan#1172's stance
    // jitter (one unchanged article's stance ranging -0.33 to -0.81 across
    // ~30 re-discoveries in 2 days). `articles` stays available below for
    // enrichOracleSources's URL-keyed metadata lookup, which is fine to run
    // over the full set.
    const articlesToScore = articles.filter((_, i) => claimResults[i] === 'claimed')

    // No try/catch: `getOracleForecast` never throws — it classifies every failure and
    // returns. The `extractor_error` branch that used to sit here was unreachable (its
    // only `await` inside the catch, `logOracleCall`, is itself fire-and-forget), so it
    // was dead code claiming to handle a case that cannot occur (daatan#1231).
    const { forecast: oracleForecast, failureClass } = await getOracleForecast(
      prediction.claimText,
      {
        articles: articlesToScore,
        claimDirection: prediction.claimDirection,
        claimDeadline: prediction.claimDeadline,
        claimCreatedAt: prediction.createdAt,
        claimArchetype: prediction.claimArchetype,
      },
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
    // The ContextSnapshot this push created (see saveNewsIndexerMatch) — the manual
    // number-rating feedback loop (daatan#1223) references it as a frozen source for
    // the numbers a rating-prompt message shows, since the row is never mutated later.
    let contextSnapshotId: string | null = null
    // The trigger article's EvidencePoolArticle row (resolved below, after
    // addArticlesToPool writes it) — daatan#1223's rating-prompt message hangs off it.
    let evidencePoolArticleId: string | null = null
    // How many articles the whole evidence pool aggregates (null on the single-run
    // fallback) — header context for the Telegram notification.
    let poolSize: number | null = null

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
      // Judgment-lane signals (Signal Lanes): un-fused from `stance` upstream, shadow-only —
      // nothing in the Oracle's own aggregation reads them yet. Threaded through here so a human
      // reading the match notification can see WHY, the same rationale as `relevance` above.
      authorLean: s.author_lean ?? null,
      authorLeanCertainty: s.author_lean_certainty ?? null,
      factSignal: s.fact_signal ?? null,
      evidenceClass: s.evidence_class ?? null,
      // 1.0 is the neutral default the Oracle returns while the credibility cutover flag is OFF —
      // not a real signal, so callers should treat it as absent rather than display "1.00" as if
      // it meant something.
      credibilityWeight: s.credibility_weight !== 1 ? s.credibility_weight : null,
    }))

    // The article that triggered this push — its enrichment is what both the Telegram
    // notification and the top-level (single-article, back-compat) response fields report.
    // NO fallback to enrichedSources[0]. If the trigger article isn't in the Oracle's sources it
    // wasn't extracted, and the honest answer is "no signal" — not a neighbour's. The fallback
    // that used to sit here was unreachable while PUSH_EVIDENCE_COUNT was 1; prod runs 8, so a
    // push carries the trigger plus up to 7 neighbours and the trigger is routinely the one the
    // Oracle drops. news-indexer writes these top-level fields into forecast_match FOR THE
    // TRIGGER, under the trigger's person_id — so the neighbour's stance was being recorded, and
    // then scored, against a journalist who never made that claim (daatan#1252). Measured before
    // the fix: Telegram ledger rows carrying a stance 2,092 vs 767 articles actually extracted
    // (+173%), against a +7% web control. Every consumer below is `?? null`-guarded already.
    const triggerEnrich = enrichedSources.find((s) => s.url === triggerUrl) ?? null

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
        // addArticlesToPool discards the written rows' ids — re-fetch the trigger
        // article's row by its unique key (daatan#1223's rating-prompt message needs
        // the id to hang the feedback relation off; a lookup miss just means no
        // rating prompt gets sent for this push, not a hard failure).
        const triggerPoolArticle = await prisma.evidencePoolArticle.findUnique({
          where: { predictionId_urlHash: { predictionId: prediction.id, urlHash: hashUrl(triggerUrl) } },
          select: { id: true },
        })
        evidencePoolArticleId = triggerPoolArticle?.id ?? null
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
        poolSize = est.poolSize

        const { stored, contextSnapshotId: snapshotId } = await saveNewsIndexerMatch({
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
        contextSnapshotId = snapshotId

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
      // No estimate to report — release the claims immediately rather than leaving these
      // articles blocked for the full staleness window before a later push can retry them.
      //
      // The reason stamped here is the CLASS, not a blanket `oracle_null` (daatan#1231).
      // The old comment on this branch — "the extractor ran, just produced nothing usable"
      // — was simply untrue for the transport share: with a 12s client budget against
      // retro's 90s, a timeout and an all-articles-off-topic abstention wrote byte-identical
      // rows, and the real cause survived only in OracleCallLog, which the retry sweep never
      // reads. `oracle_null` remains the residual for the (unreachable) unclassified case.
      // Scoped to THIS request's own claims, like the success path 130 lines above
      // (daatan#1232). Unfiltered, a null forecast also failed articles a concurrent
      // request had just claimed and was still extracting: `failClaimedArticles` only
      // touches PENDING rows, and a fresh in-flight claim is exactly that. The other
      // request would then complete against a row this one had already marked FAILED.
      await failClaimedArticles(
        prediction.id,
        items.filter((_, i) => claimResults[i] === 'claimed').map((a) => a.url),
        failureClass ?? 'oracle_null',
      )
      // A transport class means we hung up, not that the articles said nothing —
      // retro does not cancel, so it is finishing the run and will hold the answer
      // in `forecast_cache` for an hour. Go back for it (daatan#1261/#1262).
      //
      // The set handed over is `items.filter(claimed)`, which is `articlesToScore`
      // by URL: same filter, same order, same source array. That identity is the
      // whole mechanism — retro keys its cache on the sorted URL set, so a set that
      // merely overlaps re-runs the extractor and inverts the saving.
      if (isTransportNullReason(failureClass)) {
        scheduleOracleReask(
          prediction,
          items
            .filter((_, i) => claimResults[i] === 'claimed')
            .map((a) => ({
              url: a.url,
              title: a.title,
              snippet: a.snippet,
              source: a.source ?? undefined,
              publishedDate: a.publishedAt ?? undefined,
            })),
          'news-indexer',
        )
      }
      log.info(
        { predictionId: prediction.id, articles: items.length, similarity: triggerSimilarity, failureClass },
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
          // What the Oracle actually read out of the article — the claim its numbers scored.
          // Falls back to the raw snippet when extraction produced no claim text.
          extract: triggerEnrich?.claim ?? (triggerItem.snippet || null),
          stance: triggerEnrich?.stance ?? null,
          certainty: triggerEnrich?.certainty ?? null,
          relevance: triggerEnrich?.relevance ?? null,
          authorLean: triggerEnrich?.authorLean ?? null,
          authorLeanCertainty: triggerEnrich?.authorLeanCertainty ?? null,
          factSignal: triggerEnrich?.factSignal ?? null,
          evidenceClass: triggerEnrich?.evidenceClass ?? null,
          credibilityWeight: triggerEnrich?.credibilityWeight ?? null,
        },
        { similarity: triggerSimilarity, articleCount: items.length, poolSize },
        { probability, previous: prediction.confidence, ciLow, ciHigh },
        // Rating buttons (daatan#1223) attach directly to the notification; skipped when the
        // trigger article's pool row couldn't be resolved — nothing to hang the feedback off.
        evidencePoolArticleId ? { evidencePoolArticleId, contextSnapshotId } : null,
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
