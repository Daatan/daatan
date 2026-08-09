import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { rephraseQuestionForecasts } from '@/lib/services/rephrase-question-forecasts'

function isDryRun(request: NextRequest): boolean {
  return new URL(request.url).searchParams.get('dryRun') === '1'
}

async function run(request: NextRequest) {
  return NextResponse.json(await rephraseQuestionForecasts(isDryRun(request)))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await run(request)
  } catch (error) {
    return handleRouteError(error, 'Question-form rephrase failed')
  }
}, { roles: ['ADMIN'] })

/**
 * One-off backfill: rewrite question-form forecast claims into statement form
 * (daatan#1359). The rewrites are a fixed reviewed table in the service — this
 * route only drives it, so it takes no body. Slugs are left untouched by design.
 *
 * Pass `?dryRun=1` to see the outcome per forecast without writing. Idempotent:
 * a second run reports every row as `already`.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header, so
 * it can be driven headlessly — same pattern as the other admin backfills.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await run(request)
    } catch (error) {
      return handleRouteError(error, 'Question-form rephrase failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
