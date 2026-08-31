import { createLogger } from '@/lib/logger'
import { notifyOracleSearchUnavailable } from '@/lib/services/telegram'
import { getOracleConfig, oracleFetch, logOracleCall, type OracleCallMeta } from '@/lib/services/oracleClient'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source?: string
  publishedDate?: string
}

const log = createLogger('oracle-search')

const SEARCH_TIMEOUT_MS = 25_000
const HEALTH_TIMEOUT_MS = 5_000

/** Alert threshold shared between the health UI route and the hourly cron. */
export const SEARCH_LOW_CREDITS_THRESHOLD = 100

export interface OracleSearchProviderStatus {
  configured: boolean
  exhausted: boolean
  status: 'ok' | 'error' | 'not_configured' | string
  credits?: number
  error?: string
}

export interface OracleSearchHealthResponse {
  providers: Record<string, OracleSearchProviderStatus>
  overall: 'healthy' | 'degraded' | 'unhealthy' | string
  usable_count: number
}

/**
 * Fetch provider health from the Oracul's /search/health endpoint.
 * Returns null if oracle is not configured or the request fails.
 * Never throws.
 */
export async function getOracleSearchHealth(
  meta: OracleCallMeta = { source: 'health-cron' },
): Promise<OracleSearchHealthResponse | null> {
  const cfg = getOracleConfig()
  if (!cfg) return null

  const t0 = Date.now()
  try {
    const res = await oracleFetch(cfg, '/search/health', { timeoutMs: HEALTH_TIMEOUT_MS })
    if (!res.ok) {
      log.warn({ status: res.status }, 'oracle-search-health: non-OK response')
      void logOracleCall({ callType: 'SEARCH_HEALTH', status: 'ERROR', meta, durationMs: Date.now() - t0, httpStatus: res.status })
      return null
    }
    const data = await res.json() as OracleSearchHealthResponse
    void logOracleCall({ callType: 'SEARCH_HEALTH', status: 'OK', meta, durationMs: Date.now() - t0, httpStatus: res.status })
    return data
  } catch (err) {
    log.warn({ err }, 'oracle-search-health: request failed')
    void logOracleCall({ callType: 'SEARCH_HEALTH', status: 'ERROR', meta, durationMs: Date.now() - t0 })
    return null
  }
}

interface OracleSearchResult {
  title: string
  url: string
  snippet: string
  source: string
  published_date: string
}

interface OracleSearchResponse {
  query: string
  results: OracleSearchResult[]
  count: number
  /** Provider that served this request (e.g. "dataforseo", "gdelt", "ddg"). "none" means no named provider claimed the result. */
  provider: string
  /** Ordered list of providers attempted before the successful one. */
  provider_chain: string[]
}

/**
 * Search via the Oracul's /search endpoint, sharing the oracle's provider
 * fallback chain and quota counter with the oracle's own forecast calls.
 *
 * Returns null if:
 * - ORACLE_URL or ORACLE_API_KEY are not configured
 * - The request times out, returns a non-OK status, or throws
 * - The response contains zero results
 *
 * Never throws.
 */
export async function oracleSearch(
  query: string,
  limit: number = 20, // default for ad-hoc calls; use DEFAULT_MAX_ARTICLES for consistent budgets
  options?: { dateFrom?: Date; dateTo?: Date },
  meta: OracleCallMeta = { source: 'other' },
): Promise<SearchResult[] | null> {
  const cfg = getOracleConfig()
  if (!cfg) return null

  const body: Record<string, unknown> = { query, limit }
  if (options?.dateFrom) body.date_from = options.dateFrom.toISOString().slice(0, 10)
  if (options?.dateTo) body.date_to = options.dateTo.toISOString().slice(0, 10)

  const t0 = Date.now()
  try {
    const res = await oracleFetch(cfg, '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: SEARCH_TIMEOUT_MS,
    })

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '(unreadable)')
      log.warn({ status: res.status, body: errorBody, query, durationMs: Date.now() - t0 }, 'oracle-search: non-OK response')
      void logOracleCall({ callType: 'SEARCH', status: 'ERROR', meta, durationMs: Date.now() - t0, httpStatus: res.status, query })
      notifyOracleSearchUnavailable(query)
      return null
    }

    const data: OracleSearchResponse = await res.json()

    if (!data.results || data.results.length === 0) {
      log.debug({ query }, 'oracle-search: empty results')
      void logOracleCall({
        callType: 'SEARCH', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status,
        query, provider: data.provider, providerChain: data.provider_chain, searchEngine: data.provider, resultCount: 0,
      })
      return null
    }

    const durationMs = Date.now() - t0
    log.info({ query, count: data.count, provider: data.provider, providerChain: data.provider_chain, durationMs }, 'oracle-search: success')

    void logOracleCall({
      callType: 'SEARCH', status: 'OK', meta, durationMs, httpStatus: res.status,
      query, provider: data.provider, providerChain: data.provider_chain, searchEngine: data.provider, resultCount: data.results.length,
    })

    return data.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source || undefined,
      publishedDate: r.published_date || undefined,
    }))
  } catch (err) {
    log.warn({ err, query, durationMs: Date.now() - t0 }, 'oracle-search: request failed')
    void logOracleCall({ callType: 'SEARCH', status: 'ERROR', meta, durationMs: Date.now() - t0, query })
    notifyOracleSearchUnavailable(query)
    return null
  }
}
