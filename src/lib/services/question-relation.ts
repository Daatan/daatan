/**
 * Question relations — Oracle 2.0 storage layer M1 (daatan#1555).
 *
 * A `QuestionRelation` row says that two questions are related by logic
 * (nested deadline, complement, exclusive, implies, threshold), by wording
 * (alias) or by an extracted conditional. It is STRUCTURE ONLY: the row never
 * carries a probability. Edge weights are a derived, materialised layer
 * (docs planning/oracle-2-harness-and-storage.md §4.4) that does not exist yet.
 *
 * Two invariants this module owns, both cheap to get wrong at a call site:
 *
 * 1. A pair is stored in canonical orientation for SYMMETRIC kinds, so that
 *    (A, B, complement) and (B, A, complement) are one row, not two. Directed
 *    kinds (nested_deadline, threshold_nesting, implies, conditional) keep the
 *    caller's orientation — for those, from→to is the claim.
 * 2. `proposeRelation` never revives a REJECTED row: post-moderation means a
 *    human said no once and the typer must not ask again. It also never
 *    downgrades a CONFIRMED row back to PROPOSED.
 */

import { prisma } from '@/lib/prisma'
import type { QuestionRelationKind, QuestionRelationOrigin } from '@prisma/client'

export const SYMMETRIC_KINDS: ReadonlySet<QuestionRelationKind> = new Set<QuestionRelationKind>([
  'ALIAS',
  'MUTUALLY_EXCLUSIVE',
  'COMPLEMENT',
])

export interface RelationProposal {
  fromPredictionId: string
  toPredictionId: string
  kind: QuestionRelationKind
  createdBy: QuestionRelationOrigin
  /** +1 / -1, CONDITIONAL only. */
  sign?: 1 | -1 | null
  typerOutput?: unknown
  cosine?: number | null
  sharedTag?: boolean | null
}

/**
 * Orient a pair so symmetric kinds have one canonical row. Pure; exported for
 * the coherence check, which must look the pair up the same way it was stored.
 */
export function canonicalPair(
  fromPredictionId: string,
  toPredictionId: string,
  kind: QuestionRelationKind,
): { fromPredictionId: string; toPredictionId: string } {
  if (SYMMETRIC_KINDS.has(kind) && toPredictionId < fromPredictionId) {
    return { fromPredictionId: toPredictionId, toPredictionId: fromPredictionId }
  }
  return { fromPredictionId, toPredictionId }
}

export type ProposeOutcome = 'created' | 'refreshed' | 'kept_rejected' | 'kept_decided' | 'self'

/**
 * Insert a proposed relation, or refresh the evidence on an existing PROPOSED
 * one. Returns what happened so a batch typer can report it.
 */
export async function proposeRelation(p: RelationProposal): Promise<ProposeOutcome> {
  if (p.fromPredictionId === p.toPredictionId) return 'self'
  if (p.sign != null && p.kind !== 'CONDITIONAL') {
    throw new Error(`sign is only meaningful for CONDITIONAL relations (got ${p.kind})`)
  }
  const pair = canonicalPair(p.fromPredictionId, p.toPredictionId, p.kind)
  const where = { fromPredictionId_toPredictionId_kind: { ...pair, kind: p.kind } }

  const existing = await prisma.questionRelation.findUnique({ where, select: { status: true } })
  if (existing?.status === 'REJECTED') return 'kept_rejected'
  if (existing?.status === 'CONFIRMED' || existing?.status === 'MERGED') return 'kept_decided'

  const evidence = {
    sign: p.sign ?? null,
    typerOutput: p.typerOutput === undefined ? undefined : (p.typerOutput as object),
    cosine: p.cosine ?? null,
    sharedTag: p.sharedTag ?? null,
  }
  if (existing) {
    await prisma.questionRelation.update({ where, data: { ...evidence, createdBy: p.createdBy } })
    return 'refreshed'
  }
  await prisma.questionRelation.create({
    data: { ...pair, kind: p.kind, createdBy: p.createdBy, status: 'PROPOSED', ...evidence },
  })
  return 'created'
}

/** Human decision on a proposed relation. Idempotent. */
export async function decideRelation(
  id: string,
  status: 'CONFIRMED' | 'REJECTED' | 'MERGED',
  decidedBy: string,
): Promise<void> {
  await prisma.questionRelation.update({
    where: { id },
    data: { status, decidedBy, decidedAt: new Date() },
  })
}

/** All non-rejected relations touching a question, either side. */
export async function relationsFor(predictionId: string) {
  return prisma.questionRelation.findMany({
    where: {
      status: { not: 'REJECTED' },
      OR: [{ fromPredictionId: predictionId }, { toPredictionId: predictionId }],
    },
    orderBy: { createdAt: 'asc' },
  })
}
