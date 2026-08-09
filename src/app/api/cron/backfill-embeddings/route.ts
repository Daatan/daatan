import { NextRequest, NextResponse } from 'next/server'
import { embedAndStoreForecast } from '@/lib/services/embedding'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'

const log = createLogger('cron-backfill-embeddings')

/**
 * GET /api/cron/backfill-embeddings
 *
 * Embeds up to BATCH_SIZE predictions that have no embedding yet, in one cron
 * run. Running nightly keeps the similar-forecast index current without the
 * admin needing to trigger the manual POST /api/admin/backfill-embeddings.
 *
 * Idempotent — safe to run multiple times; already-embedded predictions are
 * skipped by the `embedding IS NULL` filter.
 *
 * Scheduled by .github/workflows/backfill-embeddings.yml, nightly at 02:23 UTC.
 * There is no crontab on the EC2 box — this file used to claim there was, which is
 * why nothing called this route between its introduction and #1369.
 *
 * Callers must inspect the body, not the status: per-row embedding errors are caught
 * and counted into `failed`, so a run where every embed failed still answers 200.
 */

const BATCH_SIZE = 20

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const missing = await prisma.$queryRaw<{ id: string; claimText: string }[]>`
    SELECT id, "claimText" FROM predictions WHERE embedding IS NULL LIMIT ${BATCH_SIZE}
  `

  if (missing.length === 0) {
    log.info('No predictions missing embeddings')
    return NextResponse.json({ ok: true, done: 0, remaining: 0 })
  }

  let done = 0
  let failed = 0

  for (const { id, claimText } of missing) {
    try {
      await embedAndStoreForecast(id, claimText)
      done++
    } catch (err) {
      log.error({ err, id }, 'Backfill embed failed for prediction')
      failed++
    }
  }

  const remaining = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM predictions WHERE embedding IS NULL
  `
  const remainingCount = Number(remaining[0]?.count ?? 0)

  log.info({ done, failed, remaining: remainingCount }, 'Embedding backfill cron complete')
  return NextResponse.json({ ok: true, done, failed, remaining: remainingCount })
}
