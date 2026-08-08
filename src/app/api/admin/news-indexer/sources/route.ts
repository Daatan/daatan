import { NextResponse } from 'next/server'
import { env } from '@/env'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

const log = createLogger('admin-news-indexer-sources')

type ExtractionCounts = { complete: number; failed: number }

type NiSource = {
  type?: string
  name?: string | null
  domain?: string | null
  matchKeys?: string[]
  extraction?: { complete: number; failed: number; yield: number | null }
}

/**
 * Per-source extraction outcomes from the evidence pool, keyed by the
 * `evidence_pool_articles.source` string. PENDING rows are in flight, not
 * outcomes, so they're ignored. Degrades to an empty map on DB failure —
 * the sources panel must render even without yield data.
 */
async function extractionCountsBySource(): Promise<Map<string, ExtractionCounts>> {
  const map = new Map<string, ExtractionCounts>()
  try {
    const rows = await prisma.evidencePoolArticle.groupBy({
      by: ['source', 'status'],
      _count: true,
      where: { source: { not: null } },
    })
    for (const row of rows) {
      if (!row.source || row.status === 'PENDING') continue
      const entry = map.get(row.source) ?? { complete: 0, failed: 0 }
      if (row.status === 'COMPLETE') entry.complete += row._count
      else entry.failed += row._count
      map.set(row.source, entry)
    }
  } catch (error) {
    log.warn({ error }, 'Extraction-yield groupBy failed; serving sources without yield data')
  }
  return map
}

/**
 * Fold extraction counts over each source's matchKeys (the exact strings the
 * evidence pool stores for its articles). Older news-indexer deployments don't
 * send matchKeys yet — fall back to the Telegram display name / the domain.
 */
function attachExtraction(sources: NiSource[], counts: Map<string, ExtractionCounts>) {
  for (const s of sources) {
    const keys =
      Array.isArray(s.matchKeys) && s.matchKeys.length > 0
        ? s.matchKeys
        : [s.type === 'telegram' ? s.name : s.domain].filter((k): k is string => !!k)
    let complete = 0
    let failed = 0
    for (const key of keys) {
      const c = counts.get(key)
      if (c) {
        complete += c.complete
        failed += c.failed
      }
    }
    const attempts = complete + failed
    s.extraction = {
      complete,
      failed,
      yield: attempts > 0 ? Math.round((complete / attempts) * 10000) / 10000 : null,
    }
  }
}

/**
 * Admin-only proxy to the news-indexer /sources list (the configured sources.yaml),
 * enriched with daatan-side extraction yield per source (news-indexer#194).
 */
export const GET = withAuth(async () => {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) {
    return apiError('News-indexer not configured', 503)
  }

  try {
    const resp = await fetch(`${env.NEWS_INDEXER_URL}/sources`, {
      headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY },
      cache: 'no-store',
    })
    const data = await resp.json()
    if (resp.ok && Array.isArray(data?.sources)) {
      attachExtraction(data.sources as NiSource[], await extractionCountsBySource())
    }
    return NextResponse.json(data, { status: resp.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch news-indexer sources')
  }
}, { roles: ['ADMIN'] })
