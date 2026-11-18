import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { parseJsonBody } from '@/lib/api-body'
import { retroSimulateBodySchema } from '@/lib/validations/api-inputs'
import { simulateRetroEvent } from '@/lib/services/retro-generator/simulate'

async function run(request: NextRequest) {
  const { mode, ...input } = await parseJsonBody(request, retroSimulateBodySchema)
  return NextResponse.json(await simulateRetroEvent({ ...input, dryRun: mode !== 'apply' }))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await run(request)
  } catch (error) {
    return handleRouteError(error, 'Retro simulation failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Stage 2 of the retro generator (daatan#2217), one event per call: one candidate from
 * `POST /api/admin/retro/candidates`, passed through. Finds the articles published before T0,
 * asks Oracul as of T0, and with `"mode": "apply"` saves a private PENDING_APPROVAL draft.
 * **`mode` defaults to `dry-run`**, which does everything but the write. One Oracul analysis
 * per call (up to ~95 s), so it is paced by the caller.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await run(request)
    } catch (error) {
      return handleRouteError(error, 'Retro simulation failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
