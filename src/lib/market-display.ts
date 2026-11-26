/**
 * Display math for linked external prediction markets (Polymarket / Kalshi).
 * Snapshots store the RAW provider price; polarity and outcome labeling are
 * display concerns, centralized here so the info panel and the history chart
 * can never disagree.
 */

import { bidiIsolate } from '@/lib/utils/bidi'

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

/**
 * Chart legend / series name for the Market line, e.g. "Polymarket, inverted".
 * `invertedWord` is the reader's word for "inverted", or null for a plain link.
 * The outcome label is the provider's own (usually English) text, so it is
 * direction-isolated for RTL pages (daatan#2327).
 */
export function marketLineName(
  providerLabel: string,
  invertedWord: string | null,
  outcomeLabel: string | null,
): string {
  const qualifier = invertedWord ? `${providerLabel}, ${invertedWord}` : providerLabel
  return outcomeLabel ? `"${bidiIsolate(outcomeLabel)}" (${qualifier})` : qualifier
}

/** daatan#2323: a market price older than this is shown greyed and marked stale. */
export const MARKET_STALE_HOURS = 48

export interface MarketReading {
  /** Polarity-adjusted, 0–100. */
  probability: number
  /** ISO time of the snapshot. */
  at: string
  stale: boolean
}

/**
 * The market's latest price as the forecast page shows it (daatan#2323): the last
 * snapshot (callers pass them oldest first), polarity-adjusted, aged against `nowMs`.
 */
export function latestMarketReading(
  snapshots: ReadonlyArray<{ createdAt: string; probability: number }>,
  inverted: boolean,
  nowMs: number,
): MarketReading | null {
  const last = snapshots.at(-1)
  if (!last) return null
  return {
    probability: marketDisplayProbability(last.probability, inverted),
    at: last.createdAt,
    stale: nowMs - new Date(last.createdAt).getTime() > MARKET_STALE_HOURS * 3_600_000,
  }
}

/**
 * daatan#2141: a linked market whose resolution date sits within this many days of
 * the forecast's own deadline counts as "same deadline". Beyond it the page notes
 * the mismatch and the divergence alert turns one-sided (see marketDivergenceBound).
 */
export const MARKET_DEADLINE_TOLERANCE_DAYS = 3
const MS_PER_DAY = 86_400_000

type DateLike = string | Date | null | undefined

function toMs(d: DateLike): number | null {
  if (!d) return null
  const ms = (typeof d === 'string' ? new Date(d) : d).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Market end date − forecast claim deadline, in (fractional) days; null if either is missing. */
export function marketDeadlineDeltaDays(marketEndDate: DateLike, claimDeadline: DateLike): number | null {
  const end = toMs(marketEndDate)
  const deadline = toMs(claimDeadline)
  if (end === null || deadline === null) return null
  return (end - deadline) / MS_PER_DAY
}

/** 'later' / 'earlier' when the market resolves more than the tolerance away from our deadline, else null. */
export function marketDeadlineMismatch(marketEndDate: DateLike, claimDeadline: DateLike): 'later' | 'earlier' | null {
  const delta = marketDeadlineDeltaDays(marketEndDate, claimDeadline)
  if (delta === null || Math.abs(delta) <= MARKET_DEADLINE_TOLERANCE_DAYS) return null
  return delta > 0 ? 'later' : 'earlier'
}

/**
 * How a linked market's (polarity-adjusted) probability bounds ours, given the
 * deadline gap and the claim's temporal direction:
 *
 * - ARRIVAL ("X happens by D"): a later market deadline gives X more time, so
 *   P(market) ≥ P(ours) — the market is an UPPER bound. An earlier one is a LOWER bound.
 * - SURVIVAL ("X persists / does not happen until D"): surviving to a later
 *   deadline is harder, so P(market) ≤ P(ours) — the market is a LOWER bound.
 *   An earlier one is an UPPER bound.
 * - Same deadline (|delta| ≤ tolerance), unknown direction (NONE/null) or a
 *   missing date → 'two-sided' (the plain apples-to-apples comparison).
 *
 * Inversion (externalMarketInverted) is applied to the probability before this,
 * which puts the market in the claim's own frame — no extra flip needed here.
 */
export function marketDivergenceBound(
  claimDirection: string | null | undefined,
  claimDeadline: DateLike,
  marketEndDate: DateLike,
): 'upper' | 'lower' | 'two-sided' {
  const mismatch = marketDeadlineMismatch(marketEndDate, claimDeadline)
  if (mismatch === null) return 'two-sided'
  if (claimDirection === 'ARRIVAL') return mismatch === 'later' ? 'upper' : 'lower'
  if (claimDirection === 'SURVIVAL') return mismatch === 'later' ? 'lower' : 'upper'
  return 'two-sided'
}

/**
 * The divergence that counts against the bound, in percentage points. Upper bound:
 * only ours sitting ABOVE the market is a contradiction (ours − market). Lower
 * bound: only ours sitting BELOW it (market − ours). Two-sided: |market − ours|.
 * Negative/small values mean the two are consistent.
 */
export function marketDivergenceGap(
  marketProbability: number,
  ourProbability: number,
  bound: 'upper' | 'lower' | 'two-sided',
): number {
  if (bound === 'upper') return ourProbability - marketProbability
  if (bound === 'lower') return marketProbability - ourProbability
  return Math.abs(marketProbability - ourProbability)
}
