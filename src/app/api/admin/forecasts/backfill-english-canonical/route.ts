import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { canonicalizeForecastToEnglish } from '@/lib/services/forecast'
import { createLogger } from '@/lib/logger'

const log = createLogger('backfill-english-canonical')
const MAX_PER_CALL = 25

// Unprocessed forecasts (original_language IS NULL) whose claim has any non-ASCII
// character. This over-selects accented-Latin English (harmlessly marked `english`)
// but skips the pure-ASCII majority; the per-row pass decides the precise outcome.
const NON_ASCII = '[^[:ascii:]]'

function parseLimit(request: NextRequest): number {
  return Math.min(MAX_PER_CALL, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 10))
}

async function countRemaining(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM predictions
    WHERE original_language IS NULL AND claim_text ~ ${NON_ASCII}`
  return Number(rows[0]?.count ?? 0)
}

async function runBackfill(limit: number) {
  const candidates = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM predictions
    WHERE original_language IS NULL AND claim_text ~ ${NON_ASCII}
    ORDER BY "createdAt" DESC
    LIMIT ${limit}`

  const results = { canonicalized: 0, english: 0, failed: 0, skipped: 0 }
  for (const { id } of candidates) {
    try {
      const r = await canonicalizeForecastToEnglish(id)
      results[r]++
    } catch (err) {
      results.failed++
      log.warn({ predictionId: id, err }, 'canonicalize forecast failed')
    }
  }

  const remaining = await countRemaining()
  log.info({ processed: candidates.length, ...results, remaining }, 'backfill-english-canonical.done')
  return { processed: candidates.length, ...results, remaining }
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return NextResponse.json(await runBackfill(parseLimit(request)))
  } catch (error) {
    return handleRouteError(error, 'English-canonical backfill failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Backfill: canonicalize non-English forecasts to English (translate to English,
 * re-slug + keep the old slug as a 308 alias, seed the original wording). Bounded
 * per call (?limit=N, default 10, max 25) so a single request can't run unbounded;
 * re-call until `remaining` is 0. Each non-English forecast runs Gemini calls, so
 * it's paced. Idempotent — only touches rows with original_language NULL.
 *
 * Auth: an ADMIN session, OR the `x-cron-secret` (BOT_RUNNER_SECRET) header so the
 * backfill workflow can drive it headlessly — same pattern as the cron routes.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return NextResponse.json(await runBackfill(parseLimit(request)))
    } catch (error) {
      return handleRouteError(error, 'English-canonical backfill failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
