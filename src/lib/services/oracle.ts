import { createLogger } from '@/lib/logger'
import {
  getOracleBaseUrl,
  getOracleConfig,
  oracleFetch,
  logOracleCall,
  type OracleCallMeta,
} from '@/lib/services/oracleClient'

export { recordOracleFallback } from '@/lib/services/oracleClient'

const log = createLogger('oracle')

const EXPECTED_API_VERSION = '0.1'
const FORECAST_TIMEOUT_MS = 12_000
// Bot voting runs in a background cron (bots.yml, ~270s budget) where latency is
// not user-facing, so it tolerates a longer Oracle wait than the interactive
// paths. Consultations are sequential and capped per run (see voting.ts); that
// cap is lowered in step so cap × timeout stays within the run budget.
export const BOT_FORECAST_TIMEOUT_MS = 20_000
const HEALTH_TIMEOUT_MS = 5_000
/**
 * Maximum articles fetched per search query and passed to the oracle for forecasting.
 * Used by: context/route.ts, expressPrediction.ts, and the /forecast max_articles param.
 * To change the budget for all these callers, edit this one value.
 */
export const DEFAULT_MAX_ARTICLES = 15

export interface ArticleInput {
  url: string
  title: string
  snippet: string
  source?: string
  publishedDate?: string
}

/** Per-source signal returned by the Oracle's /forecast endpoint. */
export interface OracleSource {
  source_id: string
  source_name: string
  url: string
  /** Stance in [-1, 1]: positive = supports YES, negative = supports NO. */
  stance: number
  /** Certainty in [0, 1]: how confident this source is. */
  certainty: number
  /** Credibility weight from the leaderboard; 1.0 = neutral. */
  credibility_weight: number
  claims: string[]
  /** True when this source reports the event's outcome as an accomplished fact. */
  settled?: boolean | null
}

/** Full response from POST /forecast. */
export interface OracleForecastResponse {
  question: string
  /** Aggregated stance in [-1, 1]. Map to [0, 1] probability via (mean+1)/2. */
  mean: number
  std: number
  ci_low: number
  ci_high: number
  articles_used: number
  sources: OracleSource[]
  /** True if the Oracle couldn't produce a real forecast (stub response). */
  placeholder: boolean
  /** True when the Oracle ran but had no usable articles (mean/ci are not a real estimate). */
  insufficient_data?: boolean
  /** Why the Oracle couldn't answer; see the failure-reason vocabulary on OracleCallLog. */
  reason?: string
  /** Search provider that served the underlying article search (retro /forecast & /search; may be 'caller'/'search_cache'/'none'). */
  provider?: string
  /** Ordered search fallback chain retro tried, in order. */
  provider_chain?: string[]
  /** True when enough independent sources report the event's outcome as an
   *  accomplished fact: mean/ci are pinned near the boundary and the forecast
   *  is a resolution candidate. */
  settled?: boolean
}

/** Result of {@link getOracleForecast}: the forecast (null when unusable) plus the
 *  id of the logged call, so a caller can attribute its LLM fallback to it. */
export interface OracleForecastResult {
  forecast: OracleForecastResponse | null
  logId: string | null
  /** True when the Oracle ran but deliberately abstained (insufficient_data): the
   *  evidence didn't bear on the claim. Distinct from `forecast: null` due to a
   *  transport error / not-configured. Callers should surface "insufficient
   *  evidence" rather than substituting an ungrounded estimate. */
  insufficientData?: boolean
}

/**
 * Map the Oracle's `reason` (EMPTY responses) onto the OracleCallLog vocabulary.
 * Retro's internal `timeout` is renamed to `oracle_timeout` so it never collides
 * with a daatan-side client/transport timeout. */
function emptyFailureReason(reason: string | undefined): string {
  if (!reason) return 'insufficient_data'
  return reason === 'timeout' ? 'oracle_timeout' : reason
}

/** Classify a thrown fetch error into a transport failure reason. AbortSignal.timeout()
 *  rejects with a `TimeoutError`; everything else is treated as a network failure. */
