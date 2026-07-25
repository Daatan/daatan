import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import type { EnrichedOracleSource } from '@/lib/services/oracle-snapshot'
import type { EvidencePoolArticle, ClaimArchetype, ClaimDirection } from '@prisma/client'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'
import { claimArchetypeParam, claimDirectionParam } from '@/lib/services/oracle'
import { createLogger } from '@/lib/logger'

const log = createLogger('evidence-pool')

/**
 * The per-forecast evidence pool (retro docs/ORACLE_VARIABLES.md §6 part 2).
 *
 * All three estimate paths (analyze / news-indexer / backfill) write their extracted
 * per-source signals here and then read the pool back to compute the persisted estimate —
 * `recomputeFromPool` aggregates the whole pool rather than trusting the articles a single
 * run happened to score (`resolvePooledEstimate` in pooled-estimate.ts is the shared
 * decision; the news-indexer route inlines the same logic). news-indexer was cut over in
 * v1.60.0 (#1121); analyze and backfill followed once that had run in prod.
 *
 * `excluded` (see getPoolArticles/setArticleExcluded below) is an admin's "ignore this
 * article" switch, and is now genuinely enforced: excluded rows are dropped before the
 * aggregate, so an exclusion actually moves the number on every path.
 *
 * 'retry' marks rows whose latest signal came from the pool-retry sweep
 * (pool-retry.ts) re-driving a stuck FAILED/stale-PENDING claim through extraction.
 */
export type PoolOrigin = 'analyze' | 'news-indexer' | 'backfill' | 'retry'

/**
 * Upsert one batch of extracted sources into a forecast's evidence pool, keyed
 * by (predictionId, urlHash) — same URL-normalization as NewsAnchor, so
 * http/https and trailing-slash variants of the same story collapse to one
 * row. The row IS the extraction cache: re-discovering an already-pooled
 * article updates its signal in place rather than accumulating duplicates.
 * Never touches `excluded` — an admin's exclusion decision on an article
 * survives every later re-discovery.
 */
export async function addArticlesToPool(
  predictionId: string,
  sources: EnrichedOracleSource[],
  origin: PoolOrigin,
): Promise<void> {
  await Promise.all(
    sources.map((s) =>
      prisma.evidencePoolArticle.upsert({
        where: { predictionId_urlHash: { predictionId, urlHash: hashUrl(s.url) } },
        create: {
          predictionId,
          url: s.url,
          urlHash: hashUrl(s.url),
          title: s.title,
          source: s.sourceName,
          author: s.author,
          personId: s.personId,
          personName: s.personName,
          outletId: s.outletId,
          outletName: s.outletName,
          publishedDate: s.publishedAt,
          stance: s.stance,
          certainty: s.certainty,
          credibilityWeight: s.credibilityWeight,
          claims: s.claims,
          settled: s.settled,
          settlementEventDate: s.settlementEventDate,
          quantitativeEstimate: s.quantitativeEstimate,
          evidenceWeight: s.evidenceWeight,
          relevanceScore: s.relevanceScore,
          evidenceClass: s.evidenceClass,
          authorLean: s.authorLean,
          authorLeanCertainty: s.authorLeanCertainty,
          factSignal: s.factSignal,
          eventActors: s.eventActors,
          eventTarget: s.eventTarget,
          isOccurrence: s.isOccurrence,
          verified: s.verified,
          origin,
          // No claim step for this row (e.g. the analyze path, which always
          // calls the extractor fresh rather than gating on content-hash) —
          // written straight to COMPLETE. See claimArticleForExtraction below
          // for rows that DO go through the claim lifecycle.
          status: 'COMPLETE',
        },
        update: {
          url: s.url,
          title: s.title,
          source: s.sourceName,
          author: s.author,
          personId: s.personId,
          personName: s.personName,
          outletId: s.outletId,
          outletName: s.outletName,
          publishedDate: s.publishedAt,
          stance: s.stance,
          certainty: s.certainty,
          credibilityWeight: s.credibilityWeight,
          claims: s.claims,
          settled: s.settled,
          settlementEventDate: s.settlementEventDate,
          quantitativeEstimate: s.quantitativeEstimate,
          evidenceWeight: s.evidenceWeight,
          relevanceScore: s.relevanceScore,
          evidenceClass: s.evidenceClass,
          authorLean: s.authorLean,
          authorLeanCertainty: s.authorLeanCertainty,
          factSignal: s.factSignal,
          eventActors: s.eventActors,
          eventTarget: s.eventTarget,
          isOccurrence: s.isOccurrence,
          verified: s.verified,
          origin,
          // Flips a PENDING row (claimed by claimArticleForExtraction, then
          // successfully extracted) to COMPLETE. Deliberately does not touch
          // contentHash — it's already correct from the claim step.
          status: 'COMPLETE',
          statusReason: null,
        },
      }),
    ),
  )
}

