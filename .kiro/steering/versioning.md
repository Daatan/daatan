# Versioning Guidelines

## Version Tracking
- The health endpoint (`/api/health`) returns the git commit hash for deployment verification
- Example response: `{"status":"ok","version":"0.1.16","commit":"abc1234","timestamp":"..."}`
- Use the `commit` field to verify which code is deployed

## Version Bumps
The version lives in `package.json` (`src/lib/version.ts` reads the `NEXT_PUBLIC_APP_VERSION` build arg baked from it).
- Bump `package.json`'s `version` (and run `npm install` so the lockfile follows) on **every commit on a non-main branch** — the pre-commit hook (`scripts/check-version-bump.sh`) and the `Version bump` CI check (`.github/workflows/version.yml`) reject a version that doesn't advance past `origin/main`
- Follow semver (see `VERSIONING.md`); patch for fixes/chores/docs

## Production Deployment
1. Merge the PR (CI auto-deploys staging)
2. Only when explicitly asked: run `./scripts/release.sh` on `main` (it creates and pushes the `vX.Y.Z` tag + GitHub release)
3. Tag push triggers production deployment
