/**
 * §4.1 ingest filter policy for daatan#1641 (the market anchor index catalogue).
 * Pure functions, no Prisma dependency — the crawler (PR-2) will call these against
 * data it fetches from Polymarket/Kalshi; these are exercised directly against
 * fixtures until then. See `Daatan/docs` planning/oracle-2-market-anchor-index.md §4.1
 * and daatan#1639 (the census that produced the numbers below) for the full rationale.
 *
 * Order matters and is not interchangeable: category, then volume floor, then series
 * cap. Applying the series cap before the volume floor left ~58-64k dead (untraded)
 * rows in #1639's measurement; the volume floor removes ~94% of in-scope Kalshi rows
 * on its own, so it must run first.
 */

/** The Oracul's actual question distribution, not the venues' full tag/category lists —
 *  the 13 Polymarket tags #1639's census was measured against (`politics` + `world-elections`
 *  cover what Gamma has no single `elections` tag for). Also doubles as the in-scope set
 *  for Kalshi, which ships category as a plain string field. */
export const IN_SCOPE_CATEGORIES: ReadonlySet<string> = new Set([
  'politics',
  'geopolitics',
  'world-elections',
  'finance',
  'economy',
  'economic-policy',
  'business',
  'tech',
  'ai',
  'science',
  'middle-east',
  'trump',
  'foreign-policy',
])

/** Asymmetric by design (#1639): a base rate built from thin resolved markets is noise
 *  (§4.6), so the resolved side carries the higher bar. At a single $1k floor the
 *  resolved side alone is ~60-100k in-scope rows, over the 50k HNSW line; at these
 *  numbers the combined catalogue lands ~35-45k. */
export const VOLUME_FLOOR_USD = {
  open: 1_000,
  resolved: 50_000,
} as const

/** Most-recent instances of a templated (recurring) series kept per series, for every
 *  frequency except `one_off`. The volume floor already removes ~94% of in-scope Kalshi
 *  rows before this runs, so N matters far less than it looked in isolation — #1639
 *  tested N=5 and N=10 pre-volume-floor (~63k vs ~64k of ~3.38M); post-floor the gap is
 *  a few hundred rows. `one_off` series are structurally exempt: there is only ever one
 *  instance, so "N most recent" doesn't apply. */
export const SERIES_CAP_N = 10

export type MarketSide = 'open' | 'resolved'

/** Kalshi's `frequency` field on a series. `one_off` markets are not part of a
 *  recurring series and are exempt from the series cap. */
export type SeriesFrequency =
  | 'hourly'
  | 'fifteen_min'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'annual'
  | 'custom'
  | 'one_off'

export interface CatalogueCandidate {
  category: string
  volumeUsd: number
  side: MarketSide
  /** Present only for series-based markets (Kalshi). Absent (e.g. Polymarket) means
   *  "not part of a recurring series" — treated the same as `one_off`. */
  seriesFrequency?: SeriesFrequency
  /** Stable identifier for the recurring series this instance belongs to. Required
   *  when `seriesFrequency` is set to anything other than `one_off`/undefined, since
   *  the cap is applied per series. */
  seriesId?: string
  /** Instance creation time, used to rank "most recent" within a series for the cap. */
  createdAt: Date
}

/** Category gate: free (no LLM), applied first. */
export function isInScopeCategory(category: string): boolean {
  return IN_SCOPE_CATEGORIES.has(category)
}

/** Volume/liquidity gate: an untraded market's price is not evidence (the retro#643
 *  Swalwell match was a real market with $20 of volume). Applied after the category
 *  filter, before the series cap. */
export function passesVolumeFloor(volumeUsd: number, side: MarketSide): boolean {
  return volumeUsd >= VOLUME_FLOOR_USD[side]
}

/** True when a series is subject to the recurring-instance cap: it has a
 *  `seriesFrequency` and that frequency is not `one_off`. */
function isTemplatedSeries(candidate: CatalogueCandidate): boolean {
  return candidate.seriesFrequency !== undefined && candidate.seriesFrequency !== 'one_off'
}

/**
 * Applies the full §4.1 policy in order — category, then volume floor, then series
 * cap — to a batch of candidates and returns the ones that survive.
 *
 * The series cap needs the whole batch (it ranks instances within a series against
 * each other), so it's not expressible as a single-candidate predicate like the first
 * two gates; this is the one function callers actually need.
 */
export function applyIngestFilterPolicy(candidates: CatalogueCandidate[]): CatalogueCandidate[] {
  const categoryFiltered = candidates.filter(c => isInScopeCategory(c.category))
  const volumeFiltered = categoryFiltered.filter(c => passesVolumeFloor(c.volumeUsd, c.side))

  const bySeriesId = new Map<string, CatalogueCandidate[]>()
  const notTemplated: CatalogueCandidate[] = []
  for (const c of volumeFiltered) {
    if (!isTemplatedSeries(c)) {
      notTemplated.push(c)
      continue
    }
    const key = c.seriesId ?? ''
    const bucket = bySeriesId.get(key)
    if (bucket) bucket.push(c)
    else bySeriesId.set(key, [c])
  }

  const capped: CatalogueCandidate[] = [...notTemplated]
  for (const instances of bySeriesId.values()) {
    const mostRecentFirst = [...instances].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
    capped.push(...mostRecentFirst.slice(0, SERIES_CAP_N))
  }

  return capped
}
