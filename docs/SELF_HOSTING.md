# Self-hosting Daatan

Run Daatan inside your own organization for **internal forecasting** — a calibrated AI co-forecaster plus per-person reputation/calibration tracking, on your own infrastructure.

This guide targets a **single organization, one install** (corp / gov / NGO) running in its own cloud VPC or network. It is **not** air-gapped: outbound HTTPS is assumed (so you can use a hosted Oracle, a cloud LLM, and S3/MinIO).

> **SaaS note.** The public daatan.com SaaS is the same codebase with `DAATAN_EDITION=saas` (the default). Everything in this guide is gated behind `DAATAN_EDITION=self_hosted` and is inert for the SaaS deploy.

> **Maintainers:** see [`SELF_HOST_ARCHITECTURE.md`](./SELF_HOST_ARCHITECTURE.md) for the design and [`SELF_HOST_TEST_PLAN.md`](./SELF_HOST_TEST_PLAN.md) for how it's validated.

---

## 1. What you need

- A Linux host with Docker + the `docker compose` v2 plugin.
- A DNS name pointing at the host (e.g. `forecast.your-org.example`).
- **TLS termination at your own ingress / load balancer**, forwarding to the app on port `3000`. The self-host bundle does **not** ship nginx/certbot — you bring your own TLS (corporate LB, Caddy, Traefik, nginx, cloud ALB, …).
- Optional but recommended: an OIDC identity provider (Azure AD / Entra, Okta, Keycloak, Google Workspace) for SSO.

Everything else (Postgres with pgvector, migrations) is in the bundled compose file.

---

## 2. Quick start

**Recommended — pull the prebuilt image** (no source checkout, no build):

```bash
cp .env.selfhost.example .env      # then edit — see §3
export DAATAN_VERSION=1.18.25      # a published release (omit → latest)
docker compose -f docker-compose.selfhost.pull.yml up -d
```

This pulls the app + migrations images from GHCR (`ghcr.io/daatan/daatan-selfhost`), runs migrations as a one-shot init container, starts Postgres (`pgvector/pgvector:pg16`), and starts the app on `:3000`. Point your ingress at `:3000` and open your domain. Override `DAATAN_IMAGE` if you mirror the image to your own registry.

**Alternative — build from source** (a repo checkout):

```bash
docker compose -f docker-compose.selfhost.yml up -d --build
```

Either way, migrations run automatically before the app starts.

Health checks:
- `GET /api/health` — app + DB.
- `GET /api/health/auth` — auth provider configuration.

---

## 3. Configuration

Copy `.env.selfhost.example` and fill it in. The essentials:

### Required

| Var | What |
|-----|------|
| `DATABASE_URL` | Postgres connection. The bundled compose builds this from `POSTGRES_PASSWORD`. |
| `POSTGRES_PASSWORD` | Password for the bundled Postgres. |
| `NEXTAUTH_URL` | Public base URL of the install (auth callbacks). |
| `NEXTAUTH_SECRET` | 32+ char random secret — `openssl rand -hex 32`. |
| `DAATAN_EDITION` | Set to `self_hosted`. |

### Branding

Most branding is editable **at runtime by an admin** under **Admin → Settings** (no restart) — see §3a. The `.env` values below are optional seeds for a zero-touch first boot:

| Var | What |
|-----|------|
| `APP_URL` | **Required.** Canonical/SEO base URL (falls back to `NEXTAUTH_URL`). The app fails fast if neither is set. |
| `APP_NAME` | Optional seed for the brand name. If unset, the app boots as **"Forecasting"** until an admin sets the real name in Settings. |
| `APP_LOGO_URL` | Optional logo URL seed. |
| `EMAIL_FROM` | Optional outbound-email sender. |

A self-hosted instance is automatically **`noindex`** (robots + meta) and emits no daatan.com search-verification tags — it won't show up in public search engines.

### 3a. Admin settings (edit in the UI, no restart)

Once an admin is signed in (§4), **Admin → Settings** lets them configure the instance live — values are stored in the database and **override the matching `.env` value**:

- **App name** and **logo URL** — branding shown in the sidebar, page titles, and AI prompts.
- **About page** — a title + Markdown body rendered to all users at `/about`.
- **OpenRouter API key + model** — see §6. The key powers Express/AI; pasting it turns those features on with no restart. The key is write-only in the UI (shown as `•••• configured`, never echoed back) and stored in your own database.

Leaving a field blank reverts it to the `.env` value (or the built-in default).

---

## 4. Authentication

You have three options; they can be combined. **For getting every employee in, OIDC is the path** — invites and password signup are the fallbacks.

