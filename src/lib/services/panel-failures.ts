import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('panel-failures')

/**
 * Record one AI-panel `402 Insufficient credits` failure for the evidence-health
 * digest (daatan#1504).
 *
 * The digest is DB-driven while the 402s only surface in app logs, so the sweep
 * writes them down here — one `panel_payment_failures` row per UTC day, carrying a
 * count, the last occurrence, and which member saw it last. `checkEvidenceHealth()`
 * reads the rows inside its lookback window and alerts once per burst.
 *
 * Fire-and-forget BY DESIGN: the panel call already failed when this runs, and a
 * broken recorder must never break or delay the sweep on top of that — the write is
 * not awaited and a failure ends in a warn, not a throw.
 */
export function recordPanelPaymentFailure(model: string, now: Date = new Date()): void {
  const day = now.toISOString().slice(0, 10)
  prisma.panelPaymentFailure
    .upsert({
      where: { day },
      create: { day, count: 1, lastSeenAt: now, lastModel: model },
      update: { count: { increment: 1 }, lastSeenAt: now, lastModel: model },
    })
    .then(
      () => undefined,
      (err: unknown) => log.warn({ err, model, day }, 'Failed to record panel 402'),
    )
}
