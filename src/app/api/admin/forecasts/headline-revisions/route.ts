import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { applyHeadlineRevisions } from '@/lib/services/headline-revisions'
import { HEADLINE_REVISIONS, HEADLINE_REVISION_BATCH } from '@/lib/services/headline-revisions.data'

async function run(request: NextRequest) {
  const apply = new URL(request.url).searchParams.get('apply') === '1'
  return NextResponse.json(await applyHeadlineRevisions(HEADLINE_REVISIONS, HEADLINE_REVISION_BATCH, { apply }))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await run(request)
  } catch (error) {
    return handleRouteError(error, 'Headline revisions failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Display-only headline revisions for ACTIVE forecasts (the reviewed table in
 * `headline-revisions.data.ts`). `predictions` is never written: each applied row is an
 * insert into `prediction_headline_revisions`.
 *
 * DRY RUN BY DEFAULT: the response lists the outcome per forecast. Add `?apply=1` to write.
 * Idempotent: a second apply reports every row as `already`.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await run(request)
    } catch (error) {
      return handleRouteError(error, 'Headline revisions failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
