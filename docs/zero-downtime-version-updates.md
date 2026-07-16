# Zero-Downtime Version Updates — RETIRED

> **This mechanism no longer exists.** It was removed (along with
> `scripts/update-version.sh`) because it had been broken twice over and could
> only ever mislead:
>
> 1. The script wrote `APP_VERSION` into `.env`, but nothing reads `APP_VERSION`
>    — `src/lib/version.ts` reads only `NEXT_PUBLIC_APP_VERSION`, which is baked
>    into the Docker image at build time (`Dockerfile` `ARG`/`ENV`, set by CI
>    from `package.json`).
> 2. Even if the variable name had matched, `docker compose restart` does not
>    re-read environment changes — only a container *recreate* does.
> 3. A runtime override could only ever change the *server-reported* version
>    (`/api/health`): the client bundle's version is inlined at build, so the
>    override guaranteed a client/server mismatch.
>
> **The only supported way to change the displayed version is the standard
> CI/CD pipeline** (`deploy.yml`): bump `package.json` + `src/lib/version.ts`,
> merge, and (for production) push a `v*` tag. See
> [DEPLOYMENT.md](./DEPLOYMENT.md).

The version now has exactly one source of truth per image: the
`NEXT_PUBLIC_APP_VERSION` build arg, baked at build time and carried in the
image's own environment. The runtime copies that used to exist in
`docker-compose.*.yml` and `blue-green-deploy.sh` were removed in the same
change as this notice — they were redundant when correct and actively harmful
when stale (an unset host variable interpolated to an empty string and
shadowed the correct baked value — the same failure shape as the 2026 VAPID
key outage).
