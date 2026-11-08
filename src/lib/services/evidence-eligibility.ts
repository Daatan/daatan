import type { Prisma } from '@prisma/client'

/**
 * Which forecasts still take in news evidence (daatan#2122).
 *
 * ACTIVE forecasts always do. A forecast whose `resolveByDatetime` has passed is
 * flipped to PENDING by `transition-expired-predictions`, and it used to drop out
 * of the evidence funnel at that moment — the news-indexer feed served ACTIVE only
 * and the context push 409'd anything else — so its published probability froze at
 * the last pre-deadline value. For a question whose deadline sits on the trigger
 * event (election day) while the outcome lands weeks later (appointment, swearing-in,
 * official statistics), that frozen number is pure pre-event uncertainty (~50%), and
 * the post-deadline reporting that settles it never reached the Oracul.
 *
 * PENDING forecasts therefore keep receiving evidence for a bounded grace period after
 * their deadline. The bound keeps an abandoned, never-resolved forecast from burning
 * matching + judging cost forever; 60 days covers the slowest routine case we have
 * (Israeli coalition formation: 28 + 14 days of mandate, plus the swearing-in).
 */
export const PENDING_EVIDENCE_GRACE_DAYS = 60

const DAY_MS = 86_400_000

function graceCutoff(now: Date): Date {
  return new Date(now.getTime() - PENDING_EVIDENCE_GRACE_DAYS * DAY_MS)
}

/** Prisma filter for forecasts that take in evidence. Combine with other conditions via AND. */
export function evidenceEligibleWhere(now: Date = new Date()): Prisma.PredictionWhereInput {
  return {
    OR: [
      { status: 'ACTIVE' },
      { status: 'PENDING', resolveByDatetime: { gte: graceCutoff(now) } },
    ],
  }
}

/** Row-level twin of `evidenceEligibleWhere` — the two must never disagree. */
export function acceptsEvidence(
  prediction: { status: string; resolveByDatetime: Date },
  now: Date = new Date(),
): boolean {
  if (prediction.status === 'ACTIVE') return true
  return prediction.status === 'PENDING' && prediction.resolveByDatetime.getTime() >= graceCutoff(now).getTime()
}
