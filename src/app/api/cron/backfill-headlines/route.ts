import { NextRequest, NextResponse } from 'next/server'
import { generateAndStoreHeadline } from '@/lib/llm/headline'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'

const log = createLogger('cron-backfill-headlines')

/**
 * GET /api/cron/backfill-headlines?limit=N
 *
 * Generates card headlines (daatan#1814) for predictions whose `headline IS NULL`:
 * rows that predate the column, plus any whose fire-and-forget generation failed.
 * Guard-rejected rows hold '' and are not retried. Newest first, so live cards fill
 * before old resolved ones.
 *
 * Scheduled by .github/workflows/backfill-headlines.yml. Like backfill-embeddings,
 * callers must inspect the body: per-row failures are counted, not surfaced as a status.
 */

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
const CONCURRENCY = 5

export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit'))
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT

  const missing = await prisma.prediction.findMany({
    where: { headline: null },
    select: { id: true, claimText: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const counts = { stored: 0, rejected: 0, failed: 0 }
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const results = await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(({ id, claimText }) =>
        generateAndStoreHeadline(id, claimText).catch((err) => {
          log.error({ err, id }, 'Backfill headline failed for prediction')
          return 'failed' as const
        }),
      ),
    )
    for (const r of results) counts[r]++
  }

  const remaining = await prisma.prediction.count({ where: { headline: null } })
  log.info({ ...counts, remaining }, 'Headline backfill cron complete')
  return NextResponse.json({ ok: true, ...counts, remaining })
}
