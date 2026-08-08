import { ClaimArchetype, ClaimDirection } from '@prisma/client'
import { createLogger } from '@/lib/logger'
import {
  getOracleBaseUrl,
  getOracleConfig,
  oracleFetch,
  logOracleCall,
  type OracleCallMeta,
  type OracleTokenUsage,
} from '@/lib/services/oracleClient'

export { recordOracleFallback } from '@/lib/services/oracleClient'

const log = createLogger('oracle')

const EXPECTED_API_VERSION = '0.1'

/**
 * Default Oracle budget: server-to-server and background callers (the news-indexer
 * push route, the retry sweep). A client budget must be strictly LARGER than the
 * server budget it waits on, and retro does not cancel on client disconnect —
 * `_run_forecast_inner` runs to completion and writes into `forecast_cache`. Aborting
 * early therefore saves nothing: we pay for the extraction, discard the answer, and
 * label the row a failure.
 *
 * Derived from retro's OWN server-side `phase=total` log (Oracle box
 * i-00ac444b94c5ff9b2, n=17,006 over 93 days), NOT from daatan's numbers — those are
 * censored by this very timeout and cannot show what they truncate. On the push path
 * (`provider=caller`, n=13,688):
 *
 *   all-time   p50 7.8s · p95 23.1s · p99 25.0s   >12s 17.31%  >30s 0.32%
 *   last 7d    p50 5.7s · p95 12.4s · p99 25.0s   >12s  5.59%  >30s 0.00%  max 25.6s
 *
 * The knee just above 25s is retro's `per_article_timeout_seconds = 25`; its declared
 * `forecast_timeout_seconds = 90` has fired exactly once in those 93 days, so 90 is
 * the wrong number to size against. 30s clears the real clamp with headroom and covers
 * 99.7% of all-time / 100% of the last 7 days.
 *
 * What the old 12s cost: 2,106 ERROR/`timeout` rows at a mean of 12,002ms in 30 days of
 * prod `oracle_call_logs` — 15.3% of all news-indexer forecasts — with a 2,236-row spike
 * in the [12000,12183] bucket against 673 in [11000,11999]. That is right-censoring, not
 * failure: the work completed on retro's side. See daatan#1254.
 *
 * Callers that outlast this one must move with it: news-indexer's push client
 * (`matcher.PUSH_TIMEOUT_SECONDS`, 45s) wraps this whole route.
 */
export const FORECAST_TIMEOUT_MS = 30_000

/**
 * Interactive budget: a user's request is blocked on the answer, so this stays short
 * and the caller falls back to the LLM instead of waiting. It is NOT the default —
 * a new background caller silently discarding completed work (the bug above, invisible
 * for months) is worse than a new interactive caller waiting too long (visible at once).
 *
 * Both current interactive callers race the Oracle against their own wall-clock budget,
 * so a longer Oracle wait would only be abandoned one level up: `forecasts/[id]/context`
 * races the whole estimation at `ESTIMATION_TIMEOUT_MS` (15s), and `express/guess`
 * answers a user typing a claim.
 */
export const INTERACTIVE_FORECAST_TIMEOUT_MS = 12_000

// Bot voting runs in a background cron (bots.yml, ~270s budget) where latency is
// not user-facing, so it tolerates a longer Oracle wait than the interactive
// paths. Consultations are sequential and capped per run (see voting.ts); that
// cap is lowered in step so cap × timeout stays within the run budget. Deliberately
// left at 20s rather than raised to FORECAST_TIMEOUT_MS: cap × timeout must stay
// inside the run budget, so raising it means lowering the cap in voting.ts too.
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
  /** Pre-fetched article body. The Oracle's `ArticleInput.text` — "if omitted, oracle fetches
   *  via trafilatura" — has been wired to its extractor from the start and was never populated
   *  by anything: only 1.5% of its 88,033 article reads were pre-fetched, and 19.0% fell through
   *  to `return fallback`, i.e. the extractor running over title+snippet (~215 chars) instead of
   *  a body news-indexer already holds in S3. ~50% on `t.me`; `lemonde.fr` 100% and `aa.com.tr`
   *  99.8% degraded — publishers that serve the text at ingest and then block a re-fetch.
   *  Degraded articles yield 2.9× fewer claims, so the article-level scalars every lane reduces
   *  from are computed off one sentence.
   *
   *  Only the news-indexer push path fills this (news-indexer#201); search-derived articles have
   *  no archived body to offer. Absent ⇒ the Oracle fetches the origin, exactly as today. */
  text?: string
  /** The article's language (short tag, e.g. ISO 639-1 "he", "ru"). news-indexer knows it
   *  per-source (sources.yaml / telegram config) but never sent it, so the Oracle stances raw
   *  Hebrew/Russian with English prompts and no signal about the input language (daatan#1290).
   *  Forwarded on the wire as `language`; retro's ArticleInput ignores unknown fields until
   *  retro#417 adds it, so sending it now is inert there and safe. */
  language?: string
  /** Gatekeeper verdict news-indexer already computed for this article (its POST /relevance
   *  result). When both are set AND the Oracle's reuse_supplied_relevance flag is on, the Oracle
   *  reuses them instead of re-judging (kills the double-judge; see MATCHING_ARCHITECTURE.md §3).
   *  Only the trigger article carries a verdict; both together or neither. */
  relevance?: number | null
  isPrediction?: boolean | null
}

