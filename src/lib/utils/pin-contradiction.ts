/**
 * Resolve-time pin-acknowledgment gate (daatan#1234 check #2). The Oracle's
 * settlement pin and its extreme-confidence band both fire off the same
 * underlying signal: `Prediction.confidence` is the AI's current P(claim) --
 * recordEstimate always writes it together with `settled` (context.ts), so a
 * pin never lands without an extreme confidence value in the same write.
 * `settled` can only ever go true->true afterward (one-way latch), so a later
 * evidence write can leave `settled=true` while `confidence` has drifted back
 * inside the band -- in that case there's no reliable implied direction left
 * to compare, so no contradiction is reported. `settled` is still exposed
 * separately in the return value purely for UI copy (pin vs. band wording).
 */
const AWAITING_AI_RESOLUTION_LOW = 10
const AWAITING_AI_RESOLUTION_HIGH = 90

export type ResolutionOutcome = 'correct' | 'wrong' | 'void' | 'unresolvable'

export interface PinContradiction {
  /** True when the resolver is about to declare an outcome the AI's current estimate disagrees with. */
  contradicts: boolean
  /** What the AI's confidence implies ('correct' at >=90, 'wrong' at <=10), null when confidence isn't extreme. */
  impliedOutcome: 'correct' | 'wrong' | null
  /** Whether the disagreement comes from a sticky settlement pin, as opposed to just an extreme (but unsettled) estimate. */
  isSettled: boolean
}

export function detectPinContradiction(
  settled: boolean | null | undefined,
  confidence: number | null | undefined,
  outcomeType: string,
  outcome: ResolutionOutcome,
): PinContradiction {
  const isSettled = settled === true
  if (outcomeType !== 'BINARY' || (outcome !== 'correct' && outcome !== 'wrong') || confidence == null) {
    return { contradicts: false, impliedOutcome: null, isSettled }
  }

  const impliedOutcome: 'correct' | 'wrong' | null =
    confidence >= AWAITING_AI_RESOLUTION_HIGH ? 'correct' : confidence <= AWAITING_AI_RESOLUTION_LOW ? 'wrong' : null

  return { contradicts: impliedOutcome !== null && impliedOutcome !== outcome, impliedOutcome, isSettled }
}
