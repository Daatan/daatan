import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'
import { runRequote } from '@/lib/services/temporal-clock'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron-requote')

/**
 * POST /api/cron/requote
 * The temporal-model daily driver (retro docs/TEMPORAL_MODEL_PLAN.md #4 Stage
 * 0): pure arithmetic per open forecast, no Oracul/search/LLM call except the
 * bounded self-heal classification pass. Protected by x-cron-secret (same
 * secret as BOT_RUNNER_SECRET) — the same auth pattern as every other cron
 * route, first one to read a JSON body instead of query params.
 *
 * Body: { archetypes?: string[], dryRun?: boolean }. archetypes comes from a
 * GitHub Actions repo variable (TEMPORAL_CLOCK_ARCHETYPES) so it's flippable
 * without a deploy; empty list is a deliberate glide no-op — the #1185
 * stuck-PENDING alert sweep still runs, so pausing the glide can't silently
 * kill the safety net. TEMPORAL_CLOCK_DISABLED is a server-side hard kill
 * switch that overrides whatever the request says (and does stop the sweep).
 *
 * GitHub Actions (daily 05:31 UTC, off the hour):
 *   curl -sf -X POST -H "x-cron-secret: $BOT_RUNNER_SECRET" \
 *     -H "content-type: application/json" \
 *     -d '{"archetypes":["diffuse"]}' https://daatan.com/api/cron/requote
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (env.TEMPORAL_CLOCK_DISABLED === 'true') {
    log.info('Requote skipped — TEMPORAL_CLOCK_DISABLED')
    return NextResponse.json({ ok: true, disabled: true })
  }

  const body = await request.json().catch(() => ({}))
  const archetypes = Array.isArray(body.archetypes)
    ? body.archetypes.filter((a: unknown): a is string => typeof a === 'string').map((a: string) => a.toLowerCase())
    : ['diffuse']
  const dryRun = body.dryRun === true

  try {
    const summary = await runRequote({ archetypes, dryRun })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    log.error({ err }, 'Requote cron failed')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
