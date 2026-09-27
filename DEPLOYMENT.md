# DAATAN Deployment

> **Canonical docs moved.** The authoritative deployment and rollback
> guides now live under `docs/`:
>
> - **Deployment pipeline** — [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)
> - **Rollback procedures** — [docs/ROLLBACK.md](./docs/ROLLBACK.md)
> - **Secrets management** — [SECRETS.md](./SECRETS.md)
> - **Infra layout** — [INFRASTRUCTURE_SPLIT.md](./INFRASTRUCTURE_SPLIT.md)
>
> This file is kept as a redirect so older links (internal docs,
> bookmarks, search results) still land somewhere useful. Please update
> any references to point at `docs/DEPLOYMENT.md` directly.

## TL;DR

```bash
# 1. Local sanity
npm run typecheck && npm test && npm run build

# 2. Deploy to staging — merge a PR into main (never push to main directly)
gh pr merge <n> --squash

# 3. Deploy to production — tag and push
./scripts/release.sh        # interactive; tags + creates the GitHub release (no version bump — that happens per-PR)

# 4. Verify
curl https://staging.daatan.com/api/health
curl https://daatan.com/api/health
```

## Everything else

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for the full CI/CD
pipeline, blue-green flow, ECR tags, IAM / SSM specifics, secrets
bootstrap (`fetch-secrets.sh`), and manual / emergency operations. See
[`docs/ROLLBACK.md`](./docs/ROLLBACK.md) for rollback procedures.