/** Stored claim temporal metadata, as read off `Prediction`. Optional on every
 *  Oracle call site — retro's direction guard (#244) is fail-open without it.
 *  `claimCreatedAt`/`claimArchetype` bound the settlement window on retro's
 *  side (a 'scheduled' claim can't be settled by an event predating its own
 *  creation — an earlier instance of the recurring event); fail-open too. */
export interface ClaimMeta {
  claimDirection?: ClaimDirection | null
  claimDeadline?: Date | null
  claimCreatedAt?: Date | null
  claimArchetype?: ClaimArchetype | null
}

/** Map to retro's `ForecastRequest.claim_direction` — a strict
 *  `Literal["arrival", "survival"]`. NONE/null must be omitted entirely, not
 *  sent as the literal string "none": retro 422s on any other value. Same
 *  mapping `PoolAggregateRequest.claim_direction` expects (see evidence-pool.ts). */
export function claimDirectionParam(direction: ClaimDirection | null | undefined): 'arrival' | 'survival' | undefined {
  if (direction === ClaimDirection.ARRIVAL) return 'arrival'
  if (direction === ClaimDirection.SURVIVAL) return 'survival'
  return undefined
}

/** Map to retro's `claim_archetype` — a strict lowercase
 *  `Literal["scheduled", "diffuse", "threshold", "none"]`. Unclassified (null)
 *  must be omitted entirely, same contract as `claimDirectionParam`. */
export function claimArchetypeParam(
  archetype: ClaimArchetype | null | undefined,
): 'scheduled' | 'diffuse' | 'threshold' | 'none' | undefined {
  if (archetype === ClaimArchetype.SCHEDULED) return 'scheduled'
  if (archetype === ClaimArchetype.DIFFUSE) return 'diffuse'
  if (archetype === ClaimArchetype.THRESHOLD) return 'threshold'
  if (archetype === ClaimArchetype.NONE) return 'none'
  return undefined
}

/** Per-source signal returned by the Oracle's /forecast endpoint. */
/** One extracted claim as the Oracle emits it (retro's `ClaimDetail`, retro#364) —
 *  the per-claim layer every article-level scalar on `OracleSource` is a reduction
 *  OF. Values are post-resolution: the numbers retro's fusion actually consumed,
 *  so the article-level scalars stay derivable from them.
 *
 *  Stored verbatim on the evidence-pool row (`claimsDetail`, daatan#1235).
 *  Nothing in daatan computes on it yet, and it is never sent back to
 *  `/pool/aggregate` — the estimator keeps its eight-scalar whitelist. */
