import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { embedText } from '@/lib/services/embedding'
import { getLatestEvidenceEstimate } from '@/lib/services/context'
import { notifyMarketDivergence } from '@/lib/services/telegram'
import type { ExternalMarket, MarketProvider as MarketProviderEnum } from '@prisma/client'

const log = createLogger('external-markets')

/** Percentage-point gap between a linked market's implied YES probability and
 *  our Oracle estimate above which we alert — the two disagreeing enough to be
 *  worth a human look (mispriced market, stale Oracle read, or a real edge). */
const MARKET_DIVERGENCE_THRESHOLD_PTS = 20
/** Re-arm only once the gap falls back to this (lower) bar, not merely below
 *  MARKET_DIVERGENCE_THRESHOLD_PTS — the buffer stops a gap oscillating right
 *  at the line (20.1 → 19.9 → 20.2 ...) from re-notifying every hourly sync. */
const MARKET_DIVERGENCE_REARM_PTS = 15

const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const CLOB_BASE = 'https://clob.polymarket.com'
const FETCH_TIMEOUT_MS = 8_000
/** 12-hour candles keep even a multi-year market history to a few hundred points. */
const HISTORY_FIDELITY_MINUTES = 720
/** Hard cap on backfilled snapshots per market (stride-sampled down when over). */
const MAX_BACKFILL_POINTS = 400
/** Cosine similarity above which a market is treated as "the same question". */
const MATCH_THRESHOLD = 0.8
/** Cosine-similarity floor for the admin "Suggest matches" panel. Candidates
 *  below it are dropped rather than shown — the panel returning the 5 least-bad
 *  markets for a claim with no real equivalent was the main source of the
 *  "unrelated markets" complaint. Below MATCH_THRESHOLD (these are suggestions a
 *  human confirms, not auto-links) but high enough to exclude topical noise. */
const PANEL_MATCH_FLOOR = 0.6
/** How many keyword candidates to embed-and-rank per suggest. */
const MATCH_CANDIDATES = 8
/** Cap on markets kept from a single Polymarket event. `/public-search` returns
 *  whole events, and a grouped one (elections, "who will win X") bundles dozens
 *  of sibling markets that share a topic but not the question — collecting them
 *  all floods the candidate pool and buries the real match. */
const MAX_MARKETS_PER_EVENT = 2
/** Deadline-gap tuning. A candidate whose market resolves within GRACE days of
 *  the forecast deadline gets no penalty; beyond that its similarity score
 *  decays smoothly (DECAY = the gap, in days past grace, that halves the score).
 *  Soft by design — it re-ranks rather than dropping candidates. */
const DEADLINE_GRACE_DAYS = 45
const DEADLINE_DECAY_DAYS = 365
const MS_PER_DAY = 86_400_000

/** Words that carry no search signal — articles, prepositions, conjunctions, and
 *  the boilerplate verbs/qualifiers common in forecast claims. */
const QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'or', 'and', 'to', 'in', 'on', 'for', 'by', 'be', 'will', 'is', 'are',
  'was', 'were', 'between', 'with', 'from', 'at', 'as', 'that', 'this', 'it', 'its', 'they', 'their',
  'than', 'then', 'officially', 'official', 'formally', 'formal', 'sign', 'signed', 'signs',
  'announce', 'announced', 'announces', 'reach', 'reached', 'within', 'before', 'after', 'during',
  'over', 'about', 'into', 'per', 'whether',
])

/** Acronyms Polymarket spells differently in titles — the literal token "usa"
 *  matches no market and zeroes out search, so normalize it (and "u.s."/"u.s.a"). */
const TOKEN_ALIASES: Record<string, string> = { usa: 'us', 'u.s.a': 'us', 'u.s': 'us' }

/** Max tokens to keep in a search query — long strings return no results. */
const MAX_QUERY_TOKENS = 6

/**
 * Turn a verbose forecast claim into a short, search-friendly query. Polymarket's
 * search returns nothing for long natural-language strings and weights the
 * leading tokens heavily, so we keep only salient content words and order them by
 * salience: extracted entities first, then capitalized words from the claim
 * (proper nouns the market titles key on), then the remaining keywords. Known
 * acronyms are normalized, stopwords dropped, and the length capped.
 */
