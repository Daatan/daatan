import { createLogger } from '@/lib/logger'
import { normalizeResolveByDatetime } from '@/lib/utils/date'

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