// A `type` alias, not an `interface`, on purpose: interfaces have no implicit
// index signature, so an interface-typed field would make the whole
// `EnrichedOracleSource` un-assignable to Prisma's `InputJsonValue` — and that
// snapshot is written to a Json column (`ContextSnapshot.oracleSnapshot`).
export type OracleClaimDetail = {
  /** One-sentence neutral summary of the claim. */
  claim: string
  /** The article's verbatim sentence(s) behind the claim, so a persisted claim
   *  stands alone and stays auditable later. */
  quote?: string | null
  /** This claim's own stance [-1, 1]. */
  stance: number
  /** This claim's own certainty [0, 1] — its weight in the within-article mean. */
  certainty: number
  /** Multiplies certainty in the within-article reduction; null ⇒ a neutral 1.0. */
  specificity?: number | null
  /** binary | continuous | range | trend. */
  prediction_type?: string | null
  /** This claim's OWN evidence class — the article-level field is only the most
   *  common one, so mixed-class articles are unattributable above this layer. */
  evidence_class?: 'reported_fact' | 'cited_probability' | 'cited_share' | 'reporting' | 'opinion' | null
  /** An explicit modeled/poll/market probability [0,1] cited for the event. */
  quantitative_estimate?: number | null
  /** The extractor's settlement flag for THIS claim — a lower bar than the
   *  article-level `settled`, which additionally requires settlement grade. */
  settled?: boolean | null
  /** ISO date the article gives for the event itself (or the foreclosing event). */
  event_date?: string | null
  /** This claim's fact-lane value [-1, 1], already precursor-capped in retro. */
  fact_signal?: number | null
  /** Per-claim fact facets. The article-level equivalents ride from the single
   *  dominant claim only, which is why an over-cap interested-party claim diluted
   *  by in-contract siblings is invisible above this layer (retro#378). */
  event_actors?: string | null
  event_target?: string | null
  is_occurrence?: boolean | null
  verified?: boolean | null
}

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
  /** Explicit modeled/poll/market probability this source cited for the event
   *  itself, if any (retro's cited_probability evidence class). */
  quantitative_estimate?: number | null
  /** This source's resolved evidence_class weight (retro S2 cutover) — the
   *  `class_weight[evidence_class]`/certainty-fallback value. */
  evidence_weight?: number | null
  /** Graded topic relevance [0,1] from the gatekeeper; its square multiplies
   *  this source's aggregation weight (Layer C of retro's weight formula). */
  relevance_score?: number | null
  /** This article's most common evidence_class among its extracted claims
   *  (retro #255) — used by the credibility feedback loop to exclude
   *  opinion-class articles from the resolution-outcome signal. */
  evidence_class?: 'reported_fact' | 'cited_probability' | 'cited_share' | 'reporting' | 'opinion' | null
  /** When settled: the ISO date anchoring the settlement (retro #291) — the
   *  outcome's occurrence for a positive settlement, the foreclosing event for
   *  a negative one; null when legitimately undated (post-deadline expiry).
   *  Persisted next to `settled` so pool recomputes can re-validate the vote. */
  settlement_event_date?: string | null
  /** The byline author's OWN directional forecast of the event (retro #308/#309):
   *  +1 the author expects it to happen, -1 they expect it will NOT, 0 they weigh
   *  both sides; null when the author only reports facts. Deliberately SEPARATE
   *  from `stance`/the estimate — carried only for daatan's author-scoring lane;
   *  nothing in the Oracle's aggregation reads it. */
  author_lean?: number | null
  /** How firmly the author commits to `author_lean` [0,1]; null when it is null. */
  author_lean_certainty?: number | null
  /** The FACT-lane counterpart of `stance` (retro #313, Phase 2 un-fusing): what
   *  the REPORTED FACTS alone imply about the event [-1,1], un-fused from author
   *  assertion/framing — a claim-weighted MEAN over the article's fact-bearing
   *  claims (same reduction as `stance`). null on pure opinion. Deliberately
   *  SEPARATE from the estimate: carried only for daatan persistence + the offline
   *  backtest; nothing in the Oracle's aggregation reads it. */
  fact_signal?: number | null
  /** WHO acts in the fact behind `fact_signal`, from the dominant (max |fact_signal|)
   *  claim — for the estimator's actor-pair (dyad) check. null when `fact_signal` is. */
  event_actors?: string | null
  /** The TARGET of the action in the fact behind `fact_signal`, from the dominant
   *  claim; with `event_actors` this is the fact's dyad. null when `fact_signal` is. */
  event_target?: string | null
  /** true when the dominant fact IS the event itself (or its definitive outcome),
   *  false when only a precursor/precondition/escalation. null when `fact_signal` is. */
  is_occurrence?: boolean | null
  /** true when the dominant fact is independently reported, false when only claimed
   *  by an interested party. null when `fact_signal` is. */
  verified?: boolean | null
  /** The article's claims with their per-claim fields intact (retro#364) — the layer
   *  every scalar above is a reduction of. Same order as `claims`, except that
   *  `claims` drops empty summaries while this does not. Persisted as-is
   *  (daatan#1235); nothing in the estimate reads it. */
  claims_detail?: OracleClaimDetail[] | null
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
  /** LLM token usage for this call (docs#57 item 3); nullable/omitted until the
   *  retro side that reports it is deployed, or when usage is unknown. */
  token_usage?: OracleTokenUsage | null
  /** The per-article relevance bar in force for THIS run (retro#393/#394,
   *  forecast_relevance_bar); 0.0 means no bar was applied, /forecast's
   *  historical behaviour. Response-level, not per-source — every source in
   *  this batch was judged under the same bar. Omitted on `/pool/aggregate`,
   *  which never re-judges anything. */
  relevance_bar?: number | null
}

