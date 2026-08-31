import type { ClaimArchetype, ClaimDirection } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { oracleSearch } from '@/lib/services/oracleSearch'
import { buildSearchQuery } from '@/lib/llm/searchQuery'
import {
  getOracleForecast,
  DEFAULT_MAX_ARTICLES,
  isTransportNullReason,
  type OracleFailureClass,
} from '@/lib/services/oracle'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import { enrichOracleSources, stanceToPercent, stanceStdToPercent } from '@/lib/services/oracle-snapshot'
import { resolvePooledEstimate } from '@/lib/services/pooled-estimate'
import { saveOracleSnapshotOnly, markOracleAttempted } from '@/lib/services/context'
import {
  addArticlesToPool,
  articleIdsByUrl,
  claimArticlesForExtraction,
  failClaimedArticles,
  type PoolOrigin,
} from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('oracle-backfill')

export type RefreshResult =
  | { status: 'ok'; sources: number }
  | { status: 'no-articles' }
  // `failureClass` is WHY the run produced nothing. It is already computed here to
  // stamp the pool rows; surfacing it lets a caller tell "the Oracle judged these
  // and declined" from "we hung up at 30s", which is the difference between a
  // verdict and a network event (daatan#1253). Undefined only when the Oracle was
  // never reached in a way that yielded a class.
  | { status: 'no-oracle'; failureClass?: OracleFailureClass }
  | { status: 'unchanged' }
  // The whole evidence pool is off-topic — an abstention was recorded (insufficientData
  // snapshot). Still writes a non-null oracleSnapshot marker, so the forecast drops out of
  // the backfill candidate set and the loop converges.
  | { status: 'insufficient' }

/** An article handed to refreshOracleSnapshot instead of a fresh search — the retry
 *  sweep rebuilds these from stuck pool rows (which store title but not snippet; the
 *  Oracle fetches article content itself, so an empty snippet costs little). */
export type SuppliedArticle = {
  url: string
  title: string
  snippet: string
  source?: string
  publishedDate?: string
}

/** The claim fields every Oracle re-drive needs. `claimDirection`/`claimDeadline`/
 *  `resolutionRules` are load-bearing beyond the direction guard: retro folds exactly
 *  those three into its `forecast_cache` key (`claim_meta`, retro#510), so a re-ask
 *  that omits any of them lands on a different key and re-runs the extractor.
 *  `createdAt`/`claimArchetype` are NOT in that key and are safe to vary. */
export type ReaskPrediction = {
  id: string
  claimText: string
  claimDirection?: ClaimDirection | null
  claimDeadline?: Date | null
  createdAt?: Date | null
  claimArchetype?: ClaimArchetype | null
  resolutionRules?: string | null
}

/**
 * Run the Oracle's analysis for one forecast and persist its source roster as an
 * Oracle snapshot — WITHOUT touching the user-facing context summary (uses
 * saveOracleSnapshotOnly). This is the building block of the active-forecast
 * backfill that populates the "sources behind the AI estimate" panel for forecasts
 * created before per-source capture existed, and (via `opts.articles`) of the
 * pool-retry sweep, which re-drives stuck pool rows through the same path instead
 * of searching. Reuses the same search → Oracle → enrich path as the user-triggered
 * analyze route.
 *
 * With supplied articles the two empty-marker writes (`markOracleAttempted`) are
 * skipped: they exist only so the backfill's candidate query converges, and on a
 * retried forecast — which already has real snapshots — an empty marker would
 * become the LATEST evidence snapshot that every latest-snapshot reader trusts.
 */
