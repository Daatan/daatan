# Self-hosted edition — architecture & design

Maintainer reference for how the self-hosted edition works. Operator-facing setup lives in [`SELF_HOSTING.md`](./SELF_HOSTING.md); the validation plan in [`SELF_HOST_TEST_PLAN.md`](./SELF_HOST_TEST_PLAN.md).

## Goal

Sell Daatan as a single-organization, self-hosted internal forecasting tool (corp/gov/NGO in their own VPC, not air-gapped). v1 is a **pure manual forecasting tool** — create questions, commit, resolve, per-person calibration/reputation (Brier/Glicko/ELO) — white-labelled, behind the org's SSO. Oracle / web search / LLM / external markets are **opt-in add-ons, off by default**.

## Core principle: one codebase, runtime edition flag

There is **no fork and no build-time split**. A single image runs both products; behavior is selected at runtime by `DAATAN_EDITION` (`'saas'` default | `'self_hosted'`), defined in `src/env.ts`.

**The SaaS-safety invariant** — with `DAATAN_EDITION` unset/`saas` *and* the self-host vars unset, every code path is byte-identical to the pre-self-host app. Self-host logic lives behind `edition === 'self_hosted'` branches that prod never enters, or behind fallbacks that resolve to the original literals. Tests pin this (see the test plan, Layer 0). Note: tests run with `SKIP_ENV_VALIDATION=1`, so `env.DAATAN_EDITION` is `undefined` there — all helpers treat unset as SaaS.

## The pieces

### 1. Boot decoupling (Phase 0 — PRs #944, #946)
A fresh checkout boots with no Google, no AWS, no daatan.com — given only DB + secret + `APP_URL`.
- Google OAuth made optional (`src/auth.config.ts` registers Google only when both `GOOGLE_*` are set).
- Storage abstraction `src/lib/services/storage.ts` — drivers `s3` (default, prod-identical), `local` (filesystem + `/api/uploads/[...path]` serve route), `minio` (S3-compatible). `STORAGE_DRIVER` selects; unset ⇒ s3.
- `.env.selfhost.example`, `docker-compose.selfhost.yml` (build-from-source), no nginx/certbot (TLS at operator ingress).

### 2. Enterprise auth (Phase 1 — PRs #947, #952, #954)
- **OIDC** (`src/auth.config.ts`): a generic provider registered when `OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET` are all set. A plain config object (fetch-based) so it stays **Edge-safe** (auth.config.ts is bundled into the middleware — no Prisma/bcrypt/node imports). Callback URL: `${APP_URL}/api/auth/callback/oidc`.
- **Admin bootstrap** (`src/lib/auth/oidc.ts`, jwt callback in `src/auth.ts`): emails in `OIDC_ADMIN_EMAILS` are promoted to `ADMIN` on sign-in.
- **Domain gate** (`src/lib/auth/access.ts`, signIn callback in `src/auth.ts`): `ALLOWED_EMAIL_DOMAINS` restricts every provider (OIDC + credentials) to listed domains. Empty ⇒ no restriction.
- **Closed signup + invites** (`src/lib/auth/access.ts`, `src/lib/services/invite.ts`): public credentials signup is closed by default on self-host (`isOpenSignupEnabled`); `SELF_HOST_OPEN_SIGNUP=true` re-opens. Single-use `Invite` model (token = SHA-256 hex; consumed atomically) issued from `/api/admin/invites` + Admin → Invites UI.

### 3. AI/add-ons off by default (PR #957)
`src/lib/capabilities.ts` — `aiFeaturesEnabled()` / `externalMarketsEnabled()`: `saas`/unset ⇒ on; `self_hosted` ⇒ on only when `ENABLE_AI_FEATURES` / `ENABLE_EXTERNAL_MARKETS` === `'true'`. The server snapshot `getCapabilities()` is handed to the client via `CapabilitiesProvider` (`useCapabilities()` hook; all-on default so provider-less tests are unchanged).
- **UI gated** when off: Express toggle + `/forecasts/express`, "Analyze" (ContextTimeline), "Guess Chances", AI Magic-Extract & tag-suggest (wizard steps), AI-assist-on-resolve (ResolutionForm); Polymarket/Kalshi import + suggest-similar.
- **API defense-in-depth:** `context`/`research`/`express/*`/`ai/*` → 404 when AI off; `similar` → `[]`; `import-market` → 404, `suggest-market` → `{match:null}` when markets off.

