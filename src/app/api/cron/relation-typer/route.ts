import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'
import { runRelationTyper } from '@/lib/services/relation-typer'

const log = createLogger('cron-relation-typer')

/**
 * GET /api/cron/relation-typer — retro#574.
 * Protected by x-cron-secret (same secret as the other cron routes).
 *
 * Types the open cosine ≥ 0.85 + shared-tag pairs that have no
 * `question_relations` row yet and writes PROPOSED rows for post-moderation.
 * Writes structure only; no published number changes. `?dryRun=1` returns the
 * would-be proposals without writing — the acceptance check against the
 * hand-labelled 08-21 pair set runs through this. `?limit=N` caps pairs per run.
 *
 * GitHub Actions: .github/workflows/relation-typer.yml (daily)
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET
  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = request.nextUrl.searchParams
  const dryRun = params.get('dryRun') === '1'
  const limitRaw = Number(params.get('limit'))
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined

  try {
    const summary = await runRelationTyper({ limit, dryRun })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    log.error({ err }, 'Relation typer run failed')
    return NextResponse.json({ ok: false, error: 'Relation typer run failed' }, { status: 500 })
  }
}