export function buildMarketSearchQuery(claimText: string, entities: string[] = []): string {
  const clean = (s: string) => s.replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z0-9\s.]/g, ' ')
  const norm = (w: string): string => {
    const lw = w.toLowerCase().replace(/\.+$/, '')
    return TOKEN_ALIASES[lw] ?? lw
  }
  const keep = (w: string) => w.length >= 2 && !QUERY_STOPWORDS.has(w)

  const entityTokens = entities.flatMap(e => clean(e).split(/\s+/)).map(norm).filter(keep)
  const claimWords = clean(claimText).split(/\s+/).filter(Boolean)
  const properTokens = claimWords.filter(w => /^[A-Z]/.test(w)).map(norm).filter(keep)
  const restTokens = claimWords.map(norm).filter(keep)

  const seen = new Set<string>()
  const out: string[] = []
  for (const w of [...entityTokens, ...properTokens, ...restTokens]) {
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= MAX_QUERY_TOKENS) break
  }
  return out.join(' ')
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  POLYMARKET: 'Polymarket',
  KALSHI: 'Kalshi',
}

/**
 * Multi-provider external prediction-market integration (Polymarket + Kalshi).
 *
 * Read-only. Resolve a market from a pasted URL (admin linking / URL import),
 * cache it, and periodically snapshot its YES probability so the forecast
 * history chart can plot a "Market" line. Each provider implements the
 * MarketProvider interface; callers stay provider-agnostic via the registry.
 */

export type ProviderId = MarketProviderEnum // 'POLYMARKET' | 'KALSHI'

/** Normalized market shape, provider-independent. */
export interface NormalizedMarket {
  provider: ProviderId
  externalId: string
  slug: string
  url: string
  question: string
  /** Outcome labels in price order, e.g. ["Yes", "No"]. */
  outcomes: string[]
  /** YES probability as an integer 0–100. */
  yesProbability: number
  endDate: Date | null
  closed: boolean
  /** Winning outcome label once resolved, else null. */
  resolvedOutcome: string | null
  /** Provider-specific id for the YES outcome's price-history series (Polymarket
   *  CLOB token id). Null when the provider exposes none — backfill is skipped. */
  historyId: string | null
}

/** Lightweight candidate returned by the suggestion helper. */
export interface MarketSuggestion {
  provider: ProviderId
  externalId: string
  slug: string
  question: string
  yesProbability: number
  url: string
  /** Market resolution date, used to penalize deadline-mismatched candidates. */
  endDate: Date | null
  /** Semantic match to the claim as an integer 0–100 (raw cosine × 100), set by
   *  the ranking callers. Absent on unscored candidates straight from search. */
  score?: number
}

/** Each provider knows its URLs and how to fetch/normalize/suggest markets. */
export interface MarketProvider {
  readonly id: ProviderId
  /** True if this provider owns the given URL's host. */
  matchesUrl(input: string): boolean
  /** Parse the provider's market id (slug / ticker) from a URL or raw id. */
  parseId(input: string): string | null
  /** Fetch + normalize a market by its parsed id. */
  fetchMarket(id: string): Promise<NormalizedMarket | null>
  /** Suggest candidate markets for a free-text query (best-effort). */
  suggest(query: string, limit: number): Promise<MarketSuggestion[]>
}

// ---------------------------------------------------------------------------
// Polymarket provider (public Gamma API)
// ---------------------------------------------------------------------------

/** Fetch JSON from a fixed Polymarket host with a timeout; returns null on any failure. */
async function apiFetch<T>(base: string, path: string): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      log.warn({ base, path, status: res.status }, 'Market API request failed')
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    log.warn({ base, path, err: String(err) }, 'Market API request errored')
    return null
  } finally {
    clearTimeout(timer)
  }
}

const gammaFetch = <T,>(path: string) => apiFetch<T>(GAMMA_BASE, path)

/** Gamma encodes `outcomes`/`outcomePrices` as JSON strings; decode defensively. */
function decodeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

