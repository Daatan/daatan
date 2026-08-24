import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import { percentToStance, toClaimsDetail, type EnrichedOracleSource } from '@/lib/services/oracle-snapshot'
import type { EvidencePoolArticle, ClaimArchetype, ClaimDirection, PredictionStatus } from '@prisma/client'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'
import { claimArchetypeParam, claimDirectionParam, TRANSPORT_NULL_REASONS } from '@/lib/services/oracle'
import { createLogger } from '@/lib/logger'

const log = createLogger('evidence-pool')

/**
 * Filter fragment for "the current row of each version chain" — a superseded
 * row (`supersededAt` set) is a prior, replaced reading and must not
 * double-count alongside its replacement in any aggregate, public listing or
 * outbound push (daatan#1382). See the schema's `supersededAt` doc comment.
 * Not used by `getPoolThroughput` (deliberately counts every extraction
 * attempt, superseded or not) or the admin evidence-pool listing (deliberately
 * shows the full correction history, daatan#1383).
 */
const CURRENT_VERSION_ONLY = { supersededAt: null } as const

/**
 * The per-forecast evidence pool (retro docs/ORACLE_VARIABLES.md §6 part 2).
 *
 * All three estimate paths (analyze / news-indexer / backfill) write their extracted
 * per-source signals here and then read the pool back to compute the persisted estimate —
 * `recomputeFromPool` aggregates the whole pool rather than trusting the articles a single
 * run happened to score (`resolvePooledEstimate` in pooled-estimate.ts is the shared
 * decision; the news-indexer route inlines the same logic). news-indexer was cut over in
 * v1.60.0 (#1121); analyze and backfill followed once that had run in prod.
 *
 * `excluded` (see getPoolArticles/setArticleExcluded below) is an admin's "ignore this
 * article" switch, and is now genuinely enforced: excluded rows are dropped before the
 * aggregate, so an exclusion actually moves the number on every path.
 *
 * 'retry' marks rows whose latest signal came from the pool-retry sweep
 * (pool-retry.ts) re-driving a stuck FAILED/stale-PENDING claim through extraction.
 */
export type PoolOrigin = 'analyze' | 'news-indexer' | 'backfill' | 'retry' | 'remediate'

/**
 * Write extracted signals onto a batch of already-claimed pool rows, keyed by
 * the exact row id `claimArticleForExtraction`/`claimArticlesForExtraction`
 * returned for each URL (`articleIdByUrl`) — never re-derived by
 * (predictionId, urlHash) here, since after daatan#1381 that pair is no
 * longer unique (a version chain can have several rows) and re-deriving
 * "the current row" at write time could land a slow-to-complete extraction
 * on a row a concurrent, faster correction has since superseded. A source
 * with no entry in the map (nothing claimed it — shouldn't happen for any
 * current caller, all of which build the map from the same claim step that
 * produces `sources`, but defensive rather than a silent no-op) falls back
 * to a version-aware upsert via `upsertCurrentVersion`.
 *
 * Never touches `excluded` — an admin's exclusion decision on an article
 * survives every later re-discovery. Never touches `contentHash`/`version`/
 * `supersedesId`/`supersededAt` — those are exclusively `claimArticleForExtraction`'s
 * to set; this only fills in the extraction OUTCOME onto the row the claim
 * step already created/selected.
 */
export async function addArticlesToPool(
  predictionId: string,
  sources: EnrichedOracleSource[],
  origin: PoolOrigin,
  articleIdByUrl: Map<string, string>,
): Promise<void> {
  await Promise.all(
    sources.map(async (s) => {
      const signal = {
        url: s.url,
        title: s.title,
        source: s.sourceName,
        author: s.author,
        personId: s.personId,
        personName: s.personName,
        outletId: s.outletId,
        outletName: s.outletName,
        publishedDate: s.publishedAt,
        stance: s.stance,
        certainty: s.certainty,
        credibilityWeight: s.credibilityWeight,
        claims: s.claims,
        settled: s.settled,
        settlementEventDate: s.settlementEventDate,
        quantitativeEstimate: s.quantitativeEstimate,
        evidenceWeight: s.evidenceWeight,
        relevanceScore: s.relevanceScore,
        relevanceBar: s.relevanceBar,
        extractorModel: s.extractorModel,
        extractorPromptVersion: s.extractorPromptVersion,
        extractorPromptHash: s.extractorPromptHash,
        gatekeeperModel: s.gatekeeperModel,
        gatekeeperPromptVersion: s.gatekeeperPromptVersion,
        gatekeeperPromptHash: s.gatekeeperPromptHash,
        evidenceClass: s.evidenceClass,
        authorLean: s.authorLean,
        authorLeanCertainty: s.authorLeanCertainty,
        factSignal: s.factSignal,
        eventActors: s.eventActors,
        eventTarget: s.eventTarget,
        isOccurrence: s.isOccurrence,
        verified: s.verified,
        facet: s.facet,
        // F1/F15 — deliberately `undefined` (= leave the column alone), NOT
        // DbNull. A path that re-touches a pool row without carrying per-claim
        // data (a recompute, an older Oracle build, a partial response) must
        // not erase per-claim data we already hold: it is unrecoverable, since
        // there is no backfill. This is the daatan#1237 failure mode — "re-
        // extraction nulls fields the response merely omitted" — which the
        // scalar fields above still have and this field deliberately does not.
        claimsDetail: s.claimsDetail ?? undefined,
        origin,
        // Flips a PENDING row (claimed by claimArticleForExtraction, then
        // successfully extracted) to COMPLETE. Deliberately does not touch
        // contentHash — it's already correct from the claim step.
        status: 'COMPLETE' as const,
        statusReason: null,
      }

      const id = articleIdByUrl.get(s.url)
      if (id) {
        await prisma.evidencePoolArticle.update({ where: { id }, data: signal })
        return
      }
      log.warn({ predictionId, url: s.url, origin }, 'event=evidence_pool_write_no_claim_id')
      await upsertCurrentVersion(predictionId, s, origin, signal)
    }),
  )
}

/**
 * Version-aware fallback for `addArticlesToPool` when a source has no
 * claimed row id — mirrors `claimArticleForExtraction`'s versioning
 * transaction (see its own comment) rather than duplicating the old
 * upsert-in-place behavior daatan#1381 removed.
 */
