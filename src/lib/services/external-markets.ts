import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { embedText } from '@/lib/services/embedding'
import type { ExternalMarket, MarketProvider as MarketProviderEnum } from '@prisma/client'

const log = createLogger('external-markets')

const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const FETCH_TIMEOUT_MS = 8_000
/** Cosine similarity above which a market is treated as "the same question". */
const MATCH_THRESHOLD = 0.8
/** How many keyword candidates to embed-and-rank per suggest. */
const MATCH_CANDIDATES = 8

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
}

/** Lightweight candidate returned by the suggestion helper. */
export interface MarketSuggestion {
  provider: ProviderId
  externalId: string
  slug: string
  question: string
  yesProbability: number
  url: string
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

/** Fetch JSON from Gamma with a timeout; returns null on any failure. */
async function gammaFetch<T>(path: string): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${GAMMA_BASE}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      log.warn({ path, status: res.status }, 'Gamma request failed')
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    log.warn({ path, err: String(err) }, 'Gamma request errored')
    return null
  } finally {
    clearTimeout(timer)
  }
}

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

/** Map a raw Gamma market row into the normalized shape. Returns null if unusable. */
export function normalizeGammaMarket(raw: Record<string, unknown>): NormalizedMarket | null {
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

  return {
    provider: 'POLYMARKET',
    externalId,
    slug,
    url: `https://polymarket.com/event/${slug}`,
    question,
    outcomes,
    yesProbability,
    endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
    closed,
    resolvedOutcome,
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
    if (!rows || rows.length === 0) return null
    return normalizeGammaMarket(rows[0])
  },

  async suggest(query: string, limit: number): Promise<MarketSuggestion[]> {
    // Use Polymarket's purpose-built search rather than `/markets?_q=` (which
    // ignores the query and just returns the highest-volume markets). Each event
    // carries a `markets[]` whose rows are shaped like Gamma market rows, so we
    // reuse normalizeGammaMarket. Open markets only — closed ones can't be linked.
    const collect = async (q: string): Promise<MarketSuggestion[]> => {
      const data = await gammaFetch<{ events?: { markets?: Record<string, unknown>[] }[] }>(
        `/public-search?q=${encodeURIComponent(q)}`,
      )
      const out: MarketSuggestion[] = []
      const seen = new Set<string>()
      for (const ev of data?.events ?? []) {
        for (const raw of ev.markets ?? []) {
          const m = normalizeGammaMarket(raw)
          if (!m || m.closed || seen.has(m.externalId)) continue
          seen.add(m.externalId)
          out.push({
            provider: m.provider,
            externalId: m.externalId,
            slug: m.slug,
            question: m.question,
            yesProbability: m.yesProbability,
            url: m.url,
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

  // Seed an initial price snapshot so the forecast history chart's "Market" line
  // shows as soon as a market is linked/imported, instead of staying empty until
  // the first hourly sync cron happens to run (GitHub schedules are irregular).
  // Only when none exist yet — the hourly sync owns the ongoing time series.
  const snapshotCount = await prisma.externalMarketPriceSnapshot.count({
    where: { marketId: market.id },
  })
  if (snapshotCount === 0) {
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
    select: { id: true, slug: true, externalId: true, provider: true },
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
      await prisma.$transaction([
        prisma.externalMarketPriceSnapshot.create({
          data: { marketId: cached.id, probability: latest.yesProbability },
        }),
        prisma.externalMarket.update({
          where: { id: cached.id },
          data: {
            resolved: latest.closed,
            resolvedOutcome: latest.resolvedOutcome,
            endDate: latest.endDate,
            lastSyncedAt: new Date(),
          },
        }),
      ])
      synced++
    } catch (err) {
      log.error({ marketId: cached.id, err: String(err) }, 'Failed to sync market')
      failed++
    }
  }

  log.info({ total: markets.length, synced, failed }, 'External-market sync complete')
  return { synced, failed }
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
 * provider, then — when embeddings are available — re-rank candidates by cosine
 * similarity to the full claim so the closest question floats to the top. Falls
 * back to raw search order if embeddings are unavailable. Best-effort.
 */
export async function suggestMarketsForClaim(
  claimText: string,
  entities: string[] = [],
  limit = 5,
): Promise<MarketSuggestion[]> {
  const query = buildMarketSearchQuery(claimText, entities)
  if (!query) return []

  const candidates = await suggestMarkets(query, 15)
  if (candidates.length <= 1) return candidates.slice(0, limit)

  const claimVec = await embedText(claimText.trim())
  if (!claimVec) return candidates.slice(0, limit)

  const vecs = await Promise.all(candidates.map(c => embedText(c.question)))
  return candidates
    .map((c, i) => ({ c, score: vecs[i] ? cosineSimilarity(claimVec, vecs[i]!) : -1 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.c)
}

/** A keyword candidate that cleared the embedding-similarity bar, plus its cached id. */
export interface MarketMatch extends MarketSuggestion {
  externalMarketId: string
  providerLabel: string
  /** Cosine similarity to the claim, 0–100. */
  score: number
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
export async function suggestMarketMatch(claimText: string): Promise<MarketMatch | null> {
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
    const score = cosineSimilarity(claimVec, vec)
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
