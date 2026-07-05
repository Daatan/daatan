# MEMORY.md - DAATAN Knowledge Base

## Architecture Decisions
- PostgreSQL 16 for strict data integrity (not NoSQL)
- Next.js 15 App Router (not Pages Router)
- Tailwind CSS with mobile-first approach
- NextAuth.js for authentication (Google OAuth, plus a generic OIDC provider for self-hosted SSO)
- Prisma as ORM

## Environment
- **Repository:** https://github.com/Daatan/daatan
- **Primary Branch:** main
- **Local DB Port:** 5432
- **Production:** AWS EC2 (Ubuntu), Docker
- **Staging:** Same EC2, different container

## Key Files
- Database schema: `prisma/schema.prisma`
- Auth config: `src/auth.ts`
- API routes: `src/app/api/`
- Version: `src/lib/version.ts`
- Deployment: `docker-compose.prod.yml`, `.github/workflows/deploy.yml`

## Deployment Notes
- Push to main → auto-deploys to staging
- Push tag v* → auto-deploys to production
- Rollback: `./scripts/rollback.sh [production|staging]`
- Zero-downtime: `./scripts/blue-green-deploy.sh`

## Known Issues / Gotchas
- `export const dynamic = 'force-dynamic'` only works in Server Components
- Client pages with useSearchParams need Suspense boundary
- Add `transpilePackages: ['next-auth']` in next.config.js for Docker builds
- Git commands need `GIT_PAGER=cat` to avoid hanging

## Lessons Learned
- **Docker build gotchas**: Next.js standalone build can struggle with NextAuth if `transpilePackages: ['next-auth']` is omitted. Ensure required environment variables like `NEXTAUTH_URL` and dummy secrets are provided during the build phase even if skipped locally. 
- **Next.js App Router pitfalls**: `export const dynamic = 'force-dynamic'` works ONLY in Server Components. Client components combining `useSearchParams` need a `<Suspense>` boundary to prevent de-optimizing the entire route.
- **Blue-green deployment**: Zero-downtime deployment is achieved by bringing up the new container alongside the old, updating the Nginx upstream path, and executing `nginx -s reload` without stopping Nginx, before taking down the old container.
- **Prisma migration lessons**: Rollbacks require using `npx prisma migrate resolve --rolled-back <migration-name>` to correct the shadow database state before re-deploying a fixed migration.