/** hash(title+snippet) — the only fields news-indexer's webhook (and the
 *  analyze/backfill search results) actually carry; no full article body
 *  reaches daatan. This is what a live-blog update or a corrected headline
 *  changes; a plain re-crawl of a static article stays stable. */
export function hashArticleContent(title: string, snippet: string): string {
  return crypto.createHash('sha256').update(`${title}\n${snippet}`).digest('hex')
}

/** A PENDING claim older than this is treated as abandoned (crashed request,
 *  process killed mid-extraction) and eligible for a fresh claim — comfortably
 *  past the Oracle's own p99 latency (~226s) so it never preempts a genuinely
 *  in-flight call. */
const PENDING_CLAIM_STALE_MS = 10 * 60 * 1000

export interface ClaimableArticle {
  url: string
  title: string
  snippet: string
  source: string | null
  publishedAt: string | null
}

export type ClaimResult = 'claimed' | 'skip'

/**
 * Atomically claim one (predictionId, url) pair for extraction — the fix for
 * the confirmed news-indexer race (at-least-once webhook delivery let two
 * concurrent pushes both pass a separate findFirst-then-create dedup check
 * before either committed, both call the extractor, both persist a
 * ContextSnapshot). Returns 'claimed' when the caller should proceed to call
 * the extractor for this article; 'skip' when an equivalent, non-stale claim
 * already covers it (either COMPLETE with the same content, or another
 * request's still-fresh PENDING claim).
 *
 * Implemented as create-then-conditional-updateMany rather than a single
 * raw-SQL upsert: both are single atomic statements (Postgres serializes
 * concurrent INSERTs on the same unique key, and a conditional UPDATE's WHERE
 * is evaluated under the same row lock), and this stays on the standard
 * Prisma Client API used everywhere else in this codebase.
 */
export async function claimArticleForExtraction(
  predictionId: string,
  article: ClaimableArticle,
  origin: PoolOrigin,
): Promise<ClaimResult> {
  const urlHash = hashUrl(article.url)
  const contentHash = hashArticleContent(article.title, article.snippet)

  try {
    await prisma.evidencePoolArticle.create({
      data: {
        predictionId,
        url: article.url,
        urlHash,
        title: article.title,
        source: article.source,
        publishedDate: article.publishedAt,
        contentHash,
        status: 'PENDING',
        origin,
      },
    })
    return 'claimed'
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err
  }

  const staleCutoff = new Date(Date.now() - PENDING_CLAIM_STALE_MS)
  const { count } = await prisma.evidencePoolArticle.updateMany({
    where: {
      predictionId,
      urlHash,
      OR: [
        { contentHash: null },
        { contentHash: { not: contentHash } },
        { status: 'FAILED' },
        { status: 'PENDING', updatedAt: { lt: staleCutoff } },
      ],
    },
    data: {
      url: article.url,
      title: article.title,
      source: article.source,
      publishedDate: article.publishedAt,
      contentHash,
      status: 'PENDING',
      statusReason: null,
      origin,
    },
  })
  return count > 0 ? 'claimed' : 'skip'
}

/** Claim a whole evidence set. Per-article results, same order as `articles`. */
export async function claimArticlesForExtraction(
  predictionId: string,
  articles: ClaimableArticle[],
  origin: PoolOrigin,
): Promise<ClaimResult[]> {
  return Promise.all(articles.map((a) => claimArticleForExtraction(predictionId, a, origin)))
}

/**
 * Release a batch of claims after the extractor call itself failed (timeout,
 * provider error) — marks them FAILED with a short machine-readable reason so
 * the staleness window doesn't have to elapse before the next legitimate push
 * retries them. Never throws — mirrors this file's fire-and-forget convention
 * for pool bookkeeping that must not block the caller's real response.
 */
export async function failClaimedArticles(
  predictionId: string,
  urls: string[],
  reason: string,
): Promise<void> {
  if (urls.length === 0) return
  try {
    await prisma.evidencePoolArticle.updateMany({
      where: { predictionId, urlHash: { in: urls.map(hashUrl) }, status: 'PENDING' },
      data: { status: 'FAILED', statusReason: reason.slice(0, 64) },
    })
  } catch (err) {
    log.warn({ predictionId, urls, reason, err }, 'event=evidence_pool_fail_claim_failed')
  }
}

/** List a forecast's pooled articles, most recently added first. Admin visibility only. */
export async function getPoolArticles(predictionId: string): Promise<EvidencePoolArticle[]> {
  return prisma.evidencePoolArticle.findMany({
    where: { predictionId },
    orderBy: { addedAt: 'desc' },
  })
}

