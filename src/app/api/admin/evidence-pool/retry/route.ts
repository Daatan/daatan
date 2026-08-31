import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { retryPoolExtractions } from '@/lib/services/pool-retry'

const MAX_PER_CALL = 10

function parseLimit(request: NextRequest): number {
  return Math.min(MAX_PER_CALL, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 3))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return NextResponse.json(await retryPoolExtractions(parseLimit(request)))
  } catch (error) {
    return handleRouteError(error, 'Evidence-pool retry sweep failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Drain stuck evidence-pool rows (FAILED except oracle_omitted, abandoned PENDING)
 * by re-driving them through extraction — see pool-retry.ts. Bounded per call
 * (?limit=N predictions, default 3, max 10): each prediction is one full Oracul
 * analysis, so calls are paced; re-call until `remaining` is 0.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header so the
 * retry workflow can drive it headlessly — same pattern as backfill-oracle-sources.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return NextResponse.json(await retryPoolExtractions(parseLimit(request)))
    } catch (error) {
      return handleRouteError(error, 'Evidence-pool retry sweep failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