async function upsertCurrentVersion(
  predictionId: string,
  s: EnrichedOracleSource,
  origin: PoolOrigin,
  signal: Record<string, unknown>,
): Promise<void> {
  const urlHash = hashUrl(s.url)
  const current = await prisma.evidencePoolArticle.findFirst({
    where: { predictionId, urlHash, ...CURRENT_VERSION_ONLY },
  })
  if (!current) {
    await prisma.evidencePoolArticle.create({
      data: {
        predictionId,
        url: s.url,
        urlHash,
        origin,
        status: 'COMPLETE',
        // `signal.claimsDetail` is `s.claimsDetail ?? undefined` (see addArticlesToPool's
        // signal above) — undefined on `create()` just omits the column, which defaults
        // to SQL NULL for this nullable Json column same as an explicit Prisma.DbNull
        // would. No separate DbNull default needed here.
        ...signal,
      },
    })
    return
  }
  await prisma.$transaction([
    prisma.evidencePoolArticle.update({ where: { id: current.id }, data: { supersededAt: new Date() } }),
    prisma.evidencePoolArticle.create({
      data: {
        predictionId,
        url: s.url,
        urlHash,
        origin,
        status: 'COMPLETE',
        version: current.version + 1,
        supersedesId: current.id,
        ...signal,
      },
    }),
  ])
}

/** hash(title+snippet) — the only fields news-indexer's webhook (and the
 *  analyze/backfill search results) actually carry; no full article body
 *  reaches daatan. This is what a live-blog update or a corrected headline
 *  changes; a plain re-crawl of a static article stays stable. */
export function hashArticleContent(title: string, snippet: string): string {
  return crypto.createHash('sha256').update(`${title}\n${snippet}`).digest('hex')
}

/** A PENDING claim older than this is treated as abandoned (crashed request,
 *  process killed mid-extraction) and eligible for a fresh claim — comfortably
 *  past the Oracle's own p99 latency (~226s) so it never preempts a genuinely
 *  in-flight call. */
const PENDING_CLAIM_STALE_MS = 10 * 60 * 1000

/**
 * How long a FAILED row is left alone before an organic re-push may re-claim it with
 * IDENTICAL content (daatan#1232).
 *
 * There used to be no gate at all: `{ status: 'FAILED' }` was its own OR-arm, so a row
 * that failed was immediately re-claimable. news-indexer re-pushes the same article set
 * on every poll cycle while its 5-minute cooldown rolls, so an article that always nulls
 * looped FAILED → PENDING → FAILED, burning a full Oracle run (fetch + gatekeeper +
 * extractor) each time. The schema's own comment — "eligible for retry once stale" — was
 * stricter than the code implementing it.
 *
 * 24h, matching `pool-retry`'s `RETRY_MIN_AGE_MS`, so the two retry surfaces cost the same
 * article the same order of budget instead of the organic path being ~288× cheaper to
 * trigger than the sweep it was silently competing with.
 *
 * This gate applies ONLY to re-claims with unchanged content. A content change still
 * re-claims immediately via the `contentHash` arms — that is genuinely new evidence (a
 * live-blog update), not a retry, and it is also the documented escape hatch that keeps
 * terminal rows revivable.
 */
const FAILED_RECLAIM_BACKOFF_MS = 24 * 60 * 60 * 1000

/**
 * The same gate, for a row whose last failure was a TRANSPORT event rather than a
 * verdict (`TRANSPORT_NULL_REASONS` — we hung up, or the wire broke). 60s, not 24h.
 *
 * The 24h backoff above is priced against a specific waste: an article that always
 * nulls, re-pushed every poll cycle, burning a full fetch + gatekeeper + extractor
 * run each time. That pricing assumes the previous run TOLD us something about the
 * article. A client timeout tells us nothing about it — retro does not cancel, so
 * the run we abandoned very likely completed and is sitting in `forecast_cache` for
 * an hour. Charging a wire event 24h of silence was the residual bite of
 * mislabelling it FAILED (daatan#1261): it is also precisely what made daatan#1262
 * impossible by construction, since the cache TTL is 1h and the earliest re-ask on
 * either retry surface was 24h — the two windows could never overlap.
 *
 * 60s rather than zero so a hard-down Oracle still can't be hot-looped by
 * news-indexer's re-push cycle, and comfortably shorter than `REASK_DELAY_MS`
 * (120s) so our own scheduled re-ask is never refused by this gate as `unchanged`.
 */
const TRANSPORT_RECLAIM_BACKOFF_MS = 60 * 1000

/**
 * Reasons that mean "stop asking about this row" — a verdict, not a transient miss.
 *
 * - `oracle_omitted`: the Oracle ran and its gatekeeper dropped the article. Re-asking
 *   burns an LLM call to hear "no" again.
 * - `oracle_null_final`: two independent null runs a day apart (`pool-retry`'s attempt cap).
 *
 * `pool-retry` has always excluded these from the SWEEP. They were still re-claimable on
 * the ORGANIC path with identical content, which made "terminal" true of one retry surface
 * and not the other. Now neither re-asks about unchanged content, while a content change
 * still revives them through the `contentHash` arms — preserving the deliberate escape
 * hatch documented in pool-retry.ts, and only closing the loop that had no new information
 * in it.
 */
export const TERMINAL_POOL_REASONS: readonly string[] = ['oracle_omitted', 'oracle_null_final', 'retired_legacy']

/**
 * The pre-#1231 conflated `oracle_null` string (daatan#1522) — permanent zombies, not
 * just old rows. `statusReason: 'oracle_null'` isn't in TERMINAL_POOL_REASONS, so these
 * rows match retryableWhere's `notIn` arm forever, AND pool-retry.ts's
 * ATTRIBUTABLE_NULL_REASONS deliberately excludes the literal string (six conflated
 * causes, so "attributable" can't be claimed) — so they can never earn the two-strike
 * finalization that would otherwise terminate them either. Stamping them
 * `retired_legacy` (see {@link retireLegacyNullRows}) is the only way out.
 */
export const LEGACY_NULL_REASON = 'oracle_null'

export interface ClaimableArticle {
  url: string
  title: string
  snippet: string
  source: string | null
  publishedAt: string | null
}