/** Best-effort numeric trade volume from a raw Gamma market row, used to rank the
 *  markets within one event. Gamma exposes it under a few keys (sometimes as a
 *  string); anything missing/unparseable is 0, which sorts to the back. */
function marketVolume(raw: Record<string, unknown>): number {
  const v = raw.volumeNum ?? raw.volume ?? raw.volume24hr ?? raw.liquidityNum ?? raw.liquidity
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** The parent event's slug for a raw Gamma market row, when the row carries it.
 *  `/markets?slug=` nests the event under `events[]`; `/public-search` does not,
 *  so that path passes the slug in explicitly. */
function eventSlugOf(raw: Record<string, unknown>): string | null {
  const events = Array.isArray(raw.events) ? raw.events : []
  const first = events[0] as Record<string, unknown> | undefined
  return typeof first?.slug === 'string' ? first.slug : null
}

/** Canonical web URL for a Polymarket market.
 *
 *  `/event/…` addresses an **event**, not a market. A grouped event (one question,
 *  many deadlines) has its own slug, distinct from each market's — so building the
 *  path from the market slug alone 404s for every such market. Only single-market
 *  events happen to work, because Polymarket then reuses one slug for both, which
 *  is why the breakage looked intermittent.
 *
 *  `/event/{event}/{market}` resolves for grouped and single-market events alike,
 *  and pins the exact market. Fall back to the bare market slug when the event is
 *  unknown: no worse than what we emitted before. */
function polymarketUrl(eventSlug: string | null, marketSlug: string): string {
  return eventSlug
    ? `https://polymarket.com/event/${eventSlug}/${marketSlug}`
    : `https://polymarket.com/event/${marketSlug}`
}

/** Map a raw Gamma market row into the normalized shape. Returns null if unusable.
 *  `eventSlug` overrides the row's own nested event — pass it from `/public-search`,
 *  whose market rows omit `events[]`. */
export function normalizeGammaMarket(
  raw: Record<string, unknown>,
  eventSlug?: string | null,
): NormalizedMarket | null {
  const externalId = typeof raw.conditionId === 'string' ? raw.conditionId : null
  const slug = typeof raw.slug === 'string' ? raw.slug : null
  const question = typeof raw.question === 'string' ? raw.question : null
  if (!externalId || !slug || !question) return null

  const outcomes = decodeJsonArray(raw.outcomes)
  const prices = decodeJsonArray(raw.outcomePrices).map(Number)
  if (outcomes.length === 0 || prices.length !== outcomes.length) return null

  // YES = the outcome labelled "yes" (case-insensitive), else first outcome.
  const yesIndex = Math.max(
    0,
    outcomes.findIndex(o => o.toLowerCase() === 'yes'),
  )
  const yesPrice = prices[yesIndex]
  if (!Number.isFinite(yesPrice)) return null
  const yesProbability = Math.round(Math.min(1, Math.max(0, yesPrice)) * 100)

  const closed = raw.closed === true
  let resolvedOutcome: string | null = null
  if (closed) {
    const winnerIdx = prices.findIndex(p => p >= 0.99)
    if (winnerIdx >= 0) resolvedOutcome = outcomes[winnerIdx]
  }

  const endDateRaw = typeof raw.endDate === 'string' ? raw.endDate : null
  const endDate = endDateRaw ? new Date(endDateRaw) : null

  // CLOB token ids sit in outcome order, so the YES token shares yesIndex.
  const clobTokenIds = decodeJsonArray(raw.clobTokenIds)
  const historyId = clobTokenIds[yesIndex] ?? null

  return {
    provider: 'POLYMARKET',
    externalId,
    slug,
    url: polymarketUrl(eventSlug ?? eventSlugOf(raw), slug),
    question,
    outcomes,
    yesProbability,
    endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
    closed,
    resolvedOutcome,
    historyId,
  }
}

// ---------------------------------------------------------------------------
// Price-history backfill (Polymarket CLOB)
// ---------------------------------------------------------------------------

/** A historical YES-price point ready to insert as a snapshot. */
export interface HistoryPoint {
  createdAt: Date
  probability: number
}

/** Evenly stride-sample `points` down to at most `max`, always keeping the last
 *  point (the most recent price) so the series ends where live sync picks up. */
export function samplePoints<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points
  const stride = points.length / max
  const out: T[] = []
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor(i * stride)])
  out.push(points[points.length - 1])
  return out
}

