# DAATAN Technical Documentation

> Technical architecture, infrastructure, project structure, and development guide.
> Last updated: September 27, 2026

---

## Table of Contents

1. [Technology Stack](#technology-stack)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Infrastructure](#infrastructure)
5. [CI/CD Pipeline](#cicd-pipeline)
6. [Database](#database)
7. [Authentication](#authentication)
8. [Security](#security)
9. [Monitoring & Operations](#monitoring--operations)
10. [Development Workflow](#development-workflow)

---

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Next.js (App Router) | 15.5.x |
| Language | TypeScript | 5.x |
| Runtime | Node.js | 24.x |
| Styling | Tailwind CSS | 3.4.x |
| Database | PostgreSQL | 16 |
| ORM | Prisma | 7.x |
| Authentication | NextAuth.js (Auth.js v5) | 5.0.0-beta.x |
| Testing | Vitest | 4.x |
| Containerization | Docker | Latest |
| Reverse Proxy | Nginx | Alpine |
| SSL | Let's Encrypt (Certbot) | Latest |
| Cloud | AWS (EC2, Route 53, S3) | - |
| IaC | Terraform | 1.x |
| CI/CD | GitHub Actions | - |
| AI Integration | Gemini `gemini-2.5-flash` via Vertex AI (primary; Developer-API key leg for self-host) → Oracul `/llm` (AWS Bedrock / Amazon Nova) → OpenRouter → Ollama; OpenRouter also powers bots | - |
| Forecast Oracul | TruthMachine Oracul API (`oracle.daatan.com`) — calibrated multi-source probability estimates | 1.x (app accepts API major `1` only — `EXPECTED_API_MAJOR_VERSIONS` in `src/lib/services/oracle.ts`) |
| Prompts | In-code registry `PROMPTS` in `src/lib/llm/bedrock-prompts.ts`, mirrored in `prompts/*.txt` and pinned by `prompts/prompt_versions.lock.json` (#1658) | - |
| Email | Resend | - |
| Push Notifications | web-push (VAPID) | - |
| Notifications | Telegram | - |
| i18n | next-intl | 4.x |
| Image Processing | Sharp | - |

**LLM prompts** are served from git: `PROMPTS` in `src/lib/llm/bedrock-prompts.ts` is the source of truth (no runtime fetch, no cache), `prompts/*.txt` is the human-editable mirror kept byte-identical by a test, and `prompts/prompt_versions.lock.json` pins prose + response schema together (#1658). AWS Bedrock Prompt Management is no longer used — its Terraform was removed in #1674. See [docs/LLM_ARCHITECTURE.md](./docs/LLM_ARCHITECTURE.md).

---

## Architecture Overview

### High-Level Architecture

Production and staging run on **two independent EC2 instances** in `eu-central-1`. Each instance is a self-contained Docker Compose stack (nginx + Next.js app + Postgres + certbot). See [INFRASTRUCTURE_SPLIT.md](./INFRASTRUCTURE_SPLIT.md) for instance IDs and IPs.

```
┌─────────────────────────────────────────────────────────────────┐
│                            Internet                             │
└───────────────────────────┬─────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       AWS Route 53 (DNS)                        │
│  daatan.com          (A)  → 3.126.238.216  (prod EIP)           │
│  api.daatan.com      (A)  → 3.126.238.216  (prod EIP)           │
│  staging.daatan.com  (A)  → 63.180.208.34  (staging EIP)        │
└───────────────┬───────────────────────────────┬─────────────────┘
                ▼                               ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│  EC2 i-04ea44d4243d35624 (prod) │ │ EC2 i-0406d237ca5d92cdf (staging)│
│  t3.medium · eu-central-1       │ │ t3.small · eu-central-1          │
│  ┌───────────────────────────┐  │ │  ┌───────────────────────────┐   │
│  │  daatan-nginx (80/443)    │  │ │  │  daatan-nginx (80/443)    │   │
│  │           │               │  │ │  │           │               │   │
│  │           ▼               │  │ │  │           ▼               │   │
│  │  daatan-app :3000         │  │ │  │  daatan-app-staging :3000 │   │
│  │           │               │  │ │  │  daatan-app-next :3000 (1)│   │
│  │           ▼               │  │ │  │           │               │   │
│  │  daatan-postgres          │  │ │  │           ▼               │   │
│  │  (DB: daatan)             │  │ │  │  daatan-postgres-staging  │   │
│  │                           │  │ │  │  (DB: daatan_staging)     │   │
│  │  daatan-certbot           │  │ │  │  daatan-certbot           │   │
│  └───────────────────────────┘  │ │  └───────────────────────────┘   │
└────────────────┬────────────────┘ └────────────────┬────────────────┘
                 ▼                                   ▼
      s3://daatan-db-backups-...       s3://daatan-db-backups-staging-...
      s3://daatan-uploads-prod-...     s3://daatan-uploads-staging-...

                 ▼ (HTTPS, x-api-key)
      ┌──────────────────────────────────────┐
      │  oracle.daatan.com                   │
      │  (FastAPI — retro repo, separate EC2)│
      │  calibrated probability estimates    │
      └──────────────────────────────────────┘
```

(1) `daatan-app-next` serves the manually deployed NEXT testbed (`next.daatan.com`, `deploy-next.yml`, shares the staging DB — see [docs/NEXT_ENVIRONMENT.md](./docs/NEXT_ENVIRONMENT.md)). The staging box is stopped outside working hours by EventBridge Scheduler (`terraform/staging_schedule.tf`, #1526); `deploy.yml` wakes it before deploying.

### Request Flow

1. User requests `https://daatan.com` (or `https://staging.daatan.com`).
2. Route 53 resolves to the corresponding EC2 Elastic IP.
3. Nginx on that instance terminates TLS (Let's Encrypt) and routes to the app container.
4. Next.js processes the request; Prisma talks to the local Postgres container.
5. When a route needs a calibrated probability (e.g. `POST /api/forecasts/[id]/context`), the app calls `${ORACLE_URL}/forecast` with the shared `x-api-key`, and falls back to the LLM chain on any failure or `placeholder` response.
6. Response flows back through the chain.

### Docker Containers

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `daatan-nginx` | `nginx:alpine` | 80, 443 | Reverse proxy, SSL termination |
| `daatan-app` | `daatan-app:<tag>` (prod host) | 3000 (internal) | Production Next.js app |
| `daatan-app-new` / `daatan-app-staging-new` | same image as the target | 3000 (internal) | Blue/green candidate, only while `scripts/blue-green-deploy.sh` runs |
| `daatan-app-staging` | `daatan-app:staging-*` (staging host) | 3000 (internal) | Staging Next.js app |
| `daatan-app-next` | `daatan-app:next-latest` (staging host) | 3000 (internal) | NEXT testbed (`next.daatan.com`), staging DB |
| `daatan-postgres` | `pgvector/pgvector:pg16` (prod host) | 5432 (internal) | Production PostgreSQL (DB: `daatan`) |
| `daatan-postgres-staging` | `pgvector/pgvector:pg16` (staging host) | 5432 (internal) | Staging PostgreSQL (DB: `daatan_staging`) |
| `daatan-certbot` | `certbot/dns-route53` (prod) / `certbot/certbot` (staging) | - | SSL certificate renewal |

### Volumes

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `app_postgres_data` | /var/lib/postgresql/data | Production DB persistence (named volume, Docker-prefixed) |
| `app_postgres_staging_data` | /var/lib/postgresql/data | Staging DB persistence |
| `./certbot/conf` | /etc/letsencrypt | SSL certificates |
| `./certbot/www` | /var/www/certbot | ACME challenge files |

> **Note:** Docker prefixes named volumes with the compose project name (`app_`) because compose runs from `/home/ubuntu/app/`. Data survives container restarts but NOT `docker compose down -v`.

---

## Project Structure

### Directory Overview

```
daatan/
├── .github/                    # GitHub configuration
│   └── workflows/              # CI/CD pipelines + scheduled jobs (see CI/CD Pipeline below)
│       └── deploy.yml          # Main CI + deployment workflow
├── .husky/                     # Git hooks
│   ├── pre-commit              # check-version-bump.sh + lint-staged (ESLint --fix)
│   └── pre-push                # typecheck + scripts/run-related-tests.sh (excluding integration)
├── android/                    # Android (TWA) app
├── certbot/                    # SSL certificate storage (on the servers)
│   ├── conf/                   # Let's Encrypt certificates
│   └── www/                    # ACME challenge files
├── infra/nginx/                # nginx configs (see Configuration Files)
├── messages/                   # next-intl locale files
├── prisma/                     # Database schema
│   ├── schema.prisma           # Prisma ORM schema
│   └── migrations/             # Migrations (applied by the migrations container)
├── prompts/                    # Human-editable mirror of every LLM prompt + version lock
├── public/                     # Static assets
├── scripts/                    # Operational scripts
├── src/                        # Application source code
├── terraform/                  # Infrastructure as Code
├── tests/                      # Playwright E2E (e2e/, e2e-selfhost/) + self-host checks
└── __tests__/                  # Test files
```

### Source Code (`src/`)

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API routes (full list: docs/API.md)
│   │   ├── account/            # forget-history — "Forget History" anonymize/detach (#1701)
│   │   ├── admin/              # Admin-only endpoints (role: ADMIN)
│   │   │   └── bots/           # Bot CRUD + run trigger
│   │   │       └── [id]/       # Per-bot: PATCH, DELETE, run, logs
│   │   ├── auth/               # NextAuth.js endpoints
│   │   ├── bots/               # Public bot runner endpoint (cron)
│   │   │   └── run/            # POST — triggered by GitHub Actions
│   │   ├── comments/           # Comment CRUD + reactions
│   │   ├── commitments/        # User commitment listing
│   │   ├── forecasts/          # Forecast CRUD (new system)
│   │   ├── health/             # Health check endpoint (version, commit, db, memory)
│   │   ├── ibi/                # IBI tool endpoints (fetch-url, llm, search)
│   │   ├── meta/               # timings — 30-day average context-update stage timings
│   │   ├── news-anchors/       # News anchor management
│   │   ├── news-indexer/       # news-indexer integration (active-forecasts, context push)
│   │   ├── notifications/      # Notification endpoints
│   │   ├── profile/            # User profile update
│   │   │   └── avatar/         # Avatar upload → S3
│   │   ├── push/               # Browser push subscription management
│   │   ├── ai/                 # AI-powered endpoints
│   │   ├── cron/               # Cron job endpoints hit by scheduled workflows
│   │   ├── tags/               # Tag management
│   │   ├── telegram/           # Telegram rollback webhook
│   │   ├── leaderboard/        # Leaderboard endpoint (+ sources/)
│   │   ├── top-reputation/     # Top reputation endpoint (legacy)
│   │   ├── uploads/            # Serves uploads from local disk (STORAGE_DRIVER=local)
│   │   ├── user/               # User preferences
│   │   └── well-known/         # assetlinks (Android TWA)
│   ├── admin/                  # Admin UI pages (role: ADMIN)
│   │   └── bots/               # Bot management dashboard (BotsTable.tsx)
│   ├── auth/                   # Auth pages
│   │   ├── signin/             # Sign in page
│   │   │   ├── page.tsx        # Server Component wrapper
│   │   │   └── SignInClient.tsx # Client Component with UI
│   │   └── error/              # Auth error page
│   │       ├── page.tsx        # Server Component wrapper
│   │       └── AuthErrorClient.tsx # Client Component with UI
│   ├── [locale]/               # Localized (he/ru/eo) routes
│   ├── authors/                # Pundit/author pages
│   ├── create/                 # Forecast creation
│   ├── elections/              # Elections matrix
│   ├── help/                   # Help pages (rating-numbers)
│   ├── leaderboard/            # User rankings (+ ai/, sources/)
│   ├── notifications/          # User notifications
│   ├── forecasts/              # Forecast views
│   ├── oracle-v2/              # Chrome-free Oracul 2.0 playground (admin)
│   ├── profile/                # User profile
│   ├── retroanalysis/          # Retroanalysis case studies
│   ├── settings/               # User settings
│   ├── sources/                # Per-source pages (sources/[name])
│   ├── globals.css             # Global styles
│   ├── layout.tsx              # Root layout
│   └── page.tsx                # Homepage
├── components/                 # React components
│   ├── comments/               # Comment thread components
│   ├── forecasts/              # Forecast-related components
│   │   └── Speedometer.tsx     # SVG probability gauge (∩-shape, green/red arcs, 3 marks: market/user/AI)
│   ├── profile/                # Profile edit form
│   ├── MainContent.tsx         # Client wrapper for <main>; removes sidebar offset on /auth/* routes
│   ├── Sidebar.tsx             # Navigation sidebar (hidden on /auth/* routes)
│   └── SessionWrapper.tsx      # Auth session provider
├── lib/                        # Shared utilities
│   ├── llm/                    # LLM integration
│   │   ├── providers/          # Provider implementations
│   │   │   ├── vertex.ts       # Gemini via Vertex AI (primary, #1472)
│   │   │   ├── gemini.ts       # Gemini Developer API (key-based; self-host)
│   │   │   ├── oracle.ts       # Oracul /llm — Bedrock / Amazon Nova fallback
│   │   │   ├── ollama.ts       # Ollama (self-hosted fallback)
│   │   │   └── openrouter.ts   # OpenRouter (fallback + bots)
│   │   ├── bedrock-prompts.ts  # In-code prompt registry (PROMPTS); name is historical (#1658)
│   │   ├── service.ts          # ResilientLLMService (ordered provider chain)
│   │   ├── types.ts            # LLMProvider, LLMRequest, LLMResponse
│   │   └── index.ts            # Exports llmService, createBotLLMService
│   ├── services/               # Business logic services
│   ├── utils/                  # Utility functions
│   ├── validations/            # Zod schemas
│   │                           # (NextAuth config lives at src/auth.ts, not src/lib/)
│   ├── prisma.ts               # Prisma client singleton
│   └── logger.ts               # Pino structured logging
└── types/                      # TypeScript definitions
    └── next-auth.d.ts          # NextAuth type extensions
```

### Scripts Directory

| Script | Purpose | Usage |
|--------|---------|-------|
| `blue-green-deploy.sh` | Zero-downtime deployment | `./scripts/blue-green-deploy.sh [production\|staging]` |
| `rollback.sh` | Quick rollback to previous commit | `./scripts/rollback.sh [production\|staging]` |
| `verify-health.sh` | HTTP health check (CI-safe) | `./scripts/verify-health.sh <url>` |
| `verify-logs.sh` | Docker log inspection (server-only) | `./scripts/verify-logs.sh <staging\|production>` |
| `verify-deploy.sh` | Wrapper: health check + log inspection | `./scripts/verify-deploy.sh <url> [environment]` |
| `verify-local.sh` | Comprehensive local verification | `./scripts/verify-local.sh` |
| `verify-nginx-config.sh` | Validate nginx configuration | `./scripts/verify-nginx-config.sh` |
| `release.sh` | Interactive version tagging | `./scripts/release.sh` |
| `status.sh` | Full health/version check | `./scripts/status.sh` |
| `check.sh` | Quick up/down check | `./scripts/check.sh` |

### Terraform Structure

```
terraform/
├── main.tf                     # Provider configuration
├── ec2.tf                      # EC2 instances (production + staging) + user data
├── vpc.tf                      # VPC, subnets, routing
├── security_groups.tf          # Firewall rules
├── route53.tf                  # DNS records
├── s3.tf                       # Backup + upload buckets, EC2 role/profile
├── state.tf                    # S3 backend + DynamoDB state locking config
├── iam_ssm.tf                  # SSM access
├── iam_ecr.tf / ecr.tf         # ECR repository, lifecycle policy, EC2 pull access
├── oidc_github.tf              # GitHub Actions OIDC role (AWS_ROLE_ARN)
├── bedrock_invoke.tf           # Bedrock invoke permission for the EC2 role (AI panel)
├── secrets.tf / secrets_ssm.tf # Secrets Manager env bundles, SSM parameters
├── ses.tf / iam_smtp.tf        # SES domain, mail forwarding, SMTP users
├── monitoring.tf               # CloudWatch alarms, SNS topics, budgets
├── telegram_alerts.tf          # Lambda forwarding infra alerts to Telegram (#1726)
├── staging_schedule.tf         # EventBridge Scheduler off-hours staging stop/start (#1526)
├── variables.tf                # Input variables
├── outputs.tf                  # Output values
├── backend-staging.hcl         # Staging backend config (partial configuration)
├── backend-prod.hcl            # Production backend config (partial configuration)
├── scripts/check-no-replace.sh # Pre-apply guard against instance replacement
├── terraform.tfvars            # Variable values (gitignored)
└── terraform.tfvars.example    # Example variables
```

### Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Node.js dependencies and scripts |
| `tsconfig.json` | TypeScript configuration |
| `next.config.js` | Next.js configuration |
| `tailwind.config.js` | Tailwind CSS configuration |
| `vitest.config.ts` | Vitest test configuration |
| `vitest.config.integration.ts` | Integration tests (`npm run test:integration`, real Postgres on :5433) |
| `playwright.config.ts` / `playwright.selfhost.config.ts` | Playwright E2E (`npm run test:e2e`, `npm run test:e2e:selfhost`) |
| `prisma.config.ts` | Prisma 7 CLI configuration |
| `Dockerfile` | Multi-stage Docker build |
| `docker-compose.yml` | Local development stack |
| `docker-compose.prod.yml` | Production Docker stack |
| `docker-compose.staging.yml` | Staging Docker stack (app-staging + app-next NEXT testbed) |
| `docker-compose.test.yml` | Test Postgres for integration tests |
| `docker-compose.selfhost*.yml` | Self-hosted edition stacks (see `docs/SELF_HOSTING.md`) |
| `infra/nginx/nginx-prod-ssl.conf` | Production nginx with SSL (mounted by `docker-compose.prod.yml`) |
| `infra/nginx/nginx-ssl.conf` | Combined prod+staging SSL config; used by `scripts/verify-nginx-config.sh` and the security-header test |
| `infra/nginx/nginx-staging-ssl.conf` | Staging nginx with SSL |
| `infra/nginx/nginx.conf` | Local development nginx |
| `infra/nginx/nginx-init.conf` | First-run nginx (HTTP-only, for cert issuance) |
| `.env.example` | Environment variable template |

### Documentation

| File | Purpose |
|------|---------|
| `README.md` | Project overview and quick start |
| `DAATAN_CORE.md` | Source of Truth — vision and principles |
| `GLOSSARY.md` | Terminology definitions |
| `FORECASTS_FLOW.md` | Forecast system implementation flow |
| `TODO.md` | Pointer to the GitHub Issues backlog |
| `TECH.md` | Technical architecture (this file) |
| `INFRASTRUCTURE_SPLIT.md` | Prod / staging EC2 split details |
| `docs/DEPLOYMENT.md` | Canonical deployment pipeline |
| `docs/ROLLBACK.md` | Rollback procedures |
| `SECRETS.md` | Secrets management guide |
| `SECURITY.md` | Security policy & vulnerability reporting |
| `VERSIONING.md` | Semantic versioning rules |
| `PRODUCT.md` | Product documentation |
| `TESTING.md` | Testing strategy and guidelines |
| `docs/API.md` | HTTP API reference |
| `docs/DATABASE.md` | Table map, probability scales, schema gotchas |
| `docs/LLM_ARCHITECTURE.md` | LLM chain + Oracul integration |

### Testing Structure

```
__tests__/                      # Integration tests
src/
├── app/__tests__/              # API route tests (also colocated __tests__/ next to routes and lib modules)
├── components/__tests__/       # Component tests
└── test/setup.ts               # Vitest setup file
tests/
├── e2e/                        # Playwright E2E (npm run test:e2e)
└── e2e-selfhost/               # Self-host Playwright E2E (npm run test:e2e:selfhost)
```

---

## Infrastructure

### AWS Resources

| Resource | Type | Details |
|----------|------|---------|
| EC2 Instance (prod) | t3.medium | Ubuntu 24.04, 4GB RAM |
| EC2 Instance (staging) | t3.small | Ubuntu 24.04, 2GB RAM |
| Elastic IP | Static | Assigned to EC2 |
| Route 53 | Hosted Zone | daatan.com |
| S3 Bucket | Production DB backups | `daatan-db-backups-272007598366` |
| S3 Bucket | Staging DB backups | `daatan-db-backups-staging-272007598366` |
| S3 Bucket | Avatar/upload storage | `daatan-uploads-prod-272007598366`, `daatan-uploads-staging-272007598366` |
| ECR | Container registry | `daatan-app` repository (app + `-migrations` images) |
| EventBridge Scheduler | Staging off-hours sleep | Stops staging 20:00 UTC, starts 06:00 UTC on weekdays (`terraform/staging_schedule.tf`) |
| Security Group | Firewall | HTTP, HTTPS (port 22 blocked — use SSM for server access) |
| IAM Role | EC2 Profile (prod) | `daatan-ec2-role-prod` — SSM + S3 backup/upload access (prod buckets) + Secrets Manager (`daatan-env-prod`) |
| IAM Role | EC2 Profile (staging) | `daatan-ec2-role-staging` — SSM + S3 backup/upload access (staging buckets) + Secrets Manager (`daatan-env-staging`) |

### Live Deployment

**Production URL:** https://daatan.com
**Staging URL:** https://staging.daatan.com

| Component | Value |
|-----------|-------|
| Region | `eu-central-1` (Frankfurt) |
| SSL Certificate | Let's Encrypt, auto-renewed by certbot (90-day cycle) |

### Network & DNS

| Component | Provider/Service | Purpose |
|-----------|------------------|---------|
| Domain Registrar | Namecheap | Owns `daatan.com` |
| DNS Management | Route 53 | Hosted zone |
| Nameservers | AWS | 4 NS records delegated from Namecheap |

### Security Group Rules

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Blocked | SSH — not used; access is via AWS SSM only |
| 80 | TCP | 0.0.0.0/0 | HTTP (redirects to HTTPS) |
| 443 | TCP | 0.0.0.0/0 | HTTPS |
| ICMP | - | 0.0.0.0/0 | Ping (debugging) |
### Terraform Resources

```hcl
# Key resources managed by Terraform
aws_instance.production        # Prod EC2 (both instances live in the prod state)
aws_instance.staging           # Staging EC2 — never blanket-apply
aws_eip.production / .staging  # Elastic IPs
data.aws_route53_zone.main     # DNS zone (data source, not managed)
aws_route53_record.*           # DNS records
aws_s3_bucket.backups          # Prod backup bucket
aws_s3_bucket.backups_staging  # Staging backup bucket
aws_s3_bucket.uploads          # Upload bucket (per env)
aws_security_group.ec2         # Firewall rules
aws_iam_role.ec2_role          # EC2 instance profile per env
aws_vpc.main                   # VPC
aws_subnet.public_a            # Public subnet
```

### Terraform Workflow (State Separation)

Terraform state is stored in S3 (`daatan-terraform-state`) and uses DynamoDB for state locking.
**Crucial:** staging and production are completely isolated using "Partial Configuration" — you MUST pass the correct backend config when initialising Terraform.

```bash
cd terraform

# Staging
terraform init -backend-config=backend-staging.hcl
terraform plan  -var="environment=staging"
terraform apply -var="environment=staging"

# Production — run terraform/scripts/check-no-replace.sh first, see terraform/README.md
terraform init -backend-config=backend-prod.hcl
terraform plan  -var="environment=prod"
terraform apply -var="environment=prod"
```

**Note:** both instances have `lifecycle { ignore_changes = [ami, user_data]; prevent_destroy = true }` to prevent accidental recreation. Prefer `-target=<resource>` applies over a blanket `apply` (e.g. the staging scheduler resources are applied by name — see the header of `terraform/staging_schedule.tf`).

**Before any apply touching `aws_instance.production`/`aws_instance.staging`:** run
`terraform/scripts/check-no-replace.sh`, which fails loudly if the plan would replace
(destroy + recreate) either live instance instead of updating it in place — see
`terraform/README.md` and daatan#1194 for why (`key_name` is immutable and
`terraform/*.tfvars` are gitignored, so a local drift is invisible until apply time).

### Estimated Monthly Costs

EC2/Route53/S3 costs only — excludes LLM/Bedrock spend, which dominates actual AWS billing. See the daily cost report (`.github/workflows/cost-report.yml`) for total spend.

| Service | Cost |
|---------|------|
| EC2 t3.medium (prod) | ~$30 |
| EC2 t3.small (staging) | ~$17 |
| Route 53 | ~$0.50 |
| S3 (backups) | ~$0.10 |
| **Total (infra only)** | **~$48/month** |

---

## CI/CD Pipeline

### GitHub Actions Workflows

#### Bot Runner Workflow (`bots.yml`)

Calls `POST /api/bots/run` with the `x-bot-runner-secret` header, which triggers `runDueBots()` to run any active bots that are due. **Its 5-minute schedule is commented out (stopped 2026-08-04) and the workflow is disabled at the Actions API** — it is `workflow_dispatch`-only; see the header of `.github/workflows/bots.yml` for why and how to restart it.

**Required secret:** `BOT_RUNNER_SECRET` — must match the value of the `BOT_RUNNER_SECRET` environment variable in the running app.

See [docs/bots.md](./docs/bots.md) for full bot system documentation.

#### Scheduled Workflows

Most hit an `/api/cron/*` (or admin) endpoint on the app; all also allow manual `workflow_dispatch`. Times are UTC.

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `watchdog.yml` | every 5 min | HTTP health + version drift, plus SSM disk/CPU/memory checks on the EC2 hosts |
| `transition-expired-predictions.yml` | every 15 min | `/api/cron/transition-expired-predictions` |
| `search-health.yml` | hourly | `/api/cron/search-health` |
| `external-market-sync.yml` | hourly :17 | `/api/cron/external-market-sync` — refresh linked Polymarket/Kalshi prices |
| `news-indexer-watchdog.yml` | every 2 h :17 | news-indexer disk + pipeline health via its `/stats` |
| `backfill-embeddings.yml` | 02:23 daily | `/api/cron/backfill-embeddings` |
| `backup.yml` | 04:00 + 16:00 daily | Prod DB backup to S3 (see Automated Backups) |
| `ai-panel.yml` | 04:43 + 16:43 daily | `/api/cron/ai-panel` — multi-model estimate panel |
| `requote.yml` | 05:31 daily | `/api/cron/requote` — temporal-model daily requote |
| `pundit-ratings-recalculate.yml` | 06:15 daily | `/api/admin/pundit-ratings/recalculate` |
| `cert-expiry.yml` | 06:17 daily | Served-cert expiry watch |
| `heartbeat.yml` | 09:00 daily | `/api/cron/heartbeat` — daily "alive" signal |
| `evidence-health.yml` | 10:23 daily | `/api/cron/evidence-health` — evidence-pipeline regression digest |
| `relation-typer.yml` | 11:37 daily | `/api/cron/relation-typer` — types forecast pairs into `question_relations` |
| `cost-report.yml` | 12:00 daily | Daily cost report (Telegram) |
| `seo-report.yml` | Mon 06:00 | Weekly SEO report |
| `retry-pool-extractions.yml` | Mon 06:30 | `/api/admin/evidence-pool/retry` — drain stuck pool rows |
| `cost-report-weekly.yml` | Mon 12:00 | Weekly cost report |
| `llm-waste-report.yml` | Mon 12:30 | Weekly LLM waste report |
| `model-audit-weekly.yml` | Mon 13:07 | Weekly LLM model audit |
| `evidence-second-opinion.yml` | Mon/Thu 09:00 | `/api/cron/evidence-second-opinion` |
| `cost-report-monthly.yml` | 1st of month 12:00 | Monthly cost report |

Manual-only workflows: `rollback.yml`, `deploy-next.yml` (NEXT testbed), `release-selfhost.yml`, `backfill-english-canonical.yml`, `backfill-oracle-sources.yml`. `android-release.yml` runs on `android-v*` tags; `version.yml` and `terraform-validate.yml` (when `terraform/**` changes) run on pull requests.

#### Deploy Workflow (`deploy.yml`)

**Triggers:**
- Pull request to `main` → checks only (no image push, no deploy)
- Push to `main` → Deploy to Staging
- Push tag `v*` → Deploy to Production
- Manual dispatch → Either environment

**Pipeline Stages:**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Build &   │────▶│   Deploy    │────▶│   Verify    │
│    Test     │     │   (SSM)     │     │   (Health)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Build Stage** (parallel jobs, Node.js 24):
- `Type check` and `Lint`
- `Unit tests` — on PRs, only tests related to changed files (`scripts/run-related-tests.sh`); on push/tag, the full suite sharded 4 ways (`Unit tests (full suite)`)
- `Integration Tests` (`npm run test:integration`)
- `Build & Test` (`npm run build`)
- On push/tag: `Build & Push App Image` and `Build & Push Migrations Image` to ECR in parallel; AWS access is via the OIDC role in `AWS_ROLE_ARN`

**Deploy Stage (Staging):**
- Wake the staging instance if the off-hours schedule has stopped it, and wait for SSM to come online
- Send command via AWS SSM (SSH port 22 is blocked)
- Download deploy scripts from GitHub at the current commit SHA
- Pull Docker image from ECR (`staging-latest`)
- Run blue-green deployment (`scripts/blue-green-deploy.sh staging`)
- Verify health check externally

**Deploy Stage (Production):**
- Same as staging but triggered by version tag (`v*`)
- Pulls image tagged with the specific version
- More conservative cleanup

### Required Secrets

GitHub Actions secrets referenced by the workflows. Runtime app secrets (`POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `GOOGLE_*`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`, …) are **not** GitHub secrets — they live in the Secrets Manager bundles (see [Secrets Management](#secrets-management) and [SECRETS.md](./SECRETS.md)).

| Secret | Purpose |
|--------|---------|
| `AWS_ROLE_ARN` | OIDC role assumed for ECR, SSM and the report workflows (no static AWS keys) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push public key, baked into the image at build time |
| `BOT_RUNNER_SECRET` | Shared secret for `POST /api/bots/run` and other cron endpoints called by workflows |
| `STAGING_URL` | Staging base URL used by scheduled workflows |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for workflow notifications |
| `TELEGRAM_CHAT_ID` | Telegram channel ID for notifications |
| `TELEGRAM_CLEAN_CHAT_ID` | High-signal (clean) Telegram channel for reports/alerts |
| `DATABASE_URL_STAGING` | Used by `deploy-next.yml` |
| `GSC_SA_KEY` / `YWM_OAUTH_TOKEN` / `CRUX_API_KEY` | `seo-report.yml` data sources |
| `ANDROID_KEYSTORE_*` / `ANDROID_KEY_PASSWORD` | `android-release.yml` signing |

---

## Database

### Schema Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User                                    │
│  - id, email, name, image, isBot                                │
│  - eloRating (headline rating), rs (Reputation Score)           │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ creates            │ commits            │ 1:1
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
│   Prediction    │  │   Commitment    │  │   BotConfig      │
│  - claimText    │  │  - cuCommitted  │  │  - personaPrompt │
│  - outcomeType  │  │    (confidence) │  │  - intervalMins  │
│  - status       │  │  - rsSnapshot   │  │  - autoApprove   │
└─────────────────┘  │  - binaryChoice │  └────────┬─────────┘
         │           │  - brierScore   │           │ 1:many
         │ linked to │  - rsChange     │           ▼
         ▼           └─────────────────┘  ┌──────────────────┐
┌─────────────────┐                       │   BotRunLog      │
│   NewsAnchor    │                       │  - action (enum) │
│  - url, title   │                       │  - isDryRun      │
│  - source       │                       │  - generatedText │
│  - publishedAt  │                       │  - error         │
└─────────────────┘                       └──────────────────┘
```

### Key Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| User | User accounts | eloRating (headline rating), rs, mu/sigma (Glicko), isBot, avatarUrl, slug, username |
| Prediction | Forecast statements | claimText, outcomeType, status, source, externalMarketId |
| PredictionOption | Options for multiple choice | text, predictionId |
| Commitment | Confidence + resolution record | cuCommitted (confidence), probability, rsSnapshot, brierScore, rsChange, eloChange |
| NewsAnchor | News context | url, title, source |
| Comment | Prediction comments | text, authorId, predictionId |
| CommentReaction | Emoji reactions on comments | type, userId, commentId |
| Notification | User notifications | type, message, read, userId |
| NotificationPreference | Per-type notification settings | userId, type, inApp, email, browserPush, telegram |
| PushSubscription | Browser push subscription | userId, endpoint, p256dh, auth |
| ContextSnapshot | Per-forecast context/estimate history | predictionId, summary, sources, externalProbability, oracleSnapshot |
| Tag | Prediction categories | name, slug |
| BotConfig | Autonomous bot configuration | personaPrompt, intervalMinutes, autoApprove, tagFilter, voteBias |
| BotRunLog | Audit log of bot actions | action (CREATED_FORECAST, VOTED, SKIPPED, ERROR), isDryRun, generatedText |
| EvidencePoolArticle | Per-forecast evidence pool rows extracted by the Oracul | url, status, stance, certainty, extractor/oracle provenance |
| ExternalMarket | Linked Polymarket/Kalshi markets (prices in `ExternalMarketPriceSnapshot`) | provider, usageScope, externalId, question |
| QuestionRelation / LatentNode | Oracul 2.0 forecast-graph storage | kind, origin, status |

Full table map (including `AiEstimate*`, `CalibrationRecord`, `OracleCallLog`, `PunditTagRating`, …): [docs/DATABASE.md](./docs/DATABASE.md).

### Database Operations

> **All server commands go via AWS SSM** — SSH port 22 is blocked. See `/ssm` skill or DEPLOYMENT.md.

```bash
# Connect to production DB (via SSM)
aws ssm send-command --instance-ids <ID> --document-name AWS-RunShellScript \
  --parameters '{"commands":["docker exec -i daatan-postgres psql -U daatan -d daatan -c \"\\dt\""]}'

# Migrations run via the dedicated migrations container (daatan-migrations),
# NOT via `docker exec` on the app container — the slim app image has no
# Prisma CLI / node_modules. See docs/DEPLOYMENT.md ("The dedicated migrations
# container") and docs/PRISMA_MIGRATE_DEPLOY_DEPS.md for the full flow; it
# runs automatically as Phase 5 of the blue-green deploy.

# Check migration status
docker run --rm --network host \
  -e DATABASE_URL=postgresql://daatan:<PASS>@localhost:5432/daatan \
  daatan-migrations:staging-latest npx prisma migrate status

# Manual backup — run the backup workflow (it ships scripts/backup-db.sh via SSM)
gh workflow run backup.yml
```

### Prod/Staging DB Separation

Each database runs on its **own EC2 instance** (prod and staging hosts), in separate containers:

| | Production | Staging |
|---|---|---|
| Container | `daatan-postgres` | `daatan-postgres-staging` |
| Database name | `daatan` | `daatan_staging` |
| Volume | `app_postgres_data` | `app_postgres_staging_data` |
| App container | `daatan-app` | `daatan-app-staging` |
| URL | daatan.com | staging.daatan.com |

The staging and production databases are **fully independent**. They share no data unless explicitly copied.

### Automated Backups

- **Workflow:** `.github/workflows/backup.yml` — scheduled at **04:00 and 16:00 UTC** daily (RPO ≤ 12h), plus manual `workflow_dispatch`
- **Mechanism:** GitHub Actions pushes `scripts/backup-db.sh` to the prod EC2 instance (tag `Environment=prod`) via AWS SSM `send-command` and runs it there — no cron on the box
- **Backs up:** prod only (`daatan-postgres` → `daatan`) → `s3://daatan-db-backups-272007598366/backups/`
- **S3 filename format:** `<UTC timestamp>.sql.gz` (e.g. `20260703T172550Z.sql.gz`)
- **Retention:** the script itself trims the `backups/` prefix to the newest 60 objects (30 days at 2/day) after every upload; an S3 lifecycle rule on the same prefix (`terraform/s3.tf`) expires objects after 30 days as a backstop in case the script's trim ever fails
- **Post-backup verification:** workflow triggers `scripts/verify-backup.sh` via SSM to confirm the dump restores cleanly
- **Failure alerting:** Telegram message to the clean/prod channel on any step failure
- **Staging bucket:** `daatan-db-backups-staging-*` and its 14-day lifecycle rule exist in Terraform but nothing currently populates it — staging has no automated DB backup today

---

## Authentication

### NextAuth.js Configuration

Auth.js v5. The config is split so middleware can run on the Edge runtime:

- `src/auth.config.ts` — Edge-safe base config: Google provider (registered only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set), optional generic OIDC provider (self-host, `OIDC_*`), `session: { strategy: 'jwt' }`, shared callbacks. Imported by `src/middleware.ts`.
- `src/auth.ts` — Node-only: `NextAuth({ ...authConfig, adapter: PrismaAdapter(prisma), providers: [...authConfig.providers, Credentials(...)] })` exporting `handlers, auth, signIn, signOut`. The bcrypt-backed email/password Credentials provider (and a Playwright test provider in test runs) live here because they need the DB.

```typescript
// src/auth.ts (abridged)
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [...authConfig.providers, Credentials({ /* email + bcrypt password */ })],
})
```

### Auth Page Architecture

Auth pages use a Server/Client component split pattern for proper Next.js App Router compatibility:

```
src/app/auth/
├── signin/
│   ├── page.tsx           # Server Component (export const dynamic)
│   └── SignInClient.tsx   # Client Component (useSearchParams, hooks)
└── error/
    ├── page.tsx           # Server Component (export const dynamic)
    └── AuthErrorClient.tsx # Client Component (useSearchParams)
```

**Why this pattern?**
- `export const dynamic = 'force-dynamic'` only works in Server Components
- `useSearchParams()` requires `'use client'` directive
- Combining both in one file causes the dynamic export to be ignored

Auth pages are rendered without the sidebar: `Sidebar` returns `null` on `/auth/*` routes, and `MainContent` removes the `lg:ml-64 mt-16` offset so auth pages fill the full viewport.

### OAuth Flow

1. User clicks "Sign in with Google"
2. Redirect to Google OAuth consent
3. Google redirects back with auth code
4. NextAuth exchanges code for tokens
5. User created/updated in database
6. JWT session token issued

### Session Management

- **Strategy:** JWT (stateless)
- **Token Location:** HTTP-only cookie
- **Expiration:** Configurable (default: 30 days)

---

## Security

### SSL/TLS

- **Provider:** Let's Encrypt
- **Certificates:** Per-hostname (`daatan.com`, `elections.daatan.com` on prod; `staging.daatan.com`, `next.daatan.com` on staging — see the `ssl_certificate` paths in `infra/nginx/`). Prod renews via DNS-01 (`certbot/dns-route53`, using the EC2 role's Route 53 permissions)
- **Renewal:** Automatic via Certbot (every 12 hours check) — no fixed expiry date to track here, since it auto-renews. `.github/workflows/cert-expiry.yml` watches the served leaf cert daily and alerts Telegram if renewal has actually failed; when TLS breaks, check the *authenticator* (e.g. DNS-01 IAM permissions), not a cached expiry.

To manually renew:
```bash
# Run inside the certbot container, which has the right plugin (dns-route53 on prod)
docker exec daatan-certbot certbot renew
docker compose -f ~/app/docker-compose.prod.yml restart nginx
```

### Security Headers (Nginx)

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `SAMEORIGIN` | Prevents clickjacking |
| `X-Content-Type-Options` | `nosniff` | Blocks MIME-type sniffing |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables unused browser APIs |
| `Content-Security-Policy` | See below | Controls allowed resource origins |

### Content-Security-Policy

| Directive | Value | Why |
|-----------|-------|-----|
| `default-src` | `'self'` | Baseline — same-origin only |
| `script-src` | `'self' https://www.googletagmanager.com 'unsafe-inline'` | App bundles + GA + inline GA init |
| `style-src` | `'self' https://fonts.googleapis.com 'unsafe-inline'` | Tailwind + Google Fonts + Next.js inline |
| `font-src` | `'self' https://fonts.gstatic.com` | Google Fonts woff2 files |
| `img-src` | `'self' https://lh3.googleusercontent.com https://www.googletagmanager.com data:` | App images + Google OAuth avatars + GA |
| `connect-src` | `'self' https://www.google-analytics.com https://*.google-analytics.com https://www.google.com` | GA event beacons |
| `frame-ancestors` | `'none'` | Blocks embedding |
| `object-src` | `'none'` | Blocks Flash/Java plugins |
| `base-uri` | `'self'` | Prevents `<base>` tag hijacking |
| `form-action` | `'self'` | Forms submit to same origin only |
| `worker-src` | `'self'` | PWA service workers |
| `upgrade-insecure-requests` | — | Upgrade any `http:` subresource to HTTPS |

**Enforcement:** every nginx config (`nginx.conf`, `nginx-ssl.conf`, `nginx-staging-ssl.conf`, `nginx-prod-ssl.conf`) sends the enforcing `Content-Security-Policy` header — there is no `Report-Only` rollout any more, so a missing origin breaks the resource outright.

**Adding a new external resource:**
1. Identify the directive (e.g., `script-src` for JS, `img-src` for images)
2. Add the origin to the CSP in all 4 nginx configs under `infra/nginx/`
3. Update test expectations in `__tests__/config/nginx-security-headers.test.ts`
4. Deploy and verify no violations in browser console

### Network Security

- Port 22 closed at the security group — all shell access is via AWS SSM
- Database not exposed publicly (internal Docker network)
- All traffic forced to HTTPS
- API routes have cache disabled

### Secrets Management

- Runtime secrets live in AWS Secrets Manager bundles (`daatan-env-prod`, `daatan-env-staging`) and are pulled into `~/app/.env` on each deploy by `scripts/fetch-secrets.sh`
- GitHub Secrets are used only for build-time / workflow values (`AWS_ROLE_ARN`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, Telegram notifications)
- `.env` is gitignored; no secrets are baked into Docker images
- See [SECRETS.md](./SECRETS.md) for the full list, rotation runbook, and update flow

---

## Monitoring & Operations

### Health Check Endpoints

```bash
# Production
curl https://daatan.com/api/health
# Response: {"status":"ok","version":"<version>","commit":"<short sha>","timestamp":"...","env":"production","db":true,"memory":{...}}
# status is "degraded" (DB down) or "memory-pressure" (RSS > 1600 MB) with HTTP 503

# Staging
curl https://staging.daatan.com/api/health
```

### Container Monitoring

```bash
# Container status
docker ps -a

# Resource usage
docker stats

# Container logs
docker logs daatan-app --tail 100 -f
docker logs daatan-nginx --tail 100 -f
docker logs daatan-postgres --tail 100 -f
```

### Database Health

```bash
# Connection check
docker exec daatan-postgres pg_isready -U daatan -d daatan

# Database size
docker exec daatan-postgres psql -U daatan -d daatan \
  -c "SELECT pg_size_pretty(pg_database_size('daatan'));"
```

### Log Rotation

- **Driver:** json-file
- **Max Size:** 10MB per file
- **Max Files:** 3 per container

---

## Development Workflow

### Local Setup

```bash
git clone https://github.com/Daatan/daatan.git
cd daatan
npm install
cp .env.example .env
# Edit .env with your values
npm run dev
```

### Environment Variables

Typical local `.env` — only `DATABASE_URL`, `NEXTAUTH_URL` and `NEXTAUTH_SECRET` (≥32 chars, not placeholder text) are required by `src/env.ts`; everything else is optional. See `.env.example` for the full template and [SECRETS.md](./SECRETS.md) for what production sets:

```bash
DATABASE_URL=postgresql://user:password@host:5432/database
NEXTAUTH_SECRET=<secure-random-string>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
POSTGRES_PASSWORD=<secure-password>
GOOGLE_VERTEX_PROJECT_ID=<gcp-project-id>
GOOGLE_VERTEX_CLIENT_EMAIL=<service-account-email>
GOOGLE_VERTEX_PRIVATE_KEY=<service-account-pem>
BOT_RUNNER_SECRET=<shared-secret-for-cron-endpoint>
AWS_REGION=eu-central-1
AWS_PROFILE=daatan
```

### Git Hooks (Husky)

**Pre-Commit:** (fast checks only)
- Version-bump check (`scripts/check-version-bump.sh`)
- `lint-staged` (lints staged `*.{ts,tsx}` files)

**Pre-Push:**
- Type check (`npm run typecheck`)
- Targeted tests (`scripts/run-related-tests.sh origin/main` → `vitest related --run` on changed `.ts`/`.tsx`, excluding integration tests)
- Detect auth-related changes (non-blocking warning)

### Git Workflow

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code, auto-deploys to staging |
| `feat/*`, `fix/*`, `chore/*` | Feature/fix development branches |

| Trigger | Target |
|---------|--------|
| Push to `main` | Staging (staging.daatan.com) |
| Push tag `v*` | Production (daatan.com) |
| Manual workflow | Either environment |

### Testing

```bash
npm test                        # Run all tests
npm run test:coverage           # Run with coverage
npm test -- path/to/test.ts     # Run specific test
npm run test:integration        # Integration tests (needs test Postgres on :5433, docker-compose.test.yml)
npm run test:e2e                # Playwright E2E
npm run lint                    # Lint
npx tsc --noEmit                # Type check
```

### Local Verification

```bash
./scripts/verify-local.sh       # Comprehensive pre-push check
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Health check fails | Check logs: `docker logs daatan-app --tail 50` |
| 502 Bad Gateway | Verify app container running: `docker ps` |
| Database connection error | Check postgres: `docker exec daatan-postgres pg_isready` |
| SSL certificate error | Renew: `docker exec daatan-certbot certbot renew` |
| High memory usage | Restart container: `docker compose restart app` |

### Debug Commands

```bash
docker ps -a --filter name=daatan-          # All containers
docker exec daatan-nginx nginx -t           # Check nginx config
docker exec daatan-app env | grep -E "NEXT|DATABASE|GOOGLE"  # Check env vars
df -h                                       # Disk space
free -m                                     # Memory
```

---

## Related Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) — Deployment procedures and operations
- [PRODUCT.md](./PRODUCT.md) — Product documentation
- [GitHub Issues](https://github.com/Daatan/daatan/issues) — Technical debt and roadmap (`P1`/`P2`/`P3`/`icebox` labels)
- [SECRETS.md](./SECRETS.md) — Secrets management guide
