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
   - `description`: details text, falling back to the claim text (Google warns when absent)
   - `startDate`: `publishedAt` (or `createdAt` as fallback)
   - `endDate`: `resolveByDatetime`
   - `eventAttendanceMode`: `OnlineEventAttendanceMode` — **required** for the `VirtualLocation` below; without it Google assumes a physical event and fails the rich result with "Invalid object type for field location"
   - `organizer` + `performer`: forecast author (Person, with profile URL)
   - `location`: VirtualLocation pointing at the forecast URL
   - `offers`: free Offer (`price: "0"`, `InStock`) pointing at the forecast URL — Google warns "Missing field 'offers'" without it
4. **ClaimReview** (`schema.org/ClaimReview`, public + resolved correct/wrong only) — the forecast's resolution as a fact-check, with `author` + `creator` (DAATAN Organization), `reviewRating`, and an `itemReviewed` Claim carrying the forecast author as `author` + `creator`.

> **`creator` on the CreativeWork types** (Article, ClaimReview, the nested Claim): added alongside `author` because Google Search Console flags `creator` as a recommended field on CreativeWork-derived items ("Missing field 'creator'"). `creator` mirrors the corresponding `author`.

Private forecasts (where `isPublic = false`) get only the Article + BreadcrumbList scripts.

Every JSON-LD payload is HTML-escaped before being injected into its `<script type="application/ld+json">` tag, so forecast-derived text (claim, description, author name) cannot break out of the script element and inject markup — closing the stored-XSS vector.

## Sitemap

`src/app/sitemap.ts` — dynamically generates the sitemap from live DB data. Included pages:

- `/` (weekly)
- All public, non-draft forecasts (`/forecasts/[slug]`) — daily
- Static pages (about, contact, pricing, …) — monthly

The sitemap is submitted to Google Search Console. Re-submission is not needed on content updates — Google re-crawls on its own schedule.

## Server-rendered content (Soft 404 prevention)

A forecast page must carry **substantive, unique text in its initial SSR HTML** — not
just a claim line wrapped in the sitewide nav. When the server pre-render is thin and
near-identical across thousands of pages, Google's thin-content heuristic files them under
**"Soft 404"** (HTTP 200 but treated as an error) and drops them from the index, which also
lowers the whole domain's crawl rate.

Two anti-patterns previously starved the pre-render; both are fixed:

- **`isMounted` date gates** — dates rendered `''` on the server and only filled after
  hydration. They now render via the hydration-safe `formatDisplayDate` /
  `formatDisplayDateTime` helpers (`src/lib/utils/date.ts`), which pin a fixed `en-US`
  locale + `timeZone: 'UTC'` so server and client emit identical text (no mismatch, no gate).
- **Collapsed-by-default `{open && …}` conditional rendering** — the resolution rules and the
  whole AI-context card (summary, AI estimate, reasoning, Oracle sources) were *absent from
  the DOM* until expanded. They now always render into the DOM and collapse via a CSS `hidden`
  class instead of being removed, so crawlers see them (content inside collapsed/hidden
  accordions is indexed under mobile-first).

Additionally, `ForecastDetailClient` renders a **server-side facts line** under the `<h1>`
(English/canonical locale): author · opened/resolves dates · forecaster count · community
consensus · AI estimate · status. This guarantees unique prose even on one-line claims that
have no description or sources yet. Regression coverage:
`src/app/forecasts/[id]/__tests__/ForecastDetailClient.ssr-content.test.tsx` and the
"collapsed by default" case in `src/components/forecasts/__tests__/ContextTimeline.test.tsx`.

> Verify after deploy: fetch a forecast as Googlebot and strip `<script>` — the claim, the
> facts line, the resolution rules, and (when present) the AI reasoning/sources must be in the
> visible HTML. Then in Search Console, URL Inspection → "Test live URL" on a few previously
> soft-404'd slugs and **Validate Fix** on the Soft 404 issue.

## OG-image routes are excluded from the index

`opengraph-image.tsx` route handlers (`src/app/opengraph-image.tsx`,
`src/app/forecasts/[id]/opengraph-image.tsx`, `src/app/profile/[id]/opengraph-image.tsx`, …)
return `200 image/png` — never HTML. They exist only so `<meta property="og:image">` on every
forecast/profile page has something to point at for social-preview cards. Googlebot still
crawls them as page candidates (one per page that links them) and rejects them, which piled up
as **"Crawled - currently not indexed / Failed"** in Search Console (49% of that bucket as of
2026-07).

Fix: `src/middleware.ts` sets `X-Robots-Tag: noindex` on any response whose path ends in
`/opengraph-image`. This moves them to the clean "Excluded by noindex tag" bucket instead.
Deliberately **not** done via a `robots.txt` `Disallow`: blocking only Googlebot from a path
requires a `User-agent: Googlebot`-specific block, and per RFC 9309 user-agent groups don't
merge with the wildcard `User-agent: *` group — every other `Disallow` rule would need
duplicating into it or Googlebot would crawl `/admin/`, `/api/`, etc. unrestricted.
`X-Robots-Tag` works on any content type and needs no robots.txt change. Social-preview
crawlers (Twitterbot, facebookexternalhit, Slackbot, …) fetch the raw image bytes and ignore
the header, so link previews are unaffected. Regression coverage:
`__tests__/config/middleware-routing.test.ts` ("OG-image noindex header").

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

**Bulk backlog resubmission.** The per-event ping only covers forecasts changed *after*
the feature shipped, so the pre-existing backlog was never submitted (Bing Webmaster Tools
nags about this under "publish all your latest relevant URLs"). `POST /api/admin/indexnow/resubmit`
(ADMIN-only) pushes **every indexable URL at once**: it reads the live sitemap — the single
source of truth for what's indexable — and submits those URLs via `notifyIndexNowBulk` (batches
of 10,000). Safe to re-run after large backfills (e.g. the English-canonicalization re-slug pass).
No-op without `INDEXNOW_KEY`; the sitemap is empty off-production, so it only does real work on prod.
Trigger it as an authenticated admin, e.g. from the browser console on daatan.com:
`fetch('/api/admin/indexnow/resubmit', { method: 'POST' }).then(r => r.json()).then(console.log)`.

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
