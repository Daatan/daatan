import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'
import { pushCredibilityFeedback } from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('backfill-settlement-pins')
const MAX_PER_CALL = 50

/**
 * Resolved binaries that carry a settled Oracul snapshot. Superset of what will
 * actually be recorded: the `createdAt <= resolvedAt` cut can't be expressed as
 * a column-to-column comparison here, so `pushCredibilityFeedback` re-applies it
 * per prediction and simply omits the field when nothing qualifies.
 */
const RESOLVED_WITH_PIN: Prisma.PredictionWhereInput = {
  outcomeType: 'BINARY',
  status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
  resolvedAt: { not: null },
  contextSnapshots: {
    some: {
      kind: { not: 'clock' },
      insufficientData: false,
      oracleSettled: true,
    },
  },
}

type LedgerReport = { total_settled_pins: number; contradicted_count: number }

/**
 * Read the ledger back rather than trusting our own attempt counter. The push is
 * fire-and-forget and swallows its failures, so "processed: 5" on its own is a
 * fail-open zero — this endpoint is the reason the ledger was believed to be
 * merely empty for a week (daatan#1451).
 */
async function readLedger(): Promise<LedgerReport | null> {
  const cfg = getOracleConfig()
  if (!cfg) return null
  try {
    const res = await oracleFetch(cfg, '/leaderboard/settlement-pin-report', { timeoutMs: 10_000 })
    if (!res.ok) return null
    return (await res.json()) as LedgerReport
  } catch {
    return null
  }
}

async function runBackfill(limit: number) {
  const candidates = await prisma.prediction.findMany({
    where: RESOLVED_WITH_PIN,
    select: { id: true, status: true, resolvedAt: true },
    orderBy: { resolvedAt: 'asc' },
    take: limit,
  })

  const before = await readLedger()
  for (const p of candidates) {
    await pushCredibilityFeedback(p.id, p.status === 'RESOLVED_CORRECT', p.resolvedAt as Date)
  }
  const after = await readLedger()

  const result = {
    processed: candidates.length,
    predictionIds: candidates.map((p) => p.id),
    ledgerBefore: before,
    ledgerAfter: after,
    recorded: before && after ? after.total_settled_pins - before.total_settled_pins : null,
  }
  log.info(result, 'backfill-settlement-pins.done')
  return result
}

function parseLimit(request: NextRequest): number {
  return Math.min(MAX_PER_CALL, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || MAX_PER_CALL))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return NextResponse.json(await runBackfill(parseLimit(request)))
  } catch (error) {
    return handleRouteError(error, 'Settlement-pin backfill failed')
  }
}, { roles: ['ADMIN'] })

/**
 * One-off backfill for daatan#1451: re-push already-resolved binaries so their
 * settlement pins land in retro's settlement-pin ledger, which recorded nothing
 * between retro#455 shipping and the `settlement_snapshot` field being wired.
 *
 * Safe to re-run. retro's `record_settlement_pin` keeps its own dedup index,
 * independent of the resolution-feedback one, and `POST /leaderboard/ingest`
 * calls it outside the `already_ingested` branch precisely so a retry can add a
 * snapshot the first push omitted — which is exactly this case. Source rows
 * cannot double-count.
 *
 * Reports the ledger's own counts either side of the run rather than a local
 * success tally; see {@link readLedger}.
 *
 * Auth: an ADMIN session, OR `x-cron-secret` (BOT_RUNNER_SECRET), matching the
 * other admin backfills.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return NextResponse.json(await runBackfill(parseLimit(request)))
    } catch (error) {
      return handleRouteError(error, 'Settlement-pin backfill failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