### 4a. OIDC SSO (recommended)

Register an OIDC application in your IdP, then set:

```
OIDC_ISSUER=https://login.your-org.example/realms/main
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_PROVIDER_NAME=Acme SSO            # the sign-in button label (defaults to "SSO")
```

The "SSO" button appears only when all three of `OIDC_ISSUER`/`CLIENT_ID`/`CLIENT_SECRET` are set. At your IdP, set the **redirect/callback URL** to:

```
${APP_URL}/api/auth/callback/oidc
```

On first login a user is auto-provisioned (role `USER`) — **no per-user admin work**. Admins see **Admin → About**, a read-only panel showing the edition, version, and which capabilities/integrations are configured — handy for confirming the install is wired up.

**Bootstrap your admins** without a database edit:

```
OIDC_ADMIN_EMAILS=admin@your-org.example,it-lead@your-org.example
```

Listed emails are promoted to `ADMIN` on sign-in (comma/space separated, case-insensitive).

#### Common IdP issuers

| IdP | `OIDC_ISSUER` |
|-----|---------------|
| Microsoft Entra (Azure AD) | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| Okta | `https://<your-org>.okta.com` |
| Keycloak | `https://<host>/realms/<realm>` |
| Google Workspace | `https://accounts.google.com` |

### 4b. Restrict to your company's domains (strongly recommended)

```
ALLOWED_EMAIL_DOMAINS=your-org.example,your-org.co.uk
```

Every sign-in — SSO **and** password — must have an email in this list (exact, case-insensitive; no subdomain wildcards). This is the safety net that keeps outsiders out even if an IdP federation is misconfigured. Leave unset for no restriction (the SaaS default).

### 4c. Password signup & invites (non-SSO fallback)

For people not in your IdP (contractors, guests) or orgs not using SSO:

- Public password signup is **closed by default** under `self_hosted`. To open it:
  ```
  SELF_HOST_OPEN_SIGNUP=true
  ```
  (Even when open, `ALLOWED_EMAIL_DOMAINS` still applies.)
- **Invite links** work regardless of `SELF_HOST_OPEN_SIGNUP`. An admin goes to **Admin → Invites**, clicks *Create invite* (the link is copied to the clipboard), and sends it. Each link is **single-use**: the recipient sets a password at `${APP_URL}/auth/signup?invite=<token>`. Pending invites can be revoked from the same screen.

### 4d. Google OAuth (optional)

The SaaS-style Google provider is available if you set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; leave them unset to hide the Google button.

---

## 5. Storage (uploads / avatars)

Set `STORAGE_DRIVER`:

| Driver | Use | Extra config |
|--------|-----|--------------|
| `s3` (default) | AWS S3 | `UPLOADS_BUCKET_NAME`, `AWS_REGION`, AWS credentials |
| `minio` | self-hosted S3-compatible | `UPLOADS_BUCKET_NAME`, `S3_ENDPOINT=http://minio:9000` |
| `local` | filesystem (single host) | `STORAGE_LOCAL_PATH=/data/uploads` (mount a volume) |

A MinIO service is included (commented) in `docker-compose.selfhost.yml` — uncomment it and set `STORAGE_DRIVER=minio` + `S3_ENDPOINT` to keep uploads fully in your network.

---

## 6. Optional add-on features (OFF by default)

v1 is a **pure manual forecasting tool**: create questions, commit, resolve, and track per-person calibration/reputation (Brier/Glicko/ELO) — none of which need any external service. The AI/Oracle/search and external-market features are **opt-in and off by default** on self-host, so a fresh install shows no AI buttons and never calls out.

**The LLM key is the switch** — configure one and AI-assisted features appear; configure none and they're hidden (UI gone, API routes 404 — no broken buttons).

| Provide… | …to enable |
|----------|------------|
| an **LLM key** — `OPENROUTER_API_KEY` (easy default; one key, many models), or `GEMINI_API_KEY`, or `OLLAMA_BASE_URL` (local) | **Express forecast**, "Guess Chances", AI extract & tag-suggest |
| an LLM key **+** a search backend — `ORACLE_URL` / `ORACLE_API_KEY` | the above **plus "Analyze"** (the search-backed co-forecaster) and resolve-time AI research |
| `ENABLE_EXTERNAL_MARKETS=true` | Polymarket / Kalshi paste-to-prefill import |

