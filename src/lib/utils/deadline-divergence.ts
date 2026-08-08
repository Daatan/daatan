/**
 * claimDeadline (LLM-parsed from claim text) vs resolveByDatetime
 * (platform-authoritative) must agree within this window, or both must
 * already be in the past, or the temporal clock treats them as disagreeing
 * (temporal-clock.ts's DEADLINE_AGREEMENT_TOLERANCE_MS) — the same 72h bar
 * this module's check reuses, so the admin warning and the clock's own
 * glide-horizon selection can never disagree about what counts as divergent.
 *
 * Pulled out of temporal-clock.ts (daatan#1234) so a client component can
 * surface the same check without pulling in that module's server-only
 * imports (prisma, the Telegram notifier).
 */
export const DEADLINE_AGREEMENT_TOLERANCE_MS = 72 * 3600_000

/**
 * True when claimDeadline and resolveByDatetime disagree by more than the
 * tolerance and at least one of them is still in the future — the same
 * condition temporal-clock.ts's computeRequote uses to pick the (safer,
 * later) glide horizon instead of hard-pinning. Once both dates are in the
 * past, the disagreement is no longer live: nothing about resolution
 * behavior depends on it, so it stops being worth a warning.
 */
export function isDeadlineDivergent(claimDeadline: Date, resolveByDatetime: Date, now: Date): boolean {
  const claimPassed = claimDeadline.getTime() <= now.getTime()
  const resolvePassed = resolveByDatetime.getTime() <= now.getTime()
  const deltaMs = Math.abs(claimDeadline.getTime() - resolveByDatetime.getTime())
  return deltaMs > DEADLINE_AGREEMENT_TOLERANCE_MS && !(claimPassed && resolvePassed)
}
