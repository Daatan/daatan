# DAATAN Project Context

## Project Overview
DAATAN is a reputation-based prediction platform (Next.js 15, TypeScript, Prisma, PostgreSQL).
- Production: https://daatan.com
- Staging: https://staging.daatan.com
- Version stored in: package.json (`src/lib/version.ts` reads the baked `NEXT_PUBLIC_APP_VERSION`)

## Source of Truth
All features must align with DAATAN_CORE.md. Key principles:
- Measure accuracy over time, not engagement
- No real money or gambling features
- Authority is earned through results, not bought

## Tech Stack Quick Reference
- Framework: Next.js 15 (App Router)
- Database: PostgreSQL 16 (pgvector) + Prisma 7
- Auth: NextAuth.js with Google OAuth
- Hosting: AWS EC2 (Docker + Nginx)
- CI/CD: GitHub Actions

## Key Files
- Database schema: prisma/schema.prisma
- Auth config: src/auth.ts
- API routes: src/app/api/
- Deployment: docker-compose.prod.yml, .github/workflows/deploy.yml

## Deployment
- PR merged to `main` → auto-deploys to staging (never push to `main` directly)
- Push tag `v*` → auto-deploys to production
- Rollback: `./scripts/rollback.sh [production|staging]`
- Zero-downtime: `./scripts/blue-green-deploy.sh [staging|production] [--no-cache]`
