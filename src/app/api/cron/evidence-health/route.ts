import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'
import { alertKey, checkEvidenceHealth, RECENT_DAYS, BASELINE_DAYS } from '@/lib/services/evidence-health'
import { notifyEvidenceHealthDigest } from '@/lib/services/telegram'

const log = createLogger('cron-evidence-health')

/**
 * GET /api/cron/evidence-health
 * Protected by x-cron-secret header (same secret as the other cron routes).
 *
 * The "notify on fail" half of daatan#1478: evaluates the evidence pipeline
 * against its own recent baseline and fires a single grouped Telegram digest for
 * whatever newly broke. Nothing here is a new measurement — the pool rows and
 * `oracle_call_logs` already recorded all of it; what was missing was a consumer.
 *
 * Deliberately its own route rather than a notification bolted onto
 * `/api/cron/evidence-pool-stats`: that one is a read whose window comes from a
 * caller-supplied `days` param and is invoked by `llm-waste-report.yml` (and any
 * future report), so alerting there would tie both the alert cadence and the
 * comparison window to whoever happened to call it.
 *
 * GitHub Actions: .github/workflows/evidence-health.yml (daily)
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await checkEvidenceHealth()

    notifyEvidenceHealthDigest({
      issues: result.fired,
      recentDays: RECENT_DAYS,
      baselineDays: BASELINE_DAYS,
      recentRows: result.recentRows,
      recentFailedPct: result.recentFailedPct,
      baselineFailedPct: result.baselineFailedPct,
      suppressed: result.suppressed,
    })

    return NextResponse.json({
      ok: true,
      recentDays: RECENT_DAYS,
      baselineDays: BASELINE_DAYS,
      recentRows: result.recentRows,
      recentFailedPct: result.recentFailedPct,
      baselineFailedPct: result.baselineFailedPct,
      suppressed: result.suppressed,
      fired: result.fired.map(alertKey),
    })
  } catch (err) {
    // 500 rather than a green `{ok:true, fired:[]}`: a health check that reports
    // nothing wrong because it couldn't read the data is the exact failure this
    // issue exists to end. The workflow step fails and the run goes red.
    log.error({ err }, 'evidence-health check failed')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
