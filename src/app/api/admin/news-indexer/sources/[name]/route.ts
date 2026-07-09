import { NextResponse } from 'next/server'
import { env } from '@/env'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'

/** Admin-only proxy to news-indexer's per-outlet identity endpoint: detail
 *  (config + impact + publications) plus the enrichment edit form's
 *  save/clear actions. See news-indexer's api/outlets.py. */

function outletUrl(name: string): string {
  return `${env.NEWS_INDEXER_URL}/outlets/${encodeURIComponent(name)}`
}

export const GET = withAuth(async (_request, _user, { params }) => {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) {
    return apiError('News-indexer not configured', 503)
  }
  try {
    const resp = await fetch(outletUrl(params.name), {
      headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY },
      cache: 'no-store',
    })
    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch outlet detail')
  }
}, { roles: ['ADMIN'] })

export const PUT = withAuth(async (request, _user, { params }) => {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) {
    return apiError('News-indexer not configured', 503)
  }
  try {
    const body = await request.text()
    const resp = await fetch(outletUrl(params.name), {
      method: 'PUT',
      headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY, 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    })
    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to save outlet enrichment')
  }
}, { roles: ['ADMIN'] })

export const DELETE = withAuth(async (_request, _user, { params }) => {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) {
    return apiError('News-indexer not configured', 503)
  }
  try {
    const resp = await fetch(outletUrl(params.name), {
      method: 'DELETE',
      headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY },
      cache: 'no-store',
    })
    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (error) {
    return handleRouteError(error, 'Failed to clear outlet enrichment')
  }
}, { roles: ['ADMIN'] })
