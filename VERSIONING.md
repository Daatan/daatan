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

Version bumps are **manual** and done explicitly when releasing:

1. Update `package.json` → `"version"` field
2. Commit: `git commit -m "chore: bump version to v1.x.x"`
3. Run `./scripts/release.sh` to tag and trigger production deploy

## Where the Version Lives

- **Source of truth**: `package.json` → `"version"`
- **Runtime**: `NEXT_PUBLIC_APP_VERSION` build arg (baked by CI from `package.json`)
- **Display**: sidebar logo, `/api/health` response, About page
- **Git tags**: each production release creates a tag `vMAJOR.MINOR.PATCH`

