import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError, apiError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { republishForecasts } from '@/lib/services/forecast-republish'

const MAX_IDS_PER_CALL = 50

type Body = { forecastIds?: unknown; mode?: unknown }

async function run(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body
  const ids = Array.isArray(body.forecastIds)
    ? body.forecastIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  if (ids.length === 0) return apiError('forecastIds must be a non-empty array of prediction ids', 400)
  if (ids.length > MAX_IDS_PER_CALL) return apiError(`at most ${MAX_IDS_PER_CALL} forecastIds per call`, 400)
  if (body.mode !== undefined && body.mode !== 'dry-run' && body.mode !== 'apply') {
    return apiError("mode must be 'dry-run' or 'apply'", 400)
  }
  return NextResponse.json(await republishForecasts(ids, body.mode === 'apply'))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await run(request)
  } catch (error) {
    return handleRouteError(error, 'Forecast re-publish failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Re-publish the named forecasts' estimates from the evidence pool they already
 * have — see forecast-republish.ts (daatan#1508). No search, no extractor, no LLM:
 * one compute-only Oracul aggregation per forecast, written through recordEstimate
 * under the `republish` origin (which can never latch settlement).
 *
 * `{ "forecastIds": [...], "mode": "apply" }`; **`mode` defaults to `dry-run`**, which
 * computes every would-be number and writes nothing, so a call that forgets the flag
 * cannot re-publish by accident — the same safety pattern as the remediate route (#1493).
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header — same
 * pattern as the remediate route.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await run(request)
    } catch (error) {
      return handleRouteError(error, 'Forecast re-publish failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