export async function refreshOracleSnapshot(
  prediction: ReaskPrediction,
  opts?: { articles?: SuppliedArticle[]; origin?: PoolOrigin; reask?: boolean },
): Promise<RefreshResult> {
  const supplied = opts?.articles
  const origin: PoolOrigin = opts?.origin ?? 'backfill'
  let searchResults: SuppliedArticle[] | null = supplied ?? null
  if (!searchResults) {
    const query = await buildSearchQuery(prediction.claimText)
    searchResults = await oracleSearch(query, DEFAULT_MAX_ARTICLES, undefined, {
      source: 'context-update',
      predictionId: prediction.id,
    })
  }
  if (!searchResults || searchResults.length === 0) {
    if (!supplied) await markOracleAttempted(prediction.id, 'no-articles')
    return { status: 'no-articles' }
  }

  // Same atomic claim gate as the news-indexer push path (evidence-pool.ts) —
  // if every searched article is already extracted with identical content (or
  // claimed by another still-fresh in-flight run), there's nothing new to
  // extract. Backfill targets forecasts with NO oracle snapshot yet, so this
  // rarely fires on a first pass, but it does protect a re-run over the same
  // candidate from redundantly re-calling the Oracle.
  const claimableResults = searchResults.map((r) => ({
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    source: r.source ?? null,
    publishedAt: r.publishedDate ?? null,
    // Oracle search results carry no provenance for their dates — see the same note on the
    // /forecasts/[id]/context lane (daatan#1679 item 2).
    publishedAtSource: null,
  }))
  const claimResults = await claimArticlesForExtraction(prediction.id, claimableResults, origin, {
    claimCreatedAt: prediction.createdAt ?? null,
  })
  const claimedArticleIdByUrl = articleIdsByUrl(claimableResults, claimResults)
  if (!claimResults.some((r) => r.result === 'claimed')) {
    return { status: 'unchanged' }
  }

  // Only the newly-claimed articles go to the extractor — see the identical
  // comment in the news-indexer context route (daatan#1172). `searchResults`
  // (full, unfiltered) stays available below for enrichOracleSources's
  // URL-keyed metadata lookup.
  const articlesToScore = searchResults.filter((_, i) => claimResults[i].result === 'claimed')

  // No try/catch — `getOracleForecast` never throws; the `extractor_error` branch that
  // used to sit here was dead code. Same removal as the news-indexer route (daatan#1231).
  const { forecast, failureClass } = await getOracleForecast(
    prediction.claimText,
    {
      articles: articlesToScore,
      claimDirection: prediction.claimDirection,
      claimDeadline: prediction.claimDeadline,
      claimCreatedAt: prediction.createdAt,
      claimArchetype: prediction.claimArchetype,
      resolutionRules: prediction.resolutionRules,
    },
    { source: 'context-update', predictionId: prediction.id },
  )
  if (forecast === null) {
    // Classified, like the push path. This one matters twice over: the retry sweep runs
    // THROUGH here, so without it the sweep would keep writing the very `oracle_null`
    // rows it is meant to be draining, and the two paths would disagree about what a
    // pool row means.
    // Scoped to this run's own claims, same fix and same reason as the news-indexer
    // route (daatan#1232) — unfiltered, a null run also failed a concurrent request's
    // still-PENDING claims.
    await failClaimedArticles(
      prediction.id,
      searchResults.filter((_, i) => claimResults[i].result === 'claimed').map((r) => r.url),
      failureClass ?? 'oracle_null',
    )
    if (!supplied) await markOracleAttempted(prediction.id, 'no-oracle')
    // We hung up on a run retro is finishing anyway — go back for it (daatan#1262).
    // Opt-in per caller so the re-ask below can re-enter this function without
    // scheduling another one.
    if (opts?.reask && isTransportNullReason(failureClass)) {
      scheduleOracleReask(prediction, articlesToScore, origin)
    }
    return { status: 'no-oracle', failureClass }
  }

  const articleMeta = await getArticleMetaByUrl(forecast.sources.map(s => s.url))
  const authorByUrl = new Map([...articleMeta.entries()].map(([url, m]) => [url, m.author]))
  const sources = enrichOracleSources(
    forecast.sources,
    searchResults,
    authorByUrl,
    undefined,
    forecast.relevance_bar ?? null,
    forecast.provenance?.models ?? null,
    forecast.provenance?.oracle ?? null,
  )

  // Pool this run's articles, then let the WHOLE-pool aggregate be the estimate — the same
  // cutover the news-indexer push path got in v1.60.0 (#1121), previously only shadow-logged
  // here. Awaited (not fire-and-forget) so the recompute reads a pool that already includes
  // this run's articles and its result actually drives the snapshot. Backfill is a background
  // job with no request timeout, so awaiting the compute-only aggregate costs nothing; on any
  // failure `resolvePooledEstimate` falls back to this single run.
  await addArticlesToPool(prediction.id, sources, origin, claimedArticleIdByUrl)
  // Release this run's claims the Oracle omitted (gatekeeper-rejected), or they rot as
  // PENDING forever — same lifecycle close as the news-indexer route; the PENDING filter
  // inside failClaimedArticles is the set-difference against what the pool write completed.
  await failClaimedArticles(
    prediction.id,
    searchResults.filter((_, i) => claimResults[i].result === 'claimed').map((r) => r.url),
    'oracle_omitted',
  )
  const resolved = await resolvePooledEstimate(
    prediction.id,
    {
      mean: forecast.mean,
      std: forecast.std,
      ciLow: forecast.ci_low,
      ciHigh: forecast.ci_high,
      settled: forecast.settled ?? false,
      articlesUsed: forecast.articles_used,
    },
    sources,
    prediction.claimDirection ?? null,
    prediction.claimDeadline ?? null,
    authorByUrl,
    prediction.createdAt ?? null,
    prediction.claimArchetype ?? null,
    prediction.claimText,
  )

  // The whole pool is off-topic — abstain rather than persist a number built from articles
  // the Oracle judged irrelevant. Records an abstention snapshot; the non-null oracleSnapshot
  // marker still converges the backfill (this forecast now HAS a snapshot). Any confidence/CI
  // already published survives it — the reason decides, and none of the pool's reasons
  // condemn a prior estimate (daatan#1473).
  if (resolved.insufficientData) {
    await saveOracleSnapshotOnly({
      predictionId: prediction.id,
      oracleSnapshot: { sources: [], insufficient: true, reason: resolved.reason },
      confidence: null,
      aiCiLow: null,
      aiCiHigh: null,
      insufficientData: true,
      insufficientReason: resolved.reason,
      poolSize: resolved.poolSize,
      // Provenance passthrough (daatan#1617) — from the single `/forecast` run that fed
      // the pool this abstention is over, not from `/pool/aggregate` (retro doesn't put
      // a Provenance envelope on that response yet).
      engine: forecast.provenance?.engine ?? undefined,
      schemaVersion: forecast.provenance?.schema_version ?? undefined,
    })
    log.info(
      { predictionId: prediction.id, estimateSource: 'pool-insufficient', reason: resolved.reason, poolSize: resolved.poolSize },
      'oracle-backfill.insufficient',
    )
    return { status: 'insufficient' }
  }

  const probability = stanceToPercent(resolved.mean)
  const ciLow = stanceToPercent(resolved.ciLow)
  const ciHigh = stanceToPercent(resolved.ciHigh)

  await saveOracleSnapshotOnly({
    predictionId: prediction.id,
    oracleSnapshot: {
      mean: probability,
      std: stanceStdToPercent(resolved.std),
      ciLow,
      ciHigh,
      articlesUsed: resolved.articlesUsed,
      settled: resolved.settled,
      sources: resolved.snapshotSources,
    },
    confidence: probability,
    aiCiLow: ciLow,
    aiCiHigh: ciHigh,
    settled: resolved.settled,
    evidenceMass: resolved.evidenceMass,
    nEff: resolved.nEff,
    ageAdjustedMass: resolved.ageAdjustedMass,
    // Provenance passthrough (daatan#1617) — see the abstention branch above.
    engine: forecast.provenance?.engine ?? undefined,
    schemaVersion: forecast.provenance?.schema_version ?? undefined,
  })

  log.info(
    {
      predictionId: prediction.id,
      sources: resolved.snapshotSources.length,
      estimateSource: resolved.estimateSource,
      poolSize: resolved.poolSize,
      articlesUsed: resolved.articlesUsed,
      singleRunMean: resolved.singleRunMean,
    },
    'oracle-backfill.refreshed',
  )
  return { status: 'ok', sources: resolved.snapshotSources.length }
}

