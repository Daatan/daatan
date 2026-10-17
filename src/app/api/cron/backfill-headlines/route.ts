import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'

/**
 * GET /api/cron/backfill-headlines
 *
 * Disabled. It used to generate card headlines (daatan#1814) for predictions with
 * `headline IS NULL`. Headlines are now written only when a forecast is created or its
 * claim is edited: filling NULL rows would attach new-style headlines to forecasts that
 * are already published, which must not change, so those cards fall back to the claim.
 * The route stays so the nightly workflow (still scheduled) keeps getting a 200 until it is removed.
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ ok: true, disabled: true })
}
