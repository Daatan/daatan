/**
 * The forecasts table on an outlet's public page (daatan#2320): one row per public forecast the
 * outlet's articles fed, with the outlet's lean on it and how that lean moved article by article.
 * Pure — the service in lib/services/outlet-forecasts.ts gathers the pool rows.
 */

/** Forecast status as the table shows it. `annulled` covers VOID and UNRESOLVABLE. */
export type OutletForecastState = 'open' | 'pending' | 'cameTrue' | 'didNotHappen' | 'annulled'

export interface OutletForecastRow {
  forecastId: string
  /** URL segment: the slug when there is one, the id otherwise. */
  href: string
  title: string
  state: OutletForecastState
  articles: number
  /** The outlet's lean, 1–99: the mean stance of its articles, as a probability the claim happens. */
  lean: number
  /** Running mean of that lean after each article, oldest first, at most TREND_POINTS long. */
  trend: number[]
  /** Date of the outlet's newest article on this forecast, `YYYY-MM-DD`. */
  lastArticle: string
  /** On a resolved forecast with an outcome instant: the lean of only the articles published
   *  before it (daatan#2340). Null when none were, or the forecast has no such instant. */
  beforeOutcome?: { lean: number; articles: number } | null
}

export const TREND_POINTS = 24

/** Below this many articles a line says nothing; the table shows a single dot. */
export const MIN_TREND_ARTICLES = 3

const OPEN_STATES: ReadonlySet<OutletForecastState> = new Set(['open', 'pending'])

export function forecastState(status: string): OutletForecastState {
  switch (status) {
    case 'RESOLVED_CORRECT': return 'cameTrue'
    case 'RESOLVED_WRONG': return 'didNotHappen'
    case 'VOID':
    case 'UNRESOLVABLE': return 'annulled'
    case 'PENDING': return 'pending'
    default: return 'open'
  }
}

/** The day an article counts on: its reported publish date when that reads as a date, else
 *  when Daatan recorded it. `publishedDate` comes from the source and is not always ISO. */
export function articleDay(publishedDate: string | null, addedAt: Date): string {
  const m = publishedDate?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(`${m[1]}-${m[2]}-${m[3]}`)) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return addedAt.toISOString().slice(0, 10)
}

/**
 * Running mean of `values` after each one, thinned to at most `points` evenly spaced readings
 * (the first and the last always kept). `toPercent` maps a mean to what the line plots.
 */
export function runningTrend(values: number[], toPercent: (v: number) => number, points = TREND_POINTS): number[] {
  const means: number[] = []
  let sum = 0
  values.forEach((v, i) => {
    sum += v
    means.push(toPercent(sum / (i + 1)))
  })
  if (means.length <= points) return means
  return Array.from({ length: points }, (_, i) => means[Math.round((i * (means.length - 1)) / (points - 1))])
}

export type OutletForecastSort = 'default' | 'title' | 'lean' | 'articles' | 'lastArticle' | 'state'
export type SortDir = 'asc' | 'desc'

/** First click on a column: text A→Z, the rest biggest or newest first. */
export const DEFAULT_SORT_DIR: Record<OutletForecastSort, SortDir> = {
  default: 'desc', title: 'asc', lean: 'desc', articles: 'desc', lastArticle: 'desc', state: 'asc',
}

const STATE_ORDER: OutletForecastState[] = ['open', 'pending', 'cameTrue', 'didNotHappen', 'annulled']

const byNewest = (a: OutletForecastRow, b: OutletForecastRow) => b.lastArticle.localeCompare(a.lastArticle)

/**
 * `default`: open forecasts first, then settled ones, each newest article first. Every other
 * key sorts the whole list, ties broken by newest article.
 */
export function sortOutletForecasts(
  rows: OutletForecastRow[],
  sort: OutletForecastSort = 'default',
  dir: SortDir = DEFAULT_SORT_DIR[sort],
): OutletForecastRow[] {
  const sign = dir === 'asc' ? 1 : -1
  const compare = (a: OutletForecastRow, b: OutletForecastRow): number => {
    switch (sort) {
      case 'default':
        return Number(OPEN_STATES.has(b.state)) - Number(OPEN_STATES.has(a.state))
      case 'title':
        return sign * a.title.localeCompare(b.title)
      case 'lean':
        return sign * (a.lean - b.lean)
      case 'articles':
        return sign * (a.articles - b.articles)
      case 'lastArticle':
        return sign * a.lastArticle.localeCompare(b.lastArticle)
      case 'state':
        return sign * (STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state))
    }
  }
  return [...rows].sort((a, b) => compare(a, b) || byNewest(a, b))
}

/**
 * A resolved forecast this outlet's coverage took a side on before the outcome was known
 * (daatan#2340). It reads the articles' lean, not a score: the board scores the writers.
 */
export interface OutletCall {
  forecastId: string
  href: string
  title: string
  state: 'cameTrue' | 'didNotHappen'
  /** Mean lean, 1–99, of the outlet's articles published before the outcome. */
  lean: number
  articles: number
}

/** Fewer articles than this before the outcome is one writer's take, not the outlet's. */
export const MIN_CALL_ARTICLES = 3
/** A lean closer to 50% than this (a 60/40 split) took no side. */
export const MIN_CALL_DISTANCE = 10

/**
 * Resolved forecasts where the pre-outcome lean took a side, split by whether that side held
 * up: leaning above 50% on one that came true, or below on one that didn't, is the right way
 * (the board's own hit rule). Each list puts the firmest lean first, then the most articles.
 */
export function pickCalls(rows: OutletForecastRow[]): { heldUp: OutletCall[]; missed: OutletCall[] } {
  const heldUp: OutletCall[] = []
  const missed: OutletCall[] = []
  for (const r of rows) {
    const before = r.beforeOutcome
    if (!before || (r.state !== 'cameTrue' && r.state !== 'didNotHappen')) continue
    if (before.articles < MIN_CALL_ARTICLES || Math.abs(before.lean - 50) < MIN_CALL_DISTANCE) continue
    const call: OutletCall = {
      forecastId: r.forecastId, href: r.href, title: r.title, state: r.state,
      lean: before.lean, articles: before.articles,
    }
    const leanedYes = before.lean > 50
    ;(leanedYes === (r.state === 'cameTrue') ? heldUp : missed).push(call)
  }
  const firmest = (a: OutletCall, b: OutletCall) =>
    Math.abs(b.lean - 50) - Math.abs(a.lean - 50) || b.articles - a.articles || a.title.localeCompare(b.title)
  return { heldUp: heldUp.sort(firmest), missed: missed.sort(firmest) }
}
