# Daatan API Reference

All endpoints are prefixed with `/api`. Unless noted, protected endpoints require a valid NextAuth session cookie.

## Auth conventions

| Pattern | Meaning |
|---------|---------|
| Public | No auth required |
| Auth | Any authenticated user |
| Admin | `role = ADMIN` |
| Admin / Approver | `role = ADMIN` or `role = APPROVER` |
| Admin / Resolver | `role = ADMIN` or `role = RESOLVER` |
| Bot secret | `X-Bot-Runner-Secret` header = `BOT_RUNNER_SECRET` env |

---

## Forecasts

### `GET /api/forecasts`
List predictions. Public; optional session for user-context fields.

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | enum | — | `DRAFT`, `ACTIVE`, `PENDING`, `PENDING_APPROVAL`, `RESOLVED_*`, `VOID`, `UNRESOLVABLE`. `PENDING` ("Awaiting Resolution") also matches still-`ACTIVE` forecasts where `awaitingAiResolution` is true (AI estimate >=90% or <=10%, see `context.ts`) — status itself doesn't change, so staking stays open until the real deadline |
| `authorId` | cuid | — | Filter by author |
| `tags` | string | — | Comma-separated tag names |
| `page` | number | 1 | |
| `limit` | number | 20 | max 100 |
| `sortBy` | enum | `newest` | `newest`, `deadline`, `cu` |
| `resolvedOnly` | bool | false | |
| `closingSoon` | bool | false | Within 7 days |

**Response** `{ predictions: [...], pagination: { page, limit, total, totalPages } }`

---

### `POST /api/forecasts` — Auth
Create a new prediction (status = DRAFT).

**Body** — `createPredictionSchema` (`src/lib/validations/prediction.ts`)

**Response** `201` — created prediction with author, newsAnchor, options

---

### `GET /api/forecasts/[id]`
Get single forecast by id or slug. Public; returns `userCommitment` if authenticated.

---

### `PATCH /api/forecasts/[id]` — Auth
Update forecast (author or admin). Core fields editable only on DRAFT; `isPublic` editable on any status.

**Body** — `patchPredictionSchema` (claimText, detailsText, resolutionRules, resolveByDatetime, isPublic)

---

### `DELETE /api/forecasts/[id]` — Auth
Delete forecast. Only DRAFT status allowed (admin can delete any).

---

### `POST /api/forecasts/[id]/publish` — Auth
Transition DRAFT → ACTIVE. Author only.

---

### `POST /api/forecasts/[id]/resolve` — Admin / Resolver
Resolve a prediction. Processes all commitments, distributes rewards, updates balances in one transaction.

**Body**

```json
{
  "outcome": "correct" | "wrong" | "void" | "unresolvable",
  "evidenceLinks": ["https://..."],
  "resolutionNote": "string",
  "correctOptionId": "cuid"  // required for MULTIPLE_CHOICE
}
```

