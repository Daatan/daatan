import { oracleSearch } from '@/lib/services/oracleSearch'
import { buildSearchQuery } from '@/lib/llm/searchQuery'
import { getOracleForecast, DEFAULT_MAX_ARTICLES } from '@/lib/services/oracle'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import { enrichOracleSources } from '@/lib/services/oracle-snapshot'
import { saveOracleSnapshotOnly, markOracleAttempted } from '@/lib/services/context'
import { createLogger } from '@/lib/logger'

const log = createLogger('oracle-backfill')

export type RefreshResult =
  | { status: 'ok'; sources: number }
  | { status: 'no-articles' }
  | { status: 'no-oracle' }

/**
 * Run the Oracle's analysis for one forecast and persist its source roster as an
 * Oracle snapshot — WITHOUT touching the user-facing context summary (uses
 * saveOracleSnapshotOnly). This is the building block of the active-forecast
 * backfill that populates the "sources behind the AI estimate" panel for forecasts
 * created before per-source capture existed. Reuses the same search → Oracle →
 * enrich path as the user-triggered analyze route.
 */
export async function refreshOracleSnapshot(prediction: { id: string; claimText: string }): Promise<RefreshResult> {
  const query = await buildSearchQuery(prediction.claimText)
  const searchResults = await oracleSearch(query, DEFAULT_MAX_ARTICLES, undefined, {
    source: 'context-update',
    predictionId: prediction.id,
  })
  if (!searchResults || searchResults.length === 0) {
    await markOracleAttempted(prediction.id, 'no-articles')
    return { status: 'no-articles' }
  }

  const { forecast } = await getOracleForecast(
    prediction.claimText,
    { articles: searchResults },
    { source: 'context-update', predictionId: prediction.id },
  )
  if (forecast === null) {
    await markOracleAttempted(prediction.id, 'no-oracle')
    return { status: 'no-oracle' }
  }

  const articleMeta = await getArticleMetaByUrl(forecast.sources.map(s => s.url))
  const authorByUrl = new Map([...articleMeta.entries()].map(([url, m]) => [url, m.author]))
  const sources = enrichOracleSources(forecast.sources, searchResults, authorByUrl)

  const toPercent = (v: number) => Math.round(((v + 1) / 2) * 100)
  const ciLow = toPercent(forecast.ci_low)
  const ciHigh = toPercent(forecast.ci_high)

  await saveOracleSnapshotOnly({
    predictionId: prediction.id,
    oracleSnapshot: {
      mean: forecast.mean,
      std: forecast.std,
      ciLow,
      ciHigh,
      articlesUsed: forecast.articles_used,
      sources,
    },
    confidence: toPercent(forecast.mean),
    aiCiLow: ciLow,
    aiCiHigh: ciHigh,
  })

  log.info({ predictionId: prediction.id, sources: sources.length }, 'oracle-backfill.refreshed')
  return { status: 'ok', sources: sources.length }
}
