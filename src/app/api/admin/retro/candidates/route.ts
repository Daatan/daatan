import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { parseOptionalJsonBody } from '@/lib/api-body'
import { retroCandidatesBodySchema } from '@/lib/validations/api-inputs'
import { CANDIDATE_DEFAULTS, findRetroCandidates } from '@/lib/services/retro-generator/candidates'

async function run(request: NextRequest) {
  const body = await parseOptionalJsonBody(request, retroCandidatesBodySchema)
  return NextResponse.json(await findRetroCandidates({ ...CANDIDATE_DEFAULTS, ...body }))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await run(request)
  } catch (error) {
    return handleRouteError(error, 'Retro candidates failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Stage 1 of the retro generator (daatan#2217): this week's candidate events, judged and
 * dated, for `POST /api/admin/retro/simulate` to take one at a time. Writes nothing.
 * `{ days?, threshold?, minSources?, maxClusters? }`, defaults in `CANDIDATE_DEFAULTS`.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header, so the
 * `retro-simulations` workflow can drive it — same pattern as the evidence-pool retry route.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await run(request)
    } catch (error) {
      return handleRouteError(error, 'Retro candidates failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