/**
 * `skip_complete` — an existing row already carries this exact content, fully extracted
 * (`COMPLETE`). Retrying this article for this forecast can never learn anything new; a
 * caller that retries anyway (news-indexer#354) burns an LLM judgment and a retry slot on
 * evidence that was never missing. `skip_pending` — the existing row is still resolving
 * (a fresh `PENDING` claim from a concurrent request, a `FAILED` row still in backoff, or a
 * concurrent content-changed claim this call lost the race to) — genuinely worth a later
 * retry, unlike `skip_complete`.
 */
export type ClaimResult = 'claimed' | 'skip_complete' | 'skip_pending'

/** The row a claim landed on (or already covers), so callers can address
 *  `addArticlesToPool`'s write at the exact row rather than re-deriving
 *  "the current row" later — see `addArticlesToPool`'s own comment on why
 *  that matters once a URL can have more than one row (daatan#1381).
 *  Populated on `skip` too whenever an existing row was found (the row
 *  exists whether or not this call's re-claim matched it) — `null` only
 *  when this call lost a concurrent versioning race and genuinely owns
 *  nothing (see the content-changed branch below). */
export interface ClaimOutcome {
  result: ClaimResult
  articleId: string | null
}

/**
 * Atomically claim one (predictionId, url) pair for extraction — the fix for
 * the confirmed news-indexer race (at-least-once webhook delivery let two
 * concurrent pushes both pass a separate findFirst-then-create dedup check
 * before either committed, both call the extractor, both persist a
 * ContextSnapshot). Returns `result: 'claimed'` when the caller should
 * proceed to call the extractor for this article (with `articleId` the row
 * to write the outcome onto); `'skip'` when an equivalent, non-stale claim
 * already covers it (either COMPLETE with the same content, or another
 * request's still-fresh PENDING claim, or a concurrent writer that already
 * versioned this URL — see the content-changed branch below).
 *
 * Implemented as create-then-conditional-updateMany (same-content path) or
 * create-then-transaction (content-changed path) rather than a single
 * raw-SQL upsert: all are atomic under Postgres's row/index locking, and
 * this stays on the standard Prisma Client API used everywhere else in this
 * codebase.
 */
export async function claimArticleForExtraction(
  predictionId: string,
  article: ClaimableArticle,
  origin: PoolOrigin,
): Promise<ClaimOutcome> {
  const urlHash = hashUrl(article.url)
  const contentHash = hashArticleContent(article.title, article.snippet)

  try {
    const created = await prisma.evidencePoolArticle.create({
      data: {
        predictionId,
        url: article.url,
        urlHash,
        title: article.title,
        // Stored so a later retry can re-send the same text this attempt had — see the
        // `snippet` column comment and daatan#1232.
        snippet: article.snippet || null,
        source: article.source,
        publishedDate: article.publishedAt,
        contentHash,
        status: 'PENDING',
        origin,
      },
      select: { id: true },
    })
    return { result: 'claimed', articleId: created.id }
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err
  }

  // Lost the create — a row for this (predictionId, urlHash) already exists and is
  // still current (the partial unique index only rejects the create while a
  // non-superseded row is present, so this can't come back null in practice).
  const current = await prisma.evidencePoolArticle.findFirst({
    where: { predictionId, urlHash, ...CURRENT_VERSION_ONLY },
  })
  if (!current) {
    throw new Error(`evidence_pool: P2002 on (${predictionId}, ${urlHash}) but no current row found`)
  }

  if (current.contentHash === null || current.contentHash !== contentHash) {
    // Genuinely new evidence (a live-blog update, or a legacy row from before
    // contentHash existed) — version it rather than overwriting. Old row first,
    // then the new head: the partial unique index rejects an insert while the old
    // row still reads as current, so the order isn't optional.
    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.evidencePoolArticle.update({
          where: { id: current.id },
          data: { supersededAt: new Date() },
        })
        return tx.evidencePoolArticle.create({
          data: {
            predictionId,
            url: article.url,
            urlHash,
            title: article.title,
            snippet: article.snippet || null,
            source: article.source,
            publishedDate: article.publishedAt,
            contentHash,
            status: 'PENDING',
            origin,
            version: current.version + 1,
            supersedesId: current.id,
          },
          select: { id: true },
        })
      })
      return { result: 'claimed', articleId: created.id }
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err
      // Lost the race to a concurrent claim that already versioned this URL — its
      // row already carries fresh content; nothing left for this call to do. That
      // concurrent extraction may still be in flight, so this is `skip_pending`, not
      // `skip_complete` — a caller cannot yet assume the evidence is captured.
      return { result: 'skip_pending', articleId: null }
    }
  }

  // Same content: the existing backoff/staleness re-claim, scoped to this specific
  // current row (not the (predictionId, urlHash) pair — that's no longer unique).
  const staleCutoff = new Date(Date.now() - PENDING_CLAIM_STALE_MS)
  const failedCutoff = new Date(Date.now() - FAILED_RECLAIM_BACKOFF_MS)
  const transportCutoff = new Date(Date.now() - TRANSPORT_RECLAIM_BACKOFF_MS)
  const { count } = await prisma.evidencePoolArticle.updateMany({
    where: {
      id: current.id,
      OR: [
        // Same content, previously FAILED: allowed, but only after a backoff, and never
        // for a terminal reason. Two arms because SQL's `NOT IN` is false for NULL, so a
        // null statusReason has to be matched explicitly — same shape as pool-retry's
        // `retryableWhere`, deliberately, since these are the two halves of one policy.
        {
          status: 'FAILED',
          statusReason: { notIn: [...TERMINAL_POOL_REASONS] },
          updatedAt: { lt: failedCutoff },
        },
        { status: 'FAILED', statusReason: null, updatedAt: { lt: failedCutoff } },
        // Same content, previously failed on the WIRE — the short lane. Listed after
        // the 24h arms rather than instead of them: those already match these rows
        // (a transport reason is not terminal), so this arm only ever widens the
        // window, never narrows it. daatan#1261.
        {
          status: 'FAILED',
          statusReason: { in: [...TRANSPORT_NULL_REASONS] },
          updatedAt: { lt: transportCutoff },
        },
        // An abandoned in-flight claim.
        { status: 'PENDING', updatedAt: { lt: staleCutoff } },
      ],
    },
    data: {
      url: article.url,
      title: article.title,
      snippet: article.snippet || null,
      source: article.source,
      publishedDate: article.publishedAt,
      contentHash,
      status: 'PENDING',
      statusReason: null,
      origin,
    },
  })
  // articleId is `current.id` on BOTH branches here, unlike the lost-race skip above:
  // the row unambiguously exists whether or not this call's re-claim matched, so a
  // caller resolving "the pool row for this URL" (daatan#1223's rating-prompt lookup)
  // gets it either way.
  //
  // `count === 0` means none of the re-claim OR arms matched — `current.status` at
  // fetch time (above `current.status === 'COMPLETE'` check, not affected by the
  // updateMany that just ran) says why: COMPLETE is a genuinely finished extraction,
  // nothing to retry (news-indexer#354); anything else reaching here (FAILED still in
  // backoff, PENDING not yet stale) is still resolving and worth a later retry.
  return {
    result: count > 0 ? 'claimed' : current.status === 'COMPLETE' ? 'skip_complete' : 'skip_pending',
    articleId: current.id,
  }
}

