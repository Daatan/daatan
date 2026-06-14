Run the production release checklist for the daatan project. Follow every step in order. Stop and report if anything fails.

## Pre-flight checks

1. Run `git checkout main && git pull --ff-only` — confirm main is up to date.
2. Run `gh pr list --state open` — if any open PRs exist, list them and ask the user whether to proceed or merge them first.
3. Run `cat package.json | grep '"version"'` to confirm the version to be released.
4. Run `git tag --list 'v*' | sort -V | tail -5` to confirm this version hasn't been tagged yet.

## Trigger DB backup

5. Trigger a manual DB backup via GitHub Actions before touching production:
   ```
   gh workflow run backup.yml
   ```
   Wait 30 seconds, then run `gh run list --workflow=backup.yml --limit=1` to confirm it started.

## Tag and deploy

6. Create and push the production tag:
   ```
   git tag v<VERSION>
   git push origin v<VERSION>
   ```
   This triggers the `deploy-production` job in deploy.yml.

## Monitor CI/CD

7. Run `gh run list --workflow=deploy.yml --limit=3` every 30 seconds until the production deploy job shows `completed`. Report status after each check.
8. If the run fails, run `gh run view <RUN_ID> --log-failed` and report the error.

## Verify production

9. Run: `curl -s https://daatan.com/api/health` and confirm the returned JSON shows the expected `version`, `env: "production"`, and `db: true` (HTTP 200; 503 if the DB is unhealthy).
10. Run: `curl -o /dev/null -s -w "%{http_code}" https://daatan.com/` and confirm HTTP 200.

## Done

11. Report: version deployed, tag created, HTTP status confirmed.
