import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import type { EnrichedOracleSource } from '@/lib/services/oracle-snapshot'
import type { EvidencePoolArticle, ClaimDirection } from '@prisma/client'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'
import { claimDirectionParam } from '@/lib/services/oracle'
import { createLogger } from '@/lib/logger'

const log = createLogger('evidence-pool')

/**
 * Foundation layer for the per-forecast evidence pool (retro
 * docs/ORACLE_VARIABLES.md §6 part 2). Nothing reads this table to compute an
 * estimate yet — analyze/news-indexer/backfill only shadow-write their
 * per-source signals here, in addition to their existing writes, so real
 * data accumulates ahead of the future recompute-over-pool cutover.
 * `excluded` (see getPoolArticles/setArticleExcluded below) is settable by an
 * admin today but not yet enforced by any computation for the same reason —
 * it's ready for the cutover, not a component of it.
 */
export type PoolOrigin = 'analyze' | 'news-indexer' | 'backfill'

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
          publishedDate: s.publishedAt,
          stance: s.stance,
          certainty: s.certainty,
          credibilityWeight: s.credibilityWeight,
          claims: s.claims,
          settled: s.settled,
          quantitativeEstimate: s.quantitativeEstimate,
          evidenceWeight: s.evidenceWeight,
          relevanceScore: s.relevanceScore,
          evidenceClass: s.evidenceClass,
          origin,
        },
        update: {
          url: s.url,
          title: s.title,
          source: s.sourceName,
          publishedDate: s.publishedAt,
          stance: s.stance,
          certainty: s.certainty,
          credibilityWeight: s.credibilityWeight,
          claims: s.claims,
          settled: s.settled,
          quantitativeEstimate: s.quantitativeEstimate,
          evidenceWeight: s.evidenceWeight,
          relevanceScore: s.relevanceScore,
          evidenceClass: s.evidenceClass,
          origin,
        },
      }),
    ),
  )
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
  ci_low: number
  ci_high: number
  articles_used: number
  settled: boolean
  insufficient_data: boolean
  reason: string | null
}

/** The subset of a live /forecast result needed to log a shadow comparison. */
export interface LiveForecastForComparison {
  mean: number
  ciLow: number
  ciHigh: number
  settled: boolean
}

/**
 * Shadow-compare retro's `/pool/aggregate` recompute against a live
 * `/forecast` result — log only, never affects the persisted estimate (retro
 * docs/ORACLE_VARIABLES.md, recompute-over-pool step 4). Proves the recompute
 * pipeline produces sane, comparable numbers before any path is cut over to
 * trust it.
 *
 * Fire-and-forget: never throws, callers should chain this *after*
 * `addArticlesToPool` resolves (not run in parallel with it) so the current
 * run's article is already in the pool the recompute reads — and must
 * `.catch()` the returned promise themselves, matching `addArticlesToPool`'s
 * own convention.
 */
export async function shadowCompareRecompute(
  predictionId: string,
  live: LiveForecastForComparison,
  claimDirection: ClaimDirection | null,
  claimDeadline: Date | null,
): Promise<void> {
  const cfg = getOracleConfig()
  if (!cfg) return

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
  if (usable.length === 0) return

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
        })),
        ...(claimDirectionParam(claimDirection) ? { claim_direction: claimDirectionParam(claimDirection) } : {}),
        ...(claimDeadline ? { claim_deadline: claimDeadline.toISOString() } : {}),
      }),
      timeoutMs: 10_000,
    })
  } catch (err) {
    log.warn({ predictionId, err }, 'event=pool_recompute_shadow_failed')
    return
  }
  if (!res.ok) {
    log.warn({ predictionId, status: res.status }, 'event=pool_recompute_shadow_failed')
    return
  }

  const agg: PoolAggregateApiResponse = await res.json()
  log.info(
    {
      predictionId,
      poolSize: pool.length,
      usableSize: usable.length,
      excludedCount,
      incompleteCount,
      liveMean: live.mean,
      recomputeMean: agg.mean,
      meanDelta: Math.abs(live.mean - agg.mean),
      liveCiLow: live.ciLow,
      liveCiHigh: live.ciHigh,
      recomputeCiLow: agg.ci_low,
      recomputeCiHigh: agg.ci_high,
      liveSettled: live.settled,
      recomputeSettled: agg.settled,
      recomputeInsufficient: agg.insufficient_data,
      recomputeReason: agg.reason,
    },
    'event=pool_recompute_shadow',
  )
}

interface IngestResolutionApiResponse {
  accepted: boolean
  already_ingested: boolean
  sources_recorded: number
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
 * Fire-and-forget: callers must `.catch()` the returned promise themselves,
 * matching `addArticlesToPool`/`shadowCompareRecompute`'s own convention —
 * this never blocks or alters the resolution response.
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
  if (usable.length === 0) return

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
      alreadyIngested: body.already_ingested,
      sourcesRecorded: body.sources_recorded,
    },
    'event=credibility_feedback_ingest',
  )
}
