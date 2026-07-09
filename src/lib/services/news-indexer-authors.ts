import { NextResponse } from 'next/server'
import { env } from '@/env'
import { apiError, handleRouteError } from '@/lib/api-error'

/**
 * Server-side proxy to news-indexer's author-identity admin API.
 *
 * The upstream `x-api-key` is `NEWS_INDEXER_SECRET` — the same value that gates
 * /search, /enqueue and /ledger and that news-indexer presents back to Daatan.
 * It must never reach a browser, so every call is made from the server and the
 * ADMIN check lives in the route handlers that call in here.
 */

/** Upstream ids are UUIDs; anything else is rejected before it reaches the proxy URL. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** FastAPI reports failures as `{detail}` — a string, or a list for 422s. */
function errorMessage(payload: unknown, status: number): string {
  const detail = (payload as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return 'Invalid request'
  return `News-indexer request failed (${status})`
}

export async function proxyAuthorsAdmin(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<NextResponse | Response> {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) {
    return apiError('News-indexer not configured', 503)
  }

  const hasBody = init.body !== undefined

  try {
    const resp = await fetch(`${env.NEWS_INDEXER_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'x-api-key': env.NEWS_INDEXER_API_KEY,
        ...(hasBody && { 'content-type': 'application/json' }),
      },
      ...(hasBody && { body: JSON.stringify(init.body) }),
      cache: 'no-store',
    })

    const payload = await resp.json().catch(() => null)
    if (!resp.ok) return apiError(errorMessage(payload, resp.status), resp.status)
    return NextResponse.json(payload, { status: resp.status })
  } catch (error) {
    return handleRouteError(error, `Failed to reach news-indexer (${path})`)
  }
}