/** Drop points whose probability repeats the previous point's — a plateau of
 *  identical candles is one real price, not one measurement per candle. Always
 *  keeps the first point so an all-flat series still yields its starting price. */
function dedupeConsecutive(points: HistoryPoint[]): HistoryPoint[] {
  return points.filter((p, i) => i === 0 || p.probability !== points[i - 1].probability)
}

/** Parse a CLOB prices-history payload into snapshot-ready points (asc, deduped, capped). */
export function parseHistoryPayload(payload: unknown): HistoryPoint[] {
  const history = (payload as { history?: unknown })?.history
  if (!Array.isArray(history)) return []
  const points: HistoryPoint[] = []
  for (const row of history) {
    const t = (row as { t?: unknown })?.t
    const p = (row as { p?: unknown })?.p
    if (typeof t !== 'number' || typeof p !== 'number' || !Number.isFinite(t) || !Number.isFinite(p)) continue
    points.push({
      createdAt: new Date(t * 1000),
      probability: Math.round(Math.min(1, Math.max(0, p)) * 100),
    })
  }
  points.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return samplePoints(dedupeConsecutive(points), MAX_BACKFILL_POINTS)
}

/** Fetch the market's full-life YES price history. Empty on any failure. */
async function fetchYesPriceHistory(historyId: string): Promise<HistoryPoint[]> {
  const payload = await apiFetch<unknown>(
    CLOB_BASE,
    `/prices-history?market=${encodeURIComponent(historyId)}&interval=max&fidelity=${HISTORY_FIDELITY_MINUTES}`,
  )
  return payload ? parseHistoryPayload(payload) : []
}

/**
 * Backfill a market's snapshot series from provider history so the chart's
 * Market line starts at the market's birth, not at link time. Inserts only
 * points strictly OLDER than `before` (the earliest existing snapshot, or now),
 * so it composes with a live series and re-runs are no-ops. Best-effort: any
 * failure just leaves the series to grow forward from the seed snapshot.
 */
async function backfillMarketHistory(
  marketId: string,
  historyId: string,
  before: Date,
): Promise<number> {
  try {
    const points = (await fetchYesPriceHistory(historyId)).filter(
      p => p.createdAt.getTime() < before.getTime(),
    )
    if (points.length === 0) return 0
    await prisma.externalMarketPriceSnapshot.createMany({
      data: points.map(p => ({ marketId, probability: p.probability, createdAt: p.createdAt })),
    })
    log.info({ marketId, points: points.length }, 'Backfilled market price history')
    return points.length
  } catch (err) {
    log.warn({ marketId, err: String(err) }, 'Market history backfill failed')
    return 0
  }
}

