import { createLogger } from '@/lib/logger'
import { normalizeResolveByDatetime } from '@/lib/utils/date'
import { findClaimTextDeadlineMismatch } from '@/lib/utils/extractDatesFromText'

const log = createLogger('deadline-normalisation')

export type DeadlineWritePath = 'create' | 'update' | 'bot-create'

/**
 * Log-only shadow of the UTC 23:59:59 deadline convention (daatan#1367, decided
 * 2026-08-21). Reports when a resolveByDatetime about to be written differs from
 * its normalised form; never rewrites it. Flip to enforcing once the mismatch
 * volume is known (daatan#1403). Returns true when the value was off-convention.
 */
export function auditResolveByDatetime(
  path: DeadlineWritePath,
  resolveBy: Date,
  ctx: { predictionId?: string; authorId?: string } = {},
): boolean {
  if (Number.isNaN(resolveBy.getTime())) return false
  const normalised = normalizeResolveByDatetime(resolveBy)
  const deltaMs = normalised.getTime() - resolveBy.getTime()
  if (deltaMs === 0) return false
  log.warn(
    {
      ...ctx,
      path,
      stored: resolveBy.toISOString(),
      normalised: normalised.toISOString(),
      deltaHours: Math.round((deltaMs / 3_600_000) * 100) / 100,
    },
    'resolveByDatetime off the UTC 23:59:59 convention (log-only, not rewritten)',
  )
  return true
}

/**
 * Log-only shadow of creation's claim-text/deadline block (daatan#1546, step 3 of
 * daatan#1367's plan). Creation rejects a claimText/resolveByDatetime mismatch outright
 * (src/app/api/forecasts/route.ts); an edit can silently reintroduce one since either
 * field can change independently. Reports it here without blocking the write — flip to
 * enforcing once the mismatch volume on the update path is known. Returns true when a
 * mismatch was found.
 */
export function auditClaimDeadlineMismatch(
  claimText: string,
  resolveByDatetime: Date,
  ctx: { predictionId?: string } = {},
): boolean {
  const mismatch = findClaimTextDeadlineMismatch(claimText, resolveByDatetime)
  if (!mismatch) return false
  log.warn(
    {
      ...ctx,
      path: 'update',
      claimTextDate: mismatch.toISOString(),
      resolveByDatetime: resolveByDatetime.toISOString(),
    },
    'claim text date disagrees with resolveByDatetime (log-only, not blocked)',
  )
  return true
}
