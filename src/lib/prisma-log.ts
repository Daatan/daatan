import type { Prisma } from '@prisma/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('prisma')

// claimArticleForExtraction() in services/evidence-pool.ts deliberately provokes
// a P2002 on the (predictionId, url_hash) partial unique index as an
// optimistic-concurrency claim (~67 collisions/hour on prod, 38% of log volume
// — daatan#1502). The catch handles it fully; only the client-side log emission
// is noise. Prisma error events carry no error code or call site — just
// { timestamp, message, target } — so suppression is scoped by matching the
// message to that one constraint: a P2002 on any other constraint, and every
// other error, is still logged.
const CLAIM_COLLISION =
  /Unique constraint failed on the fields:.*predictionId.*url_hash/s

export const isExpectedClaimCollision = (message: string): boolean =>
  CLAIM_COLLISION.test(message)

export const logPrismaErrorEvent = (event: Prisma.LogEvent): void => {
  if (isExpectedClaimCollision(event.message)) return
  log.error({ target: event.target }, event.message)
}