/**
 * Admin override: exclude (or re-include) one pooled article. Scoped by
 * predictionId so an admin on one forecast's page can't touch another
 * forecast's row via a guessed articleId. Returns null on no match (caller
 * maps to 404) rather than throwing, matching addArticlesToPool's own
 * error-shape convention of staying silent on ordinary not-found paths.
 */
export async function setArticleExcluded(
  predictionId: string,
  articleId: string,
  excluded: boolean,
): Promise<EvidencePoolArticle | null> {
  const existing = await prisma.evidencePoolArticle.findFirst({
    where: { id: articleId, predictionId },
  })
  if (!existing) return null
  return prisma.evidencePoolArticle.update({
    where: { id: articleId },
    data: { excluded },
  })
}

interface PoolAggregateApiResponse {
  mean: number
  std: number
  ci_low: number
  ci_high: number
  articles_used: number
  settled: boolean
  insufficient_data: boolean
  reason: string | null
}

/**
 * An aggregate over a forecast's whole evidence pool. `mean`/`std`/`ciLow`/`ciHigh`
 * are in the Oracle's stance space [-1, 1] — the same scale `/forecast` returns, so
 * callers convert with `stanceToPercent`/`stanceStdToPercent` exactly as they do for
 * a single-run forecast.
 */
export interface PoolRecompute {
  mean: number
  std: number
  ciLow: number
  ciHigh: number
  articlesUsed: number
  settled: boolean
  insufficientData: boolean
  reason: string | null
  poolSize: number
  usableSize: number
  excludedCount: number
  incompleteCount: number
  /**
   * The exact rows POSTed to `/pool/aggregate` — i.e. the articles the returned
   * estimate is an average of. `usableArticles.length === usableSize`, and (since
   * retro sets `articles_used = len(sources)` and drops nothing internally) equals
   * `articlesUsed` whenever the aggregate is sufficient. Callers persist these as the
   * snapshot's `sources` so the stored blob lists exactly the articles behind its number.
   */
  usableArticles: EvidencePoolArticle[]
}

/**
 * Aggregate a forecast's entire evidence pool into one estimate, via retro's
 * `/pool/aggregate` (retro docs/ORACLE_VARIABLES.md §6).
 *
 * This is what an Oracle estimate *should* be: a credibility-weighted aggregate over
 * every article we have on the claim. A single `/forecast` run only scores the articles
 * handed to it, so on the news-indexer push path — which usually carries exactly one
 * freshly-matched article — its `mean` is little more than that one article's stance
 * rescaled, and the persisted estimate lurches to wherever the newest article points.
 *
 * Returns null when no aggregate can be formed (Oracle unconfigured, no usable pooled
 * articles, transport error, non-200). Never throws: callers fall back to the single-run
 * forecast rather than dropping the estimate entirely. Call it *after* `addArticlesToPool`
 * resolves, so this run's own articles are already in the pool it reads.
 */
export async function recomputeFromPool(
  predictionId: string,
  claimDirection: ClaimDirection | null,
  claimDeadline: Date | null,
  claimCreatedAt: Date | null = null,
  claimArchetype: ClaimArchetype | null = null,
): Promise<PoolRecompute | null> {
  const cfg = getOracleConfig()
  if (!cfg) return null

  const pool = await getPoolArticles(predictionId)
  const excludedCount = pool.filter((a) => a.excluded).length
  const usable = pool.filter(
    (a) =>
      !a.excluded &&
      a.stance !== null &&
      a.certainty !== null &&
      a.credibilityWeight !== null &&
      a.relevanceScore !== null,
  )
  const incompleteCount = pool.length - excludedCount - usable.length
  if (usable.length === 0) return null

  let res: Response
  try {
    res = await oracleFetch(cfg, '/pool/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sources: usable.map((a) => ({
          stance: a.stance,
          certainty: a.certainty,
          credibility_weight: a.credibilityWeight,
          relevance_score: a.relevanceScore,
          evidence_weight: a.evidenceWeight,
          published_date: a.publishedDate,
          settled: a.settled ?? false,
          // The settlement anchor (retro #291) — lets aggregation-time
          // revalidation re-check this vote instead of trusting the stored bit.
          settlement_event_date: a.settlementEventDate,
        })),
        ...(claimDirectionParam(claimDirection) ? { claim_direction: claimDirectionParam(claimDirection) } : {}),
        ...(claimDeadline ? { claim_deadline: claimDeadline.toISOString() } : {}),
        ...(claimCreatedAt ? { claim_created_at: claimCreatedAt.toISOString() } : {}),
        ...(claimArchetypeParam(claimArchetype) ? { claim_archetype: claimArchetypeParam(claimArchetype) } : {}),
      }),
      timeoutMs: 10_000,
    })
  } catch (err) {
    log.warn({ predictionId, err }, 'event=pool_recompute_failed')
    return null
  }
  if (!res.ok) {
    log.warn({ predictionId, status: res.status }, 'event=pool_recompute_failed')
    return null
  }

  const agg: PoolAggregateApiResponse = await res.json()
  return {
    mean: agg.mean,
    std: agg.std,
    ciLow: agg.ci_low,
    ciHigh: agg.ci_high,
    articlesUsed: agg.articles_used,
    settled: agg.settled,
    insufficientData: agg.insufficient_data,
    reason: agg.reason,
    poolSize: pool.length,
    usableSize: usable.length,
    excludedCount,
    incompleteCount,
    usableArticles: usable,
  }
}