/**
 * WHY `forecast` came back null. Six distinct situations used to be indistinguishable
 * on the evidence-pool row, all stamped `oracle_null` (daatan#1231): 73% of the 200
 * most recent pool fetches (2026-07-31) carried that one string, and the real cause
 * survived only in `OracleCallLog.failureReason` — which the retry sweep never reads.
 *
 * They are not the same fact and they do not deserve the same retry:
 * - `oracle_abstain` — the Oracle RAN and deliberately declined (`insufficient_data`),
 *   most often the gatekeeper rejecting every article. Re-asking with identical input
 *   buys the same answer.
 * - `oracle_timeout` / `oracle_network` — we never got an answer. Worth retrying, but
 *   note what a timeout does NOT mean: retro does not cancel, so the forecast it was
 *   computing still finished. Until daatan#1254 this budget was 12s against a server
 *   whose p99 is 25s, and 15.3% of news-indexer forecasts were recorded as failures at
 *   exactly 12,002ms — a real share of what looked like "the extractor produced
 *   nothing" was pure latency. Now 30s; expect this class to shrink sharply.
 * - `oracle_http` — retro answered non-OK. Worth retrying; a 4xx repeatedly is a bug.
 * - `oracle_unconfigured` — no Oracle URL/key here. Says nothing about the article.
 * - `oracle_placeholder` — retro returned its stub response.
 * - `oracle_no_articles` — ran, but no usable mean / zero articles used.
 *
 * Retry POLICY per class is deliberately NOT changed here — see daatan#1232. This
 * only makes the cause visible on the row, which is the precondition for that work
 * and for measuring whether any funnel fix helped at all.
 */
export type OracleFailureClass =
  | 'oracle_abstain'
  | 'oracle_timeout'
  | 'oracle_network'
  | 'oracle_http'
  | 'oracle_unconfigured'
  | 'oracle_placeholder'
  | 'oracle_no_articles'

/**
 * Every reason that means "a run happened (or was attempted) and produced no
 * estimate" — the split-out descendants of the old single `oracle_null`, plus
 * `oracle_null` itself for rows written before the split.
 *
 * Consumers must match on this SET, never on the literal `'oracle_null'`. The
 * second-strike rule in `pool-retry.ts` did exactly that, so without this a
 * freshly-classified row would never reach `oracle_null_final` and the daily
 * sweep would re-drive it forever.
 */
export const ORACLE_NULL_REASONS: readonly string[] = [
  'oracle_null',
  'oracle_abstain',
  'oracle_timeout',
  'oracle_network',
  'oracle_http',
  'oracle_unconfigured',
  'oracle_placeholder',
  'oracle_no_articles',
]

/**
 * The subset of {@link ORACLE_NULL_REASONS} that says something about the ARTICLES
 * rather than about the wire: the Oracle received them, ran, and produced no
 * estimate anyway. Only these justify retiring a row (daatan#1253).
 *
 * Everything excluded here is a fact about us, not about the evidence:
 * `oracle_timeout` / `oracle_network` never got an answer at all (and retro does
 * not cancel, so the forecast probably completed after we hung up), `oracle_http`
 * is retro erroring, `oracle_unconfigured` means we never asked, and
 * `oracle_placeholder` is a stub. `oracle_null` is excluded too — it is the
 * pre-split string that CONFLATES all six causes, so a row carrying it has an
 * unknown cause, and "unknown" is not "attributable".
 *
 * Consequence worth knowing: pre-split rows can no longer reach
 * `oracle_null_final` through the sweep. They keep costing one Oracle look a day
 * until they earn a classified reason. That is the deliberate direction — an
 * extra look costs a fraction of a cent, a wrongly-retired article is lost
 * silently and forever.
 */
export const ATTRIBUTABLE_NULL_REASONS: readonly string[] = ['oracle_abstain', 'oracle_no_articles']

