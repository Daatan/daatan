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

## IndexNow

IndexNow is a push protocol that notifies Bing and Yandex immediately when a URL changes, rather than waiting for their crawlers.

**How it works:**

1. A shared key (`711ada60e0032e070ede0e05de85a79e`) is hosted at `public/711ada60e0032e070ede0e05de85a79e.txt`.
2. On each triggering event, `src/lib/services/indexnow.ts` fires a fire-and-forget POST to `https://api.indexnow.org/indexnow` with the URL.
3. The integration is disabled (no-op) when `INDEXNOW_KEY` is not set in the environment.

**Triggering events:**

| Event | Code path |
|-------|-----------|
| Forecast published | `publishForecast()` in `src/lib/services/forecast.ts` |
| Bot forecast approved | `approveForecast()` in `src/lib/services/forecast.ts` |
| Forecast resolved | `resolvePrediction()` in `src/lib/services/prediction-resolution.ts` |

**Setup checklist (one-time):**

- [x] `INDEXNOW_KEY` added to `daatan-env-prod` Secrets Manager
- [x] Key file deployed at `/711ada60e0032e070ede0e05de85a79e.txt`
- [ ] Register key in [Bing Webmaster Tools](https://www.bing.com/webmasters) → IndexNow tab

**Env var:** `INDEXNOW_KEY` (optional server-side; see `src/env.ts`)

If the key file is ever lost (e.g., regenerated `public/` directory), re-add `public/{key}.txt` containing only the key string.
