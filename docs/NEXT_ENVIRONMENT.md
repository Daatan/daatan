# NEXT Environment (Client Testbed)

The **NEXT** environment ([https://next.daatan.com](https://next.daatan.com)) is a dedicated testbed for approving new UI/UX changes before they are merged into the stable staging/production environments.

## Core Features
- **Shared Data**: Runs on the same server and uses the same **Staging Database** as the standard staging environment.
- **Isolated UI**: Allows testing of experimental layouts and interactive components without affecting other testers.
- **Environment Banner**: Displays a blue `NEXT TESTBED` banner at the top of the screen for easy identification.
- **Confidence Model**: The first environment to implement the interactive -100 to +100 confidence slider and removal of the "CU" currency terminology.

## Deployment
There is currently **no deploy workflow** for NEXT. The manual "Deploy to Next (Testbed)" workflow
(`deploy-next.yml`) was removed in October 2026: it had not run since April 2026 and depended on a
repository secret that no longer exists. Nothing builds or pushes a `daatan-app:next-latest` image
any more, so the testbed is dormant.

The staging-side pieces are still in place (the `app-next` service, the nginx server block and
certificate, and `scripts/blue-green-deploy.sh next`). To revive the testbed, build a
`daatan-app:next-latest` image for the branch on the staging host and run
`scripts/blue-green-deploy.sh next`, or add a new workflow modelled on the staging job in
`deploy.yml` (OIDC credentials, wake-staging step, migrations image). Note that the database is
shared with staging, so branch migrations do not belong here.

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
