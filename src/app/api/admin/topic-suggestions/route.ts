import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { parseOptionalJsonBody } from '@/lib/api-body'
import { topicSuggestionsBodySchema } from '@/lib/validations/api-inputs'
import { SUGGEST_DEFAULTS, findTopicSuggestions } from '@/lib/services/topic-suggestions/suggest'

async function run(request: NextRequest) {
  const body = await parseOptionalJsonBody(request, topicSuggestionsBodySchema)
  return NextResponse.json(await findTopicSuggestions({ ...SUGGEST_DEFAULTS, ...body }))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await run(request)
  } catch (error) {
    return handleRouteError(error, 'Topic suggestions failed')
  }
}, { roles: ['ADMIN'] })

/**
 * This week's stories and the open forecast questions they raise (daatan#2308), for an admin
 * to read. Writes nothing. `{ days?, threshold?, minSources?, maxClusters? }`, defaults in
 * `SUGGEST_DEFAULTS`.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header, so the
 * `topic-suggestions` workflow can drive it — same pattern as the retro candidates route.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await run(request)
    } catch (error) {
      return handleRouteError(error, 'Topic suggestions failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
