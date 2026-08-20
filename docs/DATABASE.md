# Database

PostgreSQL 16 + pgvector, accessed exclusively through Prisma v7
([`prisma/schema.prisma`](../prisma/schema.prisma) is the source of truth; this
document is the map and the cross-cutting semantics the schema can't express).
Update this file whenever a migration changes what a table *means*, not just
what it contains.

Related: [PRISMA_MIGRATE_DEPLOY_DEPS.md](./PRISMA_MIGRATE_DEPLOY_DEPS.md)
(migrations run in a dedicated container during blue-green Phase 5, never via
`docker exec`), [DATABASE_COLLATION.md](./DATABASE_COLLATION.md) (glibc
collation-version incident: text btree indexes silently corrupt on OS upgrades —
`REINDEX` + `ALTER DATABASE ... REFRESH COLLATION VERSION`),
[DEPLOYMENT.md](./DEPLOYMENT.md) (backups: `backup.yml` 04:00/16:00 UTC →
S3 `daatan-db-backups-272007598366`, RPO ≤ 12 h).

## Conventions

- **IDs** are `cuid()` strings everywhere.
- **Tables** are snake_case via `@@map`; **columns** are camelCase unless
  `@map`'d — older models (User, Prediction core fields, ContextSnapshot's
  `createdAt`/`predictionId`/`kind`/`origin`/`meta`) have camelCase columns,
  newer fields are snake_case. Always check `@map` before writing raw SQL.
- **Migrations are authored by hand** in
  `prisma/migrations/<timestamp>_<name>/migration.sql` (no `prisma migrate dev`).
- **Embeddings** (`Prediction.embedding`, `ExternalMarket.embedding`) are
  `Unsupported("vector(768)")` — invisible to the Prisma client, read/written
  with raw SQL only. The postgres image must be `pgvector/pgvector:pg16`.
- The `daatan` DB user is the superuser; there is no `postgres` user. Prod
  container `daatan-postgres` (DB `daatan`), staging `daatan-postgres-staging`
  (DB `daatan_staging`).

### Probability scales (the #1 source of bugs — read this)

| where | scale | type |
|---|---|---|
| `Prediction.confidence`, `aiCiLow/High`, `ContextSnapshot.externalProbability`, `oracleSnapshot.mean/std/ciLow/ciHigh`, `ExternalMarketPriceSnapshot.probability`, `OracleCallLog.fallbackProbability` | **0–100** | Int (oracleSnapshot values Float) |
| Oracle wire format (`/forecast` response `mean/std/ci_low/ci_high`, and `oracleSnapshot.sources[].stance`) | **stance −1..1** (`p = (stance+1)/2`) | Float |
| `oracleSnapshot.sources[].certainty` | 0..1 | Float |
| `Commitment.probability`, `communityProbabilityAtCommit`, `aiProbabilityAtCommit` | **0.0–1.0** | Float |
| `AiEstimate.probability` (LASSO panel members) | **0–100**, null = abstention | Int? |
| `AiMemberScore.brierScore` | 0.0–1.0 (Brier, lower = better) | Float |

Conversion happens once, at the Oracle boundary (`stanceToPercent` in
`src/lib/services/oracle-snapshot.ts`). Rows written before v1.31.2 originally
carried `mean`/`std` on the raw stance scale; a one-time prod data fix
(2026-07-08) normalized them all to percent (`mean → (m+1)/2·100`, `std → ·50`),
so every stored row is now percent and readers need no scale detection. The
caveat survives only in backups taken before 2026-07-08 — re-run
[`scripts/normalize-oracle-snapshot-scale.sql`](../scripts/normalize-oracle-snapshot-scale.sql)
after restoring one (executable dry-run/apply/verify steps + the exact
code-verified per-environment cutoff timestamps, not just this prose).

## Forecasts — `predictions`

The central table (`Prediction`). Field groups:

- **Content**: `claimText` (canonical English, ≤500), `detailsText`,
  `resolutionRules`, `slug` (+ `prediction_slug_aliases` for 308 redirects
  after re-slugs), `originalLanguage` (non-English originals preserved in
  `prediction_translations`).
- **Outcome**: `outcomeType` (BINARY | MULTIPLE_CHOICE | NUMERIC_THRESHOLD),
  `outcomePayload` JSON, `prediction_options` rows for MC/numeric,
  `resolveByDatetime` (the platform deadline).
- **Lifecycle**: `status` — DRAFT → ACTIVE → PENDING → RESOLVED_CORRECT /
  RESOLVED_WRONG / VOID / UNRESOLVABLE, plus PENDING_APPROVAL for bot drafts.
  Resolution fields (`resolvedAt/ById`, `resolutionOutcome`, `evidenceLinks`,
  `resolutionNote`) are filled by human resolvers.