export const polymarketProvider: MarketProvider = {
  id: 'POLYMARKET',

  matchesUrl(input: string): boolean {
    try {
      return new URL(input.trim()).hostname.includes('polymarket.com')
    } catch {
      return false
    }
  },

  parseId(input: string): string | null {
    const trimmed = input.trim()
    if (!trimmed) return null
    // Raw slug (no scheme, no slashes) — accept as-is.
    if (!trimmed.includes('/') && !trimmed.includes(' ')) return trimmed
    try {
      const url = new URL(trimmed)
      if (!url.hostname.includes('polymarket.com')) return null
      const segments = url.pathname.split('/').filter(Boolean)
      return segments.length > 0 ? segments[segments.length - 1] : null
    } catch {
      return null
    }
  },

  async fetchMarket(slug: string): Promise<NormalizedMarket | null> {
    const rows = await gammaFetch<Record<string, unknown>[]>(
      `/markets?slug=${encodeURIComponent(slug)}`,
    )
    if (rows && rows.length > 0) return normalizeGammaMarket(rows[0])

    // No market by that slug. Polymarket shows grouped events at `/event/{event}`
    // with no market segment, so a pasted URL often yields the *event* slug —
    // which `/markets?slug=` can never match. Resolve it as an event and take its
    // most-traded open market, the one the event page opens on.
    const events = await gammaFetch<{ slug?: string; markets?: Record<string, unknown>[] }[]>(
      `/events?slug=${encodeURIComponent(slug)}`,
    )
    const event = events?.[0]
    if (!event) return null
    const candidates = [...(event.markets ?? [])].sort((a, b) => marketVolume(b) - marketVolume(a))
    for (const raw of candidates) {
      const m = normalizeGammaMarket(raw, event.slug ?? slug)
      if (m && !m.closed) return m
    }
    return null
  },

  async suggest(query: string, limit: number): Promise<MarketSuggestion[]> {
    // Use Polymarket's purpose-built search rather than `/markets?_q=` (which
    // ignores the query and just returns the highest-volume markets). Each event
    // carries a `markets[]` whose rows are shaped like Gamma market rows, so we
    // reuse normalizeGammaMarket. Open markets only — closed ones can't be linked.
    const collect = async (q: string): Promise<MarketSuggestion[]> => {
      const data = await gammaFetch<
        { events?: { slug?: string; markets?: Record<string, unknown>[] }[] }
      >(`/public-search?q=${encodeURIComponent(q)}`)
      const out: MarketSuggestion[] = []
      const seen = new Set<string>()
      for (const ev of data?.events ?? []) {
        // Keep only the most-traded markets of each event, so one grouped event
        // can't crowd out other events' matches before the embedding re-rank.
        const ranked = [...(ev.markets ?? [])].sort((a, b) => marketVolume(b) - marketVolume(a))
        let kept = 0
        for (const raw of ranked) {
          if (kept >= MAX_MARKETS_PER_EVENT) break
          // These rows carry no `events[]` of their own, so the parent slug has to
          // come from the enclosing event or the suggestion's URL would 404.
          const m = normalizeGammaMarket(raw, ev.slug ?? null)
          if (!m || m.closed || seen.has(m.externalId)) continue
          seen.add(m.externalId)
          kept++
          out.push({
            provider: m.provider,
            externalId: m.externalId,
            slug: m.slug,
            question: m.question,
            yesProbability: m.yesProbability,
            url: m.url,
            endDate: m.endDate,
          })
        }
      }
      return out
    }

    let results = await collect(query)
    // Search returns nothing for over-long / rare-token queries; retry once with
    // just the first two words (broader recall) before giving up.
    const words = query.split(/\s+/).filter(Boolean)
    if (results.length === 0 && words.length > 2) {
      results = await collect(words.slice(0, 2).join(' '))
    }
    return results.slice(0, limit)
  },
}

// ---------------------------------------------------------------------------
// Kalshi provider (stub — Phase B; needs KALSHI_API_KEY_ID + KALSHI_PRIVATE_KEY)
// ---------------------------------------------------------------------------

export const kalshiProvider: MarketProvider = {
  id: 'KALSHI',

  matchesUrl(input: string): boolean {
    try {
      return new URL(input.trim()).hostname.includes('kalshi.com')
    } catch {
      return false
    }
  },

  parseId(input: string): string | null {
    try {
      const url = new URL(input.trim())
      if (!url.hostname.includes('kalshi.com')) return null
      const segments = url.pathname.split('/').filter(Boolean)
      return segments.length > 0 ? segments[segments.length - 1] : null
    } catch {
      return input.trim() || null
    }
  },

  async fetchMarket(): Promise<NormalizedMarket | null> {
    log.warn('Kalshi provider not yet configured (needs API credentials) — Phase B')
    return null
  },

  async suggest(): Promise<MarketSuggestion[]> {
    return []
  },
}

// ---------------------------------------------------------------------------
// Registry + provider-agnostic public API
// ---------------------------------------------------------------------------

const PROVIDERS: MarketProvider[] = [polymarketProvider, kalshiProvider]

/** Resolve the provider that owns a pasted URL, if any. */
export function getProviderForUrl(input: string): MarketProvider | null {
  return PROVIDERS.find(p => p.matchesUrl(input)) ?? null
}

function getProviderById(id: ProviderId): MarketProvider | null {
  return PROVIDERS.find(p => p.id === id) ?? null
}

