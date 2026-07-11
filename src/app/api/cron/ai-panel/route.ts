import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'
import { runPanelSweep } from '@/lib/services/ai-panel'

const log = createLogger('cron-ai-panel')

/** Wall-clock guard. The sweep is sequential over forecasts; a pathological run
 *  should end rather than overlap the next tick. */
export const maxDuration = 300

/**
 * GET /api/cron/ai-panel
 *
 * Asks every panel member (docs/LASSO.md §5) for an ungrounded probability on every
 * open BINARY forecast, and stores each member's answer as an `AiEstimate` row.
 *
 * The panel is a CHARTED SOURCE, not the needle: this route never writes
 * `Prediction.confidence` / `aiCiLow` / `aiCiHigh` and never calls `recordEstimate()`,
 * so nothing here can move the gauge, fire the high-confidence Telegram alert, or
 * touch any user score.
 *
 * Cheap by construction. The prompt carries no article text, so the only input that
 * changes is the date; an unchanged input hash skips the whole sweep for that
 * forecast. In practice that means one call per member per forecast per day.
 *
 * Query params:
 *   ?dryRun=1   build and log the prompt, write nothing
 *   ?limit=N    cap the number of forecasts (useful on staging)
 *
 * Triggered twice daily by .github/workflows/ai-panel.yml. Twice, not once, so a
 * failed tick self-heals within 12h rather than 24h — the second tick is a free
 * no-op when the first succeeded, because the date hash is unchanged.
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === '1'
  const limitParam = Number(searchParams.get('limit'))
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined

  const result = await runPanelSweep({ dryRun, limit })
  log.info(result, 'AI panel cron complete')

  // A rejected key is an operational failure, not a quiet no-op. Returning 200 here
  // made the scheduled workflow print "✅ Panel sweep OK" while every single call had
  // 401'd — the failure was visible only as `failed: 57` inside the JSON body. 502 is
  // what makes ai-panel.yml go red (it treats any non-200, non-404 as a failure).
  //
  // `dormant` stays a 200: no key configured is a deliberate state, not a breakage.
  if (result.unauthorized) {
    return NextResponse.json({ ok: false, ...result }, { status: 502 })
  }

  return NextResponse.json({ ok: true, ...result })
}
