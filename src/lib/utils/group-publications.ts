import type { PublicOutletPublication } from '@/lib/services/outlets'

export interface PublicationForecast {
  forecastId: string
  outcome: string | null
}

export interface GroupedPublication {
  title: string | null
  url: string | null
  publishedAt: string | null
  forecasts: PublicationForecast[]
}

/**
 * news-indexer returns one row per (article, forecast) match, so an article that fed two
 * forecasts arrived as two identical-looking rows (#2292). Collapse them to one entry per
 * article, keeping the API's newest-first order and each distinct forecast it fed.
 */
export function groupPublications(rows: PublicOutletPublication[]): GroupedPublication[] {
  const byKey = new Map<string, GroupedPublication>()
  rows.forEach((row, i) => {
    const key = row.url ?? (row.title ? `title:${row.title}` : `row:${i}`)
    let group = byKey.get(key)
    if (!group) {
      group = { title: row.title, url: row.url, publishedAt: row.publishedAt, forecasts: [] }
      byKey.set(key, group)
    }
    if (!group.title && row.title) group.title = row.title
    if (!group.publishedAt && row.publishedAt) group.publishedAt = row.publishedAt
    if (row.forecastId && !group.forecasts.some((f) => f.forecastId === row.forecastId)) {
      group.forecasts.push({ forecastId: row.forecastId, outcome: row.outcome })
    }
  })
  return [...byKey.values()]
}