/** Upsert a normalized market into the cache (keyed by provider + externalId). */
async function upsertMarket(m: NormalizedMarket): Promise<ExternalMarket> {
  const market = await prisma.externalMarket.upsert({
    where: { provider_externalId: { provider: m.provider, externalId: m.externalId } },
    create: {
      provider: m.provider,
      externalId: m.externalId,
      slug: m.slug,
      url: m.url,
      question: m.question,
      outcomes: m.outcomes,
      endDate: m.endDate,
      resolved: m.closed,
      resolvedOutcome: m.resolvedOutcome,
      lastSyncedAt: new Date(),
    },
    update: {
      slug: m.slug,
      url: m.url,
      question: m.question,
      outcomes: m.outcomes,
      endDate: m.endDate,
      resolved: m.closed,
      resolvedOutcome: m.resolvedOutcome,
      lastSyncedAt: new Date(),
    },
  })

  // Seed the price series so the forecast history chart's "Market" line shows as
  // soon as a market is linked/imported, instead of staying empty until the first
  // hourly sync cron happens to run (GitHub schedules are irregular). On first
  // link, backfill the market's full provider-side history (best-effort) and then
  // seed the current price; the hourly sync owns the ongoing time series.
  const snapshotCount = await prisma.externalMarketPriceSnapshot.count({
    where: { marketId: market.id },
  })
  if (snapshotCount === 0) {
    if (m.historyId) await backfillMarketHistory(market.id, m.historyId, new Date())
    await prisma.externalMarketPriceSnapshot.create({
      data: { marketId: market.id, probability: m.yesProbability },
    })
  }

  return market
}

/**
 * Resolve a pasted market URL (any supported provider) into a cached market row.
 * Returns null if the URL is unsupported/unparseable or the market can't be fetched.
 */
export async function resolveMarketByUrl(url: string): Promise<ExternalMarket | null> {
  const provider = getProviderForUrl(url)
  if (!provider) {
    log.warn({ url }, 'No provider matches that market URL')
    return null
  }
  const id = provider.parseId(url)
  if (!id) {
    log.warn({ url, provider: provider.id }, 'Could not parse a market id from the URL')
    return null
  }
  const market = await provider.fetchMarket(id)
  if (!market) {
    log.warn({ id, provider: provider.id }, 'Provider returned no market for id')
    return null
  }
  return upsertMarket(market)
}

/**
 * Refresh every cached market that at least one prediction links to: fetch the
 * latest price, write a snapshot, and update resolution status. Best-effort.
 */
export async function syncLinkedMarkets(): Promise<{ synced: number; failed: number }> {
  const markets = await prisma.externalMarket.findMany({
    where: { predictions: { some: {} } },
    select: {
      id: true,
      slug: true,
      externalId: true,
      provider: true,
      predictions: {
        select: { id: true, claimText: true, slug: true, externalMarketInverted: true, marketDivergenceAlertAt: true },
      },
    },
  })

  let synced = 0
  let failed = 0
  for (const cached of markets) {
    try {
      const provider = getProviderById(cached.provider)
      const latest = provider ? await provider.fetchMarket(cached.slug) : null
      if (!latest) {
        failed++
        continue
      }
      // Heal markets linked before backfill existed: a series with ≤1 point has
      // no provider history yet, so fill everything older than its first point.
      // Self-disabling — once backfilled the count is >1 and this never re-runs.
      if (latest.historyId) {
        const count = await prisma.externalMarketPriceSnapshot.count({
          where: { marketId: cached.id },
        })
        if (count <= 1) {
          const first = await prisma.externalMarketPriceSnapshot.findFirst({
            where: { marketId: cached.id },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          })
          await backfillMarketHistory(cached.id, latest.historyId, first?.createdAt ?? new Date())
        }
      }
      // Only record a new snapshot when the price actually moved — an unconditional
      // create-every-run turned a flat market into a dot-per-cron-tick plateau on
      // the probability chart. lastSyncedAt/resolution still update every run.
      const lastSnapshot = await prisma.externalMarketPriceSnapshot.findFirst({
        where: { marketId: cached.id },
        orderBy: { createdAt: 'desc' },
        select: { probability: true },
      })
      const priceChanged = lastSnapshot?.probability !== latest.yesProbability
      await prisma.$transaction([
        ...(priceChanged
          ? [
              prisma.externalMarketPriceSnapshot.create({
                data: { marketId: cached.id, probability: latest.yesProbability },
              }),
            ]
          : []),
        prisma.externalMarket.update({
          where: { id: cached.id },
          data: {
            // Rewrite the stored URL every sync so rows persisted with the old
            // market-slug-only path heal themselves on the next cron tick; no
            // separate backfill. Cheap: it's the same row we already touch.
            url: latest.url,
            resolved: latest.closed,
            resolvedOutcome: latest.resolvedOutcome,
            endDate: latest.endDate,
            lastSyncedAt: new Date(),
          },
        }),
      ])
      synced++
      await checkMarketDivergence(cached.predictions ?? [], latest.yesProbability)
    } catch (err) {
      log.error({ marketId: cached.id, err: String(err) }, 'Failed to sync market')
      failed++
    }
  }

  log.info({ total: markets.length, synced, failed }, 'External-market sync complete')
  return { synced, failed }
}

