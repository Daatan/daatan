# Zero-Downtime Version Updates

> **Note:** This technique is rarely needed. The standard CI/CD pipeline (`deploy.yml`)
> handles version updates automatically on every tag push. Use this only for hotfix
> version-number corrections without a full code rebuild.

## Overview

The application version is baked into the Docker image at build time via
`NEXT_PUBLIC_APP_VERSION`. To update the displayed version without rebuilding:
1. Update `APP_VERSION` in the server's `.env` file
2. Restart the container (picks up the new value at startup)
3. Restart takes ~10 seconds — minimal downtime vs a full rebuild

## Access

All server access is via **AWS SSM** — port 22 is closed. Use the `/ssm` slash command
in Claude Code, or `aws ssm send-command` directly:

```bash
# Start an interactive session
aws ssm start-session --target i-04ea44d4243d35624   # production
aws ssm start-session --target i-0406d237ca5d92cdf   # staging
```

## Usage

### Update Version (Production)

```bash
aws ssm send-command \
  --instance-ids i-04ea44d4243d35624 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["cd ~/app && ./scripts/update-version.sh production 1.30.X"]'
```

### Update Version (Staging)

```bash
aws ssm send-command \
  --instance-ids i-0406d237ca5d92cdf \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["cd ~/app && ./scripts/update-version.sh staging 1.30.X"]'
```

## What Happens
1. Script validates version format (semver: MAJOR.MINOR.PATCH)
2. Updates `APP_VERSION` in `.env` file
3. Restarts container gracefully (docker compose restart)
4. Waits for health check
5. Verifies new version is deployed

## Downtime
- **Container restart**: ~10 seconds
- **Full rebuild**: ~5-10 minutes
- **Improvement**: 30-60x faster

## When to Use
- Hotfix version-number corrections
- Quick version corrections without code changes

## When NOT to Use
- Code changes (requires rebuild via CI/CD)
- Dependency updates (requires rebuild)
- Environment variable changes (use docker compose restart on the server)

## Verification
Check deployed version:
```bash
curl https://daatan.com/api/health | jq .version
curl https://staging.daatan.com/api/health | jq .version
```

## Rollback
If version update fails, the script automatically shows logs and exits with error.
Container remains running with old version.

## Technical Details
- Version source: `src/lib/version.ts`
- Reads from: `process.env.NEXT_PUBLIC_APP_VERSION` (baked at build) or `APP_VERSION` (runtime fallback)
- Container env: Set in `docker-compose.prod.yml`