/**
 * How long to wait before going back for a forecast we hung up on.
 *
 * Sized off retro's own clocks, not ours. retro caps a single run at
 * `forecast_timeout_seconds = 90` measured from ITS request start, so by t+90s the
 * run has either completed (and `forecast_cache.set` stored it) or given up — there
 * is no third state and no in-flight ambiguity left to reason about. 120s clears
 * that with headroom while sitting 30× inside `cache_ttl_seconds = 3600`, which is
 * the window this whole mechanism has to land in.
 *
 * It must also exceed `TRANSPORT_RECLAIM_BACKOFF_MS` (60s), or our own re-ask is the
 * thing the claim gate refuses as `unchanged` — the failure mode daatan#1262 called
 * out by name.
 */
export const REASK_DELAY_MS = 120 * 1000

/**
 * Ceiling on re-asks waiting or running at once. These are background promises
 * nothing is blocked on, so the only real risk is a hard-down Oracle turning every
 * push into another queued 90s call; this bounds that. Deliberately small — a re-ask
 * is a recovery, not a throughput mechanism.
 */
const MAX_CONCURRENT_REASKS = 4

let inFlightReasks = 0

/** Test seam: how many re-asks are currently scheduled or running. */
export function _reaskInFlight(): number {
  return inFlightReasks
}

