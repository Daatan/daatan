import type { ClaimArchetype, ClaimDirection } from '@prisma/client'
import { recomputeFromPool, type PoolRecompute } from '@/lib/services/evidence-pool'
import {
  poolArticleToEnrichedSource,
  oracleSnapshotToContributingSources,
  type EnrichedOracleSource,
} from '@/lib/services/oracle-snapshot'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import { getLatestOracleSnapshot } from '@/lib/services/context'

/**
 * A single `/forecast` run's estimate, in the Oracul's stance space [-1, 1] — the caller's
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
   * — the caller's single-run sources on the fallback, and empty when `insufficientData`.
   */
  snapshotSources: EnrichedOracleSource[]
  estimateSource: 'pool' | 'single-run' | 'pool-insufficient'
  /**
   * The pool aggregated but returned no usable estimate — in prod either
   * `all_articles_off_topic` or `no_usable_weight` (see `reason`; the Oracul may add more,
   * so never switch on the value here). The caller must record an ABSTENTION
   * (probability null, snapshot `insufficientData: true`), NOT fall back to the single run:
   * that run scored the same off-topic articles, so its number is meaningless. The
   * `mean`/`ciLow`/… fields are the single run's and are unused in this case.
   */
  insufficientData: boolean
  /** The pool's insufficiency reason (e.g. `all_articles_off_topic`, `no_usable_weight`), or null. */
  reason: string | null
  /** Diagnostics for the caller's log line. `poolSize` is null when no pool read happened. */
  poolSize: number | null
  /**
   * Of those `poolSize` rows, how many the aggregate could actually use — the rest failed
   * extraction, were excluded, or came back incomplete. Null when no pool read happened.
   * Quoted alongside `poolSize` wherever a pool size is shown to a human: 46% of all pool
   * rows are FAILED, so the raw count overstates real evidence by roughly 2× (daatan#1475).
   */
  usableSize: number | null
  singleRunMean: number
  /** Pool-path diagnostics (retro#458 Phase 2) — null on the single-run/pool-insufficient
   *  outcomes, where no aggregate weight was ever computed. See `PoolRecompute`. */
  evidenceMass: number | null
  nEff: number | null
  ageAdjustedMass: number | null
}

/**
 * Decide one forecast's persisted estimate from its evidence pool, exactly as the
 * news-indexer push path does since v1.60.0 (#1121): aggregate the WHOLE pool
 * (`recomputeFromPool`) and trust that. A single run scores only the articles handed to it,
 * so trusting it let the newest article yank the persisted estimate; the pool puts one
 * extraction in proportion to all the evidence gathered for the claim.
 *
 * Three outcomes:
 *  - **pool** — the aggregate is the estimate. `snapshotSources` is the whole usable pool,
 *    so a caller's stored snapshot lists precisely the articles behind its number
 *    (`sources.length === articlesUsed`). Authors aren't kept on pool rows, so they're
 *    re-looked-up from news-indexer by URL, best-effort, reusing any the caller already
 *    fetched (pass `authorByUrl`).
 *  - **single-run** (`insufficientData: false`) — the pool could not be *read* (Oracul
 *    unreachable, nothing usable pooled yet, transport error). Fall back to the caller's
 *    single `/forecast` run so a flaky Oracul degrades the estimate rather than dropping it.
 *  - **pool-insufficient** (`insufficientData: true`) — the pool *was* aggregated and found
 *    no usable signal (in prod: every article off-topic). The caller must ABSTAIN, never
 *    fall back to the single run over those same off-topic articles.
 *
 * Shared by the news-indexer / analyze / backfill paths. Call it AFTER `addArticlesToPool`
 * has resolved, so this run's own articles are already in the pool it reads. `/pool/aggregate`
 * is compute-only (no search, no LLM), so it's fast; a caller under a hard timeout can await
 * it without meaningfully widening its budget.
 *
 * Pass `claimText`: it is what lets the settlement match gate run on this path at all
 * (daatan#1264). Omitting it does not fail the recompute — retro skips the gate and logs
 * `reason=no_question` — so the cost of forgetting it is silent, which is exactly why every
 * caller threads it.
 */
export async function resolvePooledEstimate(
  predictionId: string,
  singleRun: SingleRunEstimate,
  fallbackSources: EnrichedOracleSource[],
  claimDirection: ClaimDirection | null,
  claimDeadline: Date | null,
  authorByUrl: Map<string, string | null> = new Map(),
  claimCreatedAt: Date | null = null,
  claimArchetype: ClaimArchetype | null = null,
  claimText: string | null = null,
): Promise<ResolvedPoolEstimate> {
  let pool: PoolRecompute | null = null
  try {
    pool = await recomputeFromPool(predictionId, claimDirection, claimDeadline, claimCreatedAt, claimArchetype, claimText)
  } catch {
    // recomputeFromPool already swallows transport/non-200 into null; this guards only an
    // unexpected throw (e.g. the pool read itself failing) so a caller never loses its estimate.
    pool = null
  }

  // The pool aggregated but has no usable signal (off-topic) — abstain, don't fall back to a
  // single run over the same articles. Distinct from `pool === null` (couldn't read the pool).
  if (pool !== null && pool.insufficientData) {
    return {
      ...singleRun,
      snapshotSources: [],
      estimateSource: 'pool-insufficient',
      insufficientData: true,
      reason: pool.reason,
      poolSize: pool.poolSize,
      usableSize: pool.usableSize,
      singleRunMean: singleRun.mean,
      evidenceMass: null,
      nEff: null,
      ageAdjustedMass: null,
    }
  }

  if (pool === null) {
    return {
      ...singleRun,
      snapshotSources: fallbackSources,
      estimateSource: 'single-run',
      insufficientData: false,
      reason: null,
      poolSize: null,
      usableSize: null,
      singleRunMean: singleRun.mean,
      evidenceMass: null,
      nEff: null,
      ageAdjustedMass: null,
    }
  }

  const missing = pool.usableArticles.map((a) => a.url).filter((u) => !authorByUrl.has(u))
  if (missing.length > 0) {
    for (const [url, m] of await getArticleMetaByUrl(missing)) authorByUrl.set(url, m.author)
  }
  // Diff against the immediately-prior evidence snapshot so a recompute triggered by ONE new
  // article doesn't make every other pooled source look re-evaluated too (daatan#1166) — the
  // full roster is still persisted (other readers, e.g. the "sources behind the estimate"
  // panel, need the complete current roster on every snapshot), only `carriedForward` is new.
  const priorSnapshot = await getLatestOracleSnapshot(predictionId)
  const priorStanceByUrl = new Map(
    oracleSnapshotToContributingSources(priorSnapshot?.oracleSnapshot ?? null).map((s) => [s.url, s.stance]),
  )
  const snapshotSources = pool.usableArticles.map((a) =>
    poolArticleToEnrichedSource(a, authorByUrl.get(a.url) ?? null, priorStanceByUrl.get(a.url) === a.stance),
  )

  return {
    mean: pool.mean,
    std: pool.std,
    ciLow: pool.ciLow,
    ciHigh: pool.ciHigh,
    settled: pool.settled,
    articlesUsed: pool.articlesUsed,
    snapshotSources,
    estimateSource: 'pool',
    insufficientData: false,
    reason: null,
    poolSize: pool.poolSize,
    usableSize: pool.usableSize,
    singleRunMean: singleRun.mean,
    evidenceMass: pool.evidenceMass,
    nEff: pool.nEff,
    ageAdjustedMass: pool.ageAdjustedMass,
  }
}
