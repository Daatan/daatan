import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import type { PolymarketMarket } from '@prisma/client'

const log = createLogger('polymarket')

const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const FETCH_TIMEOUT_MS = 8_000

/**
 * Read-only Polymarket integration.
 *
 * Phase 1: resolve a market from a pasted URL (admin linking), cache it, and
 * periodically snapshot its YES probability so the forecast history chart can
 * plot a "Market" line alongside the community and Oracle estimates.
 *
 * Source: the public Gamma API (`gamma-api.polymarket.com/markets`). We use the
 * `outcomePrices` field (last trade / book-derived) — good enough for hourly
 * snapshots. CLOB mid-price is a later precision upgrade.
 */

/** Normalized shape we care about, decoded from a raw Gamma market row. */
export interface NormalizedMarket {
  conditionId: string
  slug: string
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

/** Lightweight candidate returned by the AI/keyword suggestion helper. */
export interface MarketSuggestion {
  conditionId: string
  slug: string
  question: string
  yesProbability: number
  url: string
}

/**
 * Extract a Polymarket slug from a pasted URL or accept a raw slug.
 * Handles `https://polymarket.com/event/<slug>` and `.../market/<slug>`,
 * trailing slashes, and query strings.
 */
export function parseSlug(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Raw slug (no scheme, no slashes) — accept as-is.
  if (!trimmed.includes('/') && !trimmed.includes(' ')) return trimmed
  try {
    const url = new URL(trimmed)
    if (!url.hostname.includes('polymarket.com')) return null
    const segments = url.pathname.split('/').filter(Boolean)
    // Last path segment is the market slug (event or market route).
    return segments.length > 0 ? segments[segments.length - 1] : null
  } catch {
    return null
  }
}

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

/** Map a raw Gamma market row into our normalized shape. Returns null if unusable. */
export function normalizeGammaMarket(raw: Record<string, unknown>): NormalizedMarket | null {
  const conditionId = typeof raw.conditionId === 'string' ? raw.conditionId : null
  const slug = typeof raw.slug === 'string' ? raw.slug : null
  const question = typeof raw.question === 'string' ? raw.question : null
  if (!conditionId || !slug || !question) return null

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
  // Once closed, the outcome priced at/near 1.0 is the winner.
  let resolvedOutcome: string | null = null
  if (closed) {
    const winnerIdx = prices.findIndex(p => p >= 0.99)
    if (winnerIdx >= 0) resolvedOutcome = outcomes[winnerIdx]
  }

  const endDateRaw = typeof raw.endDate === 'string' ? raw.endDate : null
  const endDate = endDateRaw ? new Date(endDateRaw) : null

  return {
    conditionId,
    slug,
    question,
    outcomes,
    yesProbability,
    endDate: endDate && !isNaN(endDate.getTime()) ? endDate : null,
    closed,
    resolvedOutcome,
  }
}

/** Fetch + normalize a single market by slug. */
export async function fetchMarketBySlug(slug: string): Promise<NormalizedMarket | null> {
  const rows = await gammaFetch<Record<string, unknown>[]>(
    `/markets?slug=${encodeURIComponent(slug)}`,
  )
  if (!rows || rows.length === 0) return null
  return normalizeGammaMarket(rows[0])
}

/** Upsert a normalized market into the cache (keyed by conditionId). */
async function upsertMarket(m: NormalizedMarket): Promise<PolymarketMarket> {
  return prisma.polymarketMarket.upsert({
    where: { conditionId: m.conditionId },
    create: {
      conditionId: m.conditionId,
      slug: m.slug,
      question: m.question,
      outcomes: m.outcomes,
      endDate: m.endDate,
      resolved: m.closed,
      resolvedOutcome: m.resolvedOutcome,
      lastSyncedAt: new Date(),
    },
    update: {
      slug: m.slug,
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
 * Resolve a pasted Polymarket URL into a cached market row for admin confirmation.
 * Returns null if the URL is unparseable or the market can't be fetched.
 */
export async function resolveMarketByUrl(url: string): Promise<PolymarketMarket | null> {
  const slug = parseSlug(url)
  if (!slug) {
    log.warn({ url }, 'Could not parse a Polymarket slug from input')
    return null
  }
  const market = await fetchMarketBySlug(slug)
  if (!market) {
    log.warn({ slug }, 'No Gamma market found for slug')
    return null
  }
  return upsertMarket(market)
}

/**
 * Refresh every cached market that at least one prediction links to: fetch the
 * latest price, write a snapshot, and update resolution status. Best-effort —
 * never throws; logs and continues per market.
 */
export async function syncLinkedMarkets(): Promise<{ synced: number; failed: number }> {
  const markets = await prisma.polymarketMarket.findMany({
    where: { predictions: { some: {} } },
    select: { id: true, slug: true, conditionId: true },
  })

  let synced = 0
  let failed = 0
  for (const cached of markets) {
    try {
      const latest = await fetchMarketBySlug(cached.slug)
      if (!latest) {
        failed++
        continue
      }
      await prisma.$transaction([
        prisma.polymarketPriceSnapshot.create({
          data: { marketId: cached.id, probability: latest.yesProbability },
        }),
        prisma.polymarketMarket.update({
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

  log.info({ total: markets.length, synced, failed }, 'Polymarket sync complete')
  return { synced, failed }
}

/**
 * AI/keyword helper: suggest candidate markets for a forecast's claim text.
 * Suggestion only — does not link anything; an admin confirms. Best-effort.
 */
export async function suggestMarkets(query: string, limit = 5): Promise<MarketSuggestion[]> {
  const q = query.trim()
  if (!q) return []
  const rows = await gammaFetch<Record<string, unknown>[]>(
    `/markets?closed=false&active=true&limit=${limit}&order=volume24hr&ascending=false&_q=${encodeURIComponent(q)}`,
  )
  if (!rows) return []
  const out: MarketSuggestion[] = []
  for (const raw of rows) {
    const m = normalizeGammaMarket(raw)
    if (!m) continue
    out.push({
      conditionId: m.conditionId,
      slug: m.slug,
      question: m.question,
      yesProbability: m.yesProbability,
      url: `https://polymarket.com/event/${m.slug}`,
    })
  }
  return out.slice(0, limit)
}
