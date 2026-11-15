# Analytics

Google Analytics 4 with consent mode, gated by region. In the EU/EEA, the UK and Switzerland (and whenever the region can't be determined) analytics cookies are set only after the visitor accepts the banner. Elsewhere analytics is on by default, a one-time notice says so, and the visitor can opt out. Declining keeps the site fully functional. There has been no legal review of the region split.

## Environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `GA_MEASUREMENT_ID_PROD` | EC2 `.env` | Production GA4 property (`G-XZWVJM9KH4`) |
| `GA_MEASUREMENT_ID_STAGING` | EC2 `.env` | Staging GA4 property (`G-Z4XXM7GYHW`) |
| `GA_MEASUREMENT_ID` | docker-compose (mapped from above) | What the app container reads |

`docker-compose.prod.yml` maps `GA_MEASUREMENT_ID_PROD` → `GA_MEASUREMENT_ID`; same pattern for staging. The blue-green deploy (`scripts/blue-green-deploy.sh`, which regenerates `.env` from Secrets Manager via `scripts/fetch-secrets.sh`) does the same mapping with `-e GA_MEASUREMENT_ID=…` — the staging ID for `staging` and `next`, the prod ID otherwise. The app reads it at render time in `src/app/layout.tsx` and passes it as a prop to `GoogleAnalytics`.

## Key files

- `src/components/GoogleAnalytics.tsx` — renders the three GA scripts
- `src/components/CookieConsent.tsx` — banner (opt-in regions) or notice (elsewhere); reads/writes `daatan_analytics_consent` and `daatan_analytics_notice_seen` in localStorage
- `src/lib/consent-region.ts` — the geo.lipu.dev region check constants (Worker source: `komapc/lipu-hub`, `geo/worker.js`; `connect-src` in `infra/nginx/*.conf` must allow it)
- `src/components/AnalyticsUserSync.tsx` — associates the authenticated user ID with the GA session via `gtag('set', { user_id })`
- `src/lib/analytics.ts` — `trackEvent()` wrapper + named events (`analytics.forecastCreated`, etc.)

## Consent flow

1. **Page load** — the consent script runs `beforeInteractive` (injected into `<head>`, blocks parse). It reads `localStorage` synchronously:
   - Key present and `'granted'` → sets `analytics_storage: 'granted'` immediately
   - Key present and `'denied'` → sets `analytics_storage: 'denied'` immediately, no wait
   - Key absent (new visitor) → sets `analytics_storage: 'denied'` with `wait_for_update: 1500`, and starts a `fetch` to `https://geo.lipu.dev/` (1.5 s timeout), storing the promise on `window.__daatanConsentNotRequired`. Only a literal `{"consentRequired": false}` resolves it `true`, and then the script itself calls `gtag('consent', 'update', { analytics_storage: 'granted' })`. Errors, timeouts and CSP blocks resolve `false`: denied, banner shown (the old behaviour).
2. **GA library** loads `afterInteractive` and processes the already-established consent state.
3. **New visitor, opt-in region** — `CookieConsent` banner appears. Accept → `gtag('consent', 'update', { analytics_storage: 'granted' })` + persists to localStorage. Decline → persists `'denied'`, banner disappears.
   **New visitor, other region** — analytics is already granted; a notice with **OK** / **Opt out** appears once. OK stores only `daatan_analytics_notice_seen`; the implied grant is never written to `daatan_analytics_consent`, so it is re-checked against the region on every visit. Opt out stores `'denied'`.
4. **Returning visitor** — consent applied synchronously in step 1; banner not shown again unless reopened.
5. **Changing the choice** — the "Cookie settings" link in the home-v5 footer (`src/components/CookieSettingsLink.tsx`) dispatches `daatan:open-cookie-settings` (`COOKIE_SETTINGS_EVENT`), which reopens the full Accept/Decline banner; declining there also revokes an earlier grant (#1935) and deletes the `_ga*` cookies. The same link sits in Privacy Policy §5. `/privacy` is linked from the home footer, About, sign-in/sign-up and the banner/notice itself — not from every page.

The `beforeInteractive` strategy guarantees consent is set before the GA library runs — no race condition is possible.

## Custom events

| Event name | Fired from | Params |
|---|---|---|
| `forecast_created` | `ForecastWizard.tsx` | `outcome_type`, `is_express` |
| `commitment_made` | `CommitmentForm.tsx` | `forecast_id`, `cu_committed` |
| `comment_posted` | `CommentForm.tsx` | `is_reply` |
| `login` | `SignInClient.tsx` | `method` |

All events are no-ops when GA isn't loaded or consent is denied — `trackEvent()` checks `typeof window.gtag === 'function'` before calling.

## GA console setup (required)

**Consent Mode modeling must be enabled** or declined users are invisible in reports entirely (zero data, not estimates). Modeling also needs roughly 1,000 denied events a day for 7 days, which Daatan's opt-in-region traffic does not reach, so those visitors are simply missing from reports.

For each property (`G-XZWVJM9KH4` prod, `G-Z4XXM7GYHW` staging):
> analytics.google.com → Admin → Data collection and modification → Data collection → **Consent mode** → Enable

## Verifying GA is working

1. Open DevTools → Application → Local Storage → delete `daatan_analytics_consent`
2. Reload the page and accept the cookie banner
3. DevTools → Network → filter `google-analytics`
4. Click the `g/collect` request — confirm `gcs=G111` in query params (both consents granted)

`gcs=G100` means consent is still denied — check that `applyConsent('granted')` is being called and that the consent script is present in the page source.

## Staging vs production

Staging (`APP_ENV=staging` — the runtime container var; staging and production run the same promoted image, see `src/env.ts`) adds `debug_mode: true` and an `environment: 'staging'` dimension to GA so staging traffic can be filtered out in reports. The measurement ID is hardcoded in `layout.tsx` for staging; production reads from `process.env.GA_MEASUREMENT_ID`.