/**
 * The null classes where WE hung up (or the wire broke) on a run retro very likely
 * finished anyway — the exact opposite end of {@link ATTRIBUTABLE_NULL_REASONS}.
 *
 * retro does not cancel on client disconnect: `_run_forecast_inner` runs to
 * completion and `forecast_cache.set` stores the answer for `cache_ttl_seconds`
 * (3600). So a row carrying one of these has, with high probability, a finished
 * forecast sitting in retro's memory that we paid a Haiku 4.5 extraction for and
 * never read. Two things follow, and both live off this constant:
 *
 *  - **the label is not a verdict** (daatan#1261). `oracle_timeout` says nothing
 *    about the article, so it must not earn the 24h re-claim backoff that exists
 *    to stop us paying repeatedly for an article that genuinely always nulls. See
 *    `TRANSPORT_RECLAIM_BACKOFF_MS` in evidence-pool.ts.
 *  - **the work is recoverable** (daatan#1262). Re-asking with the IDENTICAL
 *    article set inside the TTL is served from `forecast_cache` at zero LLM cost.
 *    See `scheduleOracleReask` in oracle-backfill.ts.
 *
 * `oracle_http` and `oracle_unconfigured` are deliberately NOT here. They are also
 * facts about us rather than the article, but neither leaves a completed run behind
 * to collect: a 4xx/5xx means retro rejected or failed the request, and
 * unconfigured means we never sent one.
 */
export const TRANSPORT_NULL_REASONS: readonly OracleFailureClass[] = ['oracle_timeout', 'oracle_network']

/** True when `reason` names a run we never got an answer to, rather than a verdict
 *  about the articles. Accepts a raw `statusReason` string off a pool row. */
