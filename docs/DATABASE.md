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
  AI probability, not a bot field. `awaitingAiResolution` is level-based
  (set while `confidence` ≥ 90 or ≤ 10, recomputed on every write, never
  sticky) and only affects the Awaiting-Resolution tab, never `status`.
- **Settlement latch**: `settled`/`settledAt` — set when the Oracle reports the
  outcome as an accomplished fact (≥2 independent sources). **One-way**: only
  ever set true by the funnel; a later unsettled run does not clear it; human
  resolution supersedes. As of PR #1020, `settled` no longer locks commitments
  by itself — only a passed `resolveByDatetime` or an impossibility pin (a
  `claimDeadline` that has passed and agrees with `resolveByDatetime` within
  `DEADLINE_AGREEMENT_TOLERANCE_MS`) blocks new commitments (see
  `getCommitmentLockReason` in `commitment.ts`).
- **Temporal-model metadata** (glide; retro `TEMPORAL_MODEL_PLAN.md`):
  `claimDeadline` (parsed from claim *text* — deliberately distinct from
  `resolveByDatetime`; the two diverging triggers the divergence rule),
  `claimDirection` (ARRIVAL/SURVIVAL/NONE), `claimArchetype` (only DIFFUSE is
  priced), `tauLeadDays`, `classifierVersion/At/Output`. NULL
  `classifierVersion` = not yet classified (no glide).
- **Alert dedup timestamps**: `deadlinePassedAlertAt`, `teffProvisionalAlertAt`,
  `divergenceAlertAt` (requote cron), `marketDivergenceAlertAt` (market-sync
  cron) — single-shot alerts re-arm by timestamp comparison, not NULL checks.
- **External market link**: `externalMarketId` (+ `LinkedAt`, `LinkMethod`
  'manual' | 'ai-confirmed' | 'imported', and `externalMarketInverted` when the
  market asks the opposite question — UI plots `100 − price`).
- **Bot-creation metadata** (`source='bot'`): `sentiment`, `extractedEntities`,
  `consensusLine`, `sourceSummary`.

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
| `insufficientData` | the run abstained — UI shows "Insufficient evidence"; the funnel also clears the prediction's cache trio |
| `meta` | clock provenance `{engineVersion, cause, pLast, tLast, tEff, c, direction}` |
| `summary` / `externalReasoning` | analyze-run LLM summary / writer reasoning marker |

Funnel invariants: `confidence` and `aiCiLow/aiCiHigh` on the prediction move
**atomically** (written together, cleared together on abstention, both
untouched when a run yields no number); the settled latch and all
notifications are decided by the per-origin policy table in `context.ts`.
Known bypass: bot creation (`bots/stake.ts`) still writes predictions directly.

Supporting tables: `context_timings` (per-analyze phase latencies),
`oracle_call_logs` (every Oracle API call: type, source workflow, provider
chain, failure reason, LLM-fallback flag — the observability layer for the
search/forecast chain).

## Evidence pool (foundation layer) — `evidence_pool_articles`

Per-forecast, keyed by `(predictionId, urlHash)` — `urlHash` is `hashUrl()`
(same normalization as `NewsAnchor`), so http/https and trailing-slash variants
of the same URL collapse to one row. **Foundation layer only (2026-07-09,
retro `docs/ORACLE_VARIABLES.md` §6 part 2): nothing reads this table to
compute an estimate yet.** `analyze`/`news-indexer`/`backfill` shadow-write
their per-source signal here (`addArticlesToPool` in
`src/lib/services/evidence-pool.ts`) in *addition to*, not instead of, their
existing `ContextSnapshot`/`Prediction` writes — fire-and-forget, so a
failure there never blocks or alters the estimate. The row IS the extraction
cache: re-discovering an already-pooled article updates its stored signal in
place. `excluded` is settable via the forecast page's admin-only "Evidence
pool" panel (`EvidencePoolAdmin.tsx`, `PATCH
/api/admin/forecasts/[id]/evidence-pool/[articleId]`) — shadow-writes never
touch it, so an admin's exclusion decision survives re-discovery. **Not yet
enforced by any computation** — the recompute-over-pool cutover (the
ORACLE_VARIABLES.md §6 precondition this satisfies) is still open, so
excluding an article here has no effect on the live estimate today.

## External markets — `external_markets`, `external_market_price_snapshots`

Cached Polymarket/Kalshi markets that forecasts link to (many-to-one).
Refreshed by the external-market-sync cron; `embedding` powers
suggest-on-create. Price snapshots are per-market (not per-prediction), 0–100
YES price, and since v1.32.x are written **only on a real price change** — the
newest snapshot's `createdAt` is the last *change*, not the last sync
(`lastSyncedAt` on the market is the freshness signal).

## Commitments & scoring — `commitments`, ratings on `users`

`Commitment`: one per (user, prediction), `cuCommitted` stake, `probability`
(0.0–1.0!), commit-time snapshots (`rsSnapshot`,
`communityProbabilityAtCommit`, `aiProbabilityAtCommit`) and resolution-time
results (`rsChange`, `brierScore`, `peerScore`, `aiScore`, `eloChange`).

Ratings live on `users` (`rs` reputation, Glicko-2 `mu/sigma/volatility`, ELO
`eloRating`) with per-tag variants in `user_tag_ratings`. All are **replayable
projections** of resolved commitments (`replayGlicko2History`,
`replayEloHistory`) — treat them as caches, not sources of truth. Leaderboard
sort indexes exist on each (`rs`, `eloRating`, `mu`, `correctPredictions` DESC).
See [SCORING_SYSTEMS.md](./SCORING_SYSTEMS.md).

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
