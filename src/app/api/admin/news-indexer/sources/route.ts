import { NextResponse } from 'next/server'
import { env } from '@/env'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'

/** Admin-only proxy to the news-indexer /sources list (the configured sources.yaml). */
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
    return NextResponse.json(data, { status: resp.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch news-indexer sources')
  }
}, { roles: ['ADMIN'] })
