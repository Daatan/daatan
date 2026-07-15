import type { ClaimDirection } from '@prisma/client'
import { recomputeFromPool, type PoolRecompute } from '@/lib/services/evidence-pool'
import { poolArticleToEnrichedSource, type EnrichedOracleSource } from '@/lib/services/oracle-snapshot'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'

/**
 * A single `/forecast` run's estimate, in the Oracle's stance space [-1, 1] — the caller's
 * fallback when the pool can't produce an aggregate.
 */
export interface SingleRunEstimate {
  mean: number
  std: number
  ciLow: number
  ciHigh: number
  settled: boolean
  articlesUsed: number
}

export interface ResolvedPoolEstimate extends SingleRunEstimate {
  /**
   * The sources to persist in `oracleSnapshot.sources`: the whole usable pool on the pool
   * path — the exact rows the aggregate averaged, so `snapshotSources.length === articlesUsed`
   * — or the caller's single-run sources on the fallback.
   */
  snapshotSources: EnrichedOracleSource[]
  estimateSource: 'pool' | 'single-run'
  /** Diagnostics for the caller's log line. `poolSize` is null when no pool read happened. */
  poolSize: number | null
  singleRunMean: number
}

/**
 * Decide one forecast's persisted estimate from its evidence pool, exactly as the
 * news-indexer push path does since v1.60.0 (#1121): aggregate the WHOLE pool
 * (`recomputeFromPool`) and trust that, falling back to the caller's single `/forecast`
 * run only when the pool can't aggregate — Oracle unreachable, nothing usable pooled yet,
 * or `insufficient_data`. A single run scores only the articles handed to it, so trusting
 * it let the newest article yank the persisted estimate; the pool puts one extraction in
 * proportion to all the evidence gathered for the claim.
 *
 * On the pool path the returned `snapshotSources` are the whole usable pool, so a caller's
 * stored snapshot lists precisely the articles behind its number (`sources.length ===
 * articlesUsed`). Authors aren't kept on pool rows, so they're re-looked-up from news-indexer
 * by URL — best-effort, reusing any the caller already fetched (pass `authorByUrl`).
 *
 * Shared by the analyze route and the backfill. Call it AFTER `addArticlesToPool` has
 * resolved, so this run's own articles are already in the pool it reads. The `/pool/aggregate`
 * call is compute-only (no search, no LLM), so it's fast; a caller under a hard timeout can
 * await it without meaningfully widening its budget, and gets the single run back if it fails.
 */
export async function resolvePooledEstimate(
  predictionId: string,
  singleRun: SingleRunEstimate,
  fallbackSources: EnrichedOracleSource[],
  claimDirection: ClaimDirection | null,
  claimDeadline: Date | null,
  authorByUrl: Map<string, string | null> = new Map(),
): Promise<ResolvedPoolEstimate> {
  let pool: PoolRecompute | null = null
  try {
    pool = await recomputeFromPool(predictionId, claimDirection, claimDeadline)
  } catch {
    // recomputeFromPool already swallows transport/non-200 into null; this guards only an
    // unexpected throw (e.g. the pool read itself failing) so a caller never loses its estimate.
    pool = null
  }
  const poolEstimate = pool !== null && !pool.insufficientData ? pool : null

  if (!poolEstimate) {
    return {
      ...singleRun,
      snapshotSources: fallbackSources,
      estimateSource: 'single-run',
      poolSize: pool?.poolSize ?? null,
      singleRunMean: singleRun.mean,
    }
  }

  const missing = poolEstimate.usableArticles.map((a) => a.url).filter((u) => !authorByUrl.has(u))
  if (missing.length > 0) {
    for (const [url, m] of await getArticleMetaByUrl(missing)) authorByUrl.set(url, m.author)
  }
  const snapshotSources = poolEstimate.usableArticles.map((a) =>
    poolArticleToEnrichedSource(a, authorByUrl.get(a.url) ?? null),
  )

  return {
    mean: poolEstimate.mean,
    std: poolEstimate.std,
    ciLow: poolEstimate.ciLow,
    ciHigh: poolEstimate.ciHigh,
    settled: poolEstimate.settled,
    articlesUsed: poolEstimate.articlesUsed,
    snapshotSources,
    estimateSource: 'pool',
    poolSize: poolEstimate.poolSize,
    singleRunMean: singleRun.mean,
  }
}
