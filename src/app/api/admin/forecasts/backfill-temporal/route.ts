import { NextResponse, type NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { env } from '@/env'
import { withAuth } from '@/lib/api-middleware'
import { handleRouteError } from '@/lib/api-error'
import { secretsMatch } from '@/lib/cron-auth'
import {
  classifyClaim,
  classifyAndStoreTemporal,
  type TemporalClassification,
} from '@/lib/services/temporal-classifier'
import { createLogger } from '@/lib/logger'

const log = createLogger('backfill-temporal')

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const DEADLINE_AGREEMENT_TOLERANCE_MS = 72 * 3600_000
const LOW_CONFIDENCE_THRESHOLD = 0.6

interface BackfillBody {
  mode: 'dry-run' | 'apply'
  limit?: number
  ids?: string[]
  skipIds?: string[]
  force?: boolean
}

interface Candidate {
  id: string
  slug: string | null
  claimText: string
  resolveByDatetime: Date
  outcomeType: string
}

interface Row {
  id: string
  slug: string | null
  claimText: string
  resolveByDatetime: string
  extractedDeadline: string | null
  deadlineDeltaDays: number | null
  agreement: 'agree' | 'diverge' | 'no-deadline'
  direction: string
  archetype: string
  tauLeadDays: number | null
  confidence: number | null
  notes: string
  wouldGlide: boolean
}

function agreementFor(extracted: Date | null, resolveBy: Date): Row['agreement'] {
  if (!extracted) return 'no-deadline'
  const delta = Math.abs(extracted.getTime() - resolveBy.getTime())
  return delta <= DEADLINE_AGREEMENT_TOLERANCE_MS ? 'agree' : 'diverge'
}

function toRow(c: Candidate, cls: TemporalClassification | null): Row {
  const extracted = cls?.claimDeadline ?? null
  const deadlineDeltaDays = extracted
    ? Math.round((extracted.getTime() - c.resolveByDatetime.getTime()) / 86_400_000)
    : null
  const direction = cls?.direction ?? 'none'
  const archetype = cls?.archetype ?? 'none'
  return {
    id: c.id,
    slug: c.slug,
    claimText: c.claimText.length > 140 ? c.claimText.slice(0, 140) + '…' : c.claimText,
    resolveByDatetime: c.resolveByDatetime.toISOString(),
    extractedDeadline: extracted?.toISOString() ?? null,
    deadlineDeltaDays,
    agreement: agreementFor(extracted, c.resolveByDatetime),
    direction,
    archetype,
    tauLeadDays: cls?.tauLeadDays ?? null,
    confidence: cls?.confidence ?? null,
    notes: cls?.notes ?? (c.outcomeType !== 'BINARY' ? 'non-BINARY — not priced by the glide' : 'classification failed'),
    wouldGlide: direction !== 'none' && archetype === 'diffuse' && extracted !== null,
  }
}

function summarize(rows: Row[]) {
  const byDirection: Record<string, number> = {}
  const byArchetype: Record<string, number> = {}
  let divergent = 0
  let noDeadline = 0
  let lowConfidence = 0
  for (const r of rows) {
    byDirection[r.direction] = (byDirection[r.direction] ?? 0) + 1
    byArchetype[r.archetype] = (byArchetype[r.archetype] ?? 0) + 1
    if (r.agreement === 'diverge') divergent++
    if (r.agreement === 'no-deadline') noDeadline++
    if (r.confidence !== null && r.confidence < LOW_CONFIDENCE_THRESHOLD) lowConfidence++
  }
  return { byDirection, byArchetype, divergent, noDeadline, lowConfidence }
}

async function findCandidates(body: BackfillBody): Promise<Candidate[]> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, body.limit ?? DEFAULT_LIMIT))
  const where: Prisma.PredictionWhereInput = {
    status: { in: ['ACTIVE', 'PENDING_APPROVAL'] },
    ...(body.ids?.length
      ? { id: { in: body.ids } }
      : body.force
        ? {}
        : { classifierVersion: null }),
    ...(body.skipIds?.length ? { id: { notIn: body.skipIds } } : {}),
  }
  return prisma.prediction.findMany({
    where,
    select: { id: true, slug: true, claimText: true, resolveByDatetime: true, outcomeType: true },
    take: limit,
  })
}

async function runBackfill(body: BackfillBody) {
  const candidates = await findCandidates(body)
  const rows: Row[] = []
  let classified = 0
  let failed = 0
  let skipped = 0

  for (const c of candidates) {
    try {
      if (body.mode === 'dry-run') {
        const cls = c.outcomeType === 'BINARY'
          ? await classifyClaim({ claimText: c.claimText, resolveByDatetime: c.resolveByDatetime })
          : null
        rows.push(toRow(c, cls))
        if (cls) classified++
        else if (c.outcomeType === 'BINARY') failed++
      } else {
        const cls = await classifyAndStoreTemporal({
          id: c.id,
          claimText: c.claimText,
          resolveByDatetime: c.resolveByDatetime,
          outcomeType: c.outcomeType,
        })
        rows.push(toRow(c, cls))
        if (cls || c.outcomeType !== 'BINARY') classified++
        else failed++
      }
    } catch (err) {
      skipped++
      log.warn({ predictionId: c.id, err }, 'backfill row failed')
    }
  }

  rows.sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))

  const result = {
    mode: body.mode,
    examined: candidates.length,
    classified,
    failed,
    skipped,
    summary: summarize(rows),
    rows,
  }
  log.info(
    { mode: body.mode, examined: result.examined, classified, failed, skipped },
    'backfill-temporal.done',
  )
  return result
}

function parseBody(json: unknown): BackfillBody {
  const b = (json ?? {}) as Partial<BackfillBody>
  if (b.mode !== 'dry-run' && b.mode !== 'apply') {
    throw new Error('mode must be "dry-run" or "apply"')
  }
  return {
    mode: b.mode,
    limit: typeof b.limit === 'number' ? b.limit : undefined,
    ids: Array.isArray(b.ids) ? b.ids : undefined,
    skipIds: Array.isArray(b.skipIds) ? b.skipIds : undefined,
    force: b.force === true,
  }
}

async function handle(request: NextRequest) {
  const body = parseBody(await request.json().catch(() => ({})))
  return NextResponse.json(await runBackfill(body))
}

const authed = withAuth(async (request: NextRequest) => {
  try {
    return await handle(request)
  } catch (error) {
    return handleRouteError(error, 'Temporal backfill failed')
  }
}, { roles: ['ADMIN'] })

/**
 * Two-phase backfill for the temporal-model classifier (retro
 * docs/TEMPORAL_MODEL_PLAN.md #3.4/#4 Stage 0). dry-run classifies and
 * returns a review report WITHOUT writing; apply persists via the same
 * classifyAndStoreTemporal path the creation hook uses (idempotent — rows
 * with a classifierVersion are skipped unless force). Rows are sorted by
 * confidence ascending so a human audit reads the weakest parses first.
 *
 * Auth: ADMIN session, or `x-cron-secret` (BOT_RUNNER_SECRET) headlessly.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (secret && env.BOT_RUNNER_SECRET && secretsMatch(secret, env.BOT_RUNNER_SECRET)) {
    try {
      return await handle(request)
    } catch (error) {
      return handleRouteError(error, 'Temporal backfill failed')
    }
  }
  return authed(request, { params: Promise.resolve({}) })
}
