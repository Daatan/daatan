/**
 * Signed relation typer (retro#574) — the first writer into `question_relations`.
 *
 * Cosine finds pairs that are ABOUT the same thing; it is blind to negation and
 * direction, so "Israel withdraws by Dec 31" and "IDF maintains presence through
 * Dec 31" surface as near-aliases when they are complements — 7 of the 8 live
 * incoherences on 2026-08-21 were pairs of that shape. One LLM call per
 * candidate pair types the relation and its direction; the result lands as a
 * PROPOSED row for post-moderation. Nothing here moves a published number.
 *
 * Candidate bar is 0.85 + a shared tag, not the 0.75 the duplicate warning uses:
 * at 0.75 ~99 % of pairs are topical relatives with no constraint (audit 08-21).
 *
 * Pairs typed "independent" are recorded as kind NONE (auto-confirmed ledger
 * rows) so they drop out of the candidate query; only low-confidence and
 * failed pairs are re-asked. Pairs are typed CONCURRENCY-wide: the first prod
 * run of 40 sequential calls outlasted the proxy timeout.
 */

import { SchemaType, type Schema } from '@google/generative-ai'
import { z } from 'zod'
import { Prisma, type QuestionRelationKind } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { llmService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { createLogger } from '@/lib/logger'
import { proposeRelation, type ProposeOutcome, type RelationProposal } from './question-relation'

const log = createLogger('relation-typer')

/** Bump whenever the prompt or the mapping below materially changes. v2 (08-22): direction defined as stronger → weaker, implies-vs-nested and alias-vs-nested rules — v1 scored 4/8 on the hand labels (retro#574). */
export const TYPER_VERSION = 'v2'
export const CANDIDATE_COSINE = 0.85
/** Below this the verdict is dropped and the pair re-asked on a later run. */
export const MIN_CONFIDENCE = 0.6
const TYPE_TIMEOUT_MS = 20_000
const CONCURRENCY = 8

export interface CandidatePair {
  aId: string
  aClaim: string
  aDeadline: Date | null
  aDirection: string | null
  bId: string
  bClaim: string
  bDeadline: Date | null
  bDirection: string | null
  cosine: number
  sharedTags: string[]
}

export const relationTyperSchema: Schema = {
  description: 'Logical relation between two forecast questions',
  type: SchemaType.OBJECT,
  properties: {
    relation: {
      type: SchemaType.STRING,
      description: 'alias | nested | threshold | complement | exclusive | implies | independent',
    },
    direction: { type: SchemaType.STRING, description: 'a_to_b | b_to_a | null', nullable: true },
    a_span: { type: SchemaType.STRING },
    b_span: { type: SchemaType.STRING },
    confidence: { type: SchemaType.NUMBER, description: '0..1' },
    notes: { type: SchemaType.STRING },
  },
  required: ['relation', 'a_span', 'b_span', 'confidence', 'notes'],
}

const verdictSchema = z.object({
  relation: z.enum(['alias', 'nested', 'threshold', 'complement', 'exclusive', 'implies', 'independent']),
  direction: z.enum(['a_to_b', 'b_to_a']).nullable().optional(),
  a_span: z.string(),
  b_span: z.string(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
})
export type TyperVerdict = z.infer<typeof verdictSchema>

const KIND_MAP: Record<TyperVerdict['relation'], QuestionRelationKind> = {
  independent: 'NONE',
  alias: 'ALIAS',
  nested: 'NESTED_DEADLINE',
  threshold: 'THRESHOLD_NESTING',
  complement: 'COMPLEMENT',
  exclusive: 'MUTUALLY_EXCLUSIVE',
  implies: 'IMPLIES',
}
const DIRECTED: ReadonlySet<TyperVerdict['relation']> = new Set(['nested', 'threshold', 'implies'])

/**
 * Pure: verdict → proposal, or null when nothing should be stored. A directed
 * kind without a direction is unusable and is dropped rather than guessed.
 * `independent` becomes a NONE ledger row.
 */
export function toProposal(pair: CandidatePair, v: TyperVerdict): RelationProposal | null {
  if (v.confidence < MIN_CONFIDENCE) return null
  const directed = DIRECTED.has(v.relation)
  if (directed && !v.direction) return null
  const [from, to] = directed && v.direction === 'b_to_a' ? [pair.bId, pair.aId] : [pair.aId, pair.bId]
  return {
    fromPredictionId: from,
    toPredictionId: to,
    kind: KIND_MAP[v.relation],
    createdBy: 'MODEL',
    cosine: pair.cosine,
    sharedTag: pair.sharedTags.length > 0,
    typerOutput: { version: TYPER_VERSION, ...v, aId: pair.aId, bId: pair.bId },
  }
}

/**
 * Open pairs above the bar with a shared tag and no relation row yet, in either
 * orientation. Self-join over ~140 open forecasts — a few thousand distance
 * computations, nothing to index.
 */
export async function findCandidatePairs(limit: number): Promise<CandidatePair[]> {
  return prisma.$queryRaw<CandidatePair[]>(Prisma.sql`
    SELECT
      a.id AS "aId", a."claimText" AS "aClaim", a.claim_deadline AS "aDeadline", a.claim_direction::text AS "aDirection",
      b.id AS "bId", b."claimText" AS "bClaim", b.claim_deadline AS "bDeadline", b.claim_direction::text AS "bDirection",
      (1 - (a.embedding <=> b.embedding))::float AS cosine,
      ARRAY(
        SELECT t.name FROM "_PredictionToTag" pa
        JOIN "_PredictionToTag" pb ON pb."B" = pa."B" AND pb."A" = b.id
        JOIN tags t ON t.id = pa."B"
        WHERE pa."A" = a.id
      ) AS "sharedTags"
    FROM predictions a
    JOIN predictions b ON b.id > a.id
    WHERE a.status IN ('ACTIVE', 'PENDING') AND b.status IN ('ACTIVE', 'PENDING')
      AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
      AND (1 - (a.embedding <=> b.embedding)) >= ${CANDIDATE_COSINE}
      AND EXISTS (
        SELECT 1 FROM "_PredictionToTag" pa
        JOIN "_PredictionToTag" pb ON pb."B" = pa."B" AND pb."A" = b.id
        WHERE pa."A" = a.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM question_relations r
        WHERE (r.from_prediction_id = a.id AND r.to_prediction_id = b.id)
           OR (r.from_prediction_id = b.id AND r.to_prediction_id = a.id)
      )
    ORDER BY a.embedding <=> b.embedding
    LIMIT ${limit}
  `)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`relation typer timed out after ${ms}ms`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'none stated')

/** One LLM call. Fail-open: null on any failure; the pair is re-asked later. */
export async function typePair(pair: CandidatePair): Promise<TyperVerdict | null> {
  try {
    const template = await getPromptTemplate('relation-typer')
    const prompt = fillPrompt(template, {
      aClaim: pair.aClaim,
      aDeadline: fmtDate(pair.aDeadline),
      aDirection: pair.aDirection ?? 'unknown',
      bClaim: pair.bClaim,
      bDeadline: fmtDate(pair.bDeadline),
      bDirection: pair.bDirection ?? 'unknown',
    })
    const res = await withTimeout(
      llmService.generateContent({ prompt, schema: relationTyperSchema, temperature: 0 }),
      TYPE_TIMEOUT_MS,
    )
    return verdictSchema.parse(JSON.parse(res.text))
  } catch (err) {
    log.warn({ err, aId: pair.aId, bId: pair.bId }, 'Relation typing failed')
    return null
  }
}

export interface TyperRunSummary {
  version: string
  candidates: number
  typed: number
  independent: number
  lowConfidence: number
  failed: number
  outcomes: Record<ProposeOutcome, number>
  dryRun: boolean
  /** dryRun only: what would have been proposed. */
  proposals?: Array<RelationProposal & { aClaim: string; bClaim: string }>
}

export async function runRelationTyper(opts: { limit?: number; dryRun?: boolean } = {}): Promise<TyperRunSummary> {
  const limit = opts.limit ?? 40
  const dryRun = opts.dryRun ?? false
  const pairs = await findCandidatePairs(limit)
  const summary: TyperRunSummary = {
    version: TYPER_VERSION,
    candidates: pairs.length,
    typed: 0,
    independent: 0,
    lowConfidence: 0,
    failed: 0,
    outcomes: { created: 0, refreshed: 0, kept_rejected: 0, kept_decided: 0, self: 0 },
    dryRun,
    ...(dryRun ? { proposals: [] } : {}),
  }

  const handle = async (pair: CandidatePair) => {
    const verdict = await typePair(pair)
    if (!verdict) { summary.failed++; return }
    summary.typed++
    if (verdict.relation === 'independent') summary.independent++
    const proposal = toProposal(pair, verdict)
    if (!proposal) { summary.lowConfidence++; return }
    if (dryRun) {
      if (proposal.kind !== 'NONE') summary.proposals!.push({ ...proposal, aClaim: pair.aClaim, bClaim: pair.bClaim })
      return
    }
    const outcome = await proposeRelation(proposal)
    summary.outcomes[outcome]++
  }
  const queue = [...pairs]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let pair = queue.shift(); pair; pair = queue.shift()) await handle(pair)
    }),
  )

  log.info(summary, 'Relation typer run')
  return summary
}
