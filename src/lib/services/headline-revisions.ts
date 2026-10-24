import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { HEADLINE_MAX_CHARS, HEADLINE_MAX_WORDS, polarityMatches } from '@/lib/llm/headline'

const log = createLogger('headline-revisions')

/**
 * Display-only card headlines for already-published forecasts. `predictions.headline`, the
 * claim and the resolution rules are never written here: a revision lives in its own table,
 * and the card shows it instead of the published headline only while it is not revoked and
 * its `claimHash` still matches the claim (an edited claim regenerates the headline and
 * retires the revision). Revert a revision by setting `revokedAt`.
 */

export interface HeadlineRevisionEntry {
  id: string
  slug: string
  /** The published headline the review was made against. */
  from: string
  to: string
  /** V vague, P meaning, G grammar, S scope, T timing. */
  reason: string
}

const claimHash = (claim: string) => createHash('sha256').update(claim).digest('hex')

interface ActiveRevision {
  headline: string
  claimHash: string
}

/** Newest non-revoked revision per prediction. */
async function activeRevisions(predictionIds: string[]): Promise<Map<string, ActiveRevision>> {
  const out = new Map<string, ActiveRevision>()
  if (predictionIds.length === 0) return out
  const rows = await prisma.predictionHeadlineRevision.findMany({
    where: { predictionId: { in: predictionIds }, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { predictionId: true, headline: true, claimHash: true },
  })
  for (const r of rows) if (!out.has(r.predictionId)) out.set(r.predictionId, r)
  return out
}

/** The display headline for one prediction, or null when the published one stands. */
export async function displayHeadlineFor(predictionId: string, claimText: string): Promise<string | null> {
  const rev = (await activeRevisions([predictionId])).get(predictionId)
  return rev && rev.claimHash === claimHash(claimText) ? rev.headline : null
}

/**
 * Rows with `headline` swapped for the display headline where a valid revision exists. Rows
 * without one come back unchanged. A lookup failure keeps the published headlines: the card
 * must never break over a cosmetic overlay.
 */
export async function withDisplayHeadlines<T extends { id: string; claimText: string; headline?: string | null }>(
  rows: T[],
): Promise<T[]> {
  try {
    const revisions = await activeRevisions(rows.map((r) => r.id))
    if (revisions.size === 0) return rows
    return rows.map((r) => {
      const rev = revisions.get(r.id)
      return rev && rev.claimHash === claimHash(r.claimText) ? { ...r, headline: rev.headline } : r
    })
  } catch (err) {
    log.error({ err }, 'display headline lookup failed; showing published headlines')
    return rows
  }
}

export type RevisionOutcome =
  | 'applied' | 'would_apply' | 'already' | 'missing' | 'not_active' | 'drifted' | 'invalid'

export interface RevisionReport {
  dryRun: boolean
  batch: string
  counts: Record<RevisionOutcome, number>
  rows: { id: string; slug: string; outcome: RevisionOutcome; from: string; to: string; note?: string }[]
}

/** Why a proposed headline is not acceptable, or null. Same guards as generated headlines. */
function invalidReason(claim: string, to: string): string | null {
  if (to.length > HEADLINE_MAX_CHARS) return `over ${HEADLINE_MAX_CHARS} chars`
  if (to.split(' ').length > HEADLINE_MAX_WORDS) return `over ${HEADLINE_MAX_WORDS} words`
  if (!polarityMatches(claim, to)) return 'negation differs from the claim'
  return null
}

/**
 * Apply a reviewed batch as display-only revisions. Dry run by default: nothing is written
 * unless `apply` is true. Only ACTIVE forecasts whose published headline still equals the
 * reviewed one are touched, and only by inserting a revision row; `predictions` is read-only here.
 */
export async function applyHeadlineRevisions(
  entries: HeadlineRevisionEntry[],
  batch: string,
  { apply = false }: { apply?: boolean } = {},
): Promise<RevisionReport> {
  const counts: Record<RevisionOutcome, number> = {
    applied: 0, would_apply: 0, already: 0, missing: 0, not_active: 0, drifted: 0, invalid: 0,
  }
  const rows: RevisionReport['rows'] = []
  const record = (e: HeadlineRevisionEntry, outcome: RevisionOutcome, note?: string) => {
    counts[outcome]++
    rows.push({ id: e.id, slug: e.slug, outcome, from: e.from, to: e.to, ...(note ? { note } : {}) })
  }

  for (const e of entries) {
    const p = await prisma.prediction.findUnique({
      where: { id: e.id },
      select: { status: true, claimText: true, headline: true },
    })
    if (!p) { record(e, 'missing'); continue }
    if (p.status !== 'ACTIVE') { record(e, 'not_active', p.status); continue }
    if (p.headline !== e.from) { record(e, 'drifted', `published headline is now "${p.headline ?? ''}"`); continue }
    const bad = invalidReason(p.claimText, e.to)
    if (bad) { record(e, 'invalid', bad); continue }
    const existing = await prisma.predictionHeadlineRevision.findUnique({
      where: { predictionId_batch: { predictionId: e.id, batch } },
      select: { id: true },
    })
    if (existing) { record(e, 'already'); continue }
    if (!apply) { record(e, 'would_apply'); continue }

    await prisma.predictionHeadlineRevision.create({
      data: {
        predictionId: e.id,
        headline: e.to,
        previousHeadline: p.headline,
        claimHash: claimHash(p.claimText),
        reason: e.reason,
        batch,
      },
    })
    record(e, 'applied')
  }

  log.info({ batch, dryRun: !apply, counts }, 'headline revisions run')
  return { dryRun: !apply, batch, counts, rows }
}
