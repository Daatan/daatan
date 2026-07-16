# Claude / agent guidance

This file is loaded automatically by Claude Code (and other CLAUDE.md-aware agents) when working in this repo. Keep it terse; it's read on every turn.

## What this project is

Daatan — reputation-based news prediction platform. Production at https://daatan.com, staging at https://staging.daatan.com. Stack: Next.js 15 (App Router) + TypeScript + Prisma 7 + PostgreSQL (with pgvector) + NextAuth (Google OAuth, JWT sessions) + Tailwind. Deployed on AWS EC2 via Docker + GitHub Actions blue-green.

Detailed architecture and feature docs: see [`docs/`](./docs/).

## Hard rules

- **Interview before implementing.** Before starting any non-trivial implementation task, invoke the `/interview` skill (default 6 questions). Ask questions one at a time, suggest your preferred answer first. Skip only for tiny changes (typos, config tweaks, single-line fixes).
- **PR-only workflow.** Never push directly to `main`. Every change — even a typo — goes through a PR that's merged via the GitHub UI (so CI runs and review happens). Never use `git push --force` to main.
- **Bump version on every commit on a non-main branch.** The pre-commit hook enforces this. Bump `package.json` and the `// vX.Y.Z` comment in `src/lib/version.ts` together, and run `npm install` so the lockfile picks up the change. Follow semver.
- **Production deploys are tag-triggered and explicit.** Never tag a release or push a `v*` tag unless the user asked for it. CI auto-deploys staging on every PR merge to main; production only on `v*` tags.
- **Migrations run via the dedicated migrations container** in blue-green Phase 5. Don't rely on `docker exec` for `prisma migrate deploy` — the slim runner image lacks the Prisma CLI deps. See `docs/PRISMA_MIGRATE_DEPLOY_DEPS.md`.
- **The pgvector extension must be present** in the postgres image. Production uses `pgvector/pgvector:pg16`. Don't switch to stock `postgres:16-alpine` without re-evaluating the embedding migration.

## Common patterns

- API routes: `withAuth(handler, { roles: ['ADMIN'] })` from `src/lib/api-middleware.ts`
- Service results: `ServiceResult<T> = { ok: true; data; status } | { ok: false; error; status }`
- Prisma singleton: `src/lib/prisma.ts`
- Errors: `handleRouteError(err, msg)` and `apiError(msg, status)`
- Logging: structured pino via `createLogger('module-name')`

## Code style

- TypeScript strict; no `as any` / `as unknown as X` in app code, except 4 documented, unavoidable cases (re-audited June 2026): the two NextAuth callback-bridging casts in `src/auth.ts`, the polymorphic `as`-prop spread in `src/components/ui/Button.tsx`, and the non-standard `navigator.standalone` read in `src/components/PwaInstaller.tsx`. Don't add new ones.
- Default to no comments; only add when WHY is non-obvious
- Don't add error handling, fallbacks, or validation for impossible scenarios — trust internal callers
- Tests use vitest. Run `npm test` (no extra flags needed). 1000+ tests across two projects (node integration + happy-dom).
- `npm run lint` and `npx tsc --noEmit` must both be clean before any commit. Note: `npm run lint` still uses `next lint`, which is deprecated and removed in Next.js 16 — migrate to the ESLint CLI before that bump.

## Where to look

- Schema: [`prisma/schema.prisma`](./prisma/schema.prisma) + [`docs/DATABASE.md`](./docs/DATABASE.md) (table map, probability scales, cross-cutting gotchas)
- Auth flow: [`src/auth.ts`](./src/auth.ts)
- LLM providers: [`src/lib/llm/`](./src/lib/llm/) — main chain Gemini → Oracle (Bedrock/Nova) → OpenRouter → Ollama (each leg registers only when configured); OpenRouter also powers bots. See [`docs/LLM_ARCHITECTURE.md`](./docs/LLM_ARCHITECTURE.md)
- Scoring systems: [`src/lib/services/scoring-systems.ts`](./src/lib/services/scoring-systems.ts) and [`docs/SCORING_SYSTEMS.md`](./docs/SCORING_SYSTEMS.md)
- Bot system: [`src/lib/services/bots/`](./src/lib/services/bots/) and [`docs/bots.md`](./docs/bots.md), [`docs/BOT_APPROVAL_WORKFLOW.md`](./docs/BOT_APPROVAL_WORKFLOW.md)
- Embeddings + similar-forecasts: [`docs/EMBEDDINGS.md`](./docs/EMBEDDINGS.md)
- Search providers: [`docs/SEARCH_PROVIDERS.md`](./docs/SEARCH_PROVIDERS.md) (local summary) + canonical [Daatan/docs: search-providers.md](https://github.com/Daatan/docs/blob/main/search-providers.md)
- API surface: [`docs/API.md`](./docs/API.md)
- Deployment: [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) (runtime version overrides don't exist — [`docs/zero-downtime-version-updates.md`](./docs/zero-downtime-version-updates.md) is a retirement notice explaining why)
- Telegram notifications: [`docs/TELEGRAM_NOTIFICATIONS.md`](./docs/TELEGRAM_NOTIFICATIONS.md)
- Analytics (GA4 + consent mode): [`docs/ANALYTICS.md`](./docs/ANALYTICS.md)
- SEO (IndexNow, JSON-LD, metadata): [`docs/SEO.md`](./docs/SEO.md)
- GEO — AI answer engine visibility/citation (ChatGPT, Perplexity, AI Overviews): [`docs/GEO.md`](./docs/GEO.md)

## Infra cheat-sheet

- Production EC2: `i-04ea44d4243d35624`, EIP `3.126.238.216` → `daatan.com`
- Staging EC2:    `i-0406d237ca5d92cdf` → `staging.daatan.com`
- SSH port 22 is closed — server access is via AWS SSM `send-command` (use the `/ssm` slash command in Claude Code)
- Use `docker compose` (v2 plugin, no hyphen) on prod, not `docker-compose`
- Production uses containers `daatan-app`, `daatan-nginx`, `daatan-postgres`, `daatan-certbot`
- Backups: GitHub Actions `backup.yml` runs at 04:00 and 16:00 UTC daily (RPO ≤ 12h); stored in S3 `daatan-db-backups-272007598366`

## Before opening a PR

1. `git fetch origin main && git rebase origin/main` — keep the branch current
2. `npm run lint && npx tsc --noEmit && npm test` — all must pass
3. Bump version (hook will reject the commit otherwise)
4. Update relevant doc(s) in `docs/` if you changed an API surface, schema, or env var
5. Open the PR. Verify `gh pr view --json mergeable` shows `MERGEABLE` before announcing it