/**
 * Re-drive an abandoned run's EXACT article set, so retro serves it from
 * `forecast_cache` instead of letting it expire unread (daatan#1262).
 *
 * The identical-set requirement is not a nicety. retro's cache key is
 * `sha256(question | max_articles | md5(sorted urls)[:12] | claim_direction|claim_deadline)`,
 * so any change to the URL SET (order does not matter, membership does) produces a
 * different key and a full re-run — paying the extractor twice to save it once.
 * `articles` must therefore be the set that was actually SENT, i.e. the claimed
 * subset, not the whole push.
 *
 * **Known ceiling, and it is not a bug in this code:** retro runs gunicorn with
 * `--workers 2` and its forecast cache is a per-process in-memory dict, so a re-ask
 * lands on the worker holding the entry roughly half the time. A miss is not a loss
 * — the re-ask still returns a real forecast and the pool row still completes; it
 * just costs a second extraction instead of nothing. So the recovered-ESTIMATE rate
 * is ~100% and the free-recovery rate is ~50%. Making it deterministic needs a
 * shared cache on retro's side, which is retro's call, not daatan's.
 *
 * Fire-and-forget by construction: callers have already responded. Never throws.
 */
export function scheduleOracleReask(
  prediction: ReaskPrediction,
  articles: SuppliedArticle[],
  origin: PoolOrigin,
): void {
  if (articles.length === 0) return
  if (inFlightReasks >= MAX_CONCURRENT_REASKS) {
    log.warn(
      { predictionId: prediction.id, inFlight: inFlightReasks, articles: articles.length },
      'oracle-backfill.reask_dropped_at_cap',
    )
    return
  }
  inFlightReasks++
  const timer = setTimeout(() => {
    void runOracleReask(prediction, articles, origin).finally(() => {
      inFlightReasks--
    })
  }, REASK_DELAY_MS)
  // A pending re-ask must never be the reason the process stays alive (it also keeps
  // `vitest` from hanging on a suite that scheduled one). Node-only API, absent under
  // some test timer shims — hence the guard.
  timer.unref?.()
}

/**
 * The re-ask body. Exported for tests, which drive it directly rather than waiting
 * out {@link REASK_DELAY_MS}.
 *
 * Reuses `refreshOracleSnapshot` rather than re-implementing the tail: claim →
 * forecast → pool write → omitted-release → aggregate → persist is exactly what a
 * recovered run needs, and it is the same path the retry sweep already trusts.
 * Two consequences worth stating plainly:
 *
 *  - `reask: false`, so a re-ask that times out again does not schedule a third.
 *    One recovery attempt per abandoned run; after that the row waits for the daily
 *    sweep like any other.
 *  - a recovered push persists via `saveOracleSnapshotOnly`, so the estimate lands
 *    (`confidence`, CI, snapshot) but the ContextSnapshot reads as a background
 *    refresh rather than a news-indexer match, and no Telegram notification fires.
 *    Deliberate: the number is the point, and a match notification two minutes after
 *    the fact is noise.
 */
export async function runOracleReask(
  prediction: ReaskPrediction,
  articles: SuppliedArticle[],
  origin: PoolOrigin,
): Promise<void> {
  try {
    // Cheap guard against writing a fresh AI estimate onto a forecast that resolved
    // during the delay. Every other caller of refreshOracleSnapshot filters on
    // ACTIVE before it gets here; this one is the only one with a gap to cover.
    const current = await prisma.prediction.findUnique({
      where: { id: prediction.id },
      select: { status: true },
    })
    if (current?.status !== 'ACTIVE') {
      log.info(
        { predictionId: prediction.id, status: current?.status ?? null },
        'oracle-backfill.reask_skipped_inactive',
      )
      return
    }

    const r = await refreshOracleSnapshot(prediction, { articles, origin, reask: false })
    log.info(
      {
        predictionId: prediction.id,
        origin,
        articles: articles.length,
        result: r.status,
        // `unchanged` here means the claim gate refused us — the one outcome that
        // would make this whole mechanism inert, so it is worth being able to grep.
        failureClass: r.status === 'no-oracle' ? (r.failureClass ?? null) : null,
      },
      'oracle-backfill.reask_done',
    )
  } catch (err) {
    log.warn({ predictionId: prediction.id, origin, err }, 'oracle-backfill.reask_failed')
  }
}
