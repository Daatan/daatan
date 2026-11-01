import type { ResolutionOutcome } from '@/lib/utils/pin-contradiction'

/**
 * Pre-deadline resolution gate (daatan#2076). A "by <deadline>" claim that has
 * not happened yet has not *failed* yet. Declaring it `wrong` (or
 * `unresolvable`) before its deadline is almost always a mistake: on
 * 2026-11-01, "The Winds of Winter by Dec 31 2026" was resolved WRONG two
 * months early after AI Assist applied the rules' default clause prematurely.
 *
 * `correct` (the event already happened) and `void` (the claim is invalid or
 * cancelled) are legitimately decidable at any time, so they pass. `wrong`
 * before the deadline is still possible when the event became impossible
 * (cancelled, officially ruled out), so the gate asks for an explicit
 * acknowledgment instead of refusing outright. This mirrors the pin-contradiction
 * gate (daatan#1234).
 *
 * The deadline is `claimDeadline` (parsed from the claim text, so the
 * semantic one) when known, otherwise `resolveByDatetime`.
 */
export interface EarlyResolution {
  /** True when the outcome needs the resolver's explicit acknowledgment. */
  isEarly: boolean
  /** The deadline the check used, or null when none could be parsed. */
  deadline: Date | null
}

export function effectiveDeadline(
  claimDeadline: Date | string | null | undefined,
  resolveByDatetime: Date | string | null | undefined,
): Date | null {
  const raw = claimDeadline ?? resolveByDatetime
  if (raw == null) return null
  const d = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export function detectEarlyResolution(
  outcome: ResolutionOutcome,
  claimDeadline: Date | string | null | undefined,
  resolveByDatetime: Date | string | null | undefined,
  now: Date = new Date(),
): EarlyResolution {
  const deadline = effectiveDeadline(claimDeadline, resolveByDatetime)
  const gated = outcome === 'wrong' || outcome === 'unresolvable'
  return { isEarly: gated && deadline !== null && now < deadline, deadline }
}