export function isTransportNullReason(reason: string | null | undefined): boolean {
  return reason != null && (TRANSPORT_NULL_REASONS as readonly string[]).includes(reason)
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
  /** Why `forecast` is null — set on every null path, absent when a forecast came
   *  back. Callers stamp it onto the evidence-pool row so the cause survives where
   *  the retry sweep can see it. See {@link OracleFailureClass}. */
  failureClass?: OracleFailureClass
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

/** One (byline author, outlet) row in the author-shadow scoring board. Shadow scoring —
 *  informational track record only, never consumed by the live forecast. */
export interface OracleAuthorShadowEntry {
  id: string
  author: string
  outlet_name: string
  brier_score: number
  skill_mu: number
  skill_sigma: number
  skill_conservative: number
  predictions: number
  articles: number
}

/** Response from GET /leaderboard/author-shadow. */
export interface OracleAuthorShadowResponse {
  authors: OracleAuthorShadowEntry[]
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
  options?: { articles?: ArticleInput[]; timeoutMs?: number } & ClaimMeta,
  meta: OracleCallMeta = { source: 'other' },
): Promise<OracleForecastResult> => {
  const cfg = getOracleConfig()
  if (!cfg) {
    log.debug('Oracle not configured — skipping')
    return { forecast: null, logId: null, failureClass: 'oracle_unconfigured' }
  }

  const t0 = Date.now()
  try {
    const res = await oracleFetch(cfg, '/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        max_articles: DEFAULT_MAX_ARTICLES,
        // Log correlation only (retro #273) — lets gate_reused log lines join
        // directly to a context_snapshots row instead of by timestamp.
        ...(meta.predictionId ? { prediction_id: meta.predictionId } : {}),
        // Arms retro #244's direction guard. Both fail-open on retro's side
        // when absent — omit rather than send a value it would 422 on (NONE
        // is not a valid claim_direction).
        ...(claimDirectionParam(options?.claimDirection)
          ? { claim_direction: claimDirectionParam(options?.claimDirection) }
          : {}),
        ...(options?.claimDeadline ? { claim_deadline: options.claimDeadline.toISOString() } : {}),
        // Settlement-window metadata (retro #291) — bounds which events may
        // settle the claim; fail-open on retro's side when absent.
        ...(options?.claimCreatedAt ? { claim_created_at: options.claimCreatedAt.toISOString() } : {}),
        ...(claimArchetypeParam(options?.claimArchetype)
          ? { claim_archetype: claimArchetypeParam(options?.claimArchetype) }
          : {}),
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
                // Skips the Oracle's own trafilatura fetch for this article. Omitted (not sent
                // as null) when we have no body: the Oracle branches on falsiness, so either
                // spelling works, but omitting keeps an un-archived article's payload
                // byte-identical to what it sends today.
                ...(a.text ? { text: a.text } : {}),
                // Language hint for the Oracle's gatekeeper/extractor prompts. retro's pydantic
                // ArticleInput has no `language` field yet and ignores extras (default
                // extra="ignore"), so this is inert on the wire until retro#417 lands.
                ...(a.language ? { language: a.language } : {}),
                // Reuse the caller-supplied gatekeeper verdict (both fields, or neither) so the
                // Oracle can skip re-judging — see ArticleInput. Inert until the Oracle's
                // reuse_supplied_relevance flag is on; absent → the Oracle judges as today.
                ...(a.relevance != null && a.isPrediction != null
                  ? { relevance: a.relevance, is_prediction: a.isPrediction }
                  : {}),
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
      return { forecast: null, logId, failureClass: 'oracle_http' }
    }

    const data: OracleForecastResponse = await res.json()
    const searchEngine = data.provider ?? data.provider_chain?.join(', ') ?? null

    // The Oracle deliberately abstained: it ran but the evidence didn't bear on
    // the claim (off-topic, all-hedged, or too thin). Signal this distinctly so
    // the caller can show "insufficient evidence" instead of guessing a number.
    if (data.insufficient_data) {
      log.debug({ reason: data.reason, articlesUsed: data.articles_used }, 'Oracle abstained — insufficient evidence')
      const logId = await logOracleCall({ callType: 'FORECAST', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, resultCount: data.articles_used, failureReason: emptyFailureReason(data.reason), tokenUsage: data.token_usage })
      return { forecast: null, logId, insufficientData: true, failureClass: 'oracle_abstain' }
    }

    if (data.placeholder) {
      log.debug('Oracle returned placeholder response — no real forecast available')
      const logId = await logOracleCall({ callType: 'FORECAST', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, failureReason: emptyFailureReason(data.reason), tokenUsage: data.token_usage })
      return { forecast: null, logId, failureClass: 'oracle_placeholder' }
    }

    if (typeof data.mean !== 'number' || data.articles_used === 0) {
      log.debug({ articlesUsed: data.articles_used, reason: data.reason }, 'Oracle returned no usable articles')
      const logId = await logOracleCall({ callType: 'FORECAST', status: 'EMPTY', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, resultCount: data.articles_used, failureReason: emptyFailureReason(data.reason), tokenUsage: data.token_usage })
      return { forecast: null, logId, failureClass: 'oracle_no_articles' }
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
    const logId = await logOracleCall({ callType: 'FORECAST', status: 'OK', meta, durationMs: Date.now() - t0, httpStatus: res.status, query: question, searchEngine, resultCount: data.articles_used, tokenUsage: data.token_usage })
    return { forecast: data, logId }
  } catch (err) {
    log.warn({ err, durationMs: Date.now() - t0 }, 'Oracle request failed')
    // 12s client budget against retro's own 90s — an unknown share of what the pool
    // recorded as "the extractor produced nothing" was this line, and nothing on the
    // row said so (daatan#1231).
    const reason = transportFailureReason(err)
    const logId = await logOracleCall({ callType: 'FORECAST', status: 'ERROR', meta, durationMs: Date.now() - t0, query: question, failureReason: reason })
    return { forecast: null, logId, failureClass: reason === 'timeout' ? 'oracle_timeout' : 'oracle_network' }
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
  options?: { timeoutMs?: number } & ClaimMeta,
): Promise<number | null> => {
  const { forecast } = await getOracleForecast(
    question,
    { timeoutMs: options?.timeoutMs, claimDirection: options?.claimDirection, claimDeadline: options?.claimDeadline },
    meta,
  )
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
 * Author-shadow scoring board: per (byline author, outlet) Brier + TrueSkill-style rating
 * computed from `author_lean` extractions, resolved against outcomes (retro PR #315). Shadow
 * scoring — informational only, never feeds the live forecast estimate.
 *
 * Returns null if the Oracle is not configured or the request fails. Never throws.
 */
export const getAuthorShadowLeaderboard = async (
  meta: OracleCallMeta = { source: 'source-leaderboard' },
): Promise<OracleAuthorShadowResponse | null> => {
  const cfg = getOracleConfig()
  if (!cfg) return null

  const t0 = Date.now()
  try {
    const res = await oracleFetch(cfg, '/leaderboard/author-shadow', { timeoutMs: HEALTH_TIMEOUT_MS })
    if (!res.ok) {
      void logOracleCall({ callType: 'LEADERBOARD', status: 'ERROR', meta, durationMs: Date.now() - t0, httpStatus: res.status })
      return null
    }
    const data = await res.json() as OracleAuthorShadowResponse
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