/** Claim a whole evidence set. Per-article outcomes, same order as `articles`. */
export async function claimArticlesForExtraction(
  predictionId: string,
  articles: ClaimableArticle[],
  origin: PoolOrigin,
): Promise<ClaimOutcome[]> {
  return Promise.all(articles.map((a) => claimArticleForExtraction(predictionId, a, origin)))
}

/** Builds the `addArticlesToPool` id map from a claim step's outcomes — same
 *  order/URLs as the `articles`/`items` array the claim step was called
 *  with. Skipped/lost-race entries are simply absent from the map. */
export function articleIdsByUrl(articles: ClaimableArticle[], outcomes: ClaimOutcome[]): Map<string, string> {
  return new Map(
    articles
      .map((a, i): [string, string | null] => [a.url, outcomes[i]?.articleId ?? null])
      .filter((entry): entry is [string, string] => entry[1] !== null),
  )
}

/**
 * Release a batch of claims after the extractor call itself failed (timeout,
 * provider error) — marks them FAILED with a short machine-readable reason so
 * the staleness window doesn't have to elapse before the next legitimate push
 * retries them. Never throws — mirrors this file's fire-and-forget convention
 * for pool bookkeeping that must not block the caller's real response.
 */
export async function failClaimedArticles(
  predictionId: string,
  urls: string[],
  reason: string,
): Promise<void> {
  if (urls.length === 0) return
  try {
    await prisma.evidencePoolArticle.updateMany({
      // CURRENT_VERSION_ONLY — a claim's row can be superseded by a concurrent
      // content-changed claim before this release runs (daatan#1381); a
      // no-longer-current row must never be touched by a later cleanup call.
      where: { predictionId, urlHash: { in: urls.map(hashUrl) }, status: 'PENDING', ...CURRENT_VERSION_ONLY },
      data: { status: 'FAILED', statusReason: reason.slice(0, 64) },
    })
  } catch (err) {
    log.warn({ predictionId, urls, reason, err }, 'event=evidence_pool_fail_claim_failed')
  }
}

/** List a forecast's pooled articles, most recently added first. Admin visibility only. */
/**
 * `includeSuperseded` defaults to `false` (current-version-only, daatan#1382) —
 * that's what every aggregation-adjacent caller wants, since a corrected
 * article's prior reading is no longer live evidence. The admin evidence-pool
 * listing opts into `true` to show the correction history a version chain now
 * makes visible (daatan#1383).
 */
export async function getPoolArticles(
  predictionId: string,
  { includeSuperseded = false }: { includeSuperseded?: boolean } = {},
): Promise<EvidencePoolArticle[]> {
  return prisma.evidencePoolArticle.findMany({
    where: { predictionId, ...(includeSuperseded ? {} : CURRENT_VERSION_ONLY) },
    orderBy: { addedAt: 'desc' },
  })
}

/**
 * Top pool rows for the resolution-research LLM context: the pool is the
 * Oracle's curated, stance-scored evidence for exactly this claim — better
 * grounded than fresh search snippets, and the only place settlement
 * assertions live. Settled rows first (they assert the resolving event
 * itself), then by evidence weight. Looser than USABLE_POOL_ROW_WHERE on
 * purpose: a pre-relevanceScore row with a stance is still evidence a
 * resolver should see, even though aggregation skips it.
 */
export async function getPoolArticlesForResearch(predictionId: string, limit = 12) {
  return prisma.evidencePoolArticle.findMany({
    where: {
      predictionId,
      ...CURRENT_VERSION_ONLY,
      excluded: false,
      status: 'COMPLETE',
      stance: { not: null },
    },
    orderBy: [
      { settled: { sort: 'desc', nulls: 'last' } },
      { evidenceWeight: { sort: 'desc', nulls: 'last' } },
    ],
    take: limit,
    select: {
      url: true,
      title: true,
      source: true,
      publishedDate: true,
      stance: true,
      settled: true,
      settlementEventDate: true,
      evidenceClass: true,
    },
  })
}

/**
 * What the recompute path actually consumes (daatan#1263): the fields sent to
 * `/pool/aggregate`, the `usable` filter's inputs, and everything
 * `poolArticleToEnrichedSource` copies into the persisted snapshot roster. What it
 * deliberately leaves behind is the claim-lifecycle bookkeeping — `snippet` (up to
 * 2000 chars/row, kept only so retries can re-send the original text), `contentHash`,
 * `status`/`statusReason`, `origin`, timestamps — which a recompute over a large pool
 * (p95 160 rows, max 359 at filing) was hydrating on every push for no reader.
 * `author` is also omitted: the snapshot path re-looks it up by URL for freshness
 * (see resolvePooledEstimate), so the stored column is only read by pool-only paths.
 */
const POOL_RECOMPUTE_SELECT = {
  id: true,
  url: true,
  source: true,
  title: true,
  publishedDate: true,
  personId: true,
  personName: true,
  outletId: true,
  outletName: true,
  stance: true,
  certainty: true,
  credibilityWeight: true,
  claims: true,
  settled: true,
  settlementEventDate: true,
  quantitativeEstimate: true,
  evidenceWeight: true,
  relevanceScore: true,
  relevanceBar: true,
  extractorModel: true,
  extractorPromptVersion: true,
  extractorPromptHash: true,
  gatekeeperModel: true,
  gatekeeperPromptVersion: true,
  gatekeeperPromptHash: true,
  evidenceClass: true,
  authorLean: true,
  authorLeanCertainty: true,
  factSignal: true,
  eventActors: true,
  eventTarget: true,
  isOccurrence: true,
  verified: true,
  facet: true,
  claimsDetail: true,
  excluded: true,
  status: true,
  // Ingest time, not publish time (daatan#1362). `publishedDate` cannot substitute:
  // a months-old article can be discovered and pooled today, so only this can answer
  // "are we still finding new evidence for this claim, or has the pool gone stale".
  addedAt: true,
} satisfies Prisma.EvidencePoolArticleSelect