type DivergenceCandidate = {
  id: string
  claimText: string
  slug: string | null
  externalMarketInverted: boolean
  marketDivergenceAlertAt: Date | null
}

/**
 * For every prediction linked to a just-synced market, compare the market's
 * implied probability (inverted per-prediction if the link asks the opposite
 * question) against our latest Oracle estimate. Alerts once when the gap first
 * crosses MARKET_DIVERGENCE_THRESHOLD_PTS, then stays quiet until the gap
 * closes — re-arming for a later re-crossing. Best-effort, never throws.
 */
async function checkMarketDivergence(
  predictions: DivergenceCandidate[],
  marketYesProbability: number,
): Promise<void> {
  for (const p of predictions) {
    try {
      const marketProbability = p.externalMarketInverted ? 100 - marketYesProbability : marketYesProbability
      const anchor = await getLatestEvidenceEstimate(p.id)
      if (!anchor) continue

      const gapPts = Math.abs(marketProbability - anchor.externalProbability)

      if (gapPts > MARKET_DIVERGENCE_THRESHOLD_PTS && p.marketDivergenceAlertAt === null) {
        // Atomic claim-then-notify: only the runner that actually flips this
        // row from null → set sends the alert, so an overlapping cron run
        // (retry, manual trigger) can't double-fire for the same crossing.
        const claimed = await prisma.prediction.updateMany({
          where: { id: p.id, marketDivergenceAlertAt: null },
          data: { marketDivergenceAlertAt: new Date() },
        })
        if (claimed.count > 0) {
          notifyMarketDivergence({ id: p.id, claimText: p.claimText, slug: p.slug }, marketProbability, anchor.externalProbability, gapPts)
        }
      } else if (gapPts <= MARKET_DIVERGENCE_REARM_PTS && p.marketDivergenceAlertAt !== null) {
        await prisma.prediction.update({ where: { id: p.id }, data: { marketDivergenceAlertAt: null } })
      }
    } catch (err) {
      log.error({ predictionId: p.id, err: String(err) }, 'Failed to check market divergence')
    }
  }
}

/**
 * Suggest candidate markets across providers for a forecast's claim text.
 * Suggestion only — an admin/creator confirms. Best-effort.
 */
export async function suggestMarkets(query: string, limit = 5): Promise<MarketSuggestion[]> {
  const q = query.trim()
  if (!q) return []
  const perProvider = await Promise.all(PROVIDERS.map(p => p.suggest(q, limit)))
  return perProvider.flat().slice(0, limit)
}

/**
 * Ranked suggestions for a forecast's claim (the admin "Suggest matches" panel):
 * build a keyword-reduced query from the claim + extracted entities, search each
 * provider, then re-rank candidates by cosine similarity to the full claim
 * (deadline-weighted) so the closest question floats to the top. Only candidates
 * whose raw cosine clears PANEL_MATCH_FLOOR are returned — a claim with no real
 * market equivalent yields [] rather than the 5 least-bad markets. Each returned
 * candidate carries its 0–100 match score. Suppressed entirely when embeddings
 * are unavailable (an unscored keyword hit can't be trusted). Best-effort.
 */
