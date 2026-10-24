import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { applyHeadlineRevisions, type HeadlineRevisionEntry } from '@/lib/services/headline-revisions'
import { HEADLINE_REVISIONS, HEADLINE_REVISION_BATCH } from '@/lib/services/headline-revisions.data'
import { HEADLINE_REVISIONS_2, HEADLINE_REVISION_BATCH_2 } from '@/lib/services/headline-revisions-2.data'

// Reviewed batches by name. With no ?batch= the newest one runs; a newer batch supersedes an older
// one on the card (newest non-revoked revision wins), so earlier batches stay as the audit trail.
const BATCHES: Record<string, HeadlineRevisionEntry[]> = {
  [HEADLINE_REVISION_BATCH]: HEADLINE_REVISIONS,
  [HEADLINE_REVISION_BATCH_2]: HEADLINE_REVISIONS_2,
}

async function run(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const apply = params.get('apply') === '1'
  const batch = params.get('batch') ?? HEADLINE_REVISION_BATCH_2
  const entries = Object.hasOwn(BATCHES, batch) ? BATCHES[batch] : undefined
  if (!entries) return NextResponse.json({ error: `Unknown batch ${batch}`, batches: Object.keys(BATCHES) }, { status: 400 })
  return NextResponse.json(await applyHeadlineRevisions(entries, batch, { apply }))
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
