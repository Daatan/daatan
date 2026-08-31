import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError, apiError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { remediatePool, remediableWhere, usablePoolWhere } from '@/lib/services/pool-remediate'

const MAX_IDS_PER_CALL = 10

type Body = { ids?: unknown; mode?: unknown; scope?: unknown }

async function run(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
  if (ids.length === 0) return apiError('ids must be a non-empty array of prediction ids', 400)
  if (ids.length > MAX_IDS_PER_CALL) return apiError(`at most ${MAX_IDS_PER_CALL} ids per call`, 400)
  if (body.mode !== undefined && body.mode !== 'dry-run' && body.mode !== 'apply') {
    return apiError("mode must be 'dry-run' or 'apply'", 400)
  }
  if (body.scope !== undefined && body.scope !== 'a6' && body.scope !== 'usable') {
    return apiError("scope must be 'a6' or 'usable'", 400)
  }
  const target = body.scope === 'usable' ? usablePoolWhere() : remediableWhere()
  return NextResponse.json(await remediatePool(ids, body.mode === 'apply', target))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await run(request)
  } catch (error) {
    return handleRouteError(error, 'Evidence-pool remediation failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Re-extract the named forecasts' strongest evidence rows against the current
 * extractor and re-publish their estimates — see pool-remediate.ts.
 *
 * `{ "ids": [...], "mode": "apply", "scope": "usable" }`; **`mode` defaults to
 * `dry-run`**, which reads the target set and writes nothing, so a call that forgets
 * the flag cannot remediate by accident. **`scope` defaults to `a6`** (the narrow
 * over-extraction signature); `usable` targets the whole currently-usable pool for a
 * blanket recompute (retro#626) instead of an A6-only remediation. Each forecast costs
 * one Oracul analysis per 15 target rows, so this is driven by hand over a reviewed
 * list, not on a schedule — the plan's human-review gate sits in front of it, not
 * inside it.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header — same
 * pattern as the retry route.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await run(request)
    } catch (error) {
      return handleRouteError(error, 'Evidence-pool remediation failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