export type PoolRecomputeArticle = Prisma.EvidencePoolArticleGetPayload<{
  select: typeof POOL_RECOMPUTE_SELECT
}>

/**
 * `getPoolArticles` narrowed to the recompute path's projection — same rows,
 * same order. Current-version-only (daatan#1382): a superseded row's stance
 * is stale evidence and must not double-count alongside its replacement.
 */
async function getPoolArticlesForRecompute(predictionId: string): Promise<PoolRecomputeArticle[]> {
  return prisma.evidencePoolArticle.findMany({
    where: { predictionId, ...CURRENT_VERSION_ONLY },
    orderBy: { addedAt: 'desc' },
    select: POOL_RECOMPUTE_SELECT,
  })
}

export interface PublicSourceArticle {
  id: string
  title: string | null
  url: string
  publishedDate: string | null
  predictionId: string
  predictionClaimText: string
  predictionStatus: PredictionStatus
}

/**
 * An (author, outlet) pair's recent pooled articles, for the public author detail page
 * (daatan#1195 follow-up). `author`/`outletName` are exact matches against the same raw
 * strings retro's author-shadow leaderboard is keyed by (see `pushCredibilityFeedback`,
 * which sends these same two fields as `author_signals[].author`/`outlet_name`) — a
 * leaderboard row for this pair only exists because at least one row here contributed to
 * it, so this never spuriously comes back empty for a page that's actually linked to.
 *
 * Public-safe projection only: excludes the Oracle-estimator shadow-lane fields
 * (stance/authorLean/factSignal/etc.) that live on the same row but were never meant for
 * public display.
 *
 * Current-version-only (daatan#1382): a corrected article should appear once, as
 * its latest reading, not once per version.
 */
export async function getPublicArticlesByAuthorOutlet(
  author: string,
  outletName: string,
  limit = 20,
): Promise<PublicSourceArticle[]> {
  const rows = await prisma.evidencePoolArticle.findMany({
    where: { author, outletName, excluded: false, ...CURRENT_VERSION_ONLY },
    orderBy: { addedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      url: true,
      publishedDate: true,
      predictionId: true,
      prediction: { select: { claimText: true, status: true } },
    },
  })

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    publishedDate: r.publishedDate,
    predictionId: r.predictionId,
    predictionClaimText: r.prediction.claimText,
    predictionStatus: r.prediction.status,
  }))
}

/**
 * Admin override: exclude (or re-include) one pooled article. Scoped by
 * predictionId so an admin on one forecast's page can't touch another
 * forecast's row via a guessed articleId. Returns null on no match (caller
 * maps to 404) rather than throwing, matching addArticlesToPool's own
 * error-shape convention of staying silent on ordinary not-found paths.
 */
export async function setArticleExcluded(
  predictionId: string,
  articleId: string,
  excluded: boolean,
): Promise<EvidencePoolArticle | null> {
  const existing = await prisma.evidencePoolArticle.findFirst({
    where: { id: articleId, predictionId },
  })
  if (!existing) return null
  return prisma.evidencePoolArticle.update({
    where: { id: articleId },
    data: { excluded },
  })
}

/**
 * One-off admin action (daatan#1522): stamp every `oracle_null`-legacy row terminal.
 * `apply: false` (the default call-site convention — see the remediate/retry routes)
 * only counts the target set; `apply: true` performs the update. Unbounded by design —
 * the WHERE clause itself is the bound (exactly the pre-#1231 rows), not a batch size.
 */
export async function retireLegacyNullRows(apply: boolean): Promise<{ matched: number }> {
  const where = { status: 'FAILED' as const, statusReason: LEGACY_NULL_REASON }
  if (!apply) return { matched: await prisma.evidencePoolArticle.count({ where }) }
  const { count } = await prisma.evidencePoolArticle.updateMany({
    where,
    data: { statusReason: 'retired_legacy' },
  })
  return { matched: count }
}

interface PoolAggregateApiResponse {
  mean: number
  std: number
  ci_low: number
  ci_high: number
  articles_used: number
  settled: boolean
  insufficient_data: boolean
  reason: string | null
  /** Floored, credibility/evidence-class/recency/relevance-weighted voting
   *  mass this pool carried (retro#458 Phase 2). 0.0 when insufficient_data
   *  (or no_sources, where no pool was ever built). */
  evidence_mass?: number | null
  /** Kish's effective sample size of the voting weights — exactly
   *  `articles_used` for equal weights, shrinking toward 1 as one row
   *  dominates the pool (retro#458 Phase 2). 0.0 when insufficient_data (or
   *  no_sources). */
  n_eff?: number | null
  /** `evidence_mass` recomputed with recency decay switched off; always >=
   *  `evidence_mass` (retro#458 Phase 2). 0.0 when insufficient_data (or
   *  no_sources). */
  age_adjusted_mass?: number | null
}

/**
 * An aggregate over a forecast's whole evidence pool. `mean`/`std`/`ciLow`/`ciHigh`
 * are in the Oracle's stance space [-1, 1] — the same scale `/forecast` returns, so
 * callers convert with `stanceToPercent`/`stanceStdToPercent` exactly as they do for
 * a single-run forecast.
 */
/**
 * "A pool row the aggregate can actually use" — the one definition (daatan#1475).
 *
 * It existed twice and the two disagreed: `recomputeFromPool` filtered on all six
 * conditions below, while the evidence-health alert asked only for COMPLETE-with-a-stance.
 * A forecast could therefore clear the alert's bar and still aggregate to nothing, which is
 * precisely the class that issue is about — 9 ACTIVE forecasts publishing a confidence with
 * no usable evidence behind it. The guard, the alert and the aggregate now read the same
 * predicate, so they cannot drift apart again.
 *
 * `excluded` is a human's call and rides at the front: an admin exclusion must genuinely
 * remove a row everywhere. The four `!== null` checks are not belt-and-braces — retro's
 * `/pool/aggregate` needs every one of them, so a row missing any is indistinguishable
 * from a failure downstream however cleanly its extraction finished.
 *
 * Kept beside {@link USABLE_POOL_ROW_WHERE}, which is the same predicate as SQL. The two
 * MUST move together; `evidence-pool-usable.test.ts` pins both against one field list.
 */
