# NEXT Environment (Client Testbed)

The **NEXT** environment ([https://next.daatan.com](https://next.daatan.com)) is a dedicated testbed for approving new UI/UX changes before they are merged into the stable staging/production environments.

## Core Features
- **Shared Data**: Runs on the same server and uses the same **Staging Database** as the standard staging environment.
- **Isolated UI**: Allows testing of experimental layouts and interactive components without affecting other testers.
- **Environment Banner**: Displays a blue `NEXT TESTBED` banner at the top of the screen for easy identification.
- **Confidence Model**: The first environment to implement the interactive -100 to +100 confidence slider and removal of the "CU" currency terminology.

## Deployment
Deployments to the NEXT environment are **manual** to allow for maximum flexibility in showcasing specific branches.

### How to deploy a branch to NEXT:
1. Go to **GitHub Actions** in the repository.
2. Select the **"Deploy to Next (Testbed)"** workflow.
3. Click **"Run workflow"**.
4. Choose the branch you want to preview (e.g., `feat/new-charts`).
5. Click the green **Run workflow** button.

The deployment uses a dedicated Docker container `daatan-app-next` and is managed by the `scripts/blue-green-deploy.sh next` command.

Caveats (from `.github/workflows/deploy-next.yml`):
- **Branch migrations do not run.** The workflow builds only the app image (`next-latest`); Phase 5 uses the existing `daatan-migrations:staging-latest` image, i.e. whatever `main` last deployed to staging. A branch that needs a schema change won't get it on NEXT — and the database is shared with staging anyway.
- **It does not wake staging.** The staging box sleeps 20:00–06:00 UTC and on weekends (see `docs/DEPLOYMENT.md`); `deploy-next.yml` has no wake step, so start the instance (or trigger a staging deploy) first during that window.

## Technical Configuration
- **Hostname**: `next.daatan.com`
- **Nginx Config**: `infra/nginx/nginx-staging-ssl.conf` (proxies to `http://app-next:3000`)
- **Docker Service**: `app-next` in `docker-compose.staging.yml`
- **Environment Variable**: `APP_ENV=next`

## Verification Checklist
- [x] Blue banner is visible at the top.
- [x] Confidence slider is active on binary forecasts.
- [x] Speedometer shows Market, User, and AI indicators.
- [x] All "CU" terminology is hidden/replaced by "Confidence".