### 4. White-label (Phase 3 — PRs #958, #960)
`src/lib/branding.ts` is the single source of identity.
- `getAppName()` / `getAppUrl()` — **required** for `self_hosted` (throw/fail-fast if missing); `saas`/unset returns the `DAATAN` / `https://daatan.com` literals (ignoring `NEXTAUTH_URL`, so prod+staging stay byte-identical).
- `shouldIndex()` — self-host is always `noindex`; SaaS indexes in production only. Drives `layout.tsx` robots, `robots.ts`, `sitemap.ts`.
- `getVerificationTokens()` — the exact Google/Bing tokens for SaaS; `null` (suppressed) for self-host.
- `getBranding()` → `BrandingProvider` (`useBranding()`); `BrandLogo` renders the bundled asset via `next/image` (no override) or a plain `<img>` when `APP_LOGO_URL` is set (avoids next/image remote-pattern config). Sidebar + auth screens consume it.

### 5. Packaging (Phase 4 — PR #961)
- `.github/workflows/release-selfhost.yml` (manual dispatch) builds the app (`runner`) + migrations images and pushes to `ghcr.io/<owner>/daatan-selfhost:<version>`. Dispatch-only — never touches the SaaS ECR/EC2 pipeline.
- `docker-compose.selfhost.pull.yml` — the product install: pulls the image (`DAATAN_VERSION` / `DAATAN_IMAGE`) instead of building.

## Env surface (self-host)

Required: `DATABASE_URL`, `POSTGRES_PASSWORD`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DAATAN_EDITION=self_hosted`, `APP_NAME`, `APP_URL`.
Auth: `OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/PROVIDER_NAME`, `OIDC_ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, `SELF_HOST_OPEN_SIGNUP`, optional `GOOGLE_*`.
Storage: `STORAGE_DRIVER`, `UPLOADS_BUCKET_NAME`, `S3_ENDPOINT`, `STORAGE_LOCAL_PATH`, `AWS_REGION`.
Add-ons (off by default): `ENABLE_AI_FEATURES`, `ENABLE_EXTERNAL_MARKETS`, then `GEMINI_API_KEY`/`OLLAMA_BASE_URL`/`ORACLE_URL`/`ORACLE_API_KEY`.
Branding: `APP_LOGO_URL`, `EMAIL_FROM`.

## Deferred / not in v1

- LLM prompt de-DAATAN (`{{appName}}` in `bedrock-prompts.ts`) — AI is off by default; `getPromptTemplate` is a cached hot path, so a separate change.
- Content pages (`about`, `privacy`) + OG-image routes still say DAATAN.
- SAML — via a BoxyHQ Jackson sidecar that exposes SAML *as* OIDC (the app only ever speaks OIDC).
- License-key gate (ed25519-signed `LICENSE_KEY`, warn-only) — issuance tooling lives out of repo.
- Gating the admin-only bot system (LLM-dependent).

> Done since: admin **About** panel (`/admin/about` + `/api/admin/about`) reports edition/version/capabilities/integrations (booleans, no secrets); `ADMIN_EMAIL` env seeds the first admin in `prisma/seed.ts` (falls back to the SaaS owners when unset).

## Phase / PR history

| Phase | PRs |
|-------|-----|
| 0 — boot decoupling | #944 (edition flag, optional Google), #946 (storage drivers) |
| 1 — enterprise auth | #947 (OIDC + admin email), #952 (domain gate + closed signup), #954 (invites) |
| AI off by default | #957 |
| 3 — white-label | #958 (SEO/metadata), #960 (UI logo/wordmark) |
| 4 — packaging | #961 (GHCR image + pull compose) |