export function isUsablePoolRow(a: {
  excluded: boolean
  status: string
  stance: number | null
  certainty: number | null
  credibilityWeight: number | null
  relevanceScore: number | null
}): boolean {
  return (
    !a.excluded &&
    a.status === 'COMPLETE' &&
    a.stance !== null &&
    a.certainty !== null &&
    a.credibilityWeight !== null &&
    a.relevanceScore !== null
  )
}

/** {@link isUsablePoolRow} as a Prisma filter, over current-version rows only. */
export const USABLE_POOL_ROW_WHERE = {
  ...CURRENT_VERSION_ONLY,
  excluded: false,
  status: 'COMPLETE',
  stance: { not: null },
  certainty: { not: null },
  credibilityWeight: { not: null },
  relevanceScore: { not: null },
} as const satisfies Prisma.EvidencePoolArticleWhereInput

/**
 * How many rows of a forecast's pool the aggregate could use right now.
 *
 * Zero means the published confidence — if there is one — has nothing behind it that a
 * reader could inspect: every extraction in the pool failed, was excluded, or came back
 * incomplete. The forecast page says so rather than presenting the number unqualified
 * (daatan#1475). Deliberately a live count, not a persisted flag: it self-corrects the
 * moment one extraction succeeds, and needs no backfill for the forecasts already in
 * this state.
 */
export async function countUsableEvidence(predictionId: string): Promise<number> {
  return prisma.evidencePoolArticle.count({
    where: { predictionId, ...USABLE_POOL_ROW_WHERE },
  })
}

export interface PoolRecompute {
  mean: number
  std: number
  ciLow: number
  ciHigh: number
  articlesUsed: number
  settled: boolean
  insufficientData: boolean
  reason: string | null
  poolSize: number
  usableSize: number
  excludedCount: number
  incompleteCount: number
  /**
   * The exact rows POSTed to `/pool/aggregate` — i.e. the articles the returned
   * estimate is an average of. `usableArticles.length === usableSize`, and (since
   * retro sets `articles_used = len(sources)` and drops nothing internally) equals
   * `articlesUsed` whenever the aggregate is sufficient. Callers persist these as the
   * snapshot's `sources` so the stored blob lists exactly the articles behind its number.
   */
  usableArticles: PoolRecomputeArticle[]
  /** See `PoolAggregateApiResponse.evidence_mass`. */
  evidenceMass: number | null
  /** See `PoolAggregateApiResponse.n_eff`. */
  nEff: number | null
  /** See `PoolAggregateApiResponse.age_adjusted_mass`. */
  ageAdjustedMass: number | null
}

const ALREADY_OCCURRED_MIN_ROWS = 5
const ALREADY_OCCURRED_STANCE_THRESHOLD = 0.7

/**
 * Log-only shadow check (daatan#1507): does the pool already show the claimed event
 * having happened *before the claim was even created*? Found via the Brent-crude case
 * (daatan#1474 swing review #4) — a forecast created 2026-07-29 asking whether Brent
 * crosses $100, when Brent had already crossed six days earlier; the pool's own
 * pre-creation evidence proved it, but nothing surfaced that until Mark caught it
 * manually. Cheap heuristic per the issue's own "first cut": `ALREADY_OCCURRED_MIN_ROWS`
 * usable rows at stance >= `ALREADY_OCCURRED_STANCE_THRESHOLD`, every one of them
 * published before `claimCreatedAt`. Log-only, mirrors auditResolveByDatetime /
 * auditClaimDeadlineMismatch — never blocks or mutates.
 */
function auditAlreadyOccurredAtCreation(
  predictionId: string,
  usable: PoolRecomputeArticle[],
  claimCreatedAt: Date | null,
): void {
  if (!claimCreatedAt) return
  const priorStrong = usable.filter((a) => {
    if (a.stance === null || a.stance < ALREADY_OCCURRED_STANCE_THRESHOLD) return false
    if (!a.publishedDate) return false
    const published = new Date(a.publishedDate)
    return !Number.isNaN(published.getTime()) && published < claimCreatedAt
  })
  if (priorStrong.length < ALREADY_OCCURRED_MIN_ROWS) return
  log.warn(
    {
      predictionId,
      matchingRows: priorStrong.length,
      claimCreatedAt: claimCreatedAt.toISOString(),
      urls: priorStrong.map((a) => a.url),
    },
    'evidence-pool.already_occurred_at_creation — pool shows the event before claim creation (log-only, daatan#1507)',
  )
}

/**
 * Aggregate a forecast's entire evidence pool into one estimate, via retro's
 * `/pool/aggregate` (retro docs/ORACLE_VARIABLES.md §6).
 *
 * This is what an Oracle estimate *should* be: a credibility-weighted aggregate over
 * every article we have on the claim. A single `/forecast` run only scores the articles
 * handed to it, so on the news-indexer push path — which usually carries exactly one
 * freshly-matched article — its `mean` is little more than that one article's stance
 * rescaled, and the persisted estimate lurches to wherever the newest article points.
 *
 * Returns null when no aggregate can be formed (Oracle unconfigured, no usable pooled
 * articles, transport error, non-200). Never throws: callers fall back to the single-run
 * forecast rather than dropping the estimate entirely. Call it *after* `addArticlesToPool`
 * resolves, so this run's own articles are already in the pool it reads.
 */
