import { prisma } from '@/lib/prisma'
import { deadlineEndsAt } from '@/lib/utils/date'

// Israel is at most UTC+3, so nothing further out can have ended yet.
const MAX_EARLY_END_MS = 4 * 3_600_000

/**
 * Transition ACTIVE predictions whose resolve-by deadline has ended to PENDING.
 * The deadline ends at midnight in Israel (see deadlineEndsAt, daatan#2030).
 *
 * This keys off resolveByDatetime, not claimDeadline. PENDING closes staking and
 * takes the forecast out of the feeds and the news-indexer, and claimDeadline is
 * parsed from the claim text and can be months away from resolveByDatetime.
 *
 * Returns the number of predictions transitioned.
 */
export async function transitionExpiredPredictions(now: Date = new Date()): Promise<number> {
  const candidates = await prisma.prediction.findMany({
    where: {
      status: 'ACTIVE',
      resolveByDatetime: { lt: new Date(now.getTime() + MAX_EARLY_END_MS) },
    },
    select: { id: true, resolveByDatetime: true },
  })
  const ids = candidates.filter((p) => deadlineEndsAt(p.resolveByDatetime) <= now).map((p) => p.id)
  if (ids.length === 0) return 0
  const result = await prisma.prediction.updateMany({
    where: { id: { in: ids }, status: 'ACTIVE' },
    data: { status: 'PENDING' },
  })
  return result.count
}