**Response** — the updated `Prediction` row, plus `timings` (daatan#1139): how long the transaction's two phases took — `scoringMs` (per-commitment Brier/RS/Glicko-2) and `updatingMs` (ELO + per-tag rating write-back). `ResolutionForm.tsx`'s "Scoring commitments…" / "Updating ratings…" step labels use these to self-calibrate their client-side timer (`@/lib/forecast-timing`, same EWMA pattern as forecast creation), the same way `POST /api/forecasts/[id]/research`'s `timings` already calibrates its own step labels.

```jsonc
{
  "id": "cuid", "status": "RESOLVED_CORRECT", /* ...rest of the Prediction row... */
  "timings": { "scoringMs": 340, "updatingMs": 120 }
}
```

---

### `POST /api/forecasts/[id]/approve` — Admin / Approver
Approve a bot `PENDING_APPROVAL` forecast → ACTIVE. Stakes on behalf of the bot.

---

### `POST /api/forecasts/[id]/reject` — Admin / Approver
Reject a bot `PENDING_APPROVAL` forecast → VOID. Creates `BotRejectedTopic`.

**Body**

```json
{
  "keywords": ["string"],   // optional, max 20
  "description": "string"   // optional, max 500
}
```

---

### `POST /api/forecasts/[id]/commit` — Auth
Create or update a commitment on a forecast.

**Body**

```json
{
  "confidence": -100,      // BINARY: -100 (certain NO) to +100 (certain YES); sign determines direction
  "confidence": 75,        // MULTIPLE_CHOICE: 1–100 certainty level
  "optionId": "cuid"       // required for MULTIPLE_CHOICE
}
```

`binaryChoice` is derived server-side from the sign of `confidence` (positive = YES).

---

### `GET /api/forecasts/[id]/commit/preview` — Auth
Preview expected RS outcomes before committing.

**Response** `{ confidence, probability, rsIfRight, rsIfWrong }`

---

### `GET /api/forecasts/[id]/context`
Return the public context timeline for a forecast (list of dated context snapshots with source articles and the AI probability estimate at that time). Public — no auth required.

**Response** — `{ currentContext, contextUpdatedAt, snapshots: ContextSnapshot[] }`, each snapshot shaped as:

```jsonc
{
  "id": "cuid",
  "predictionId": "cuid",
  "summary": "string",
  "sources": [{ "title": "...", "url": "...", "source": "...", "publishedDate": "..." }],
  "externalProbability": 64,                          // 0–100, or null
  "externalReasoning": "TruthMachine Oracle (...)",   // or null
  "origin": "analyze",                                // which path wrote it: creation | analyze | news-indexer | backfill | clock; null on pre-funnel rows
  "articlesUsed": 3,                                  // Oracle evidence volume, or null (legacy / LLM fallback / clock)
  "oracleSnapshot": {                                 // null when LLM-fallback path was used
    "mean": 64,                                       // 0–100 percent, all rows (historical stance-scale rows normalized 2026-07-08 — see docs/DATABASE.md)
    "std": 6,                                         // 0–100 percent spread
    "ciLow": 52,                                      // 0–100, pre-scaled 95% CI
    "ciHigh": 76,
    "articlesUsed": 3,
    "sources": [
      {
        "sourceId": "reuters",
        "sourceName": "Reuters",
        "url": "https://reuters.com/...",
        "stance": 0.7,                                // [-1, 1], sign = YES/NO lean
        "certainty": 0.85,                            // [0, 1]
        "credibilityWeight": 0.95,                    // leaderboard weight, ~1.0 = neutral
        "claims": ["..."]
      }
    ]
  },
  "createdAt": "ISO-8601"
}
```

---

### `POST /api/forecasts/[id]/context` — Auth
Refresh the AI context for a forecast: fetches web articles for the claim, asks an LLM to summarise them, computes an "AI %" probability, and appends a new snapshot to the context timeline. Author-only and rate-limited to once per 24h per forecast.

**Probability source (tried in order):**

1. **TruthMachine Oracle API** (`POST ${ORACLE_URL}/forecast`) — calibrated multi-source estimate. Used when `ORACLE_URL` and `ORACLE_API_KEY` are set and the Oracle returns a non-placeholder response with at least one usable article. See [docs/LLM_ARCHITECTURE.md](./LLM_ARCHITECTURE.md#oracle-api-integration). When this path is taken, the full Oracle payload (mean, std, 95% CI, per-source stance/certainty/credibility) is persisted on the snapshot in the `oracleSnapshot` field and surfaced in the UI.
2. **LLM `guessChances`** (Gemini → Oracle → OpenRouter → Ollama fallback) — used when the forecast Oracle path is unconfigured, times out, returns `placeholder: true`, or the API version is incompatible. Snapshots from this path have `oracleSnapshot = null`.

The chosen source is recorded in `externalReasoning` on the snapshot (`"TruthMachine Oracle (calibrated multi-source estimate)"` vs the LLM-generated justification).

**Response** — `{ success, newContext, contextUpdatedAt, snapshot, timeline }` where `snapshot` and each `timeline` entry use the same `ContextSnapshot` shape documented under `GET /api/forecasts/[id]/context` above (including the optional `oracleSnapshot` field).

---

### `POST /api/forecasts/[id]/research` — Auth
AI-assisted resolution research for resolvers. Searches for recent articles about the forecast claim (Oracle → 3-way parallel local fallback), optionally generates better queries via LLM if initial results are sparse, then asks an LLM to suggest a resolution outcome and evidence links. Rate-limited to 10 calls per hour per user. Requires `RESOLVER` or `ADMIN` role.

**Response**

```jsonc
{
  "outcome": "correct",          // "correct" | "wrong" | "void" | "unresolvable"
  "reasoning": "string",         // LLM explanation for the suggested outcome
  "evidenceLinks": ["https://..."],  // URLs found that support the resolution
  "correctOptionId": "opt_cuid", // only set for MULTIPLE_CHOICE predictions
  "timings": { "searchMs": 8200, "llmMs": 9400, "totalMs": 17600 }
}
```

---

### `GET /api/forecasts/similar`
Find forecasts similar to a given forecast (by ID) or query text, using pgvector cosine similarity on Gemini `gemini-embedding-2` embeddings. Public — no auth required. Returns results from `ACTIVE` and `PENDING_APPROVAL` forecasts only, filtered to cosine similarity ≥ 0.75.

**Query params**

| Param | Required | Description |
|-------|----------|-------------|
| `id` | one of `id`/`q` | Forecast ID to find similar forecasts for (claimText + tags fetched automatically) |
| `q` | one of `id`/`q` | Free-text query to embed (max 200 chars) |
| `tags` | no | Comma-separated tag names used to boost results with shared tags (max 10, 50 chars each) |
| `limit` | no | Max results to return (default `3`, max `10`) |
| `language` | no | Supported non-English locale (`he`/`ru`/`eo`): overlays cached claimText translations. Each entry gains `translated: boolean`; a cache miss keeps the English claim (clients can fill it via `POST /api/forecasts/[id]/translate`). Never triggers new translations. |

**Response** — `{ similar: SimilarForecast[] }`, each entry shaped as:

```jsonc
{
  "id": "cuid",
  "slug": "bitcoin-will-reach-100k-by-2026",
  "claimText": "Bitcoin will reach $100k by end of 2026",
  "status": "ACTIVE",
  "resolveByDatetime": "2026-12-31T00:00:00Z",
  "author": { "name": "Alice", "username": "alice" },
  "score": 0.91    // cosine similarity, 0–1
}
```

Returns `{ similar: [] }` when no embedding is available (Gemini API key not configured) or no results pass the similarity threshold.

---

### `POST /api/forecasts/suggest-market` — Auth
Called by the create wizard after the claim step to offer linking a "same question" external market. **Body** `{ claimText, deadline? }` — `deadline` is an optional ISO 8601 datetime the wizard sends only once the resolution date is known (prefilled express / AI-extract / market-import flows), penalizing candidates that resolve far from it. Keyword-prefilters candidates, embeds the claim + each candidate, and returns `{ match }` with the single best market only when its deadline-adjusted cosine similarity clears the auto-link threshold, else `{ match: null }`. Best-effort; returns `{ match: null }` when external markets are disabled or embeddings are unavailable.

---

### `GET /api/forecasts/[id]/translate` — Auth
Return translated version of the forecast in the user's language preference. Rate-limited to 20 requests/hour per IP (429 on exceed); cache hits don't count against the quota.

---

### `POST /api/forecasts/express/generate` — Auth
Generate an "express" forecast via AI from a URL or topic.

---

### `POST /api/forecasts/express/guess` — Auth
Estimate the probability that a given claim will resolve YES, based on supplied article search results.

**Body**

```json
{
  "claimText": "string",
  "detailsText": "string",
  "articles": [{ "title": "...", "url": "...", "snippet": "..." }]
}
```

**Response** `{ probability: number, reasoning: string }` (probability is `0–100`).

Same Oracle-first → LLM-fallback logic as `POST /api/forecasts/[id]/context` above.

---

## Commitments

### `GET /api/commitments` — Auth
List commitments for the current user.

**Query params** — `listCommitmentsQuerySchema` (predictionId, status, page, limit)

---

### `GET /api/commitments/stats` — Auth
Aggregate stats for the current user's commitments (total, resolved, correct/wrong, accuracy, avg Brier score). Correct/wrong are derived from each commitment's Brier score (`< 0.25` = correct), matching the resolution engine.

---

### `GET /api/commitments/activity` — Auth
Recent commitment activity feed.

---

## Comments

### `GET /api/comments`
List comments. Accepts `predictionId` query param.

### `POST /api/comments` — Auth
Create a comment.

### `PATCH /api/comments/[id]` — Auth
Edit a comment (author only).

### `DELETE /api/comments/[id]` — Auth
Delete a comment (author or admin).

### `POST /api/comments/[id]/react` — Auth
Add or remove a reaction.

### `POST /api/comments/[id]/translate` — Auth
Translate a comment. Rate-limited to 30 requests/hour per IP (429 on exceed).

---

## Notifications

### `GET /api/notifications` — Auth
List notifications for the current user.

### `PATCH /api/notifications/[id]` — Auth
Mark notification as read.

### `GET /api/notifications/unread-count` — Auth
Return `{ count: number }`. Rate-limited to 120 requests/minute per user (429 on exceed).

### `GET /api/notifications/preferences` — Auth
Get notification preferences.

### `PATCH /api/notifications/preferences` — Auth
Update notification preferences.

---

## Profile

### `PATCH /api/profile/update` — Auth
Update profile (name, username, bio, etc.).

### `POST /api/profile/avatar` — Auth
Upload avatar image. Accepts multipart form with `file` field.

### `PATCH /api/profile/language` — Auth
Set preferred display language.

### `GET|PATCH /api/user/preferences` — Auth
Chart/display preferences. Currently one whitelisted boolean: `showAiPanel`
(the LASSO chart opt-in, [LASSO.md](./LASSO.md) §8). PATCH body
`{ showAiPanel: boolean }`, 400 on anything else; nothing here can touch
scoring, roles, or profile identity.

---

## Leaderboard & Stats

### `GET /api/leaderboard`
Top users ranked by the selected scoring system. Public. Rate-limited to 60 requests/hour per IP.
Result cached 5 min per `(limit, sortBy, tag)` combination via `unstable_cache` (#1204) — rankings
move slowly (only on resolution events), so this avoids the full multi-query aggregation
(scoped to all `isPublic` users) rerunning on every page view/filter change.

| Query | Type | Default | Description |
|-------|------|---------|-------------|
| `sortBy` | enum | `rs` | One of: `rs`, `accuracy`, `totalCorrect`, `cuCommitted`, `brierScore`, `peerScore`, `aiScore`, `elo`, `glicko`, `roi`, `truthScore`, `weightedPeerScore`. See `docs/SCORING_SYSTEMS.md`. |
| `tag` | string | – | Filter by tag slug. When provided, ELO and Glicko-2 are read from the materialized `UserTagRating` table (seeded lazily on first request for that tag); other sorts are filtered to commitments on predictions tagged with the slug. |
| `limit` | int | `50` | Max users to return (capped server-side). |

### `GET /api/top-reputation`
Top users by reputation for sidebar widget. Public. Rate-limited to 60 requests/hour per IP.

### `GET /api/profile/[id]/glicko-history`
Skill history (μ, σ, μ−3σ) over time for the user's profile chart. Public.

---

## Tags

### `GET /api/tags`
List all tags with usage counts. Public.

### `POST /api/tags` — Admin
Create a tag.

### `DELETE /api/tags/[id]` — Admin
Delete a tag.

---

## AI

### `POST /api/ai/extract` — Auth
Extract structured prediction data from free text. Rate-limited to 20 requests/hour per IP (429 on exceed).

### `POST /api/ai/suggest-tags` — Auth
Suggest relevant tags for a forecast. Rate-limited to 10 requests/hour per user (429 on exceed).

---

## Push Notifications

### `POST /api/push/subscribe` — Auth
Register a Web Push subscription.

---

## News Anchors

### `GET /api/news-anchors` — Auth
List news anchors the user has used.

---

## Admin

All admin endpoints require `role = ADMIN`.

### `GET /api/admin/forecasts`
List all forecasts regardless of status.

### `PATCH /api/admin/forecasts/[id]`
Admin-level forecast update (no status restrictions).

### `GET /api/admin/forecasts/[id]/external-market`
Candidate external markets (Polymarket / Kalshi) matching the forecast's claim — keyword search (at most 2 markets kept per source event) re-ranked by embedding similarity with a deadline-gap penalty. Only candidates whose similarity clears a relevance floor are returned, each with a `score` (0–100 match); a claim with no real equivalent returns `[]` rather than the least-bad markets, and suggestions are suppressed entirely when embeddings are unavailable. Suggestion only; an admin confirms via POST.

### `POST /api/admin/forecasts/[id]/external-market`
Link a market by pasted URL. **Body** `{ url }`. On first link the market's full provider-side price history is backfilled (Polymarket CLOB `prices-history`, best-effort, capped at 400 points) so the chart's Market line starts at the market's birth, then the current price is seeded; the hourly `external-market-sync` cron owns the series from there. Resets `inverted` to false.

### `PATCH /api/admin/forecasts/[id]/external-market`
Set the link's polarity. **Body** `{ inverted: boolean }` — mark the linked market as asking the *opposite* question (e.g. claim "X will not win" vs market "Will X win?"). Stored per-prediction (`externalMarketInverted`); the UI then displays 100 − market price everywhere and labels the Market line "(inverted)". `409` when no market is linked.

### `DELETE /api/admin/forecasts/[id]/external-market`
Unlink the market (also clears the inverted flag).

### `GET /api/admin/forecasts/[id]/evidence-pool`
List the forecast's evidence pool (`evidence_pool_articles`) — every article `analyze`/`news-indexer`/`backfill` have extracted a signal from. See `docs/DATABASE.md` "Evidence pool"; since v1.60.0 the pool aggregate *is* the persisted estimate on all three paths.

### `PATCH /api/admin/forecasts/[id]/evidence-pool/[articleId]`
Toggle one pooled article's `excluded` flag. **Body** `{ excluded: boolean }`. `404` if the article doesn't belong to this forecast. Excluded rows are dropped from the pool aggregate on every path, so the toggle genuinely moves the estimate.

### `POST /api/admin/evidence-pool/retry` — Admin or `x-cron-secret`
Drain stuck evidence-pool rows (FAILED except the terminal reasons `oracle_omitted`/`oracle_null_final`, abandoned PENDING claims ≥24h old) by re-driving them through extraction, biggest ACTIVE-forecast backlogs first. A row that comes back null twice in a row is finalized (`oracle_null_final`) — the sweep stops asking, though an organic re-push with changed content can still revive it. Both strikes must be **attributable**: only `oracle_abstain`/`oracle_no_articles` count, i.e. the Oracle actually ran and declined. A timeout, network or HTTP failure retires nothing — one call carries up to 15 rows, so a single client-side failure used to stamp the whole batch terminal on no information at all (daatan#1253). See [DATABASE.md](./DATABASE.md). `?limit=N` predictions per call (default 3, max 10 — each is one full Oracle analysis). Returns per-status tallies (incl. `finalized`) plus `remaining`; re-call until it stops shrinking. Driven headlessly by the `Retry Pool Extractions` workflow — scheduled weekly (Mondays 06:30 UTC, against production) plus manual dispatch.

### `POST /api/admin/forecasts/backfill-rules` — Admin
LLM-generate resolution rules for all forecasts that are missing them. Long-running (up to 300s).

### `POST /api/admin/backfill-embeddings` — Admin
Generate vector embeddings (gemini-embedding-2, 768 dims) for predictions that don't yet have one. Used to power similar-forecasts lookup. Long-running.

### `GET /api/admin/oracle-stats` — Admin
Oracle usage statistics for the admin **Oracle** tab. Every Oracle call (all call types, success **and** failure) is recorded in `OracleCallLog` with its `callType` (SEARCH, FORECAST, LEADERBOARD, HEALTH, SEARCH_HEALTH, LLM, FETCH_URL), `source` (the Daatan workflow that triggered it — e.g. `context-update`, `bot-voting`, `express-creation`), `status` (OK/EMPTY/ERROR), search engine, latency, and the triggering user/bot. A FORECAST call also records `failureReason` when it failed/came back empty — transport failures are daatan-derived (`timeout`, `network`, `http_5xx`, `http_4xx`); EMPTY responses pass through the Oracle's own `reason` (`no_search_results`, `all_articles_off_topic`, `no_usable_weight`, `no_decisive_signal`, `all_fetches_failed`, `extraction_errors`, `no_usable_predictions`, `no_result`, `oracle_timeout`). When the caller abandons the Oracle result and uses the LLM fallback, `fellBackToLlm` is set and `fallbackProbability` records the 0–100 the LLM produced. The log self-prunes to 30 days.
Query: `?windowDays=` (1–30, default 30). Response: `{ windowDays, totals: { totalCalls, errorCalls, errorRate, avgDurationMs }, bySource[], byCallType[], byEngine[], byStatus[], byFailureReason[], fallback: { count, rate, avgProbability, extremeCount }, recent[] }` — each breakdown row is `{ key, callCount, errorCount, avgDurationMs, lastSeenAt }`; `byFailureReason` rows are `{ key, callCount }`; `fallback.rate` is the share of FORECAST calls that fell back, `extremeCount` counts fallbacks above 85% or below 10%.

### `GET /api/admin/forecast-attempts` — Admin
Analytics for Express forecast creation attempts. Returns success rate, daily breakdown, top moderation rejection reasons, and per-user attempt patterns over the last 30 days. Useful for tuning LLM moderation prompts.

```json
{
  "summary": { "total": 1240, "successRate": 0.71, "byOutcome": { "SUCCESS": 884, "MODERATED": 248, "DUPLICATE": 108 } },
  "daily": [{ "date": "2026-05-28", "outcome": "SUCCESS", "count": 42 }],
  "moderationReasons": [{ "reason": "too_vague", "count": 112 }],
  "topUsers": [{ "userId": "...", "name": "Alice", "total": 38, "successCount": 29 }]
}
```

### `POST /api/admin/recalculate-elo` — Admin
Replay ELO history from scratch over all resolved commitments. Used after data corrections.

### `GET /api/admin/approvals`
List forecasts with status `PENDING_APPROVAL`.

### `GET /api/admin/users`
List all users.

### `GET /api/admin/users/[id]`
Get user details.

### `PATCH /api/admin/users/[id]`
Update user role.

### `GET /api/admin/comments`
List all comments.

### `DELETE /api/admin/comments/[id]`
Delete any comment.

### `GET /api/admin/bots`
List all bot configs.

### `POST /api/admin/bots`
Create a bot config.

### `PATCH /api/admin/bots/[id]`
Update a bot config.

### `DELETE /api/admin/bots/[id]`
Delete a bot config.

### `POST /api/admin/bots/[id]/run`
Manually trigger a bot run.

### `GET /api/admin/bots/[id]/logs`
Fetch recent bot run logs.

### `GET /api/admin/news-indexer/sources` — Admin
Proxy to the news-indexer `/sources` list (the configured `sources.yaml` joined to per-source forecast-match impact). Backs the admin **Sources** tab. Returns the news-indexer payload verbatim with its status. Responds `503 News-indexer not configured` when `NEWS_INDEXER_URL` / `NEWS_INDEXER_API_KEY` are unset.

### `GET /api/admin/news-indexer/sources/[name]` — Admin
Proxy to news-indexer's `GET /outlets/{name}` — one outlet's identity enrichment (Wikipedia URL, Telegram channel, links, notes — null/empty until an admin fills them in) merged with its `sources.yaml` config and forecast-match-derived impact + up to 50 recent publications. Backs the admin Sources detail page (`/admin/sources/[name]`, linked from each row in the Sources tab). Same `503` behavior as above.

### `PUT /api/admin/news-indexer/sources/[name]` — Admin
Proxy to news-indexer's `PUT /outlets/{name}` — upsert the enrichment fields. Body: `{ wikipedia_url?, telegram_channel?, links?: [{label,url}], notes? }`; only fields sent as non-null are changed. Returns the updated identity object with its status.

### `DELETE /api/admin/news-indexer/sources/[name]` — Admin
Proxy to news-indexer's `DELETE /outlets/{name}` — clears an outlet's enrichment row entirely (not exposed in the current UI; available for future use).

### `POST /api/admin/news-indexer/match` — Admin
Proxy to the news-indexer `/match` endpoint — re-match a single article URL against active forecasts on demand. Body: `{ articleUrl: string }` (must be a valid URL). Returns the news-indexer response (`{ matches, queued }`) with its status. Responds `503 News-indexer not configured` when `NEWS_INDEXER_URL` / `NEWS_INDEXER_API_KEY` are unset.

### `GET|POST /api/admin/news-indexer/authors` — Admin
`GET` proxies news-indexer's `/authors/admin/people` — every curated person with their raw alias rows. `POST` proxies `/authors` to create one; body `{ canonical_name, notes? }`. Backs the admin **Authors** tab (`/admin/authors`).

### `PATCH|DELETE /api/admin/news-indexer/authors/[id]` — Admin
Rename a person or edit their notes (`PATCH`, body `{ canonical_name?, notes? }`), or delete them and cascade their aliases (`DELETE`).

### `POST /api/admin/news-indexer/authors/[id]/aliases` — Admin
Add a byline / channel-name alias to a person. Body: `{ alias: string }`.

### `DELETE /api/admin/news-indexer/authors/[id]/aliases/[aliasId]` — Admin
Remove one alias.

All four reject an `[id]` / `[aliasId]` that is not a UUID with `400` before building the upstream URL, and share the `503 News-indexer not configured` behavior above. Upstream is FastAPI and reports failures as `{detail}`; the proxy rewrites that to Daatan's `{error}` shape and forwards the status.

> **Why these are proxied rather than linked.** news-indexer's own `/admin` page asks the operator to paste an API key into the browser. That key is `NEWS_INDEXER_SECRET`, which also gates `/search`, `/enqueue` and `/ledger` and authenticates news-indexer back to Daatan — so it must not reach a browser. Routing through Daatan keeps the key server-side and replaces the single shared credential with a per-user `ADMIN` check, which also gives the mutations a real audit trail (upstream can only log that *someone* with the key made a change).

---

## IBI Analysis (Admin only)

Server-side proxy routes for the IBI retro analysis tool at `/ibi`. All three routes require an authenticated ADMIN session. Oracle calls are made server-side using `ORACLE_API_KEY` — the key is never exposed to the browser.

### `POST /api/ibi/fetch-url` — Admin
Fetch and extract text/title/date from a URL. Proxies to Oracle `/fetch-url`.

**Body** `{ "url": "https://..." }`

**Response** `{ "text": "...", "title": "...", "date": "YYYY-MM-DD" }`

**Safe URL fetching (SSRF).** Any server-side URL fetch goes through `assertSafeUrl` in `src/lib/utils/scraper.ts`: HTTPS-only, and after DNS resolution it rejects private, loopback, link-local, and IMDS (`169.254.0.0/16`) addresses. Redirects are followed manually (`redirect: 'manual'`) with the safety check re-run on every hop, so a public host cannot 30x-redirect into an internal target.

### `POST /api/ibi/search` — Admin
Article search via Oracle's provider fallback chain. Proxies to Oracle `/search`.

**Body** `{ "query": "string", "limit": 10, "date_to": "YYYY-MM-DD" }`

**Response** `{ "results": [{ "title", "url", "snippet", "source", "published_date" }] }`

### `POST /api/ibi/llm` — Admin
LLM call proxied to the Oracle `/llm` endpoint (AWS Bedrock / Amazon Nova via litellm). `model` is a litellm ID and defaults to the Oracle's configured Bedrock model when omitted.

**Body** `{ "model": "bedrock/amazon.nova-pro-v1:0", "messages": [{ "role": "user", "content": "..." }], "temperature": 0.1 }`

**Response** `{ "content": "..." }`

---

## Bots

### `POST /api/bots/run` — Bot secret
Trigger the bot runner. Used by the GitHub Actions cron workflow.

**Header** `X-Bot-Runner-Secret: <BOT_RUNNER_SECRET>`

---

## System

### `GET /api/meta/timings`
Returns average server-side timing samples for the context-analysis pipeline (search → LLM → Oracle) aggregated over the last 30 days. The client uses these estimates to drive step-progress labels ("Searching… 10s → Analyzing… 12s → Estimating… 8s"). Public — no auth required.

**Response**

```jsonc
// When ≥ 3 samples exist:
{ "hasData": true, "sampleCount": 142, "timings": { "searchMs": 9800, "llmMs": 11200, "oracleMs": 7400 } }

// When fewer than 3 samples:
{ "hasData": false, "timings": { "searchMs": 10000, "llmMs": 12000, "oracleMs": 8000 } }
```

---

### `GET /api/health`
Liveness + readiness probe. Returns `200` when the DB is reachable, `503` when it is not.

```json
{
  "status": "ok",         // "ok" | "degraded"
  "version": "1.22.6",    // app version from src/lib/version.ts
  "commit": "e3a594f",    // short GIT_COMMIT baked at build time
  "timestamp": "2026-04-16T17:31:45.056Z",
  "env": "production",    // APP_ENV
  "db": true
}
```

### `GET /api/health/auth`
Auth subsystem health check.

### `GET /api/health/search`
Search provider health check. Returns credit/status for Serper, SerpAPI, and ScrapingBee.

### `GET /api/cron/cleanup`
Clean up expired/stale data. Intended for cron use.

### `GET /api/cron/heartbeat`
Liveness probe used by external monitoring. Verifies app + DB and emits a metric.

### `GET /api/cron/search-health`
Periodic search-provider health check. Triggers a Telegram alert if a provider is degraded.

### `GET /api/cron/oracle-health`
Checks Oracle API reachability and version compatibility. Fires a Telegram alert (`notifyOracleForecastUnavailable`) when the Oracle is down. Rate-limited to one alert per 5-minute window. Intended to run every 30 minutes via EC2 crontab.

**EC2 crontab:** `0,30 * * * * curl -sf -H "x-cron-secret: $BOT_RUNNER_SECRET" https://daatan.com/api/cron/oracle-health`

### `GET /api/cron/backfill-embeddings`
Generates missing vector embeddings in batches of 20. Picks up predictions where `embedding IS NULL` and calls the Gemini embedding API. Returns `{ ok, done, failed, remaining }`. Intended to run nightly.

**EC2 crontab:** `30 2 * * * curl -sf -H "x-cron-secret: $BOT_RUNNER_SECRET" https://daatan.com/api/cron/backfill-embeddings`

### `GET /api/cron/ai-panel`
LASSO panel sweep ([LASSO.md](./LASSO.md) §9): asks every panel member for an
ungrounded probability on every open BINARY forecast; date-hash-gated to one
call per member per forecast per day. Auth: `x-cron-secret` header
(`BOT_RUNNER_SECRET`), 401 otherwise. Query params: `?dryRun=1` (build/log
prompts, write nothing — reports `{written: 0, dryRun: N}`), `?limit=N`.
Returns the sweep summary; **502** when the OpenRouter key was rejected (even
if Bedrock members carried the sweep — a dead key must fail loudly), 200 with
`{dormant: true}` when no member can authenticate at all (deliberate state).
Triggered by `.github/workflows/ai-panel.yml` at 04:43 and 16:43 UTC, not the
EC2 crontab.

### `POST /api/cron/requote`
Temporal-clock daily driver: pure-arithmetic glide requote per open forecast
(no Oracle/search/LLM call except the bounded self-heal classification pass).
Auth: `x-cron-secret` header. JSON body `{ archetypes?: string[], dryRun?:
boolean }` — archetypes defaults to `["diffuse"]` and comes from the
`TEMPORAL_CLOCK_ARCHETYPES` repo variable; `TEMPORAL_CLOCK_DISABLED=true` on
the server is a hard kill switch (returns `{ok: true, disabled: true}`).
Triggered by `.github/workflows/requote.yml` daily at 05:31 UTC.

Each non-dry run also performs the **stuck-PENDING sweep** (#1185),
independent of the archetype allowlist: any `PENDING` prediction whose
`claimDeadline` passed >12h ago with no `deadlinePassedAlertAt` gets a
one-shot clean-channel Telegram alert ("resolve via the admin UI") and the
stamp. Alert-only — resolution semantics are untouched; only the
`TEMPORAL_CLOCK_DISABLED` kill switch stops it.

### `GET /api/cron/external-market-sync`
Refreshes every cached Polymarket/Kalshi market that at least one forecast
links to: pulls the latest YES price, writes an `ExternalMarketPriceSnapshot`
(only on a real price change — drives the "Market" chart line), and updates
resolution status. Auth: `x-cron-secret` header. Best-effort per market, never
throws. Triggered hourly by `.github/workflows/external-market-sync.yml`.

### `GET /api/cron/transition-expired-predictions`
Transitions `ACTIVE` predictions past their `resolveByDatetime` to `PENDING`.
Moved off the `GET /api/forecasts` hot read path (#1202) — every feed load
was paying for this write-scan before doing any read. Doesn't gate commitment
eligibility (`getCommitmentLockReason` checks `resolveByDatetime` directly),
so a periodic sweep is safe. Auth: `x-cron-secret` header. Returns
`{ ok, transitioned }`. Triggered every 15 minutes by
`.github/workflows/transition-expired-predictions.yml`.

---

## Notifications

### `GET /api/notifications` — Auth
List notifications for the current user.

### `GET /api/notifications/unread-count` — Auth
Unread count for the bell badge.

### `PATCH /api/notifications/[id]` — Auth
Mark a single notification as read.

### `GET /api/notifications/preferences` — Auth
Get the user's notification preferences (email, push, telegram channels).

### `PATCH /api/notifications/preferences` — Auth
Update notification preferences.

---

## Telegram

### `POST /api/telegram/rollback` — Telegram webhook
Handles interactive Telegram commands (`/status`, `/versions`, `/rollback 1.7.x`) that dispatch the GitHub Actions rollback workflow. **Fails closed:** rejects every request unless `TELEGRAM_WEBHOOK_SECRET` is set and the request carries the matching `x-telegram-bot-api-secret-token` header (plus a chat-ID allow-list). See [ROLLBACK.md](./ROLLBACK.md).

---

## Comments (extended)

### `POST /api/comments/[id]/react` — Auth
Add or remove a reaction (emoji) on a comment.

### `GET /api/comments/[id]/translate` — Auth
LLM-translate a comment to the user's preferred language.

### `GET /api/forecasts/[id]/translate` — Auth
LLM-translate forecast claim/details/options to the user's preferred language.

---

## Auth

### `POST /api/auth/signup`
Register a new account with email + password. Rate-limited to 5 requests/hour per IP.

### `POST /api/auth/forgot-password`
Send a password reset email. Rate-limited to 5 requests/hour per IP. Always returns 200 to prevent email enumeration.

### `POST /api/auth/reset-password`
Reset password using a token from the reset email.

---

## Account

### `DELETE /api/account`
Delete the authenticated user's account and all associated data.
