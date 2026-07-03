/**
 * Display math for linked external prediction markets (Polymarket / Kalshi).
 * Snapshots store the RAW provider price; polarity and outcome labeling are
 * display concerns, centralized here so the info panel and the history chart
 * can never disagree.
 */

/** The probability to show for a raw market price, honoring the inverted flag. */
export function marketDisplayProbability(raw: number, inverted: boolean): number {
  return inverted ? 100 - raw : raw
}

/**
 * Which outcome label the stored price tracks. Standard Yes/No markets return
 * null (no labeling needed). For anything else the provider price is the FIRST
 * outcome's price, so surface that label instead of implying a "yes".
 */
export function trackedOutcomeLabel(outcomes: unknown): string | null {
  if (!Array.isArray(outcomes)) return null
  const labels = outcomes.filter((o): o is string => typeof o === 'string')
  if (labels.some(l => l.toLowerCase() === 'yes')) return null
  return labels[0] ?? null
}

/** Chart legend / series name for the Market line, e.g. "Market (Polymarket, inverted)". */
export function marketLineName(
  providerLabel: string,
  inverted: boolean,
  outcomeLabel: string | null,
): string {
  const qualifier = inverted ? `${providerLabel}, inverted` : providerLabel
  return outcomeLabel ? `Market: "${outcomeLabel}" (${qualifier})` : `Market (${qualifier})`
}

/** One-line explanation of an inverted link, used as a hover hint. */
export const INVERTED_HINT =
  'This market asks the opposite question, so its price is shown as 100 − market price to match this forecast’s claim.'
