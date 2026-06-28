# Self-hosting Daatan

Run Daatan inside your own organization for **internal forecasting** — a calibrated AI co-forecaster plus per-person reputation/calibration tracking, on your own infrastructure.

This guide targets a **single organization, one install** (corp / gov / NGO) running in its own cloud VPC or network. It is **not** air-gapped: outbound HTTPS is assumed (so you can use a hosted Oracle, a cloud LLM, and S3/MinIO).

> **SaaS note.** The public daatan.com SaaS is the same codebase with `DAATAN_EDITION=saas` (the default). Everything in this guide is gated behind `DAATAN_EDITION=self_hosted` and is inert for the SaaS deploy.

---

## 1. What you need

- A Linux host with Docker + the `docker compose` v2 plugin.
- A DNS name pointing at the host (e.g. `forecast.your-org.example`).
- **TLS termination at your own ingress / load balancer**, forwarding to the app on port `3000`. The self-host bundle does **not** ship nginx/certbot — you bring your own TLS (corporate LB, Caddy, Traefik, nginx, cloud ALB, …).
- Optional but recommended: an OIDC identity provider (Azure AD / Entra, Okta, Keycloak, Google Workspace) for SSO.

Everything else (Postgres with pgvector, migrations) is in the bundled compose file.

---

## 2. Quick start

```bash
cp .env.selfhost.example .env      # then edit — see §3
docker compose -f docker-compose.selfhost.yml up -d --build
```

This builds the app image locally, runs database migrations as a one-shot init container, starts Postgres (`pgvector/pgvector:pg16`), and starts the app on `:3000`. Point your ingress at `:3000` and open your domain.

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

### Branding (optional — defaults to Daatan)

`APP_URL` (canonical/SEO base; falls back to `NEXTAUTH_URL`), `APP_NAME`, `APP_LOGO_URL`, `EMAIL_FROM`.

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

On first login a user is auto-provisioned (role `USER`) — **no per-user admin work**.

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

## 6. AI features (all optional — degrade gracefully)

| Var | What happens when unset |
|-----|--------------------------|
| `GEMINI_API_KEY` | Falls back to a local Ollama at `OLLAMA_BASE_URL`; if neither, AI estimates are skipped. |
| `OLLAMA_BASE_URL` | No local LLM fallback. |
| `ORACLE_URL` / `ORACLE_API_KEY` | The calibrated Oracle co-forecaster is skipped; the LLM path is used instead. |

The forecasting engine, scoring, Brier/Glicko/ELO, and reputation work with **none** of these set — the AI pieces are additive.

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

```bash
git pull
docker compose -f docker-compose.selfhost.yml up -d --build
```

Take a `pg_dump` (see §7) before upgrading.

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

- **Required:** `DATABASE_URL`, `POSTGRES_PASSWORD`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DAATAN_EDITION`
- **Branding:** `APP_URL`, `APP_NAME`, `APP_LOGO_URL`, `EMAIL_FROM`
- **Auth:** `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME`, `OIDC_ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, `SELF_HOST_OPEN_SIGNUP`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Storage:** `STORAGE_DRIVER`, `UPLOADS_BUCKET_NAME`, `S3_ENDPOINT`, `STORAGE_LOCAL_PATH`, `AWS_REGION`
- **AI:** `GEMINI_API_KEY`, `OLLAMA_BASE_URL`, `ORACLE_URL`, `ORACLE_API_KEY`
