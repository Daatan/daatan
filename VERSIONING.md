# Versioning Rules

DAATAN follows [Semantic Versioning](https://semver.org/).

## Version Format

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: Breaking changes, major rewrites, or significant new systems
- **MINOR**: New features, significant improvements
- **PATCH**: Bug fixes, small improvements

## Convention

| PR Title Prefix | Version Bump |
|-----------------|--------------|
| `BREAKING:`, `major:` | MAJOR (x.0.0) |
| `feat:`, `feature:` | MINOR (0.x.0) |
| `fix:`, `chore:`, `infra:`, other | PATCH (0.0.x) |

## Examples

```
feat: Add user authentication     → 0.1.0 (minor bump)
fix: Correct login validation     → 0.1.1 (patch bump)
BREAKING: New database schema     → 1.0.0 (major bump)
chore: Update dependencies        → 1.0.1 (patch bump)
```

## How to Bump

Bump the version on **every commit on a non-`main` branch** — not at release time:

1. Update `package.json` → `"version"` field and run `npm install` so `package-lock.json` picks it up
   (or `npm version patch --no-git-tag-version`, which does both without creating a commit or tag)
2. Commit it with the change

This is enforced: `.husky/pre-commit` runs `scripts/check-version-bump.sh`, which requires the
branch's version to be strictly **greater** than `origin/main`'s (not merely different), and
`.github/workflows/version.yml` (the `Version bump` check) re-runs the same script on every PR's
merge commit — so two concurrent branches that both bump X → Y can't both merge. After a rebase,
re-check: a rebase can silently drop an identical bump.

Releasing is separate: `./scripts/release.sh` only creates and pushes a `v*` tag plus a GitHub
release (it offers `package.json`'s current version as option 0); it does not bump anything.
Pushing the tag triggers the production deploy.

## Where the Version Lives

- **Source of truth**: `package.json` → `"version"`
- **Runtime**: `NEXT_PUBLIC_APP_VERSION` build arg (baked by CI from `package.json`)
- **Display**: sidebar logo, `/api/health` response, About page, staging/next banners
- **Git tags**: each production release creates a tag `vMAJOR.MINOR.PATCH`