function transportFailureReason(err: unknown): 'timeout' | 'network' {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    ? 'timeout'
    : 'network'
}

interface OracleHealthResponse {
  status: string
  version?: string
  leaderboard_sources?: number
}

/** One entry in the Oracle leaderboard. */
export interface OracleLeaderboardEntry {
  id: string
  name?: string
  skill_conservative?: number
  /** @deprecated renamed to skill_conservative */
  trueskill_conservative?: number
  elo?: number
  brier_score?: number
  [key: string]: unknown
}

/** Response from GET /leaderboard. */
export interface OracleLeaderboardResponse {
  sources: OracleLeaderboardEntry[]
  count: number
}

/**
 * Call the TruthMachine Oracle API and return the full forecast payload plus the
 * id of the logged call.
 *
 * `forecast` is `null` if the Oracle is not configured, returned a placeholder
 * response, had no usable articles, or failed for any reason (timeout,
 * non-OK status, network error). `logId` is the OracleCallLog row id (null when
 * unconfigured or the log write failed) so a caller that then takes the LLM
 * fallback can attribute it via {@link recordOracleFallback}. Never throws.
 */
export const getOracleForecast = async (
  question: string,
  options?: { articles?: ArticleInput[]; timeoutMs?: number },
  meta: OracleCallMeta = { source: 'other' },
): Promise<OracleForecastResult> => {
  const cfg = getOracleConfig()
  if (!cfg) {
    log.debug('Oracle not configured — skipping')
    return { forecast: null, logId: null }
  }

  const t0 = Date.now()
  try {
    const res = await oracleFetch(cfg, '/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        max_articles: DEFAULT_MAX_ARTICLES,
        // Oracle's ArticleInput uses snake_case `published_date`; map from our
        // camelCase `publishedDate` so recency weighting on the Oracle side
        // actually receives the date (otherwise it's dropped and treated as now).
        ...(options?.articles?.length
          ? {
              articles: options.articles.map(a => ({
                url: a.url,
                title: a.title,
                snippet: a.snippet,
                source: a.source,
                published_date: a.publishedDate,
              })),
            }
          : {}),
      }),
      timeoutMs: options?.timeoutMs ?? FORECAST_TIMEOUT_MS,
    })

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '(unreadable)')
      log.warn({ status: res.status, body: errorBody, durationMs: Date.now() - t0 }, 'Oracle returned non-OK status')
      const logId = await logOracleCall({ callType: 'FORECAST', status: 'ERROR', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, failureReason: res.status >= 500 ? 'http_5xx' : 'http_4xx' })
      return { forecast: null, logId }
    }

    const data: OracleForecastResponse = await res.json()
    const searchEngine = data.provider ?? data.provider_chain?.join(', ') ?? null

    // The Oracle deliberately abstained: it ran but the evidence didn't bear on
    // the claim (off-topic, all-hedged, or too thin). Signal this distinctly so
    // the caller can show "insufficient evidence" instead of guessing a number.
    if (data.insufficient_data) {
      log.debug({ reason: data.reason, articlesUsed: data.articles_used }, 'Oracle abstained — insufficient evidence')
      const logId = await logOracleCall({ callType: 'FORECAST', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, resultCount: data.articles_used, failureReason: emptyFailureReason(data.reason) })
      return { forecast: null, logId, insufficientData: true }
    }

    if (data.placeholder) {
      log.debug('Oracle returned placeholder response — no real forecast available')
      const logId = await logOracleCall({ callType: 'FORECAST', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, failureReason: emptyFailureReason(data.reason) })
      return { forecast: null, logId }
    }

    if (typeof data.mean !== 'number' || data.articles_used === 0) {
      log.debug({ articlesUsed: data.articles_used, reason: data.reason }, 'Oracle returned no usable articles')
      const logId = await logOracleCall({ callType: 'FORECAST', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, resultCount: data.articles_used, failureReason: emptyFailureReason(data.reason) })
      return { forecast: null, logId }
    }

    log.info(
      {
        question: question.slice(0, 80),
        mean: data.mean,
        articlesUsed: data.articles_used,
        sources: data.sources.length,
        durationMs: Date.now() - t0,
      },
      'Oracle forecast',
    )
    const logId = await logOracleCall({ callType: 'FORECAST', status: 'OK', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, resultCount: data.articles_used })
    return { forecast: data, logId }
  } catch (err) {
    log.warn({ err, durationMs: Date.now() - t0 }, 'Oracle request failed')
    const logId = await logOracleCall({ callType: 'FORECAST', status: 'ERROR', meta, durationMs: Date.now() - t0, query: question, failureReason: transportFailureReason(err) })
    return { forecast: null, logId }
  }
}

