import type { ClaimArchetype, ClaimDirection } from '@prisma/client'
import { oracleSearch } from '@/lib/services/oracleSearch'
import { buildSearchQuery } from '@/lib/llm/searchQuery'
import { getOracleForecast, DEFAULT_MAX_ARTICLES } from '@/lib/services/oracle'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import { enrichOracleSources, stanceToPercent, stanceStdToPercent } from '@/lib/services/oracle-snapshot'
import { resolvePooledEstimate } from '@/lib/services/pooled-estimate'
import { saveOracleSnapshotOnly, markOracleAttempted } from '@/lib/services/context'
import {
  addArticlesToPool,
  claimArticlesForExtraction,
  failClaimedArticles,
  type PoolOrigin,
} from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('oracle-backfill')

export type RefreshResult =
  | { status: 'ok'; sources: number }
  | { status: 'no-articles' }
  | { status: 'no-oracle' }
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
  prediction: {
    id: string
    claimText: string
    claimDirection?: ClaimDirection | null
    claimDeadline?: Date | null
    createdAt?: Date | null
    claimArchetype?: ClaimArchetype | null
  },
  opts?: { articles?: SuppliedArticle[]; origin?: PoolOrigin },
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
  const claimResults = await claimArticlesForExtraction(
    prediction.id,
    searchResults.map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      source: r.source ?? null,
      publishedAt: r.publishedDate ?? null,
    })),
    origin,
  )
  if (!claimResults.some((r) => r === 'claimed')) {
    return { status: 'unchanged' }
  }

  let forecast: Awaited<ReturnType<typeof getOracleForecast>>['forecast']
  try {
    ;({ forecast } = await getOracleForecast(
      prediction.claimText,
      {
        articles: searchResults,
        claimDirection: prediction.claimDirection,
        claimDeadline: prediction.claimDeadline,
        claimCreatedAt: prediction.createdAt,
        claimArchetype: prediction.claimArchetype,
      },
      { source: 'context-update', predictionId: prediction.id },
    ))
  } catch (err) {
    await failClaimedArticles(prediction.id, searchResults.map((r) => r.url), 'extractor_error')
    throw err
  }
  if (forecast === null) {
    await failClaimedArticles(prediction.id, searchResults.map((r) => r.url), 'oracle_null')
    if (!supplied) await markOracleAttempted(prediction.id, 'no-oracle')
    return { status: 'no-oracle' }
  }

  const articleMeta = await getArticleMetaByUrl(forecast.sources.map(s => s.url))
  const authorByUrl = new Map([...articleMeta.entries()].map(([url, m]) => [url, m.author]))
  const sources = enrichOracleSources(forecast.sources, searchResults, authorByUrl)

  // Pool this run's articles, then let the WHOLE-pool aggregate be the estimate — the same
  // cutover the news-indexer push path got in v1.60.0 (#1121), previously only shadow-logged
  // here. Awaited (not fire-and-forget) so the recompute reads a pool that already includes
  // this run's articles and its result actually drives the snapshot. Backfill is a background
  // job with no request timeout, so awaiting the compute-only aggregate costs nothing; on any
  // failure `resolvePooledEstimate` falls back to this single run.
  await addArticlesToPool(prediction.id, sources, origin)
  // Release this run's claims the Oracle omitted (gatekeeper-rejected), or they rot as
  // PENDING forever — same lifecycle close as the news-indexer route; the PENDING filter
  // inside failClaimedArticles is the set-difference against what the pool write completed.
  await failClaimedArticles(
    prediction.id,
    searchResults.filter((_, i) => claimResults[i] === 'claimed').map((r) => r.url),
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
  )

  // The whole pool is off-topic — abstain rather than persist a number built from articles
  // the Oracle judged irrelevant. Records confidence/CI null + insufficientData; the non-null
  // oracleSnapshot marker still converges the backfill (this forecast now HAS a snapshot).
  if (resolved.insufficientData) {
    await saveOracleSnapshotOnly({
      predictionId: prediction.id,
      oracleSnapshot: { sources: [], insufficient: true, reason: resolved.reason },
      confidence: null,
      aiCiLow: null,
      aiCiHigh: null,
      insufficientData: true,
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
