# SEO

Overview of SEO-relevant features, structured data, and indexing integrations.

## Metadata

Root layout (`src/app/layout.tsx`) sets global OpenGraph and Twitter Card defaults.
Forecast detail pages (`src/app/forecasts/[id]/page.tsx`) override with per-forecast values:

| Tag | Value |
|-----|-------|
| `og:title` / `og:description` | Forecast claim text + description |
| `twitter:card` | `summary_large_image` |
| `twitter:site` | `@daatan_dev` |
| `twitter:creator` | Author's `twitterHandle` (if set on their profile) |

## Structured data (JSON-LD)

A forecast page emits up to four JSON-LD scripts (`src/app/forecasts/[id]/page.tsx`; the locale-prefixed route emits the first two):

1. **Article** (`schema.org/Article`) — `headline`, `description`, `datePublished`, `dateModified`, `author` + `creator` (both the forecast author as Person), `publisher` (DAATAN Organization).
2. **BreadcrumbList** — Home → Forecasts → [claim text]
3. **Event** (`schema.org/Event`, public forecasts only) — maps the forecast to a predictive event:
   - `name`: forecast claim text
   - `startDate`: `publishedAt` (or `createdAt` as fallback)
   - `endDate`: `resolveByDatetime`
   - `organizer`: forecast author (Person, with profile URL)
   - `location`: VirtualLocation pointing at the forecast URL
4. **ClaimReview** (`schema.org/ClaimReview`, public + resolved correct/wrong only) — the forecast's resolution as a fact-check, with `author` + `creator` (DAATAN Organization), `reviewRating`, and an `itemReviewed` Claim carrying the forecast author as `author` + `creator`.

> **`creator` on the CreativeWork types** (Article, ClaimReview, the nested Claim): added alongside `author` because Google Search Console flags `creator` as a recommended field on CreativeWork-derived items ("Missing field 'creator'"). `creator` mirrors the corresponding `author`.

Private forecasts (where `isPublic = false`) get only the Article + BreadcrumbList scripts.

## Sitemap

`src/app/sitemap.ts` — dynamically generates the sitemap from live DB data. Included pages:

- `/` (weekly)
- All public, non-draft forecasts (`/forecasts/[slug]`) — daily
- Static pages (about, contact, pricing, …) — monthly

The sitemap is submitted to Google Search Console. Re-submission is not needed on content updates — Google re-crawls on its own schedule.

## Slugs & canonical URLs

Slugs are English (forecasts authored in another language are canonicalized to English at
creation — see [TRANSLATIONS.md](./TRANSLATIONS.md)). Reaching a forecast by raw id, or by a
**retired slug** (kept in `prediction_slug_aliases` after a re-slug), 308-redirects to the
current canonical `/forecasts/[slug]`, so old links and their SEO are preserved.

## Search-engine notification

`src/lib/services/indexnow.ts` exposes `notifySearchEngines(slug)` — a fire-and-forget
fan-out called on every event that creates, changes, or moves a forecast URL. It pings two
independent channels, each a no-op until its own env var(s) are set:

- **IndexNow** (`notifyIndexNow`) — Bing/Yandex/Seznam. **Does not reach Google.**
- **Google Indexing API** (`notifyGoogle`) — Google directly (see below).

**Triggering events** (all route through `notifySearchEngines`):

| Event | Code path |
|-------|-----------|
| Forecast published | `publishForecast()` in `src/lib/services/forecast.ts` |
| Forecast approved | `approveForecast()` in `src/lib/services/forecast.ts` |
| **Forecast re-slugged to English** | `canonicalizeForecastToEnglish()` in `src/lib/services/forecast.ts` |
| Forecast resolved | `resolvePrediction()` in `src/lib/services/prediction-resolution.ts` |
| Admin status change (VOID/UNRESOLVABLE) | `src/app/api/admin/forecasts/[id]/route.ts` |
| Forecast rejected | `src/app/api/forecasts/[id]/reject/route.ts` |

> The re-slug trigger matters most for non-English forecasts: canonicalization mints a brand-new
> English URL and leaves the old slug only 308-redirecting. Without this ping the new URL stays
> undiscovered until the next sitemap re-crawl. All events are public-gated (`isPublic`).

### IndexNow (Bing/Yandex)

IndexNow is a push protocol that notifies Bing and Yandex immediately when a URL changes.

1. A shared key (`711ada60e0032e070ede0e05de85a79e`) is hosted at `public/711ada60e0032e070ede0e05de85a79e.txt`.
2. On each event, a POST goes to `https://api.indexnow.org/indexnow` with the URL.
3. Disabled (no-op) when `INDEXNOW_KEY` is not set.

**Setup checklist (one-time):**

- [x] `INDEXNOW_KEY` added to `daatan-env-prod` Secrets Manager
- [x] Key file deployed at `/711ada60e0032e070ede0e05de85a79e.txt`
- [ ] Register key in [Bing Webmaster Tools](https://www.bing.com/webmasters) → IndexNow tab

**Env var:** `INDEXNOW_KEY` (optional server-side; see `src/env.ts`)

If the key file is ever lost (e.g., regenerated `public/` directory), re-add `public/{key}.txt` containing only the key string.

### Google Indexing API

Unlike IndexNow, Google does not accept third-party push pings, so `notifyGoogle` calls Google's
[Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart) directly. It
signs a service-account JWT (via `jose`), exchanges it for an access token, and POSTs
`{ url, type: 'URL_UPDATED' }` to `urlNotifications:publish`. No-op unless both env vars are set.

**Env vars:** `GOOGLE_INDEXING_CLIENT_EMAIL`, `GOOGLE_INDEXING_PRIVATE_KEY` (service-account creds; see `src/env.ts`).

**Setup (one-time):**

- [ ] Create a Google Cloud service account; enable the **Indexing API** on the project.
- [ ] In [Search Console](https://search.google.com/search-console) → Settings → Users and permissions, add the service-account email as an **Owner** of the `daatan.com` property.
- [ ] Set `GOOGLE_INDEXING_CLIENT_EMAIL` and `GOOGLE_INDEXING_PRIVATE_KEY` (the SA key's `client_email` / `private_key`; newlines may be `\n`-escaped) in `daatan-env-prod`.

> **Caveat:** the Indexing API is officially scoped to `JobPosting`/`BroadcastEvent` content. It is
> used here as a best-effort discovery nudge; Google may ignore or rate-limit other content types.
> The sitemap remains the authoritative discovery path — resubmit it in Search Console after large
> backfills (e.g. the English-canonicalization re-slug pass).
