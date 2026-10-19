import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { remediatePool, remediableWhere, usablePoolWhere, amnestyWhere } from '@/lib/services/pool-remediate'
import { parseOptionalJsonBody } from '@/lib/api-body'
import { remediateBodySchema } from '@/lib/validations/api-inputs'

const MAX_IDS_PER_CALL = 10

async function run(request: NextRequest) {
  const { ids, mode, scope } = await parseOptionalJsonBody(request, remediateBodySchema(MAX_IDS_PER_CALL))
  const target = scope === 'usable' ? usablePoolWhere() : scope === 'amnesty' ? amnestyWhere() : remediableWhere()
  return NextResponse.json(await remediatePool(ids, mode === 'apply', target))
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
 * blanket recompute (retro#626) instead of an A6-only remediation; `amnesty` targets the
 * one-time pre-08-05 `oracle_null_final` re-drive (daatan#1547) — the timeout-retirement
 * regime's terminal stamps, not genuine null verdicts. Each forecast costs one Oracul
 * analysis per 15 target rows, so this is driven by hand over a reviewed list, not on a
 * schedule — the plan's human-review gate sits in front of it, not inside it.
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