interface IngestResolutionApiResponse {
  accepted: boolean
  already_ingested: boolean
  sources_recorded: number
  author_signals_recorded?: number
}

/**
 * Credibility feedback loop, step 2 (retro docs/ORACLE_VARIABLES.md §9):
 * push one resolved forecast's per-source stances to retro's
 * `POST /leaderboard/ingest` so real outcomes can eventually score source
 * credibility, instead of only the frozen, hand-curated vault. Storage-only
 * on retro's side for now — does not affect live `credibility_weight`.
 *
 * BINARY predictions only: stance is a [-1,1] YES-probability signal, which
 * has no clean meaning for a MULTIPLE_CHOICE prediction's per-option
 * correctness. Callers must gate on `outcomeType === 'BINARY'` before
 * calling this (see the resolve route).
 *
 * Excludes `excluded` (admin-excluded) and `opinion`-class articles from the
 * signal (Q7 of the credibility feedback loop interview: an op-ed
 * disagreeing with how a claim resolved isn't the same kind of credibility
 * failure as a reported fact being wrong) and anything missing the fields
 * retro's `ResolutionSourceInput` requires. Skips the call entirely when
 * nothing usable remains — an empty-sources ingest would just be noise in
 * retro's accumulating store.
 *
 * Also carries the author-scoring lane (`author_signals`): every
 * non-excluded row with an `author_lean`, INCLUDING opinion-class — that
 * lane scores the author's own lean, and opinion is precisely where it
 * lives. Retro replays these per (byline author, outlet) into its shadow
 * author board (`GET /leaderboard/author-shadow`).
 *
 * Fire-and-forget: callers must `.catch()` the returned promise themselves,
 * matching `addArticlesToPool`'s own convention — this never blocks or alters
 * the resolution response.
 */
export async function pushCredibilityFeedback(
  predictionId: string,
  outcome: boolean,
  resolvedAt: Date,
): Promise<void> {
  const cfg = getOracleConfig()
  if (!cfg) return

  const pool = await getPoolArticles(predictionId)
  const usable = pool.filter(
    (a) => !a.excluded && a.evidenceClass !== 'opinion' && a.source !== null && a.stance !== null,
  )
  const authorSignals = pool.filter((a) => !a.excluded && a.authorLean !== null)
  if (usable.length === 0 && authorSignals.length === 0) return

  let res: Response
  try {
    res = await oracleFetch(cfg, '/leaderboard/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prediction_id: predictionId,
        outcome,
        resolved_at: resolvedAt.toISOString(),
        sources: usable.map((a) => ({
          source: a.source,
          stance: a.stance,
          evidence_class: a.evidenceClass,
          credibility_weight: a.credibilityWeight,
          evidence_weight: a.evidenceWeight,
        })),
        author_signals: authorSignals.map((a) => ({
          author: a.author,
          outlet_name: a.outletName,
          author_lean: a.authorLean,
          author_lean_certainty: a.authorLeanCertainty,
          evidence_class: a.evidenceClass,
        })),
      }),
      timeoutMs: 10_000,
    })
  } catch (err) {
    log.warn({ predictionId, err }, 'event=credibility_feedback_ingest_failed')
    return
  }
  if (!res.ok) {
    log.warn({ predictionId, status: res.status }, 'event=credibility_feedback_ingest_failed')
    return
  }

  const body: IngestResolutionApiResponse = await res.json()
  log.info(
    {
      predictionId,
      outcome,
      poolSize: pool.length,
      usableSize: usable.length,
      authorSignalsSize: authorSignals.length,
      alreadyIngested: body.already_ingested,
      sourcesRecorded: body.sources_recorded,
      authorSignalsRecorded: body.author_signals_recorded,
    },
    'event=credibility_feedback_ingest',
  )
}
