import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError, apiError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { retireLegacyNullRows } from '@/lib/services/evidence-pool'

async function run(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown }
  if (body.mode !== undefined && body.mode !== 'dry-run' && body.mode !== 'apply') {
    return apiError("mode must be 'dry-run' or 'apply'", 400)
  }
  try {
    return NextResponse.json(await retireLegacyNullRows(body.mode === 'apply'))
  } catch (error) {
    return handleRouteError(error, 'Legacy oracle_null retirement failed')
  }
}

const authed = withAuth(run, { roles: ['ADMIN'] })

/**
 * POST /api/admin/evidence-pool/retire-legacy-null
 *
 * One-off admin action (daatan#1522): stamp every pre-#1231 `oracle_null`-legacy row
 * with the terminal `retired_legacy` reason, so the retry sweep and re-claim path stop
 * treating them as retryable forever (see retireLegacyNullRows). `{ "mode": "apply" }`;
 * **`mode` defaults to `dry-run`**, which only counts the target set and writes nothing —
 * same convention as the remediate/retry routes.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header — same
 * pattern as the remediate/retry routes.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    return run(request)
  }
  return authed(request, { params: Promise.resolve({}) })
}
