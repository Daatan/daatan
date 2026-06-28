# Self-hosted edition — test plan

How we validate that the self-hosted edition (`DAATAN_EDITION=self_hosted`) works, and that none of it regresses the SaaS deploy. Layered cheapest-and-most-automated first; run top-down.

> **The golden invariant:** with `DAATAN_EDITION` unset or `saas` and the self-host vars unset, behavior is byte-identical to before. Every layer either asserts that, or tests `self_hosted`-only paths that prod can never enter.

---

## Layer 0 — Automated invariants (CI, already green)

These run in `npm test` on every PR and pin the safety contract. No manual action.

| Area | Test |
|------|------|
| Capability gating defaults off (self-host) / on (saas+unset) | `__tests__/lib/capabilities.test.ts` |
| AI/market routes 404 / empty when off | `__tests__/api/ai-feature-guard.test.ts` |
| Branding: saas literals + exact verification tokens; self-host require/noindex | `__tests__/lib/branding.test.ts` |
| Logo override vs bundled fallback | `__tests__/components/BrandLogo.test.tsx` |
| OIDC provider registration + admin-email mapping | `__tests__/config/oidc-provider.test.ts`, `__tests__/lib/oidc-role-mapping.test.ts` |
| Domain gate + closed-signup + invite consumption | `__tests__/lib/auth-access.test.ts`, `__tests__/api/signup-gating.test.ts`, `__tests__/lib/invite.test.ts` |
| Edge-safety (no Node imports in middleware path) | `__tests__/config/auth-edge-safety.test.ts` |

**Pass criteria:** `npm run lint && npx tsc --noEmit && npm test` all clean.

---

## Layer 1 — Image build & boot

Confirm the published artifact builds and a fresh stack comes up.

```bash
# Build both targets locally (what the GHCR workflow does):
docker build --target runner    -t daatan-selfhost:test .
docker build --target migrations -t daatan-selfhost:test-migrations .

# Or run the full stack from source:
cp .env.selfhost.example .env    # set POSTGRES_PASSWORD, NEXTAUTH_SECRET, APP_URL, APP_NAME, DAATAN_EDITION=self_hosted
docker compose -f docker-compose.selfhost.yml up -d --build

# Smoke it:
./scripts/selfhost-smoke.sh http://localhost:3000
```

**Pass criteria:** `selfhost-smoke.sh` exits 0 — `/api/health` and `/api/health/auth` are green, migrations ran (no pending), the homepage returns 200.

---

## Layer 2 — Edition behavior (local, the core)

A fresh self-host with **no** Google/AWS/Oracle/LLM/search and AI off by default.

Automated slice — `npm run test:e2e:selfhost` (uses `playwright.selfhost.config.ts`, which boots the app with `DAATAN_EDITION=self_hosted`, `APP_NAME="Acme Forecasting"`, AI unset):

- `/create` shows **no** Express toggle (manual wizard only).
- No "Analyze" button on a forecast; no "AI Assist" on resolve; no Magic-Extract wand in the wizard.
- AI API routes return **404** (`/api/forecasts/express/guess`, `/api/ai/suggest-tags`, …).
- Branding: page `<title>` and sidebar wordmark show `Acme Forecasting`; `robots.txt` disallows all.

Manual / extended (checklist):

- [ ] Create a forecast via the manual wizard (no news anchor).
- [ ] Commit confidence units; another user commits the other side.
- [ ] Resolve it → reputation / Brier / Glicko / ELO update on the profile.
- [ ] Boot with `APP_NAME` unset → app **fails fast** with a clear "APP_NAME is required" error.

**Pass criteria:** the Playwright spec passes; the manual checklist is fully ticked.

---

## Layer 3 — Auth / SSO (needs an IdP)

Stand up the bundled Keycloak test IdP:

```bash
docker compose -f tests/selfhost/docker-compose.keycloak.yml up -d
# Imports the "daatan" realm: client `daatan-selfhost`, users admin@acme.example / user@acme.example (pw: password)
# Point the app at it:
#   OIDC_ISSUER=http://localhost:8080/realms/daatan
#   OIDC_CLIENT_ID=daatan-selfhost
#   OIDC_CLIENT_SECRET=daatan-selfhost-secret
#   OIDC_ADMIN_EMAILS=admin@acme.example
#   ALLOWED_EMAIL_DOMAINS=acme.example
```

Checklist:

- [ ] "Log in with SSO" button appears; login as `user@acme.example` → auto-provisioned as `USER`.
- [ ] Login as `admin@acme.example` → role is `ADMIN` (admin-email mapping).
- [ ] A user whose email is outside `acme.example` is **rejected** (domain gate) — add a second Keycloak user on another domain to verify.
- [ ] Public password signup is **blocked** (closed by default); `SELF_HOST_OPEN_SIGNUP=true` re-opens it.
- [ ] Admin → Invites → create link → it signs up exactly once, then is spent; revoke works.

**Pass criteria:** every box ticked against Keycloak.

---

## Layer 4 — Opt-in add-ons (prove they can be turned on)

- [ ] `ENABLE_AI_FEATURES=true` + `GEMINI_API_KEY` (or `OLLAMA_BASE_URL`) → Express / Analyze / Guess / Magic-Extract reappear and function; AI routes no longer 404.
- [ ] `ENABLE_EXTERNAL_MARKETS=true` → pasting a Polymarket/Kalshi URL prefills the forecast.
- [ ] `ORACLE_URL`/`ORACLE_API_KEY` set → Analyze uses the Oracle estimate; unset → falls back to LLM.

**Pass criteria:** each add-on activates with its flag and degrades gracefully without its backing service.

---

## Layer 5 — SaaS non-regression

- Layer 0 pins the unit-level invariants.
- The existing `deploy.yml` auto-deploys **staging** on every merge to `main`; smoke `https://staging.daatan.com` after a self-host PR merges (Google login works, `/api/health` green, an avatar upload round-trips to S3).
- Production ships only on a `v*` tag (unchanged).

**Pass criteria:** staging behaves exactly as before each self-host merge.

---

## First real run

Follow the copy-paste runbook: [`SELF_HOST_FIRST_RUN.md`](./SELF_HOST_FIRST_RUN.md) — publish the image → write `.env` → boot → smoke → edition behavior → Keycloak SSO → About panel → optional add-on, with expected output and a troubleshooting table at each step.

## Harness files

| File | Purpose |
|------|---------|
| `scripts/selfhost-smoke.sh` | Layer 1 — boot/health/migration smoke (CI-friendly, exits non-zero on failure) |
| `tests/selfhost/docker-compose.keycloak.yml` + `realm-export.json` | Layer 3 — a ready OIDC IdP with seeded users |
| `playwright.selfhost.config.ts` + `tests/e2e-selfhost/` | Layer 2 — automated edition-behavior checks (`npm run test:e2e:selfhost`) |
