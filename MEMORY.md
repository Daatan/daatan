# MEMORY.md - DAATAN Knowledge Base

## Architecture Decisions
- PostgreSQL 16 for strict data integrity (not NoSQL)
- Next.js 16 App Router (not Pages Router), Cache Components on
- Tailwind CSS with mobile-first approach
- NextAuth.js for authentication (Google OAuth, plus a generic OIDC provider for self-hosted SSO)
- Prisma as ORM

## Environment
- **Repository:** https://github.com/Daatan/daatan
- **Primary Branch:** main
- **Local DB Port:** 5432
- **Production:** AWS EC2 (Ubuntu), Docker
- **Staging:** Separate EC2 instance (`staging.daatan.com`), same Docker layout

## Key Files
- Database schema: `prisma/schema.prisma`
- Auth config: `src/auth.ts`
- API routes: `src/app/api/`
- Version: `package.json` (`src/lib/version.ts` reads the baked `NEXT_PUBLIC_APP_VERSION`)
- Deployment: `docker-compose.prod.yml`, `.github/workflows/deploy.yml`

## Deployment Notes
- PR merged to main → auto-deploys to staging (never push to main directly)
- Push tag v* → auto-deploys to production
- Rollback: `./scripts/rollback.sh [production|staging]`
- Zero-downtime: `./scripts/blue-green-deploy.sh`

## Known Issues / Gotchas
- Cache Components is on (`cacheComponents: true` in `next.config.js`, Next 16): route segment configs (`export const dynamic` / `revalidate` / `runtime`) are build errors — don't add them. A route that reads no request data needs `await connection()` (`next/server`); see CLAUDE.md "Common patterns".
- Client pages with useSearchParams need Suspense boundary
- Git commands need `GIT_PAGER=cat` to avoid hanging

## Lessons Learned
- **Docker build gotchas**: ensure required environment variables like `NEXTAUTH_URL` and dummy secrets are provided during the build phase even if skipped locally. 
- **Next.js App Router pitfalls**: route segment configs (`export const dynamic` etc.) are build errors under Cache Components. Client components combining `useSearchParams` need a `<Suspense>` boundary to prevent de-optimizing the entire route.
- **Blue-green deployment**: Zero-downtime deployment is achieved by bringing up the new container alongside the old, health-checking it and running migrations on it, then swapping the service's Docker network alias on the edge network so nginx (variable upstream + Docker DNS) resolves to the new container, before stopping the old one. See `scripts/blue-green-deploy.sh` header and `docs/DEPLOYMENT.md`.
- **Prisma migration lessons**: Rollbacks require using `npx prisma migrate resolve --rolled-back <migration-name>` to correct the shadow database state before re-deploying a fixed migration.
