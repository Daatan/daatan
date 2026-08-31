import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { checkOracleHealth } from '@/lib/services/oracle'
import { notifyOracleForecastUnavailable } from '@/lib/services/telegram'
import { secretsMatch } from '@/lib/cron-auth'

const log = createLogger('cron-oracle-health')

/**
 * GET /api/cron/oracle-health
 *
 * Checks the TruthMachine Oracle /health endpoint and fires a Telegram alert
 * when unreachable or failing. The existing search-health cron covers search
 * provider credits; this covers the forecast Oracul itself.
 *
 * Uses the same Telegram cooldown mechanism as other alerts (5-min window), so
 * running this hourly will fire at most one alert per incident.
 *
 * EC2 crontab (run every 30 minutes):
 *   0,30 * * * * curl -sf -H "x-cron-secret: $BOT_RUNNER_SECRET" https://daatan.com/api/cron/oracle-health
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const healthy = await checkOracleHealth()

  log.info({ healthy }, 'Oracul health check')

  if (!healthy) {
    notifyOracleForecastUnavailable()
    log.warn('Oracul forecast unavailable — Telegram alert fired')
  }

  return NextResponse.json({ ok: true, healthy })
}
