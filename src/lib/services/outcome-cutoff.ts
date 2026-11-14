import { prisma } from '@/lib/prisma'

/**
 * Outcome-time cutoff (daatan#2144): a source reading may score as a prediction only if it
 * was PUBLISHED before the forecast's outcome was publicly known. The cutoff is the earliest
 * reliably verifiable public confirmation of the specific outcome, recorded per forecast in
 * the append-only `prediction_outcome_cutoffs` table — never derived from the deadline, the
 * resolution time, or when daatan collected the article.
 *
 * The same rule is implemented in the elections app (src/lib/elections/outcome-cutoff.ts
 * there). The two share the test table in `__tests__/outcome-cutoff.test.ts` — change both.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long after its 00:00 UTC a calendar date can still be "that day" somewhere: a date-only
 * stamp carries no timezone, and the latest zone (UTC-12) ends the day 36h after 00:00 UTC.
 * A day-precision reading counts only if this whole span precedes the cutoff.
 */
const DAY_PRECISION_SPAN_MS = DAY_MS + 12 * 60 * 60 * 1000

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** A midnight-UTC timestamp is a date with a placeholder time (20% of pool rows), not an instant. */
const MIDNIGHT_UTC = /^\d{4}-\d{2}-\d{2}T00:00(:00(\.0+)?)?(Z|\+00:00)$/

export type PublishedAt = { ms: number; dayPrecision: boolean }

/** Parse a pool row's `published_date` (a free-form string). Null when absent or unparseable. */
export function parsePublishedDate(raw: string | null | undefined): PublishedAt | null {
  if (raw == null) return null
  const s = raw.trim()
  if (!s) return null
  if (DATE_ONLY.test(s)) {
    const ms = Date.parse(`${s}T00:00:00Z`)
    return Number.isNaN(ms) ? null : { ms, dayPrecision: true }
  }
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) return null
  return { ms, dayPrecision: MIDNIGHT_UTC.test(s) }
}

/**
 * True when a reading published at `publishedDate` predates `cutoff`. Undated readings never
 * do; a day-precision reading does only when its entire day, in any timezone, is over.
 */
export function isPublishedBeforeCutoff(publishedDate: string | null | undefined, cutoff: Date): boolean {
  const p = parsePublishedDate(publishedDate)
  if (!p) return false
  const cutoffMs = cutoff.getTime()
  return p.dayPrecision ? p.ms + DAY_PRECISION_SPAN_MS <= cutoffMs : p.ms < cutoffMs
}

/**
 * Whether one pool reading may score as a prediction on its forecast. A reading the extractor
 * flagged `settled` reports the outcome as accomplished fact — that is not a forecast whatever
 * its timestamp says (and an article updated in place keeps its first-publication stamp).
 */
export function isScorableReading(
  reading: { publishedDate: string | null | undefined; settled?: boolean | null },
  cutoff: Date | null | undefined,
): boolean {
  if (!cutoff) return false
  if (reading.settled === true) return false
  return isPublishedBeforeCutoff(reading.publishedDate, cutoff)
}

export const CUTOFF_STATUSES = ['approved', 'insufficient'] as const
export type CutoffStatus = (typeof CUTOFF_STATUSES)[number]

/**
 * The effective cutoff per forecast: the NEWEST row decides. `approved` yields its timestamp;
 * `insufficient` (no reliable cutoff could be established) and "no row at all" both yield
 * nothing, which callers must read as "exclude this forecast from predictive scoring".
 */
export async function approvedCutoffs(predictionIds: string[]): Promise<Map<string, Date>> {
  if (predictionIds.length === 0) return new Map()
  const rows = await prisma.predictionOutcomeCutoff.findMany({
    where: { predictionId: { in: predictionIds } },
    select: { predictionId: true, status: true, cutoffAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const latest = new Map<string, { status: string; cutoffAt: Date | null }>()
  for (const r of rows) latest.set(r.predictionId, r)
  const out = new Map<string, Date>()
  for (const [id, r] of latest) {
    if (r.status === 'approved' && r.cutoffAt) out.set(id, r.cutoffAt)
  }
  return out
}

export interface RecordCutoffInput {
  predictionId: string
  status: CutoffStatus
  cutoffAt: Date | null
  basis: string
  evidenceUrls: string[]
  recordedBy: string
}

/** Append a cutoff decision. Rows are never updated or deleted — a correction is a new row. */
export async function recordOutcomeCutoff(input: RecordCutoffInput) {
  if (input.status === 'approved' && !input.cutoffAt) {
    throw new Error('An approved cutoff needs a cutoffAt timestamp')
  }
  return prisma.predictionOutcomeCutoff.create({
    data: {
      predictionId: input.predictionId,
      status: input.status,
      cutoffAt: input.status === 'approved' ? input.cutoffAt : null,
      basis: input.basis,
      evidenceUrls: input.evidenceUrls,
      recordedBy: input.recordedBy,
    },
  })
}