- **AI estimate cache**: `confidence` + `aiCiLow`/`aiCiHigh` +
  `awaitingAiResolution` are a **denormalized cache of the latest
  ContextSnapshot**, maintained only by the `recordEstimate` funnel (below).
  `confidence` predates the funnel as "bot metadata" — treat it as the current
  AI probability, not a bot field. `awaitingAiResolution` is level-based for
  organic estimates (set while `confidence` ≥ 90 or ≤ 10, recomputed on every
  write, never sticky) and only affects the Awaiting-Resolution tab, never
  `status`. A **settlement pin** is its own class (daatan#1248): its
  `confidence` is the Oracle's `settlement_stance` constant (~97), not a level,
  so a pinned write enters the band only when its snapshot pool carries ≥2
  settling votes — an unverifiable pin sets the flag false and skips the
  high-confidence Telegram alert.
- **Settlement latch**: `settled`/`settledAt` — set when the Oracle reports the
  outcome as an accomplished fact (≥2 independent sources). **One-way**: only
  ever set true by the funnel; a later unsettled run does not clear it; human
  resolution supersedes. As of PR #1020, `settled` no longer locks commitments
  by itself — only a passed `resolveByDatetime` or an impossibility pin (a
  `claimDeadline` that has passed and agrees with `resolveByDatetime` within
  `DEADLINE_AGREEMENT_TOLERANCE_MS`) blocks new commitments (see
  `getCommitmentLockReason` in `commitment.ts`). `resolutionOverrodePin`
  (daatan#1234 check #2): null unless the pin/extreme `confidence` contradicted
  the outcome a resolver just declared — then true, since `resolvePrediction`
  rejects the request otherwise. See `detectPinContradiction` in
  `src/lib/utils/pin-contradiction.ts`.
- **Temporal-model metadata** (glide; retro `TEMPORAL_MODEL_PLAN.md`):
  `claimDeadline` (parsed from claim *text* — deliberately distinct from
  `resolveByDatetime`; the two diverging triggers the divergence rule),
  `claimDirection` (ARRIVAL/SURVIVAL/NONE), `claimArchetype` (only DIFFUSE is
  priced), `tauLeadDays`, `classifierVersion/At/Output`. NULL
  `classifierVersion` = not yet classified (no glide). The divergence check
  itself (`isDeadlineDivergent`, `src/lib/utils/deadline-divergence.ts`,
  daatan#1234) is a pure function shared by the temporal clock's glide-horizon
  selection and a non-blocking warning banner on the forecast edit form — the
  clock's server-only `temporal-clock.ts` re-exports the same
  `DEADLINE_AGREEMENT_TOLERANCE_MS` rather than each defining its own, so the
  banner and the clock's own behavior can never disagree about what counts as
  divergent. Three OTHER call sites (`ForecastDetailClient.tsx`'s impossibility
  check, `commitment.ts`'s lock reason, `backfill-temporal/route.ts`'s dry-run
  report) each hold an independent copy of the same 72h constant, by design —
  they predate this module and avoid pulling in `temporal-clock.ts`'s
  server-only deps for the same reason this module exists. Not consolidated
  here; worth a follow-up if a fourth copy needing the *same* semantics ever
  appears (the existing three aren't quite identical to `isDeadlineDivergent`
  — no "both already past" carve-out).
- **Alert dedup timestamps**: `deadlinePassedAlertAt`, `teffProvisionalAlertAt`,
  `divergenceAlertAt` (requote cron), `marketDivergenceAlertAt` (market-sync
  cron) — single-shot alerts re-arm by timestamp comparison, not NULL checks.
- **External market link**: `externalMarketId` (+ `LinkedAt`, `LinkMethod`
  'manual' | 'ai-confirmed' | 'imported', and `externalMarketInverted` when the
  market asks the opposite question — UI plots `100 − price`).
- **Bot-creation metadata** (`source='bot'`): `sentiment`, `extractedEntities`,
  `consensusLine`, `sourceSummary`.
- **Telegram running notification** (daatan#1215): `telegramMessageId`,
  `telegramChatId` — the currently-live "News article matched" message for
  this forecast, if any. `notifyNewsArticleMatched` (`src/lib/services/
  telegram.ts`) edits this message in place on a later match instead of
  sending a new one each time; both fields are overwritten when a fallback
  send happens (edit failed — outside Telegram's ~48h edit window, deleted,
  etc.). NULL = no notification sent yet.

## The AI-estimate stream — `context_snapshots`

Every AI-estimate write, from any path, is one `ContextSnapshot` row written by
**`recordEstimate`** (`src/lib/services/context.ts` — the single writer since
v1.33.0; design: retro `docs/ORACLE_VARIABLES.md` §6).

| column | meaning |
|---|---|
| `externalProbability` | the estimate (0–100) or null when the run produced no number |
| `origin` | which path wrote it: `creation` \| `analyze` \| `news-indexer` \| `backfill` \| `clock`; **null = pre-funnel row** (guess from `externalReasoning` marker strings) |
| `kind` | pricing semantics: `evidence` (default) vs `clock` (daily glide requote). Clock rows are excluded from the public timeline, the glide anchor, and push dedup (`NOT_CLOCK` filters) |
| `articlesUsed` | Oracle evidence volume; null on legacy/LLM-fallback/clock rows |
| `oracleSnapshot` | full Oracle payload (see scale table above); null on the LLM-fallback path |
| `insufficientData` | the run abstained — UI shows "Insufficient evidence". Since daatan#1473 the prediction's published estimate is left standing, not cleared (below) |
| `meta` | clock provenance `{engineVersion, cause, pLast, tLast, tEff, c, direction}`; on an abstention, `{abstain: {reason, poolSize}}` |
| `summary` / `externalReasoning` | analyze-run LLM summary / writer reasoning marker |

Funnel invariants: `confidence` and `aiCiLow/aiCiHigh` on the prediction move
**atomically** (written together, cleared together, or both untouched — never one
without the other); the settled latch and all notifications are decided by the
per-origin policy table in `context.ts`.

**An abstention does not clear the published estimate** (daatan#1473). It says *this run*
found no usable evidence; it is not a verdict on the number already published, which came
out of a pool that only ever grows. One `analyze` run wiped a 115-article,
settlement-verifier-approved 97% and left the forecast blank for ~23 h with no self-heal.
`recordEstimate` therefore branches on the abstention's **reason**, not on the bare
`insufficientData` boolean: only a reason listed in `CLEARING_ABSTAIN_REASONS` clears the
needle, the band and `awaitingAiResolution` together; every other reason — including an
unknown one — takes the same no-op the "run produced no number" case takes. That set is
empty today and exists for a pool-*staleness* abstention (retro#416's valve), which would be
a verdict on the prior number; discriminating by pool *size* instead would make that valve
inert on exactly its target population. The abstention is still recorded on the snapshot
(`insufficientData: true`, plus `meta.abstain = {reason, poolSize}` — previously logged
only), which is what the UI reads.
Known bypass: bot creation (`bots/stake.ts`) still writes predictions directly.

Supporting tables: `context_timings` (per-analyze phase latencies),
`oracle_call_logs` (every Oracle API call: type, source workflow, provider
chain, failure reason, LLM-fallback flag, and — for FORECAST/LLM calls, once
retro reports it — per-call LLM token usage (`promptTokens`…`cacheWriteTokens`,
docs#57 item 3) — the observability layer for the search/forecast chain).

## Calibration — `calibration_records`

One row per resolved **binary**, frozen at resolution time (daatan#1233). Written
by `recordCalibration()` from `resolvePrediction`, **after** the resolution
transaction commits — a defect in a research row must never be able to roll back
a resolution, which is also why that function never throws.

It exists because every number in it is one the system *overwrites*: the glide
requotes daily, so "what did we publish 7 days before this resolved" is only
answerable while snapshot history survives, and only via a lateral join nobody
re-runs. The consequence was that system calibration had been measured exactly
once (2026-08-01: Brier 0.298 over 17 scorable pairs — worse than always
answering 50%; CI-width-vs-error correlation −0.07).

| column | what |
|---|---|
| `p_final`, `p_final_at`, `p_final_kind`, `p_final_origin` | the last published probability before resolution, 0–100. **Includes `kind='clock'`** — the glide's requote is what the page showed, and scoring the system means scoring what it said. The kind/origin columns are what let a fit separate clock from evidence afterwards. |
| `ci_low`, `ci_high`, `settled_at_final` | the Oracle's interval at that instant (percent) and whether it was a settlement pin. The CI-honesty check is the point — audit F16 predicts these widths carry no risk information. |
| `p_7d`, `p_30d` (+ `_at`) | the same published number as of 7/30 days before resolution — Brier-by-horizon. Null when the forecast had said nothing that far back. |
| `clock_snapshots`, `evidence_snapshots` | the denominator for the glide backtest. |
| `disputed`, `dispute_note` | set when the resolver knowingly overrode a contradicting settlement pin / extreme AI confidence (daatan#1234 check #3, gated by `resolutionOverrodePin` on the prediction — see `detectPinContradiction`), so the pair can be excluded from a fit instead of silently poisoning it. **Create-only**: `recordCalibration()`'s upsert never touches either column on an existing row — only a future manual admin action should change them once set. |

**Nothing derived is stored.** Brier, log score and calibration bins all follow
from `p_final` + `outcome`; a derived column that can disagree with its inputs is
the defect this codebase keeps finding elsewhere.

Backfill: `npx tsx scripts/backfill-calibration-records.ts [--dry-run]`,
idempotent, and it reuses the live writer's own selection rules rather than
reimplementing them. Expect many rows with `p_final = null` — most resolutions
predate Oracle snapshot coverage, and a null record is the honest way to say
"not scorable".

## Evidence pool (foundation layer) — `evidence_pool_articles`

Per-forecast, keyed by `(predictionId, urlHash)` — `urlHash` is `hashUrl()`
(same normalization as `NewsAnchor`), so http/https and trailing-slash variants
of the same URL collapse to one row. Started as a write-only foundation layer
(2026-07-09, retro `docs/ORACLE_VARIABLES.md` §6 part 2); since v1.60.0 it is
the source of truth the estimate is recomputed from (see below), and since
2026-07-16 also what the elections consumers render (elections app #50/#51,
daatan `/elections` matrix #1147). `analyze`/`news-indexer`/`backfill`/`remediate` write
their per-source signal here (`addArticlesToPool` in
`src/lib/services/evidence-pool.ts`) alongside their existing
`ContextSnapshot`/`Prediction` writes. The row IS the extraction
cache: re-discovering an already-pooled article updates its stored signal in
place.

**Fixed: re-discovery no longer re-extracts unchanged content.** Confirmed on
prod (2026-07-21) that overwriting on re-discovery was NOT always a no-op: a
single ynet article's stance ranged -0.33 to -0.81 across ~30 re-discoveries in
2 days, with no edit to the underlying story — a genuine extractor
non-determinism, not a duplicate write (elections' url+stance dedup correctly
left it alone, since the value really did differ each time). Each
re-extraction's drift also fed `recomputeFromPool`'s whole-pool aggregate, so
it wasn't only a display concern — the persisted `oracleSnapshot.mean` could
absorb it too.

Root cause ([daatan#1172](https://github.com/Daatan/daatan/issues/1172)): the
content-hash claim gate (`claimArticleForExtraction`/
`claimArticlesForExtraction` below) already existed and correctly computed,
per article, whether its content had changed since it was last pooled — but
`analyze`/`news-indexer` only used the gate's result as an all-or-nothing
"is there anything new in this batch at all" check, then sent the *whole*
batch to the extractor regardless, re-extracting and overwriting
content-unchanged articles right alongside genuinely new ones.
`analyze` additionally had no gate at all before this fix. All three call
sites (`analyze`, `news-indexer`, `backfill`/`retry`) now filter to only the
newly-claimed articles before calling the Oracle; a batch where nothing is new
reads the existing pool aggregate directly instead of extracting or falling
back to an ungrounded LLM guess. Elections' display-only trailing-median
smoothing (`combined-chart.ts`) remains in place as defense-in-depth, but the
underlying instability is now addressed at the source.

**`remediate` is the one origin that deliberately defeats the content-hash gate.**
The fix above makes unchanged content a no-op, which is correct for every organic
path — but it also means a row extracted by an *older, wronger* extractor can never
be re-read, since its content hasn't changed and never will. The backward
remediation (`POST /api/admin/evidence-pool/remediate`, daatan#1493) therefore nulls
`contentHash` on its target rows before re-driving them, which routes them down
`claimArticleForExtraction`'s supersede-and-insert arm instead of its in-place
re-claim arm. That choice is what makes the run reversible: every prior reading
survives as a superseded version, and a bad remediation is undone by dropping the
new head and clearing `supersededAt` on its `supersedesId` parent, in that order.
**That order is enforced, not advisory** — clearing the parent first leaves two rows
reading as current, and the partial unique index rejects it outright with
`evidence_pool_articles_current_url_key` on `(predictionId, url_hash)` (verified
against a real chain on staging, 2026-08-19). So a revert attempted backwards fails
loudly and changes nothing, rather than half-applying; but it also means the delete
genuinely has to come first, or the revert simply will not run.
The corollary is a rule about *when* it is legitimate — re-extraction can only
repair a verdict if the extractor's INPUT can differ (a fixed prompt, a new guard, a
body that fetches this time). On byte-identical input with an unchanged extractor,
any movement is sampling variance, and remediating it launders noise into the
published number.

Rows move through a claim lifecycle: `claimArticleForExtraction` inserts/claims
a row as `PENDING` (a claim older than 10 min counts as abandoned and can be
re-claimed), a successful extraction completes it, and everything a run claimed
but got no signal for is released as `FAILED` with a `statusReason`.

**Re-claiming a FAILED row** (daatan#1232) is gated on three things, and the gate
distinguishes *new evidence* from *a retry*:

- **Content changed** (`contentHash` differs, or is null on a pre-fingerprint row) —
  re-claims **immediately, whatever the row's previous outcome was**. That is genuinely
  new evidence (a live-blog update), and it is also the documented escape hatch that
  keeps terminal rows revivable.
- **Same content, non-terminal failure** — re-claimable only after
  `FAILED_RECLAIM_BACKOFF_MS` (24 h, matching `pool-retry`'s `RETRY_MIN_AGE_MS`).
- **Same content, previous failure was on the WIRE** (`TRANSPORT_NULL_REASONS` —
  `oracle_timeout`/`oracle_network`) — re-claimable after `TRANSPORT_RECLAIM_BACKOFF_MS`
  (60 s) instead (daatan#1261). The 24 h figure is priced against an article that
  *always* nulls, which assumes the last run told us something **about the article**;
  a client timeout does not. retro does not cancel on disconnect, so the run we
  abandoned very likely completed and is sitting in its `forecast_cache` for an hour —
  and a 1 h cache against a 24 h floor can never overlap, which is exactly what made
  daatan#1262 impossible by construction. 60 s rather than 0 so a hard-down Oracle
  still cannot be hot-looped by the re-push cycle. This arm only ever *widens* the
  window: the 24 h arms already matched these rows, since a transport reason is not
  terminal.
- **Same content, terminal reason** (`TERMINAL_POOL_REASONS`) — never re-claimed.

This used to be a bare `{ status: 'FAILED' }` arm: no age gate, no reason filter. Since
news-indexer re-pushes the same article set on every poll cycle while its 5-minute
cooldown rolls, an always-null article looped `FAILED → PENDING → FAILED`, burning a
full Oracle run (fetch + gatekeeper + extractor) every few minutes — and "terminal" was
true of the sweep but false of every organic re-push, because only `pool-retry` honoured
it. The schema comment "eligible for retry once stale" was stricter than the code.

**The null family** (daatan#1231) — the Oracle produced no forecast, split by WHY.
This used to be one string, `oracle_null`, covering six different situations: 73% of
the 200 most recent pool fetches (2026-07-31) carried it, and because
`getOracleForecast` never throws, a 12-second client timeout and a deliberate
all-articles-off-topic abstention wrote byte-identical rows. The real cause survived
only in `OracleCallLog.failureReason`, which the retry sweep never reads.

| reason | meaning |
|---|---|
| `oracle_abstain` | the Oracle RAN and declined (`insufficient_data`) — usually its gatekeeper rejecting every article |
| `oracle_timeout` | no answer within daatan's client budget (30 s on the background paths since daatan#1254; 12 s before, against a server whose measured p99 is 25 s — that inversion recorded 15.3% of news-indexer forecasts as failures at exactly 12,002 ms). retro does **not** cancel, so a timeout here does not mean the forecast was never produced |
| `oracle_network` | transport failure other than a timeout |
| `oracle_http` | retro answered non-OK |
| `oracle_unconfigured` | no Oracle URL/key on this deployment — says nothing about the article |
| `oracle_placeholder` | retro returned its stub response |
| `oracle_no_articles` | ran, but produced no usable mean / zero articles used |
| `oracle_null` | residual, and every row written before the split |

These reasons are daatan's slice of a chain that starts in news-indexer and passes through
retro; each of those keeps its own, differently-named drop labels, and no single store holds
an article's whole journey. The cross-repo map is
[funnel.md](https://github.com/Daatan/docs/blob/main/funnel.md) — §9 lines the
three vocabularies up side by side.

Consumers must match the whole family via `ORACLE_NULL_REASONS` (`src/lib/services/oracle.ts`),
never the literal `'oracle_null'` — the retry sweep's second-strike rule did the
latter, and a strict-equality check would silently stop finalizing rows.
**Retry policy is no longer uniform across the family.** The transport classes
(`TRANSPORT_NULL_REASONS` — `oracle_timeout`/`oracle_network`) are treated as *we never
got an answer* rather than *the articles said nothing*, and they alone get the 60 s
re-claim lane above and the re-ask below (daatan#1261/#1262). An abstention on identical
input still buys the same answer, so it keeps the full 24 h backoff.

**Going back for an abandoned run (daatan#1262).** retro finishes a forecast the client
hung up on and stores it in `forecast_cache` for `cache_ttl_seconds` (3600). daatan used
to never read it — its earliest re-ask was 24 h — so ~72 completed Claude Haiku 4.5
extractions a day were paid for and discarded. On a transport class the push route and
the retry sweep now schedule `scheduleOracleReask` (`src/lib/services/oracle-backfill.ts`),
which after `REASK_DELAY_MS` (120 s) re-drives the run through `refreshOracleSnapshot`:

- **The article set must be IDENTICAL.** retro keys the cache on
  `sha256(question | max_articles | md5(sorted urls)[:12] | claim_direction|claim_deadline)`,
  so the re-ask carries the *claimed subset* — what was actually sent — not the whole push.
  A set that merely overlaps is a different key and re-runs the extractor, paying twice to
  save once. `claim_created_at`/`claim_archetype` are **not** in that key and may vary.
- **120 s is sized off retro's clocks**, not ours: retro caps a run at
  `forecast_timeout_seconds` (90 s) from its own request start, so by then the run has
  either completed and cached or given up. It must also exceed the 60 s re-claim backoff,
  or daatan's own gate refuses the re-ask as `unchanged`.
- **One attempt.** The re-ask runs with `reask: false`, so a re-ask that times out again
  does not chain; the row falls back to the daily sweep. Concurrent re-asks are capped.
- **Known ceiling:** retro runs gunicorn `--workers 2` and its forecast cache is
  per-process in memory, so a re-ask lands on the worker holding the entry roughly half
  the time. A miss still returns a real forecast and still completes the pool row — it
  just costs a second extraction instead of nothing. So the recovered-**estimate** rate is
  ~100% and the *free*-recovery rate is ~50%. Making it deterministic needs a shared cache
  on retro's side.
- A recovered push persists via `saveOracleSnapshotOnly`, so the estimate lands but the
  ContextSnapshot reads as a background refresh rather than a news-indexer match, and no
  Telegram notification fires.

Other reasons: `oracle_omitted` (the Oracle ran but its gatekeeper dropped the
article — terminal), `oracle_null_final` (two consecutive **attributable** null runs —
terminal, stamped by the retry sweep's attempt cap), `reextract_no_signal`.

**"Attributable" is the load-bearing word (daatan#1253).** Only
`ATTRIBUTABLE_NULL_REASONS` — `oracle_abstain` and `oracle_no_articles` — retire a
row: those mean the Oracle received the articles, ran, and produced nothing anyway.
`oracle_timeout` / `oracle_network` / `oracle_http` / `oracle_unconfigured` /
`oracle_placeholder` are facts about the wire, not the evidence, and legacy
`oracle_null` conflates all six so its cause is unknown. Both strikes are checked:
the row's prior reason AND this run's failure class. This matters because one sweep
call carries up to `DEFAULT_MAX_ARTICLES` (15) rows on a **single** Oracle call — a
lone client timeout used to stamp the whole batch terminal on zero information about
any article in it (94.9% of terminal rows were retired in multi-row groups). Since
`oracle_null_final` is in `TERMINAL_POOL_REASONS`, that loss was silent and beyond
the sweep's reach. Pre-split `oracle_null` rows consequently no longer reach the cap
via the sweep — deliberate: one extra Oracle look a day is far cheaper than a
wrongly-retired article.
`extractor_error` is **no longer written**: it was stamped in a `catch` around
`getOracleForecast`, which never throws, so the branch was dead code (removed in
daatan#1231). Historical rows carrying it remain retryable. The retry sweep (`src/lib/services/pool-retry.ts`,
exposed at `POST /api/admin/evidence-pool/retry`, driven by the weekly
`Retry Pool Extractions` workflow) re-pushes retryable rows through
`refreshOracleSnapshot`, biggest ACTIVE-forecast backlogs first, one attempt
per row per 24 h. Terminal rows are still revivable organically: a re-push with
changed content re-claims the row.

The sweep re-pushes each row with the **stored `snippet`** (daatan#1232). It previously
sent title-only (`snippet: ''`), because the pool never persisted the snippet — so for a
Telegram row whose only content *is* the snippet, the retry carried strictly less text
than the attempt that had already failed, making the second null and the terminal
`oracle_null_final` stamp near-deterministic rather than a genuine re-test. `snippet` is
nullable with **no backfill** (the text was never stored on this side and is
unrecoverable); rows predating the column fall back to title-only exactly as before, and
self-heal on the next organic re-push.

`excluded` is settable via the forecast page's admin-only "Evidence
pool" panel (`EvidencePoolAdmin.tsx`, `PATCH
/api/admin/forecasts/[id]/evidence-pool/[articleId]`) — shadow-writes never
touch it, so an admin's exclusion decision survives re-discovery.
`evidenceWeight` is retro's resolved evidence_class weight (S2 cutover, retro
`/forecast`'s `SourceSignal.evidence_weight`, PR #251) — the
`class_weight[evidence_class]`/certainty-fallback value already computed
server-side. `relevanceScore` is the gatekeeper's graded topic relevance
(`SourceSignal.relevance_score`) — its square is Layer C of retro's weight
formula; never captured anywhere in daatan's pipeline before this, so a naive
recompute would have treated every pooled article as fully on-topic.
`relevanceBar` is the per-article relevance bar in force when the row was
admitted (retro `ForecastResponse.relevance_bar`, #393/#394, PR retro#404) —
0.0 means no bar was applied, `/forecast`'s behaviour today. Fully shadow /
additive like `authorLean`/`factSignal`: nothing reads it yet, null on rows
written before the column existed and on the `/pool/aggregate` recompute path
(compute-only, and retro doesn't return a bar there), no backfill. It exists
so that once the bar moves off 0.0, a backtest or recompute can tell which
admission regime produced each row — a property of the row that can't be
recovered after the fact once history mixes both regimes.
`evidenceClass` is the article's most common evidence_class among its
extracted claims (retro `SourceSignal.evidence_class`, PR #255) — needed by
the credibility feedback loop (see below) to exclude opinion-class articles
from the resolution-outcome signal, since `evidenceWeight` alone can't
distinguish opinion from a low-certainty unclassified article.
`settlementEventDate` is the settlement anchor (retro
`SourceSignal.settlement_event_date`, PR #291): the outcome's occurrence date
for a positive settlement, the foreclosing event's date for a negative one,
null when legitimately undated (post-deadline expiry). Sent back on
`/pool/aggregate` (with the prediction's `createdAt` as `claim_created_at` and
`claimArchetype` as `claim_archetype`) so retro's aggregation-time settlement
revalidation can re-check every stored settled vote on every recompute —
before this, a stale/poisoned `settled` bit voted forever (the 2026-07-16
false-pin audit). Plain String pass-through like `publishedDate`; retro
validates it.
`authorLean`/`authorLeanCertainty` are the **byline author's OWN** directional
forecast of the event (retro `SourceSignal.author_lean`, #308/#309):
`authorLean` ∈ [-1,1] (+1 the author expects it to happen, -1 expects not, 0
weighs both sides), `authorLeanCertainty` ∈ [0,1] (how firmly they commit); both
null when the author only reported facts or relayed others' views. This is the
**author-scoring lane** of the extractor un-fusing work
(`project_author_scoring_redesign`) — deliberately kept SEPARATE from the
estimate: unlike every other signal column above, **nothing in aggregation or
the recompute reads it**, and it is never sent to `/pool/aggregate` (that path is
compute-only and never re-extracts, so it can't populate it either). Fully
shadow / additive: null on rows written before the columns existed, populated
only on NEW extractions (pool rows are a `contentHash` cache — no backfill
without the reset→retry sweep). Byline-author-string scoring can start at
~84% `author` coverage; per-outlet scoring stays blocked until `outletId`
populates (news-indexer #1131).
`factSignal` + `eventActors`/`eventTarget`/`isOccurrence`/`verified` are the
**fact-lane** counterpart of `stance` (retro `SourceSignal.fact_signal`, #313):
`factSignal` ∈ [-1,1] is what the **reported facts alone** imply about the event,
un-fused from author assertion/framing — a claim-weighted MEAN over the article's
fact-bearing claims (the SAME reduction as `stance`). The four facets qualify
the **dominant** (max |fact_signal|) claim: `eventActors`→
`eventTarget` name that fact's actor/target dyad (the actor-pair check, #303),
`isOccurrence` marks the event ITSELF vs a precursor/precondition/escalation,
`verified` marks an independently-reported fact vs an interested party's claim.
**These are stored for a diagnostic lane, not for a pending re-pricing** (retro#533,
2026-08-15, `Daatan/docs/decisions.md`): the estimator-cutover framing they were
originally written for is RETIRED — corr(stance, fact_signal) measured 0.905 on
precursor rows (n=2,645), so the offline paired-Brier gate could never accumulate
discriminating data. Nothing in daatan reads these columns, and that is now the
steady state rather than a waiting room. Their value is on the retro side, where the
same fields (recomputed at extraction time, NOT read back from here) key the
precursor cap and the decider-intent stance cap, and here, where they are the
per-claim audit surface for reviewing a pool row. Re-opening bar: ≥30 resolved
predictions with lane divergence >0.1, in `decisions.md`.
`carriedForward` (daatan#1166/#1167, `oracle-snapshot.ts`/`pooled-estimate.ts`)
is true when a pooled source's stance for this recompute is UNCHANGED from the
immediately-prior snapshot's stance at the same URL — i.e. this source wasn't
freshly (re-)evaluated this time, just carried into the new snapshot because
the full roster is persisted on every recompute (other readers, like the
"sources behind the estimate" panel, need the complete current roster, not a
diff). False for a genuinely new or re-extracted-with-a-different-stance
source, or when there's no prior snapshot to compare against. Added
specifically for elections' chart (`combined-chart.ts`, elections#63): before
this field, every pooled source looked freshly re-evaluated on every
recompute, so the chart drew a spurious new vertex per source per recompute
even when nothing about that source had changed. Consumers read it as
`carriedForward ?? false`, since rows written before the column existed are
null.
All null when no scored claim carried a `factSignal` (e.g. pure opinion). Like
`authorLean`, this is the **estimator lane** of the un-fusing work
(`project_author_scoring_redesign`) — kept SEPARATE from the current estimate:
**nothing in aggregation or the recompute reads these**, and they are never sent
to `/pool/aggregate`. Fully shadow / additive: null on rows written before the
columns existed, populated only on NEW extractions (pool rows are a `contentHash`
cache — no backfill without the reset→retry sweep). The free-text facets
(`eventActors`/`eventTarget`) are unbounded `text` so an over-long LLM value can
never fail the shadow write. The Phase-3 estimator cutover to `factSignal` is
gated on an offline Brier backtest — until it beats `stance` on calibration,
`stance` stays authoritative.
`claimsDetail` (jsonb, F1/F15 — daatan#1235 + retro#364) is the **per-claim layer
behind every extracted scalar above**. Each element is one claim as retro's fusion
consumed it: its own `stance`, `certainty`, `specificity`, `prediction_type`,
`evidence_class`, `quantitative_estimate`, `settled`, `event_date`, `fact_signal`
and the four fact facets, plus the `claim` summary and its verbatim `quote`. Every
other extracted column on this row is a **reduction** — five article-level scalars
computed over five different claim subsets — and this column is where the inputs to
those reductions used to die, unrecoverably. Without it there is no retroactive
backtesting (we cannot re-score history we never kept), no per-claim credibility
attribution, and no way to measure extractor instability over time.
Two collapses are visible only here: `evidenceClass` above is the article's most
**common** class, so mixed-class articles are unattributable above this layer; and
the fact facets above ride from the single **dominant** claim, so a lone over-cap
interested-party claim diluted by in-contract siblings is invisible (retro#378).
Same shadow discipline as `authorLean`/`factSignal` where the *estimate* is concerned:
**nothing in aggregation or the recompute reads it** — retro keeps its eight-scalar
whitelist, so a recompute is bit-identical whether or not this column is sent.
Since daatan#1264 it **is** sent on `/pool/aggregate` (with the prediction's
`claimText` as `question`), because the **settlement match gate** — the one rule that
is semantic rather than arithmetic — votes on these per-claim `claim`/`quote`/
`event_date` values. Without both fields retro skipped the gate explicitly
(`reason=no_question` / `no_claim_detail`), so a pin published through the recompute
path would have bypassed a gate that has been ENFORCING on `/forecast` since
2026-08-03 (retro#395). Sending it is gated on the same narrowing the read path uses:
retro's `ClaimDetail` requires `claim`+`stance`+`certainty`, and one malformed element
would 422 the whole aggregate and drop the estimate to the single-run fallback, so an
unusable value is sent as null and the gate skips that row.
Additive and nullable with **no backfill**: for rows
extracted before the column existed the per-claim data is gone and must not be
fabricated. One deliberate difference from the scalar shadow columns above: an
update that merely *omits* `claimsDetail` leaves the stored value alone rather than
nulling it (`addArticlesToPool` passes `undefined`, not `DbNull`), because the data
is unrecoverable — that is the daatan#1237 failure mode, which the scalar columns
still have and this one does not.
`personId`/`personName`/`outletId`/`outletName` are resolved cross-platform identity from
news-indexer's `/articles/by-url` (Phase 2 of the matching redesign, news-indexer
`docs/MATCHING_ARCHITECTURE.md`) — an exact match against news-indexer's own `person`/`outlet`
tables. All nullable; `author`/`personId`/`personName` were historically backfilled
(2026-07-15: 88% author, 24% person coverage), `outletId`/`outletName` (#1131) are
forward-populated only — and in practice have never been populated on pool rows
(0% coverage as of 2026-08-17). Since news-indexer#302 the push payload carries the
NAMES next to the ids, so a push that resolved identity no longer needs the by-url
round-trip at all; the lookup runs only for URLs the push did not cover. Presence, not
truthiness, decides: an item with no `author` key is an older news-indexer and is still
looked up, while `author: null` is news-indexer stating it found no byline. Data gotcha for coverage stats: rows added 2026-08-09 →
2026-08-16 20:20Z carried `personId` with **NULL `personName`** (the daatan#1463
enrichment regression, fixed in v1.65.178); their names were backfilled 2026-08-17
(220/220, self-join on the table's own healthy id→name pairs), but their `author`
stays NULL — that window's bylines were unrecoverable daatan-side. Both elections consumers now attribute by id first: the elections
app (#50/#51) and daatan's `/elections` matrix (#1147) read usable pool rows and match
`personId` before falling back to the `TRACKED_SOURCES`/`CURATED_ELECTION_AUTHORS` alias
tables, which survive only for byline-only identities news-indexer can't resolve yet.
**All three estimate paths are cut over to the pool** (ORACLE_VARIABLES.md §6).
`recomputeFromPool()` in `evidence-pool.ts` posts the current non-excluded pool to
retro's `POST /pool/aggregate`, and that aggregate — mean, std, CI, `settled`,
`articles_used` — *is* the persisted estimate. The `/forecast` call on the run's
articles is now only an **extraction** step, feeding their signals into the pool.
news-indexer was cut over first in v1.60.0 (#1121); `analyze` and `backfill` followed
once that had run in prod. The shared decision lives in `resolvePooledEstimate()`
(`pooled-estimate.ts`), used by `analyze` and `backfill`; the news-indexer route inlines
the same logic. (`shadowCompareRecompute()` — the log-only pool-vs-live comparison these
two paths used before the cutover — has been removed.)

Why: a run scores only the articles handed to it, and a news-indexer push usually carries
a single freshly-matched article, so `/forecast` returns little more than that article's
stance rescaled. Trusting it let the newest article yank the estimate wholesale — one live
forecast swung 1% → 99% in 19 minutes on two articles reporting the *same* event, each
with a CI so tight (0–2, then 94–100) that the system never once signalled doubt.
Aggregating the pool puts a single bad extraction in proportion to the evidence gathered.

The shared decision (`resolvePooledEstimate` in `pooled-estimate.ts`) has **three** outcomes,
and the two "no pool number" cases are deliberately different:
- **pool** — the aggregate is the estimate.
- **single-run fallback** — the pool could not be *read* (Oracle unreachable, nothing usable
  pooled yet, transport error). Fall back to this run's `/forecast` so a flaky Oracle degrades
  the estimate rather than dropping it.
- **abstain** — the pool *was* aggregated and returned `insufficient_data`. In prod there are
  two reasons: `all_articles_off_topic` (every article scored below `relevance_weight_floor`)
  and, since the Oracle's 2026-08-01 R3 release, `no_usable_weight` (rows exist but every one
  of them carries zero aggregation weight — blocked by credibility, zeroed by relevance, or
  both; the Oracle used to answer such a pool with equal weights instead). Thin-but-on-topic
  pools are still NOT insufficient — `defer_on_thin_evidence` is off, so they get their CI
  inflated instead. Treat the reason as an opaque string: it is the Oracle's to extend. The run records an **abstention** — no number persisted, the
  snapshot flagged `insufficientData: true` and carrying `meta.abstain = {reason, poolSize}`,
  no notification, excluded from the glide anchor and history chart (both filter
  `insufficientData: false`) — rather than fall back to a single run over the *same*
  off-topic articles, which would reintroduce a garbage number. Any confidence/CI already
  published **survives** it (daatan#1473, above). The UI renders the abstention as
  "insufficient evidence" (ContextTimeline). A forecast with any prior on-topic evidence
  shouldn't be able to reach this state at all — those rows keep their relevance in the
  accumulating pool — which is exactly why an abstention on one is treated as the
  untrustworthy side of the contradiction.

Each run logs which path won and the single-run mean (`estimateSource` ∈
{`pool`,`single-run`,`pool-insufficient`}, `singleRunMean`/`singleRunDelta`) — a large gap is
the signature of a run that would have yanked the old estimate.

Consequently `excluded` is now **enforced on every path**: excluded rows are dropped before
the aggregate, so an admin's exclusion genuinely moves the number.

**"Usable" has one definition** (`isUsablePoolRow` / `USABLE_POOL_ROW_WHERE` in
`evidence-pool.ts`, daatan#1475): a current-version row that is not `excluded`, is `COMPLETE`,
and carries all four of `stance`, `certainty`, `credibilityWeight`, `relevanceScore`. Anything
missing one of them is unreadable to the aggregate. It used to be written twice — the
in-memory filter in `recomputeFromPool()` required all four, the `forecast-empty` health
query required only a stance — so a pool of half-extracted rows read as *covered* by the alert
built to catch exactly that. Both now import the same predicate, `evidence-pool-usable.test.ts`
pins them against one field list, and `countUsableEvidence()` exposes it as a live count.

Volume and *usable* volume are not the same number and are no longer quoted as one: 46% of all
`evidence_pool_articles` rows are FAILED (2026-08-18), so a pool of 22 may hold 9 readable
rows. The Telegram match header says `N new / U of P usable in pool`, falling back to the bare
`N new / P in pool` when composition is unknown (the single-run path). `ResolvedPoolEstimate`
carries `usableSize` alongside `poolSize` for this.

**A published number with an empty pool says so.** 9 ACTIVE forecasts display a confidence
while `countUsableEvidence()` returns 0 (2026-08-18) — every article ever gathered for the
claim failed extraction or was set aside, and the number is a survivor of an earlier, healthier
pool. The forecast page annotates it (`forecast.aiUnevidencedNotice`) instead of hiding it: the
estimate is *unverifiable*, not known to be wrong, and suppressing it would render identically
to an abstention — a different state the write layer deliberately distinguishes (daatan#1473).
An abstention takes precedence; the notice is shown only when a number is actually displayed.

`oracleSnapshot.sources` lists the **whole usable pool** on the pool path — the exact rows
`recomputeFromPool()` posted, mapped by `poolArticleToEnrichedSource()` — so
`sources.length === articlesUsed` and the stored snapshot lists precisely the articles its
number averages. (Before this, `sources` held only the run's own articles next to a
`mean`/`articlesUsed` describing the whole pool — the snapshot couldn't explain its own
number, and elections' per-commentator matching saw only those bylines.) The snapshot path
resolves authors from the run's own articles plus a news-indexer by-URL lookup for the rest
(`pooled-estimate.ts`), best-effort — a pooled article with no indexed byline is kept with a
null author, never dropped. (Pool rows also carry `author` directly since Phase 2.1; the
elections readers use that stored value.) The single-run **fallback** still stores just the
run's own sources, matching its `articlesUsed`.

### Credibility feedback loop (retro `docs/ORACLE_VARIABLES.md` §9)

When a `Prediction` resolves (`resolvePrediction()` in
`prediction-resolution.ts`) and `outcomeType === 'BINARY'` with a definite
outcome (not VOID/UNRESOLVABLE), the resolve route fire-and-forget calls
`pushCredibilityFeedback()` in `evidence-pool.ts`, which posts the
forecast's non-excluded, non-`opinion`-class pool articles' stances to
retro's `POST /leaderboard/ingest` (source, stance, evidence_class,
credibility_weight, evidence_weight, plus the boolean outcome). Storage-only
on retro's side today — accumulates real resolution data ahead of a future
scoring step; does not affect any live `credibility_weight`.

The same push carries the author-scoring lane (`author_signals`): every
non-excluded row with an `author_lean`, opinion-class INCLUDED (that lane
scores the author's own lean; opinion is the signal). Retro replays it per
(byline author, outlet) into a shadow author board
(`GET /leaderboard/author-shadow`) — also shadow-only, nothing feeds back
into forecasts.

### Pipeline alerting — `evidence_health_alerts` (#1478)

One row per condition the evidence pipeline is **currently** failing, keyed by a
stable string (`source-silent:bbc.co.uk`, `forecast-empty:<predictionId>`,
`overall-failure`, `batch-heartbeat-stale` / `batch-heartbeat-unreachable` — the
TruthMachine batch-loop liveness pair, retro#556). `forecast-empty` fires on the shared usable-row definition above, so it
asks the same question the aggregate does. It is fire/re-arm state, not a log: `checkEvidenceHealth()`
claims a condition by inserting its key — only the run that wins the insert
notifies, so overlapping runs can't double-page — and deletes the keys whose
condition no longer holds, which is what lets the same source page again the next
time it breaks. Empty table = pipeline currently clean.

Why a table and not `telegram.ts`'s in-memory `canNotify()`: these conditions
persist for days or weeks, and an in-memory cooldown resets on every deploy, so a
source that has been silent since last Tuesday would re-page after each release.
Same idiom as `predictions.market_divergence_alert_at`, moved off the row because a
source-level or pipeline-level condition has no row of its own to hang off.

### AI-panel 402 counter — `panel_payment_failures` (#1504)

One row per UTC day the panel saw `402 Insufficient credits` from OpenRouter:
`count`, `last_seen_at`, and `last_model` (the member that saw it last). Written
fire-and-forget by `recordPanelPaymentFailure()` (`src/lib/services/panel-failures.ts`)
from the sweep's failure path — a recording failure warns and is swallowed, never
delaying a panel call. This is the raw record, not alert state: the 402s only
surfaced in app logs, which the DB-driven digest can't read. `checkEvidenceHealth()`
fires one `panel-payment` digest line when any row's `last_seen_at` falls inside its
26h lookback (all OpenRouter members fail together on credit exhaustion, so any
nonzero count ≈ total panel outage); dedup lives in `evidence_health_alerts` above,
under the key `panel-payment`. Rows are tiny (one per bad day) and are kept.

## External markets — `external_markets`, `external_market_price_snapshots`

Cached Polymarket/Kalshi markets that forecasts link to (many-to-one).
Refreshed by the external-market-sync cron; `embedding` powers
suggest-on-create. Price snapshots are per-market (not per-prediction), 0–100
YES price, and since v1.32.x are written **only on a real price change** — the
newest snapshot's `createdAt` is the last *change*, not the last sync
(`lastSyncedAt` on the market is the freshness signal).

## LASSO (AI panel) — `ai_estimate_runs`, `ai_estimates`, `ai_member_scores`

Multi-LLM ungrounded probability series, modelled on the external-market
snapshots: charted (opt-in), scored, and **structurally unable to move the
needle** — nothing here is read by `recordEstimate`, the gauge, or any user
score. Canonical doc: [LASSO.md](./LASSO.md).

- `ai_estimate_runs` — one panel sweep over one forecast. `inputHash` is the
  date-gate (sha256 of claim + rules + resolveBy + UTC day + promptVersion +
  roster signature; grounded-scoped forecasts additionally fold in the grounded
  prompt's version and the article-set fingerprint, LASSO.md §9a); UNIQUE
  `(predictionId, inputHash)` makes the cron idempotent. In practice one run
  per open BINARY forecast per day. `contextSnapshot` (JSONB, null on
  ungrounded-only runs) freezes the news-indexer articles the grounded twins
  answered against — completion passes reuse it verbatim, never re-retrieve. A
  run written while some members couldn't be authenticated is *completed in
  place* by a later same-day sweep (estimates appended, LASSO.md §4), so a
  run's estimates may carry a later `createdAt` than the run itself.
- `ai_estimates` — one member's answer within a run. Member identity is
  `(model, mode, promptVersion)` — all plain strings, never enums, so adding
  a member needs no migration. `probability` is **0–100 Int, null =
  abstention**, and `callFailed` says *why*: true = the call threw (timeout,
  provider error, IAM) and the model never saw the claim; false = a genuine
  "claim too vague" decline. (Rows predating v1.54.0 were backfilled from the
  latency-IS-NULL inference.) `'oracle'` and `'market'` never appear here —
  they exist only as sentinel models in `ai_member_scores`.
- `ai_member_scores` — matched-time Brier per (commitment, member), written at
  resolution from the run pinned by `Commitment.aiRunIdAtCommit` (FK,
  `ON DELETE SET NULL` — deleting a run never deletes a commitment). Sentinel
  `model` values: `'oracle'` (scored from `aiProbabilityAtCommit`) and
  `'market'` (linked market price as of the commit instant); both carry
  `mode = 'sentinel'`. Feeds only `/leaderboard/ai`; no RS/ELO/Glicko path
  reads it. Carries the full member identity — `mode` (a grounded-indexer twin
  shares its sibling's model string; UNIQUE is `(commitmentId, model, mode)`)
  and `promptVersion` (null for the sentinels) — and the leaderboard groups by
  `(model, mode, promptVersion)`: scores produced under different prompt
  templates, or with vs without injected articles, are different members and
  are never averaged into one row.
- `users.showAiPanel` — per-user opt-in for the chart lines, default false.

## Commitments & scoring — `commitments`, ratings on `users`

`Commitment`: one per (user, prediction), `cuCommitted` stake, `probability`
(0.0–1.0!), commit-time snapshots (`rsSnapshot`,
`communityProbabilityAtCommit`, `aiProbabilityAtCommit`, `aiRunIdAtCommit` —
the LASSO run current at stake time, see above) and resolution-time
results (`rsChange`, `brierScore`, `peerScore`, `aiScore`, `eloChange`).

`commitment_revisions` (daatan#1281): append-only history of the mutable
fields, written by `updateCommitment` in the same transaction *before* each
in-place UPDATE — the commitment row is the current state, revisions are the
prior trajectory. Storage-only (nothing reads it); no backfill (history before
the table existed was never recorded); cascades away with its commitment.

Ratings live on `users` (`rs` reputation, Glicko-2 `mu/sigma/volatility`, ELO
`eloRating`) with per-tag variants in `user_tag_ratings`. All are **replayable
projections** of resolved commitments (`replayGlicko2History`,
`replayEloHistory`) — treat them as caches, not sources of truth. Leaderboard
sort indexes exist on each (`rs`, `eloRating`, `mu`, `correctPredictions` DESC).
See [SCORING_SYSTEMS.md](./SCORING_SYSTEMS.md).

`pundit_tag_ratings` is the same shape and formula, for a different population:
tracked pundits/outlets (news-indexer `Person`, keyed by `personId`, not a
`users` row — pundits don't commit/stake) scored on `evidence_pool_articles`
stance instead of `Commitment.probability`. No incremental update hook exists
(no resolution transaction to attach to) — it's seeded lazily per tag on first
read (`ensurePunditTagRatingsSeeded`, `src/lib/services/pundit-rating.ts`) by
replaying the SAME `calculateEloUpdates`/`glicko2Update` functions used above,
just fed evidence-pool rows. To force a recompute, delete the tag's rows.
Elections' pundit leaderboard reads this (not `user_tag_ratings`, and not
`getSourceLeaderboard`'s retro-backed `/leaderboard/sources` — that one is
global/all-topics and string-keyed by `(author, outlet)`, not tag-scoped or
`personId`-keyed).

## Users, auth & self-hosting

`users` + NextAuth tables (`accounts`, `sessions`, `verification_tokens`).
`password` is a bcrypt hash, null for Google-only accounts. Roles: USER | BOT |
RESOLVER | APPROVER | ADMIN. Self-hosted edition adds `invites` (SHA-256 of
the token, single-use via `acceptedAt`) and `settings` (key/value overrides of
.env — SaaS never writes rows).

## Social & i18n

`comments` (threaded via `parentId`, soft-deleted via `deletedAt`),
`comment_reactions` (one per user per comment), `notifications` +
`notification_preferences` (per type × channel matrix) + `push_subscriptions`
(browser push, per device). Translation caches: `prediction_translations`
(keyed (prediction, field, language), `sourceHash` = SHA-256 of the English
source so edits invalidate — the funnel's analyze origin deletes `detailsText`
rows on every summary rewrite) and `comment_translations`.

## Bots

`bot_configs` (persona/prompts, schedule, caps, staking range, approval flags —
one per BOT user), `bot_run_logs` (every run: action, trigger news, generated
text, dry-run flag), `bot_rejected_topics` (admin-rejected topics with keyword
sets to stop re-suggestion), `forecast_creation_attempts` (express-forecast
audit log incl. moderation/search failures). See [bots.md](./bots.md) and
[BOT_APPROVAL_WORKFLOW.md](./BOT_APPROVAL_WORKFLOW.md).

## News anchors

`news_anchors` — immutable snapshots of the article a forecast was created
from (`urlHash` SHA-256 unique for dedup, title/snippet/image captured at
anchor time).

## Cross-cutting gotchas

1. **Never write `Prediction.confidence`/`aiCiLow`/`aiCiHigh` directly** — go
   through `recordEstimate` so the snapshot stream, the cache, the settled
   latch and notifications stay consistent. (Bots are the one legacy exception.)
2. **`settled` is a one-way latch** (see above) — `recordEstimate` can only
   set it true, never clear it. An admin can clear a false settlement via
   `DELETE /api/admin/forecasts/[id]/settled` (`clearSettledLatch` in
   `context.ts`), surfaced as a "Clear settlement" button on the forecast
   page when `settled=true`. Clearing re-admits the forecast to the
   temporal clock's glide candidates on its next daily run.
3. **Pre-v1.31.2 `oracleSnapshot` rows were stance-scale** until the one-time
   normalization to percent on 2026-07-08. Live data is uniform now; only
   backups predating the fix still mix scales (see "Probability scales" above).
4. **`kind='clock'` rows are invisible on purpose** in timeline/anchor/dedup
   queries; the probability chart's `getProbabilityHistory` is the one reader
   that deliberately includes them (glide movement must be visible). New query
   paths over `context_snapshots` must decide explicitly whether clock rows
   belong.
5. **Text indexes depend on glibc collation** — after any base-image/OS
   upgrade, run the collation check before trusting slug lookups
   ([DATABASE_COLLATION.md](./DATABASE_COLLATION.md)).
6. **`embedding` columns don't exist for Prisma** — raw SQL only, and
   `pgvector` must be present in the image.
7. **Rolled-back rows in `_prisma_migrations` are historical, not pending**
   (traced 2026-08-15, daatan#1435). Prod carries two rows with
   `finished_at IS NULL AND rolled_back_at IS NOT NULL`:
   `20260225000000_add_context_snapshots` (failed 2026-03-06, `42P07` — the
   table already existed from an earlier route) and
   `20260430000000_add_prediction_embedding` (failed 2026-05-03 — the postgres
   image predated pgvector). Both were resolved with
   `prisma migrate resolve --rolled-back`, and **both have a later successful
   row for the same name**: `context_snapshots` via `resolve --applied`
   (`finished_at` set, `applied_steps_count = 0`), `prediction_embedding` by a
   genuine re-run after the pgvector image swap (its SQL is `IF NOT EXISTS`
   idempotent, `applied_steps_count = 1`). Prisma keys on the **latest** row
   per migration name, so nothing is pending and nothing will retry — deploys
   are unaffected. Staging shows the same shape (plus four failed attempts of
   `20260408000000_update_bot_model_preference` before its fifth succeeded).
   When diagnosing a migration failure: a failed row **with** a successful
   sibling row is settled history — only a failed row with **no** successful
   sibling blocks `migrate deploy`. Check with:
   `select migration_name, finished_at is not null as ok, rolled_back_at is not null as rb from _prisma_migrations where migration_name = '<name>' order by started_at;`
