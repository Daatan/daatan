import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { republishForecasts } from '@/lib/services/forecast-republish'
import { parseOptionalJsonBody } from '@/lib/api-body'
import { republishBodySchema } from '@/lib/validations/api-inputs'

const MAX_IDS_PER_CALL = 50

async function run(request: NextRequest) {
  const { forecastIds, mode } = await parseOptionalJsonBody(request, republishBodySchema(MAX_IDS_PER_CALL))
  return NextResponse.json(await republishForecasts(forecastIds, mode === 'apply'))
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