export async function recomputeFromPool(
  predictionId: string,
  claimDirection: ClaimDirection | null,
  claimDeadline: Date | null,
  claimCreatedAt: Date | null = null,
  claimArchetype: ClaimArchetype | null = null,
  claimText: string | null = null,
): Promise<PoolRecompute | null> {
  const cfg = getOracleConfig()
  if (!cfg) return null

  const pool = await getPoolArticlesForRecompute(predictionId)
  const excludedCount = pool.filter((a) => a.excluded).length
  const usable = pool.filter(isUsablePoolRow)
  const incompleteCount = pool.length - excludedCount - usable.length
  if (usable.length === 0) return null

  auditAlreadyOccurredAtCreation(predictionId, usable, claimCreatedAt)

  let res: Response
  try {
    res = await oracleFetch(cfg, '/pool/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sources: usable.map((a) => ({
          stance: a.stance,
          certainty: a.certainty,
          credibility_weight: a.credibilityWeight,
          relevance_score: a.relevanceScore,
          evidence_weight: a.evidenceWeight,
          published_date: a.publishedDate,
          // Ingest timestamp, so retro can report `days_since_last_complete` —
          // freshness of *coverage* (daatan#1362, follow-up to retro#458 Phase 2).
          // Distinct from `published_date` (a months-old piece can be pooled today)
          // and from `age_adjusted_mass` (which weighs the existing pool, and cannot
          // say whether new evidence is still arriving).
          //
          // Every row reaching this payload is COMPLETE: the `usable` filter above
          // now checks `status === 'COMPLETE'` directly (daatan#1445) rather than
          // inferring completeness from the four fields being non-null — a legacy
          // FAILED row can carry stale non-null values from a prior successful
          // extraction and would otherwise slip through.
          //
          // Safe to send before retro reads it: `PoolSourceInput` declares no
          // `model_config`, so Pydantic v2's default `extra='ignore'` drops unknown
          // keys rather than 422ing. daatan can ship first.
          added_at: a.addedAt.toISOString(),
          settled: a.settled ?? false,
          // The settlement anchor (retro #291) — lets aggregation-time
          // revalidation re-check this vote instead of trusting the stored bit.
          settlement_event_date: a.settlementEventDate,
          // The per-claim layer the settlement match gate votes on (daatan#1264).
          // Without it retro's `_settlement_votes()` finds nothing and the gate
          // skips with `reason=no_claim_detail`, so a pin published through the
          // recompute path would bypass a gate that has been ENFORCING on
          // `/forecast` since 2026-08-03 (retro#395). Narrowed through the same
          // validator the read path uses: an untyped Json column that fails
          // retro's stricter `ClaimDetail` would 422 the entire aggregate.
          // Legacy rows (pre-2026-08-02 extractions) send null and the gate
          // skips those — correct, and self-healing as the pool re-extracts.
          claims_detail: toClaimsDetail(a.claimsDetail),
          // Vote identity, so the recompute gate sees what the live gate sees:
          // retro builds each vote's attribution from `outlet or url`. Both are
          // whitelisted out of the estimator on retro's side, so neither can
          // move the number.
          url: a.url,
          outlet: a.outletName,
        })),
        // The claim being recomputed — the gate is the first rule that is
        // semantic rather than arithmetic, so without it retro skips with
        // `reason=no_question`. Guarded on retro's own `min_length=5`; the
        // 500-char cap matches `Prediction.claimText`'s `VarChar(500)` exactly,
        // so no truncation is possible here.
        ...(claimText && claimText.trim().length >= 5 ? { question: claimText.trim() } : {}),
        ...(claimDirectionParam(claimDirection) ? { claim_direction: claimDirectionParam(claimDirection) } : {}),
        ...(claimDeadline ? { claim_deadline: claimDeadline.toISOString() } : {}),
        ...(claimCreatedAt ? { claim_created_at: claimCreatedAt.toISOString() } : {}),
        ...(claimArchetypeParam(claimArchetype) ? { claim_archetype: claimArchetypeParam(claimArchetype) } : {}),
      }),
      timeoutMs: 10_000,
    })
  } catch (err) {
    log.warn({ predictionId, err }, 'event=pool_recompute_failed')
    return null
  }
  if (!res.ok) {
    log.warn({ predictionId, status: res.status }, 'event=pool_recompute_failed')
    return null
  }

  const agg: PoolAggregateApiResponse = await res.json()
  return {
    mean: agg.mean,
    std: agg.std,
    ciLow: agg.ci_low,
    ciHigh: agg.ci_high,
    articlesUsed: agg.articles_used,
    settled: agg.settled,
    insufficientData: agg.insufficient_data,
    reason: agg.reason,
    poolSize: pool.length,
    usableSize: usable.length,
    excludedCount,
    incompleteCount,
    usableArticles: usable,
    evidenceMass: agg.evidence_mass ?? null,
    nEff: agg.n_eff ?? null,
    ageAdjustedMass: agg.age_adjusted_mass ?? null,
  }
}

interface IngestResolutionApiResponse {
  accepted: boolean
  already_ingested: boolean
  sources_recorded: number
  author_signals_recorded?: number
}

/** retro's `SettlementSnapshotInput` wire shape — stance space [-1, 1], not percent. */
type SettlementSnapshotPayload = {
  settled: true
  mean: number
  ci_low: number
  ci_high: number
}

/**
 * The settlement pin as it stood while the claim was still open: the most
 * recent settled, non-clock `oracleSnapshot` written at or before `resolvedAt`.
 *
 * Deliberately not simply the latest snapshot — evidence writes can land after
 * a resolution, and the ledger is a post-mortem of what the pin *published*,
 * not of what the pool looks like now.
 *
 * Returns null when the claim was never pinned; the caller then omits the field
 * and retro records nothing for it (`record_settlement_pin` returns False on a
 * missing snapshot, which is the correct outcome for an unpinned claim).
 */
async function getSettlementPinSnapshot(
  predictionId: string,
  resolvedAt: Date,
): Promise<SettlementSnapshotPayload | null> {
  const row = await prisma.contextSnapshot.findFirst({
    where: {
      predictionId,
      kind: { not: 'clock' },
      insufficientData: false,
      createdAt: { lte: resolvedAt },
      oracleSnapshot: { path: ['settled'], equals: true },
    },
    orderBy: { createdAt: 'desc' },
    select: { oracleSnapshot: true },
  })
  if (!row) return null

  const snap = row.oracleSnapshot as Record<string, unknown>
  const { mean, ciLow, ciHigh } = snap
  if (typeof mean !== 'number' || typeof ciLow !== 'number' || typeof ciHigh !== 'number') return null

  return {
    settled: true,
    mean: percentToStance(mean),
    ci_low: percentToStance(ciLow),
    ci_high: percentToStance(ciHigh),
  }
}

