import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { refreshOracleSnapshot } from '@/lib/services/oracle-backfill'
import { createLogger } from '@/lib/logger'

const log = createLogger('backfill-oracle-sources')
const MAX_PER_CALL = 25

/**
 * One-time-ish backfill: populate the Oracle source roster for ACTIVE forecasts that
 * have no Oracle snapshot yet (created before per-source capture existed). Bounded per
 * call (?limit=N, default 10, max 25) so a single request can't run unbounded; re-call
 * until `remaining` is 0. Each forecast runs a full search + Oracle analysis, so this
 * is paced and admin-gated.
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const limit = Math.min(
      MAX_PER_CALL,
      Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 10),
    )

    // Active forecasts with no context snapshot carrying an oracleSnapshot.
    const candidates = await prisma.prediction.findMany({
      where: {
        status: 'ACTIVE',
        contextSnapshots: { none: { oracleSnapshot: { not: Prisma.DbNull } } },
      },
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

    const remaining = await prisma.prediction.count({
      where: {
        status: 'ACTIVE',
        contextSnapshots: { none: { oracleSnapshot: { not: Prisma.DbNull } } },
      },
    })

    log.info({ processed: candidates.length, ...results, remaining }, 'backfill-oracle-sources.done')
    return NextResponse.json({ processed: candidates.length, ...results, remaining })
  } catch (error) {
    return handleRouteError(error, 'Oracle-sources backfill failed')
  }
}, { roles: ['ADMIN'] })