export async function suggestMarketsForClaim(
  claimText: string,
  entities: string[] = [],
  limit = 5,
  deadline?: Date | null,
): Promise<MarketSuggestion[]> {
  const query = buildMarketSearchQuery(claimText, entities)
  if (!query) return []

  const candidates = await suggestMarkets(query, 15)
  if (candidates.length === 0) return []

  // Without embeddings we can't judge relevance; showing unscored keyword hits is
  // exactly what surfaced unrelated markets, so suppress rather than guess.
  const claimVec = await embedText(claimText.trim())
  if (!claimVec) return []

  const vecs = await Promise.all(candidates.map(c => embedText(c.question)))
  return candidates
    .map((c, i) => {
      const cosine = vecs[i] ? cosineSimilarity(claimVec, vecs[i]!) : 0
      return {
        // Show the semantic match (raw cosine); deadline only re-ranks below.
        candidate: { ...c, score: Math.round(cosine * 100) },
        cosine,
        rank: cosine * deadlineWeight(c.endDate, deadline),
      }
    })
    .filter(s => s.cosine >= PANEL_MATCH_FLOOR)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(s => s.candidate)
}

/** A keyword candidate that cleared the embedding-similarity bar, plus its cached id. */
export interface MarketMatch extends MarketSuggestion {
  externalMarketId: string
  providerLabel: string
  /** Cosine similarity to the claim, 0–100. */
  score: number
}

/**
 * Soft multiplicative weight in (0, 1] that penalizes a candidate market whose
 * resolution date sits far from the forecast's deadline. A near-identical
 * question resolving a year off (e.g. a 2027 Polymarket market matched to a 2026
 * forecast) thus ranks below a correctly-dated match instead of auto-linking.
 * Within GRACE days the weight is 1; beyond it it decays as 1/(1 + over/DECAY).
 * Returns 1 when either date is unknown — we can't judge, so don't penalize.
 */
export function deadlineWeight(
  endDate: Date | null | undefined,
  deadline: Date | null | undefined,
): number {
  if (!endDate || !deadline) return 1
  const gapDays = Math.abs(endDate.getTime() - deadline.getTime()) / MS_PER_DAY
  const over = Math.max(0, gapDays - DEADLINE_GRACE_DAYS)
  return 1 / (1 + over / DEADLINE_DECAY_DAYS)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/**
 * Suggest-on-create: keyword-prefilter candidate markets for a claim, embed the
 * claim + each candidate question, and return the single best match if its cosine
 * similarity clears MATCH_THRESHOLD ("very similar / same question"). The winning
 * market is cached so the returned `externalMarketId` can be linked directly.
 * Best-effort — returns null on no candidates, no embeddings, or no strong match.
 */
export async function suggestMarketMatch(
  claimText: string,
  deadline?: Date | null,
): Promise<MarketMatch | null> {
  const q = claimText.trim()
  if (q.length < 10) return null

  const candidates = await suggestMarkets(buildMarketSearchQuery(q), MATCH_CANDIDATES)
  if (candidates.length === 0) return null

  const claimVec = await embedText(q)
  if (!claimVec) return null

  const candidateVecs = await Promise.all(candidates.map(c => embedText(c.question)))

  let best: { cand: MarketSuggestion; score: number } | null = null
  for (let i = 0; i < candidates.length; i++) {
    const vec = candidateVecs[i]
    if (!vec) continue
    // Deadline-adjusted so a same-question market resolving a year off can't
    // clear the auto-link threshold (the Knicks 2026↔2027 mislink).
    const score = cosineSimilarity(claimVec, vec) * deadlineWeight(candidates[i].endDate, deadline)
    if (!best || score > best.score) best = { cand: candidates[i], score }
  }

  if (!best || best.score < MATCH_THRESHOLD) return null

  const { cand, score } = best
  // Cache the winner so we have an id to link.
  const market = await resolveMarketByUrl(cand.url)
  if (!market) return null

  return {
    ...cand,
    externalMarketId: market.id,
    providerLabel: PROVIDER_LABEL[cand.provider] ?? cand.provider,
    score: Math.round(score * 100),
  }
}