/**
 * Credibility feedback loop, step 2 (retro docs/ORACLE_VARIABLES.md §9):
 * push one resolved forecast's per-source stances to retro's
 * `POST /leaderboard/ingest` so real outcomes can eventually score source
 * credibility, instead of only the frozen, hand-curated vault. Storage-only
 * on retro's side for now — does not affect live `credibility_weight`.
 *
 * BINARY predictions only: stance is a [-1,1] YES-probability signal, which
 * has no clean meaning for a MULTIPLE_CHOICE prediction's per-option
 * correctness. Callers must gate on `outcomeType === 'BINARY'` before
 * calling this (see the resolve route).
 *
 * Excludes `excluded` (admin-excluded) and `opinion`-class articles from the
 * signal (Q7 of the credibility feedback loop interview: an op-ed
 * disagreeing with how a claim resolved isn't the same kind of credibility
 * failure as a reported fact being wrong) and anything missing the fields
 * retro's `ResolutionSourceInput` requires. Skips the call entirely when
 * nothing usable remains — an empty-sources ingest would just be noise in
 * retro's accumulating store. "Nothing" now includes the settlement snapshot:
 * a pinned claim whose pool holds no usable rows still has a pin worth
 * recording, so it must not be skipped.
 *
 * Also carries the author-scoring lane (`author_signals`): every
 * non-excluded row with an `author_lean`, INCLUDING opinion-class — that
 * lane scores the author's own lean, and opinion is precisely where it
 * lives. Retro replays these per (byline author, outlet) into its shadow
 * author board (`GET /leaderboard/author-shadow`).
 *
 * Carries a third lane when the claim was settlement-pinned:
 * `settlement_snapshot`, the pin as it stood at forecast time, which is the
 * sole input to retro's settlement-pin ledger (retro#361 Phase 1 / retro#455).
 * Omitting it is why that ledger recorded nothing between its ship date and
 * daatan#1451 — the writer is unreachable without this field, not merely
 * under-fed. Note the scale change: `oracleSnapshot` holds percent, retro wants
 * stance, and its `mean` is bounded `[-1, 1]`, so an unconverted percent is a
 * 422 rather than a silent mis-record — but on a fire-and-forget call a 422 is
 * still just a warning line.
 *
 * Fire-and-forget: callers must `.catch()` the returned promise themselves,
 * matching `addArticlesToPool`'s own convention — this never blocks or alters
 * the resolution response.
 */
export async function pushCredibilityFeedback(
  predictionId: string,
  outcome: boolean,
  resolvedAt: Date,
): Promise<void> {
  const cfg = getOracleConfig()
  if (!cfg) return

  const pool = await getPoolArticles(predictionId)
  const usable = pool.filter(
    (a) => !a.excluded && a.evidenceClass !== 'opinion' && a.source !== null && a.stance !== null,
  )
  const authorSignals = pool.filter((a) => !a.excluded && a.authorLean !== null)
  const settlementSnapshot = await getSettlementPinSnapshot(predictionId, resolvedAt)
  if (usable.length === 0 && authorSignals.length === 0 && settlementSnapshot === null) return

  // Fourth lane (retro#356): the claim's temporal archetype, so retro can
  // condition a resolved base rate on it — the target its shadow hazard prior
  // drifts a `diffuse` by-deadline claim toward. Fetched here rather than
  // threaded through the caller because this is the only consumer.
  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { claimArchetype: true },
  })

  let res: Response
  try {
    res = await oracleFetch(cfg, '/leaderboard/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prediction_id: predictionId,
        outcome,
        resolved_at: resolvedAt.toISOString(),
        sources: usable.map((a) => ({
          source: a.source,
          stance: a.stance,
          evidence_class: a.evidenceClass,
          credibility_weight: a.credibilityWeight,
          evidence_weight: a.evidenceWeight,
        })),
        author_signals: authorSignals.map((a) => ({
          author: a.author,
          outlet_name: a.outletName,
          author_lean: a.authorLean,
          author_lean_certainty: a.authorLeanCertainty,
          evidence_class: a.evidenceClass,
        })),
        ...(settlementSnapshot ? { settlement_snapshot: settlementSnapshot } : {}),
        // Same mapper the /pool/aggregate push already uses (line ~820), not a
        // hand-rolled toLowerCase(): it encodes retro's strict lowercase
        // Literal AND the omit-when-unclassified contract in one place. That
        // distinction is load-bearing here — retro treats an ABSENT archetype
        // as unconditioned and counts it toward no archetype's base rate,
        // whereas `"none"` is a real enum member meaning "classified as not
        // temporally shaped". Collapsing the two would file every unclassified
        // claim under a real class and quietly poison the rate.
        ...(claimArchetypeParam(prediction?.claimArchetype)
          ? { claim_archetype: claimArchetypeParam(prediction?.claimArchetype) }
          : {}),
      }),
      timeoutMs: 10_000,
    })
  } catch (err) {
    log.warn({ predictionId, err }, 'event=credibility_feedback_ingest_failed')
    return
  }
  if (!res.ok) {
    log.warn({ predictionId, status: res.status }, 'event=credibility_feedback_ingest_failed')
    return
  }

  const body: IngestResolutionApiResponse = await res.json()
  log.info(
    {
      predictionId,
      outcome,
      poolSize: pool.length,
      usableSize: usable.length,
      authorSignalsSize: authorSignals.length,
      settlementPinned: settlementSnapshot !== null,
      alreadyIngested: body.already_ingested,
      sourcesRecorded: body.sources_recorded,
      authorSignalsRecorded: body.author_signals_recorded,
    },
    'event=credibility_feedback_ingest',
  )
}

/** Pool rows added in a window, split by whether they became usable evidence. */
export interface PoolThroughput {
  /** Rows the extractor was spent on, whatever the outcome. */
  attempted: number
  /** Rows that reached COMPLETE *with* a stance — the only ones aggregation can use. */
  usable: number
}

/**
 * How much of what the extractor was spent on actually became evidence.
 *
 * This is the denominator of the weekly LLM waste report (docs#57): spend alone
 * cannot be acted on, spend over usable output can. `attempted - usable` IS the
 * waste, because a row that never got a stance cost a full extraction and
 * contributes nothing to any aggregate.
 *
 * COMPLETE-without-a-stance counts as waste deliberately: `recomputeFromPool`
 * requires a stance, so such a row is indistinguishable from a failure downstream
 * however cleanly it finished.
 */
export async function getPoolThroughput(days: number): Promise<PoolThroughput> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const [attempted, usable] = await Promise.all([
    prisma.evidencePoolArticle.count({ where: { addedAt: { gt: since } } }),
    prisma.evidencePoolArticle.count({
      where: { addedAt: { gt: since }, status: 'COMPLETE', stance: { not: null } },
    }),
  ])
  return { attempted, usable }
}
