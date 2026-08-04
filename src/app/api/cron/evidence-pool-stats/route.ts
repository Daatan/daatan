import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'
import { getPoolThroughput } from '@/lib/services/evidence-pool'

const log = createLogger('cron-evidence-pool-stats')

const DEFAULT_DAYS = 7
const MAX_DAYS = 90

/**
 * GET /api/cron/evidence-pool-stats?days=7
 * Protected by x-cron-secret header (same secret as BOT_RUNNER_SECRET).
 *
 * The denominator of the weekly LLM waste report (docs#57, daatan#1274): how many
 * pool rows the extractor was spent on, and how many became usable evidence.
 *
 * Exists because the report previously reached for this over SSM — `send-command`
 * into prod to `docker exec` a `psql` `count(*)` — which needed
 * `ssm:GetCommandInvocation` on the CI role to read the answer back. Granting that
 * would have widened a CI role's read access to *every* SSM command result in the
 * account in order to count two integers. The app already owns this data and
 * already authenticates machines this way (see the other routes under /api/cron),
 * so the report does a plain HTTP call instead: no SSM, no docker exec, no psql,
 * no IAM change — and the number is reusable by anything else that wants it.
 *
 * Read-only. Consumed by .github/workflows/llm-waste-report.yml.
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = request.nextUrl.searchParams.get('days')
  const days = raw === null ? DEFAULT_DAYS : Number(raw)
  // Reject rather than clamp: a caller asking for a window it doesn't get back
  // would divide spend for one period by output from another and never notice.
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return NextResponse.json(
      { error: `days must be an integer between 1 and ${MAX_DAYS}` },
      { status: 400 },
    )
  }

  try {
    const { attempted, usable } = await getPoolThroughput(days)
    log.info({ days, attempted, usable }, 'event=evidence_pool_stats')
    return NextResponse.json({ ok: true, days, attempted, usable })
  } catch (err) {
    log.error({ err }, 'evidence-pool-stats failed')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