/**
 * Thin back-compat wrapper: returns just the scaled probability in [0, 1],
 * or null if the Oracle path wasn't usable. Prefer `getOracleForecast` when
 * you also want the sources, confidence interval, or the log id.
 */
export const getOracleProbability = async (
  question: string,
  meta: OracleCallMeta = { source: 'other' },
  options?: { timeoutMs?: number },
): Promise<number | null> => {
  const { forecast } = await getOracleForecast(question, { timeoutMs: options?.timeoutMs }, meta)
  if (!forecast) return null
  return (forecast.mean + 1) / 2
}

/**
 * Fetch the live source credibility leaderboard from the Oracle API.
 *
 * The Oracle refreshes this from disk every N seconds, so the data is always
 * current without requiring a server redeploy.  Returns null if the Oracle is
 * not configured or the request fails.  Never throws.
 */
export const getOracleLeaderboard = async (
  meta: OracleCallMeta = { source: 'leaderboard' },
): Promise<OracleLeaderboardResponse | null> => {
  const cfg = getOracleConfig()
  if (!cfg) return null

  const t0 = Date.now()
  try {
    const res = await oracleFetch(cfg, '/leaderboard', { timeoutMs: HEALTH_TIMEOUT_MS })
    if (!res.ok) {
      void logOracleCall({ callType: 'LEADERBOARD', status: 'ERROR', meta, durationMs: Date.now() - t0, httpStatus: res.status })
      return null
    }
    const data = await res.json() as OracleLeaderboardResponse
    void logOracleCall({ callType: 'LEADERBOARD', status: 'OK', meta, durationMs: Date.now() - t0, httpStatus: res.status, resultCount: data.count })
    return data
  } catch {
    void logOracleCall({ callType: 'LEADERBOARD', status: 'ERROR', meta, durationMs: Date.now() - t0 })
    return null
  }
}

/**
 * Check Oracle API health and version compatibility.
 * Returns true if Oracle is reachable and version-compatible.
 * Never throws.
 */
export const checkOracleHealth = async (
  meta: OracleCallMeta = { source: 'health-cron' },
): Promise<boolean> => {
  const baseUrl = getOracleBaseUrl()
  if (!baseUrl) return false

  const t0 = Date.now()
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (!res.ok) {
      void logOracleCall({ callType: 'HEALTH', status: 'ERROR', meta, durationMs: Date.now() - t0, httpStatus: res.status })
      return false
    }

    const data: OracleHealthResponse = await res.json()
    if (data.status !== 'ok') {
      void logOracleCall({ callType: 'HEALTH', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status })
      return false
    }

    if (data.version && !data.version.startsWith(EXPECTED_API_VERSION)) {
      log.warn(
        { expected: EXPECTED_API_VERSION, actual: data.version },
        'Oracle API version mismatch — falling back to LLM',
      )
      void logOracleCall({ callType: 'HEALTH', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status })
      return false
    }

    void logOracleCall({ callType: 'HEALTH', status: 'OK', meta, durationMs: Date.now() - t0, httpStatus: res.status })
    return true
  } catch {
    void logOracleCall({ callType: 'HEALTH', status: 'ERROR', meta, durationMs: Date.now() - t0 })
    return false
  }
}
