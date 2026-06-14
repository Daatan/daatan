import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'
import { syncLinkedMarkets } from '@/lib/services/external-markets'

const log = createLogger('cron-external-market-sync')

/**
 * GET /api/cron/external-market-sync
 *
 * Refreshes every cached external market (Polymarket / Kalshi) that at least one
 * forecast links to: pulls the latest YES price, writes an
 * ExternalMarketPriceSnapshot (drives the "Market" line on the forecast history
 * chart), and updates resolution status.
 *
 * Read-only against each provider's API; best-effort (never throws). Hourly is
 * plenty — prices move slowly relative to the chart's resolution.
 *
 * EC2 crontab (run hourly):
 *   17 * * * * curl -sf -H "x-cron-secret: $BOT_RUNNER_SECRET" https://daatan.com/api/cron/external-market-sync
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncLinkedMarkets()
  log.info(result, 'External-market sync cron complete')

  return NextResponse.json({ ok: true, ...result })
}
