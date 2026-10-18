import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import { pushCredibilityFeedback } from '@/lib/services/evidence-pool'
import { createLogger } from '@/lib/logger'

const log = createLogger('backfill-tags')
const MAX_PER_CALL = 50

/** Resolved binaries that carry at least one tag — the only ones retro's per-topic board can use. */
const RESOLVED_WITH_TAGS: Prisma.PredictionWhereInput = {
  outcomeType: 'BINARY',
  status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
  resolvedAt: { not: null },
  tags: { some: {} },
}

async function runBackfill(limit: number, after: string | null) {
  const candidates = await prisma.prediction.findMany({
    where: RESOLVED_WITH_TAGS,
    select: { id: true, status: true, resolvedAt: true },
    orderBy: { id: 'asc' },
    take: limit,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  })

  for (const p of candidates) {
    await pushCredibilityFeedback(p.id, p.status === 'RESOLVED_CORRECT', p.resolvedAt as Date)
  }

  const result = {
    processed: candidates.length,
    nextCursor: candidates.length === limit ? candidates[candidates.length - 1].id : null,
  }
  log.info(result, 'backfill-tags.done')
  return result
}

function parseParams(request: NextRequest) {
  const params = new URL(request.url).searchParams
  return {
    limit: Math.min(MAX_PER_CALL, Math.max(1, Number(params.get('limit')) || MAX_PER_CALL)),
    after: params.get('after'),
  }
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    const { limit, after } = parseParams(request)
    return NextResponse.json(await runBackfill(limit, after))
  } catch (error) {
    return handleRouteError(error, 'Tag backfill failed')
  }
}, { roles: ['ADMIN'] })

/**
 * One-off backfill for daatan#1917: re-push already-resolved tagged binaries so retro records
 * their tags (`POST /leaderboard/ingest` on an ingested prediction_id with `tags` stores the tags
 * and rescores; the ledger entry itself is untouched, so this is safe to re-run). Page through
 * with `?after=<nextCursor>` until `nextCursor` is null. The push swallows its own failures, so
 * check retro's by-tag board afterwards rather than trusting `processed`.
 *
 * Auth: an ADMIN session, OR `x-cron-secret` (BOT_RUNNER_SECRET), like the other admin backfills.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      const { limit, after } = parseParams(request)
      return NextResponse.json(await runBackfill(limit, after))
    } catch (error) {
      return handleRouteError(error, 'Tag backfill failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
