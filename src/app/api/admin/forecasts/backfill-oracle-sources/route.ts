import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { refreshOracleSnapshot } from '@/lib/services/oracle-backfill'
import { createLogger } from '@/lib/logger'

const log = createLogger('backfill-oracle-sources')
const MAX_PER_CALL = 25

/** ACTIVE forecasts with no context snapshot carrying an oracleSnapshot. */
const NO_ORACLE_SNAPSHOT: Prisma.PredictionWhereInput = {
  status: 'ACTIVE',
  contextSnapshots: { none: { oracleSnapshot: { not: Prisma.DbNull } } },
}

function parseLimit(request: NextRequest): number {
  return Math.min(MAX_PER_CALL, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 10))
}

async function runBackfill(limit: number) {
  const candidates = await prisma.prediction.findMany({
    where: NO_ORACLE_SNAPSHOT,
    select: { id: true, claimText: true },
    take: limit,
  })

  const results = { ok: 0, noArticles: 0, noOracle: 0, failed: 0 }
  for (const p of candidates) {
    try {
      const r = await refreshOracleSnapshot(p)
      if (r.status === 'ok') results.ok++
      else if (r.status === 'no-articles') results.noArticles++
      else results.noOracle++
    } catch (err) {
      results.failed++
      log.warn({ predictionId: p.id, err }, 'backfill forecast failed')
    }
  }

  const remaining = await prisma.prediction.count({ where: NO_ORACLE_SNAPSHOT })
  log.info({ processed: candidates.length, ...results, remaining }, 'backfill-oracle-sources.done')
  return { processed: candidates.length, ...results, remaining }
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return NextResponse.json(await runBackfill(parseLimit(request)))
  } catch (error) {
    return handleRouteError(error, 'Oracle-sources backfill failed')
  }
}, { roles: ['ADMIN'] })

/**
 * One-time-ish backfill: populate the Oracle source roster for ACTIVE forecasts that
 * have no Oracle snapshot yet (created before per-source capture existed). Bounded per
 * call (?limit=N, default 10, max 25) so a single request can't run unbounded; re-call
 * until `remaining` is 0. Each forecast runs a full search + Oracle analysis, so it's paced.
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
      return handleRouteError(error, 'Oracle-sources backfill failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
