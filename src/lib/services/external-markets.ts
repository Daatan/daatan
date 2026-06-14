import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import type { ExternalMarket, MarketProvider as MarketProviderEnum } from '@prisma/client'

const log = createLogger('external-markets')

const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const FETCH_TIMEOUT_MS = 8_000

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
    const rows = await gammaFetch<Record<string, unknown>[]>(
      `/markets?closed=false&active=true&limit=${limit}&order=volume24hr&ascending=false&_q=${encodeURIComponent(query)}`,
    )
    if (!rows) return []
    const out: MarketSuggestion[] = []
    for (const raw of rows) {
      const m = normalizeGammaMarket(raw)
      if (!m) continue
      out.push({
        provider: m.provider,
        externalId: m.externalId,
        slug: m.slug,
        question: m.question,
        yesProbability: m.yesProbability,
        url: m.url,
      })
    }
    return out.slice(0, limit)
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
  return prisma.externalMarket.upsert({
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
