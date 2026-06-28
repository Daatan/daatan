# Self-hosted edition — first-run validation runbook

A copy-paste sequence to prove a real self-host install works end-to-end, the first time. Run it once on a throwaway host (a small VM, or your laptop with Docker). Each step lists the command and what you should see. Maps to the layers in [`SELF_HOST_TEST_PLAN.md`](./SELF_HOST_TEST_PLAN.md).

Prerequisites: Docker + the `docker compose` v2 plugin; `openssl`, `curl`, `jq`.

---

## Step 1 — Publish the image (maintainer, once)

GitHub → Actions → **Release self-hosted image** → *Run workflow* (leave version blank to use `package.json`).

Then make the package pullable without auth: GitHub org **Daatan** → Packages → `daatan-selfhost` → Package settings → **Change visibility → Public**.

Verify the tags exist:

```bash
docker pull ghcr.io/daatan/daatan-selfhost:latest
docker pull ghcr.io/daatan/daatan-selfhost:latest-migrations
```

✅ Both pull without `docker login`.

> Prefer not to publish yet? Skip this step and build locally instead: in Step 3 use `docker-compose.selfhost.yml` with `up -d --build` (no GHCR needed).

---

## Step 2 — Write the `.env`

```bash
cp .env.selfhost.example .env
# Minimum to boot (manual edition, no SSO yet):
cat >> .env <<'EOF'
DAATAN_EDITION=self_hosted
APP_NAME=Acme Forecasting
APP_URL=https://forecast.acme.example
POSTGRES_PASSWORD=$(openssl rand -hex 16)
NEXTAUTH_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=https://forecast.acme.example
EOF
```

Edit `APP_URL`/`NEXTAUTH_URL` to your real hostname (or `http://localhost:3000` for a laptop test). Leave `ENABLE_AI_FEATURES`/`ENABLE_EXTERNAL_MARKETS` unset (off).

> Sanity check the require-branding guard: temporarily comment out `APP_NAME`, `up`, and confirm the app **fails fast** with "APP_NAME is required". Then restore it.

---

## Step 3 — Boot

```bash
export DAATAN_VERSION=$(node -p "require('./package.json').version")   # or a published tag
docker compose -f docker-compose.selfhost.pull.yml up -d
docker compose -f docker-compose.selfhost.pull.yml ps
```

✅ `postgres` healthy, `migrate` exited 0, `app` healthy.
✅ Migration logs: `docker compose -f docker-compose.selfhost.pull.yml logs migrate` shows migrations applied, no errors.

---

## Step 4 — Smoke (Layer 1)

```bash
./scripts/selfhost-smoke.sh http://localhost:3000        # or your APP_URL
```

✅ Exits 0: health ok, auth reachable, homepage 200, robots disallow-all (noindex).

---

## Step 5 — Edition behavior (Layer 2)

In a browser at your URL:

- [ ] Title bar / sidebar show **Acme Forecasting**, not DAATAN.
- [ ] `/create` shows the **manual wizard only** — no Express toggle.
- [ ] Open a forecast → **no "Analyze"** button; resolve view → **no "AI Assist"**.
- [ ] `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/ai/suggest-tags` → **401 or 404** (never 200).
- [ ] Manual happy path: create a forecast (no news anchor) → commit confidence → resolve → reputation/Brier update on the profile.

Or run the automated slice locally (needs a Postgres on `:5432` and a build):

```bash
npm run build && npm run test:e2e:selfhost
```

✅ The `tests/e2e-selfhost` specs pass (branding, noindex, no-Express, AI 404).

---

## Step 6 — SSO + access control (Layer 3)

```bash
docker compose -f tests/selfhost/docker-compose.keycloak.yml up -d
# add to .env, then `up -d` the app again:
#   OIDC_ISSUER=http://localhost:8080/realms/daatan
#   OIDC_CLIENT_ID=daatan-selfhost
#   OIDC_CLIENT_SECRET=daatan-selfhost-secret
#   OIDC_ADMIN_EMAILS=admin@acme.example
#   ALLOWED_EMAIL_DOMAINS=acme.example
```

- [ ] "Log in with SSO" appears; `user@acme.example` / `password` → logs in as a normal user.
- [ ] `admin@acme.example` → lands as **ADMIN** (see **Admin → About**).
- [ ] `outsider@other.example` → **rejected** (domain gate).
- [ ] Public password signup is blocked; Admin → Invites → create link → signs up once, then spent.

> Keycloak issuer must be reachable at the same URL from both the browser and the app container. On a single host, `http://localhost:8080` works for a browser-based login; if the app is containerized, put both on one Docker network and use the service hostname.

---

## Step 7 — Confirm with the About panel

Admin → **About**:

- [ ] Edition `self_hosted`, the right version, AI **off**, OIDC **on**, domain allow-list **on**, storage driver as configured.

---

## Step 8 — (optional) Toggle an add-on (Layer 4)

```bash
# in .env: ENABLE_AI_FEATURES=true and GEMINI_API_KEY=... (or OLLAMA_BASE_URL=...)
docker compose -f docker-compose.selfhost.pull.yml up -d
```

- [ ] Analyze / Express / Guess buttons reappear and function; About shows AI **on**.

---

## If something fails

- **App won't start, "APP_NAME/APP_URL is required"** → set them in `.env` (required for `self_hosted`).
- **`migrate` exits non-zero** → check `DATABASE_URL` / `POSTGRES_PASSWORD` match; view `logs migrate`.
- **GHCR pull denied** → the package is still private (Step 1) or you need `docker login ghcr.io`.
- **SSO redirect mismatch** → the IdP client redirect URI must be exactly `${APP_URL}/api/auth/callback/oidc`.
- **Everyone rejected at login** → `ALLOWED_EMAIL_DOMAINS` doesn't include the users' domain.

Record anything that needed a fix — that's the feedback that hardens the harness (especially the Playwright spec, which hasn't been run end-to-end yet).
