# Telegram Notifications

Application notifications route to **one of two channels** (see [Channel routing](#channel-routing)):

- **clean** (`TELEGRAM_CLEAN_CHAT_ID`) — **production only**, high-signal: new versions, forecasts, users, votes, resolutions, comments, and page-worthy alarms.
- **noisy** (`TELEGRAM_CHAT_ID`) — everything else, plus **all** non-production traffic (staging/next, bots, indexer, operational errors, health digests).

Messages are prefixed with `[prod]` / `[staging]` / `[next]` based on `APP_ENV`. If `TELEGRAM_CLEAN_CHAT_ID` is unset, clean events fall back to the noisy channel (no messages are dropped).

---

## CI/CD Notifications (GitHub Actions)

Sent by `deploy.yml`, `backup.yml`, `rollback.yml`. **Production** events route to the **clean** channel (`TELEGRAM_CLEAN_CHAT_ID`, falling back to `TELEGRAM_CHAT_ID` if unset); **staging** events stay on **noisy** (`TELEGRAM_CHAT_ID`). The fallback uses the runner-side pattern `CHAT_ID="${{ secrets.TELEGRAM_CLEAN_CHAT_ID }}"; CHAT_ID="${CHAT_ID:-${{ secrets.TELEGRAM_CHAT_ID }}}"`.

| Event | Icon | Channel | Message |
|---|---|---|---|
| Staging deploy success | ✅ | noisy | `[staging] Deployment successful` — version, PR number+title, PR link |
| Staging deploy failure | ❌ | noisy | `[staging] Deployment failed` — version, PR number+title, PR link + logs link |
| Production deploy success | ✅ | clean | `[prod] Deployment successful` — version, PR number+title, PR link |
| Production deploy failure | ❌ | clean | `[prod] Deployment failed` — version, PR number+title, PR link + logs link |
| DB backup failure | 🚨 | clean | `DB Backup FAILED` — timestamp (backup verification is prod-only) |
| Rollback success | 🔄 | clean (prod) / noisy (staging) | `[env] Rollback to vX complete` — reason, triggered-by |
| Rollback failure | ❌ | clean (prod) / noisy (staging) | `[env] Rollback to vX FAILED. Manual intervention required` — reason, logs link |

---

## Watchdog Notifications (`watchdog.yml` — every 5 min)

### HTTP health checks

Sent directly by `watchdog.yml` from the **GitHub Actions runner**. Both `production` and `staging` are checked. Prod-side alerts route to the **clean** channel (with noisy fallback); staging health-check failures stay on **noisy**.

| Event | Icon | Channel | Message |
|---|---|---|---|
| Any health check fails | 🚨 | clean (prod) / noisy (staging) | `[env] Health check FAILED` — list of failing checks, health endpoint link |
| Staging version newer than prod | ⚠️ | clean | `[prod] Version drift: prod is running vX but staging has vY — consider deploying` |
| CloudWatch alarm(s) firing | 🚨 | clean | `CloudWatch alarm(s) firing` — alarm name + state reason per line |

**Health checks performed:**
- `Health (app+db)` — `/api/health` → `status: "ok"`
- `Health DB flag` — `/api/health` → `db: true`
- `Homepage` — HTTP 200
- `Forecast feed` — `/forecasts` HTTP 200
- `Leaderboard` — `/leaderboard` HTTP 200
- `About/login` — `/auth/signin` HTTP 200

Any unexpected redirect also counts as a failure (guards against redirect loops).

**Retry before alerting:** each check gets one retry (10s pause) before it's counted as a failure — a single transient network blip between the runner and the target (seen 2026-07-26: all 6 checks timed out for ~2 min with no app restart and no nginx errors) no longer pages the clean channel by itself. A real outage still fails both attempts and alerts as before.

**Job status reflects the alert:** the `Check production`/`Check staging` job now fails (non-zero conclusion) whenever the Telegram alert fires — previously the job always showed `success` even mid-outage, since the check script only recorded failures into an output variable without exiting non-zero.

**Version drift dedup:** at most one alert per production version. Once notified that prod=vX is behind, no further alerts fire until prod itself advances to a new version.

### Disk / CPU / Memory checks (EC2)

Sent by shell scripts **executing on the EC2 server** via SSM from `watchdog.yml`'s `disk-watchdog` job. Alerts use the server's `TELEGRAM_BOT_TOKEN` from `.env` — independent of GitHub Actions credentials.

| Script | Event | Icon | Threshold |
|---|---|---|---|
| `scripts/check-disk-space.sh` | Root partition usage high | 💾 | > 90% |
| `scripts/check-system-health.sh` | Memory usage high | 🧠 | > 90% |
| `scripts/check-system-health.sh` | CPU load high | 🔥 | > cores × 2 (1-min avg) |

---

## News-indexer watchdog (`news-indexer-watchdog.yml` — every 2h, even UTC hours)

Monitors the **news-indexer** (`scrapper.daatan.com`) — free disk + DB / pipeline health — which `watchdog.yml`'s `disk-watchdog` does **not** cover (that targets the `daatan-backend` instances only). Runs from the **GitHub Actions runner** by polling the public `/stats` endpoint (disk usage comes from `.disk.used_percent`, which reflects the EC2 root volume).

ALERT-ONLY every 2 hours (even UTC hours, at :17) → 🚨 to **both** channels (clean + noisy); silent when healthy. Once a day at **08:00 UTC** it also posts a plain digest to the **noisy** channel (the digest hour must be even so an even-hour run lands on it).

Only **acute** conditions alert. Each one starts, gets fixed, and stops, so a repeating message means it is still broken. A **chronic** condition — one that stays true until a human edits config — must never alert on a 2-hourly schedule, or it posts the same text 12×/day to the high-signal channel forever. Stale feeds are chronic (they need a `sources.yaml` edit), so they appear in the daily digest only.

| Event | Icon | Trigger | Alerts |
|---|---|---|---|
| Disk low | 💾 | `disk.used_percent` > 80%, or a jump > 2 pp vs the previous hour | 🚨 both channels |
| Worker unhealthy | ⚙️ | `worker.status` ≠ `ok` | 🚨 both channels |
| Pipeline stalled | 📰 | 0 articles indexed in 24h | 🚨 both channels |
| Queue backed up | 📮 | DLQ depth > 0, or queue depth > 500 | 🚨 both channels |
| Indexer down | 🚨 | `/stats` unreachable after 3 attempts (12s/attempt, 3s between retries — rides out a normal deploy restart) | 🚨 both channels |
| Stale feed | 🕸️ | an enabled feed stopped producing > 7d | digest only (chronic) |
| Daily digest | 📊 | always at 08:00 UTC (disk, DB, articles, worker, matches, stale feeds) | noisy |

---

## Daily summary (`heartbeat.yml` — daily 09:00 UTC)

Sent by the **EC2 app process** via `GET /api/cron/heartbeat` (triggered by `heartbeat.yml`). Because the Telegram message originates from the server — not from GitHub Actions — a silent daily summary means the server itself has a problem, not just that GitHub Actions is down. The message also doubles as the liveness heartbeat (it replaced the old bare "server alive" ping).

| Event | Icon | Message |
|---|---|---|
| Daily summary | 📊 | `Daily summary — vX.Y.Z · N new users · N forecasts · N commitments · N resolved · search U/T providers usable` (last 24h, from Prisma counts + Oracle `/search/health`) |
| Backup restore failed | 🚨 | `Backup Verification FAILED — reason — Manual investigation required` (sent from `scripts/verify-backup.sh` on EC2) |

---

## Application Notifications (`src/lib/services/telegram.ts`)

Sent by API routes and services on business and operational events. The **Channel** column is the production routing target; on staging/next everything goes to the noisy channel regardless.

### Business Events

| Event | Icon | Channel | Triggered by |
|---|---|---|---|
| New forecast published | 📢 | clean | `POST /api/forecasts/[id]/publish` |
| New commitment made | 🎯 | clean | `src/lib/services/commitment.ts` → `createCommitment()` |
| New comment posted | 💬 | clean | `POST /api/comments` |
| Forecast resolved | ⚖️ | clean | `POST /api/forecasts/[id]/resolve` |
| New user registered | 🆕 | clean | `POST /api/auth/signup` (credentials) and OAuth sign-in handler |
| Bot forecast approved | ✅ | noisy | `POST /api/forecasts/[id]/approve` |
| Bot forecast rejected | ❌ | noisy | `POST /api/forecasts/[id]/reject` |
| News article matched | 🗞️ | noisy | news-indexer integration. **One fresh message per push**, laid out for skimming: the estimate as a **movement** (`Oracle 63% → 71%`) on top, followed by evidence volume (`· 3 new / 22 in pool` when the pool path produced the estimate, `· N articles` for a multi-article push on the single-run fallback); the triggering article as a link (+ a short italic **extract** — the Oracle's extracted claim when it produced one, the raw snippet otherwise); every per-article number as one bold-labelled line of a `<blockquote>` **panel** (a quote bar groups them without the "copy code" chrome clients hang on `<pre>` blocks); then the forecast as a link named by its claim text, with the 1️⃣–5️⃣ rating buttons attached (see below). Panel rows, in order: **stance** [-1,1] — which way the article argues (signed, `(cert x.xx)` = the extractor's certainty in that reading); **relevance** [0,1] — the Oracle's claim-aware judgment (its *square* weights the article in aggregation); **match** — the embedding cosine, the weakest of the three and the one proven to misrank (news-indexer#124); the **judgment-lane signals** (Signal Lanes) `author_lean (cert)` / `fact_signal` / `credibility` / `class` — the extractor's un-fused shadow-only fields (nothing in the Oracle's own aggregation reads them yet; `credibility` shown only when it differs from the neutral `1.0` default, since the credibility cutover flag is OFF); **range** — the confidence band, omitted when under 2 points wide. Every row is omitted when unknown rather than printed as `null`. Freshly sent, not edited in place: an edit never resurfaces in the channel feed, and a rating tap must map 1:1 to exactly the numbers shown. (The daatan#1215/#1219 edit-in-place mechanics were retired by this redesign; `Prediction.telegramMessageId`/`telegramChatId` are no longer written.) |
| High AI confidence (≥80%) | 📈 | clean | `src/lib/services/context.ts` — fires when the AI estimate **crosses** 80 from below (any confidence-writing path: news-indexer push, user "analyze context", admin backfill). Crossing-based, so a forecast hovering at 82 doesn't re-alert. Adds a "settled" line when the Oracle reports the outcome as an accomplished fact (resolution candidate). |

### Manual number-rating feedback (daatan#1223)

The 1️⃣–5️⃣ rating buttons attach **directly to the "News article matched" message** (they originally lived on a separate 🔍 rating-prompt message; the two were merged when the notification went back to one-fresh-message-per-push, which restored the 1:1 message↔article mapping a rating tap needs). `notifyNewsArticleMatched()` persists the `ArticleRatingPrompt` row keyed on the sent message's chat/message id right after send; a push whose trigger article couldn't be resolved to an `EvidencePoolArticle` row sends the message without buttons — there is nothing to hang the feedback off.

- **1️⃣–5️⃣ button row** (1 worst, 5 best). **Any channel member can vote — by design.** There is no authorization gate: being able to see the message in the channel is the access control, and rater identity is the tapper's Telegram user id (always present on a `callback_query`, needs no setup), captured together with a display name. A tap upserts one `EvidencePoolArticleFeedback` row per (article, Telegram user) — `rating` is a plain `Int` — and refreshes the button labels with live per-value tally counts (`3️⃣ ·1`). Raters can change their mind by tapping another number.
- **A rating of 1 or 2 also opens a private DM** to the tapping rater with a toggle keyboard to flag which specific number was wrong: Stance / Relevance / Similarity / Probability / Author Lean / Fact Signal / Evidence Class / Credibility / Other, plus a Done button that collapses the keyboard to a plain confirmation (`Recorded: 2/5 — Stance`). 3–5 need no further detail. Telegram only lets a bot DM someone who has messaged it first, so this is best-effort: for a rater who never `/start`-ed @DaatanClawBot the rating still stores, and the button's toast tells them to `/start` and re-tap to unlock the drilldown.
- **Free-text replies** to either the article-match message or the drilldown DM append to that row's `note`, once a rating already exists.
- Every number shown is snapshotted at send time — `ArticleRatingPrompt.contextSnapshotId` references the exact `ContextSnapshot` row this push created (append-only, never mutated later), plus a directly-captured `snapshotSimilarity` — so what a rater judged stays pinned even if the article is later re-extracted or the prediction moves again.
- Only `notifyNewsArticleMatched` carries rating buttons in v1; no other notification type does.

Handled by the same webhook as `/rollback` (`src/app/api/telegram/rollback/route.ts`, `callback_query` branch) — Telegram supports exactly one webhook URL per bot. Unlike `/rollback`'s `TELEGRAM_ROLLBACK_CHAT_IDS` chat allowlist, rating taps are **not** gated. `TELEGRAM_ADMIN_MAP` (Telegram user id → `User.id`) survives as **optional enrichment only**: when the map knows a tapper's Telegram id, their rating row also links to that daatan `User` for later analysis; unknown tappers store with a null `raterUserId`.

### Operational Alerts

| Event | Icon | Channel | Rate-limited | Triggered by |
|---|---|---|---|---|
| Oracle forecast unavailable | 🚨 | clean | 5 min (global) | `GET /api/cron/oracle-health` |
| Security event (403/401) | 🛡️ | clean | 5 min per `pathname:status` | `src/lib/api-middleware.ts` |
| Search provider health digest | ⚠️/🚨 | noisy / **clean when critical** | 5 min (global, one key) | `GET /api/cron/search-health` (hourly) + `GET /api/health/search` |
| Server error | 🚨 | noisy | 5 min per `route:ErrorType` | `src/lib/api-middleware.ts` |
| Dead link / 404 | 🔗 | noisy | 5 min per `pathname` | API routes on not-found |
| LLM chain failure | 🤖 | noisy | 5 min per provider-chain | `src/lib/llm/service.ts` — fires **only when the whole fallback chain fails**; a single provider failing that a fallback then rescues is logged, not paged |
| Oracle search unavailable | ⚠️ | noisy | 5 min (global) | `src/lib/services/oracleSearch.ts` |
| Market ⇄ Oracle divergence | 📊 | noisy | single-shot per crossing; hysteresis re-arms only once the gap falls to ≤15pt (not merely <20pt), and an atomic claim (`updateMany` gated on the alert column being null) prevents double-fires across overlapping cron runs | `GET /api/cron/external-market-sync` (hourly) → `checkMarketDivergence()` in `src/lib/services/external-markets.ts` — fires when a linked Polymarket/Kalshi market's implied probability and our Oracle estimate differ by more than 20pt |

> **EC2 alarms are not sent by this module.** Disk/CPU/memory (`check-disk-space.sh`, `check-system-health.sh`) and backup-verification (`verify-backup.sh`) alerts are curled to Telegram **directly from EC2 shell scripts** — see the [Watchdog](#disk--cpu--memory-checks-ec2) and [Daily summary](#daily-summary-heartbeatyml--daily-0900-utc) sections. The matching app exports (`notifyDiskSpaceLow`, `notifyMemoryPressure`, `notifyHighLoad`, `notifyBackupVerificationFailed`, plus back-compat `notifyAllSearchProvidersFailed` / `notifyOracleForecastRecovered`) are routed to **clean** in code but currently have no app caller. The shell scripts now post to `${TELEGRAM_CLEAN_CHAT_ID:-$TELEGRAM_CHAT_ID}`, so on prod (where `TELEGRAM_CLEAN_CHAT_ID` is set) the live EC2 alarms land on the **clean** channel and fall back to noisy elsewhere.

### Channel routing

`sendChannelNotification(message, channel)` (in `src/lib/services/telegram.ts`) resolves the destination:

```
if channel == 'clean' AND APP_ENV == 'production' AND TELEGRAM_CLEAN_CHAT_ID set
    → TELEGRAM_CLEAN_CHAT_ID   (clean)
else
    → TELEGRAM_CHAT_ID         (noisy)
```

So staging/next **never** post to the clean channel, and an un-provisioned `TELEGRAM_CLEAN_CHAT_ID` degrades safely to noisy. The search-health digest is the one dynamic case: it routes to **clean** only when critical (no usable providers), otherwise noisy.

**Search health is grouped:** instead of one "credits low" message per provider, `notifySearchHealthDigest()` emits a **single** message per check listing every exhausted/low provider (`🚨 All search providers failed` header when none are usable, `⚠️ Search provider health` otherwise). This replaced the previous per-provider fan-out (`notifySearchCreditsLow` / `notifyAllSearchProvidersFailed`, still exported for back-compat but no longer called by the crons).

**Rate limiting:** Error notifications use a 5-minute in-memory cooldown. Cooldown resets on process restart.

**Dev suppression:** All application notifications are suppressed when `APP_ENV=development`.

---

## Configuration

| Secret | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather (format: `123456:ABC-...`) |
| `TELEGRAM_CHAT_ID` | **Noisy** channel/group ID (negative number for groups) — receives everything except prod clean events |
| `TELEGRAM_CLEAN_CHAT_ID` | **Clean** channel ID — **production only**, optional. High-signal events/alarms. Falls back to `TELEGRAM_CHAT_ID` when unset. The bot must be an admin of this channel. |
| `CRON_SECRET` | Shared secret for `/api/cron/heartbeat` — same value as `BOT_RUNNER_SECRET` in `.env` |
| `TELEGRAM_ADMIN_MAP` | JSON map of Telegram user id → `User.id` (`{"123456":"cuid1","789012":"cuid2"}`) — **optional enrichment, not a gate**, for the [manual number-rating feedback](#manual-number-rating-feedback-daatan1223) buttons: a mapped tapper's rating row also links to their daatan `User`; anyone can vote either way. Safe to leave unset. Raw `process.env`, not `src/env.ts`'s validated schema — mirrors `TELEGRAM_ROLLBACK_CHAT_IDS`'s existing pattern for this same route. |

`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are stored in both GitHub Actions secrets (for CI/CD alerts) and AWS Secrets Manager (for runtime app alerts). The EC2 instance reads them from `.env` at runtime. `TELEGRAM_CLEAN_CHAT_ID` is added to `daatan-env-prod` (Secrets Manager) only — staging is single-channel by design.

> Replaces the former `TELEGRAM_NEWS_CHAT_ID` (a dedicated channel for news-indexer matches). News matches now route through the shared noisy channel.
