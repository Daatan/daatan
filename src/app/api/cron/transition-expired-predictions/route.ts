import { NextRequest, NextResponse } from 'next/server'
import { transitionExpiredPredictions } from '@/lib/services/prediction-lifecycle'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'

const log = createLogger('cron-transition-expired-predictions')

/**
 * GET /api/cron/transition-expired-predictions
 * Transitions ACTIVE predictions past their resolveByDatetime to PENDING.
 * Moved off the GET /api/forecasts hot read path (daatan#1202) — every feed
 * load was paying for this write-scan before doing any read. Doesn't gate
 * commitment eligibility (getCommitmentLockReason checks resolveByDatetime
 * directly), so a periodic sweep is safe.
 * Protected by x-cron-secret header (same secret as BOT_RUNNER_SECRET).
 *
 * Triggered by .github/workflows/transition-expired-predictions.yml every 15 minutes.
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const transitioned = await transitionExpiredPredictions()
    log.info({ transitioned }, 'Cron transition-expired-predictions completed')
    return NextResponse.json({ ok: true, transitioned })
  } catch (err) {
    log.error({ err }, 'Cron transition-expired-predictions failed')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