Notes:
- **Easiest path:** an admin pastes the OpenRouter key under **Admin → Settings** (§3a) — no `.env` edit, no restart. The `OPENROUTER_API_KEY` env var is just a seed for the same setting.
- On a self-host without a search backend, **Express runs LLM-only** (generates a structured forecast from your text, no web search) — which is the common case. "Analyze" stays hidden until you add the Oracle.
- `OPENROUTER_MODEL` (or the Model field in Settings) overrides the default model (`openai/gpt-4o-mini`).
- `ENABLE_AI_FEATURES=true` is an explicit override; normally a key is enough.
- Providers degrade gracefully relative to one another (Gemini → OpenRouter → Ollama).

> **Not in the self-hosted edition:** the automated **bot system** (LLM personas that scan news and auto-create forecasts) is SaaS-only. Its admin tab, pages, and API routes are disabled on self-host (the routes 404), and no bot sync runs at boot. Forecasts on a self-host are created by your people.

---

## 7. Backups

The bundled Postgres stores data in the `postgres_data` volume. Back it up with `pg_dump`:

```bash
docker exec daatan-selfhost-postgres pg_dump -U daatan daatan | gzip > daatan-$(date +%F).sql.gz
```

Restore into a fresh database:

```bash
gunzip -c daatan-YYYY-MM-DD.sql.gz | docker exec -i daatan-selfhost-postgres psql -U daatan daatan
```

Schedule the dump (cron / your backup system) and ship the artifact off-host.

---

## 8. Upgrades

Migrations run automatically: the `migrate` one-shot container applies pending Prisma migrations before the app starts, on every `up`.

Pull-based install — bump the version and re-up:

```bash
export DAATAN_VERSION=<new-version>
docker compose -f docker-compose.selfhost.pull.yml pull
docker compose -f docker-compose.selfhost.pull.yml up -d
```

Source build — `git pull` then `up --build`. Take a `pg_dump` (see §7) before upgrading.

### 8a. Publishing the image (maintainers)

The image is published from a **manual** GitHub Action — it never fires on a normal prod tag and touches nothing in the SaaS pipeline (no ECR/EC2/AWS).

1. Bump `package.json`'s `version` field and merge to `main` as usual.
2. **Actions → "Release self-hosted image" → Run workflow.** Leave *Version* blank to publish the current `package.json` version (or type an explicit one).
3. It builds and pushes both tags to GHCR:
   - `ghcr.io/daatan/daatan-selfhost:<version>` and `:latest`
   - `ghcr.io/daatan/daatan-selfhost:<version>-migrations` and `:latest-migrations`

### 8b. Letting a customer pull (private image)

The package is **private** (public packages are disabled by org policy), so the customer authenticates once before pulling. Issue them — or have them create — a GitHub token with **`read:packages`** only, then:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
export DAATAN_VERSION=<version>
docker compose -f docker-compose.selfhost.pull.yml pull
docker compose -f docker-compose.selfhost.pull.yml up -d
```

If a customer can't be granted org access, mirror the image into their own registry and point `DAATAN_IMAGE` at it.

---

## 9. Verifying the install

1. **Boot** — `docker compose ... up` succeeds; `GET /api/health` and `/api/health/auth` are green.
2. **SSO** — the "SSO" button appears; a test login auto-creates a `USER`; an `OIDC_ADMIN_EMAILS` address logs in as `ADMIN`.
3. **Domain gate** — a login from outside `ALLOWED_EMAIL_DOMAINS` is rejected.
4. **Invite** — Admin → Invites → *Create invite*; the link signs up exactly once and is then spent.
5. **Forecast** — create a question (no news anchor needed), submit a forecast, resolve it; reputation/Brier/Glicko update.

---

## 10. Environment variable reference

See [`.env.selfhost.example`](../.env.selfhost.example) for the full annotated list. Quick map:

- **Required:** `DATABASE_URL`, `POSTGRES_PASSWORD`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DAATAN_EDITION`, `APP_URL`
- **Branding (optional seeds — editable in Admin → Settings):** `APP_NAME`, `APP_LOGO_URL`, `EMAIL_FROM`
- **Auth:** `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME`, `OIDC_ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, `SELF_HOST_OPEN_SIGNUP`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL` (seeds the first admin via `prisma/seed.ts`)
- **Storage:** `STORAGE_DRIVER`, `UPLOADS_BUCKET_NAME`, `S3_ENDPOINT`, `STORAGE_LOCAL_PATH`, `AWS_REGION`
- **AI (a key enables it):** `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `GEMINI_API_KEY`, `OLLAMA_BASE_URL`; `ORACLE_URL`/`ORACLE_API_KEY` add "Analyze"; `ENABLE_AI_FEATURES` (override), `ENABLE_EXTERNAL_MARKETS`
