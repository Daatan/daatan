import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { apiError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { secretsMatch } from '@/lib/cron-auth'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { retractCredibilityFeedback } from '@/lib/services/evidence-pool'

const log = createLogger('retract-credibility')

async function run(id: string, actor: string) {
  const prediction = await prisma.prediction.findUnique({ where: { id }, select: { id: true } })
  if (!prediction) return apiError('Forecast not found', 404)

  const result = await retractCredibilityFeedback(id)
  log.info({ predictionId: id, actor, status: result.status }, 'event=credibility_feedback_retract_requested')
  if (result.status !== 'ok') {
    return result.status === 'skipped'
      ? apiError('Retro ledger writes are off in this environment', 409)
      : apiError('Retro refused or did not answer; see the logs', 502)
  }
  return NextResponse.json({ predictionId: id, retro: result.retro })
}

const authed = withAuth(async (_request, user, { params }) => run(params.id, user.id), { roles: ['ADMIN'] })

/**
 * Withdraw one forecast's credibility feedback from retro's source and author ledgers, without
 * unresolving it (daatan#2273): for readings that scored the wrong event, e.g. a forecast whose
 * resolution rules inverted its claim. Retro's `DELETE /leaderboard/ingest/{id}` is idempotent.
 *
 * It does not stop a later re-push: the resolved-forecast backfills (tags, settlement pins) push
 * every match again. Exclude the bad pool rows first, so a re-push has nothing wrong to send.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header — same pattern as
 * the evidence-pool remediate route.
 */
export async function POST(request: NextRequest, context: { params: Promise<Record<string, string>> }) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    return run((await context.params).id, 'cron-secret')
  }
  return authed(request, context)
}
