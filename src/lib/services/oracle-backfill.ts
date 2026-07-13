import type { ClaimDirection } from '@prisma/client'
import { oracleSearch } from '@/lib/services/oracleSearch'
import { buildSearchQuery } from '@/lib/llm/searchQuery'
import { getOracleForecast, DEFAULT_MAX_ARTICLES } from '@/lib/services/oracle'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import { enrichOracleSources, stanceToPercent, stanceStdToPercent } from '@/lib/services/oracle-snapshot'
import { saveOracleSnapshotOnly, markOracleAttempted } from '@/lib/services/context'
import {
  addArticlesToPool,
  shadowCompareRecompute,
  claimArticlesForExtraction,
  failClaimedArticles,
} from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('oracle-backfill')

export type RefreshResult =
  | { status: 'ok'; sources: number }
  | { status: 'no-articles' }
  | { status: 'no-oracle' }
  | { status: 'unchanged' }

/**
 * Run the Oracle's analysis for one forecast and persist its source roster as an
 * Oracle snapshot — WITHOUT touching the user-facing context summary (uses
 * saveOracleSnapshotOnly). This is the building block of the active-forecast
 * backfill that populates the "sources behind the AI estimate" panel for forecasts
 * created before per-source capture existed. Reuses the same search → Oracle →
 * enrich path as the user-triggered analyze route.
 */
export async function refreshOracleSnapshot(
  prediction: { id: string; claimText: string; claimDirection?: ClaimDirection | null; claimDeadline?: Date | null },
): Promise<RefreshResult> {
  const query = await buildSearchQuery(prediction.claimText)
  const searchResults = await oracleSearch(query, DEFAULT_MAX_ARTICLES, undefined, {
    source: 'context-update',
    predictionId: prediction.id,
  })
  if (!searchResults || searchResults.length === 0) {
    await markOracleAttempted(prediction.id, 'no-articles')
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
    'backfill',
  )
  if (!claimResults.some((r) => r === 'claimed')) {
    return { status: 'unchanged' }
  }

  let forecast: Awaited<ReturnType<typeof getOracleForecast>>['forecast']
  try {
    ;({ forecast } = await getOracleForecast(
      prediction.claimText,
      { articles: searchResults, claimDirection: prediction.claimDirection, claimDeadline: prediction.claimDeadline },
      { source: 'context-update', predictionId: prediction.id },
    ))
  } catch (err) {
    await failClaimedArticles(prediction.id, searchResults.map((r) => r.url), 'extractor_error')
    throw err
  }
  if (forecast === null) {
    await failClaimedArticles(prediction.id, searchResults.map((r) => r.url), 'oracle_null')
    await markOracleAttempted(prediction.id, 'no-oracle')
    return { status: 'no-oracle' }
  }

  const articleMeta = await getArticleMetaByUrl(forecast.sources.map(s => s.url))
  const authorByUrl = new Map([...articleMeta.entries()].map(([url, m]) => [url, m.author]))
  const sources = enrichOracleSources(forecast.sources, searchResults, authorByUrl)

  // Evidence pool shadow-write + recompute shadow-compare (retro
  // docs/ORACLE_VARIABLES.md §6 part 2, step 6) — additive only, never blocks
  // or alters the estimate below. Chained (not parallel) so the recompute
  // reads a pool that already includes this run's articles.
  addArticlesToPool(prediction.id, sources, 'backfill')
    .then(() =>
      shadowCompareRecompute(
        prediction.id,
        {
          mean: forecast.mean,
          ciLow: forecast.ci_low,
          ciHigh: forecast.ci_high,
          settled: forecast.settled ?? false,
        },
        prediction.claimDirection ?? null,
        prediction.claimDeadline ?? null,
      ),
    )
    .catch((err) =>
      log.warn({ predictionId: prediction.id, err }, 'evidence pool shadow-write/recompute-compare failed'),
    )

  const ciLow = stanceToPercent(forecast.ci_low)
  const ciHigh = stanceToPercent(forecast.ci_high)
  const probability = stanceToPercent(forecast.mean)

  await saveOracleSnapshotOnly({
    predictionId: prediction.id,
    oracleSnapshot: {
      mean: probability,
      std: stanceStdToPercent(forecast.std),
      ciLow,
      ciHigh,
      articlesUsed: forecast.articles_used,
      settled: forecast.settled ?? false,
      sources,
    },
    confidence: probability,
    aiCiLow: ciLow,
    aiCiHigh: ciHigh,
    settled: forecast.settled ?? false,
  })

  log.info({ predictionId: prediction.id, sources: sources.length }, 'oracle-backfill.refreshed')
  return { status: 'ok', sources: sources.length }
}
