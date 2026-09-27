# Prisma v7 — Missing Runtime Dependencies for `migrate deploy`

> **Status: RESOLVED** — Fixed in PR #620 (v1.8.32) via dedicated migrations container.
> This document is kept as a record of the root cause and decision history.
> Current state (verified 2026-09-27): Option C is what runs — the `Dockerfile`'s `FROM builder AS migrations` stage, executed with `docker run --rm` in `scripts/blue-green-deploy.sh` Phase 5; the "Self-Validation Step" and "Current Staging State" sections below describe the pre-fix state (the runner stage now only checks `@prisma/adapter-pg`).

## Summary

After upgrading to Prisma v7, `prisma migrate deploy` fails inside the Docker runner stage because the Prisma CLI loads `@prisma/dev` and `@prisma/config` at startup, and these packages have transitive dependencies that are not included in the runner image.

The runner stage only hand-copies specific `node_modules` packages. Each deploy attempt reveals one more missing package ("whack-a-mole").

---

## Root Cause

The Prisma v7 CLI (`prisma/build/index.js`) requires:
- `@prisma/config` → needs `effect`, `deepmerge-ts`, `empathic`, `fast-check`, `pure-rand`, `@standard-schema/spec`
- `@prisma/dev` → needs `pathe` and ~50 additional packages (see full list below)

These are all hoisted to `node_modules/` in the builder stage, but only a subset are copied to the runner stage.

---

## Failure History

| PR | What was fixed | What still broke at deploy |
|---|---|---|
| #618 | Prisma v7 upgrade + adapter-pg | `Cannot find module 'effect'` |
| #619 | Copied `effect`, `deepmerge-ts`, `empathic`, `fast-check`, `pure-rand`, `@standard-schema/spec` | `Cannot find module 'pathe'` (from `@prisma/dev`) |
| next fix needed | Must copy all `@prisma/dev` transitive deps | TBD |

---

## Complete List of Missing Packages

All non-`@prisma` transitive dependencies of `prisma`, `@prisma/config`, `@prisma/dev`, and `@prisma/client` that need to be in the runner stage:

```
@electric-sql/pglite
@electric-sql/pglite-socket
@electric-sql/pglite-tools
@hono/node-server
@kurkle/color
@standard-schema/spec       ← already copied in PR #619
ajv
aws-ssl-profiles
better-result
chart.js
cross-spawn
deepmerge-ts                 ← already copied in PR #619
denque
effect                       ← already copied in PR #619
empathic                     ← already copied in PR #619
env-paths
fast-check                   ← already copied in PR #619
fast-deep-equal
fast-json-stable-stringify
foreground-child
generate-function
get-port-please
graceful-fs
grammex
graphmatch
hono
http-status-codes
iconv-lite
is-property
isexe
json-schema-traverse
long
lru.min
mysql2
named-placeholders
path-key
pathe                        ← currently missing (next failure)
postgres
proper-lockfile
punycode
pure-rand                    ← already copied in PR #619
remeda
retry
safer-buffer
seq-queue
shebang-command
shebang-regex
signal-exit
sqlstring
std-env
uri-js
valibot
which
zeptomatch
```

---

## Fix Options

### Option A — Copy all missing packages (more whack-a-mole, but targeted)
Add ~45 more `COPY --from=builder` lines to the Dockerfile runner stage. Fragile — any Prisma upgrade may add new deps.

### Option B — Copy entire node_modules to runner (simplest, but large image)
```dockerfile
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
```
Image will be larger (~500MB more), but no more missing dep issues. Prisma upgrades are safe.

### Option C — Run migrations from a separate migrations container (best architecture)
Add a `migrations` stage to the Dockerfile that extends the builder stage. The blue-green deploy script runs the migrations container (which has full node_modules) instead of `docker exec` into the app container.

```dockerfile
FROM builder AS migrations
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]
```

Then in blue-green-deploy.sh Phase 5:
```bash
docker run --rm --network $NETWORK -e DATABASE_URL="$DATABASE_URL" \
  daatan-migrations:staging-latest \
  node node_modules/prisma/build/index.js migrate deploy
```

**Recommended**: Option C is the cleanest. Option B is the quickest.

---

## Self-Validation Step (added in separate commit)

A `RUN` step was added to the Dockerfile runner stage to catch missing deps at build time:

```dockerfile
RUN node -e "require('./node_modules/@prisma/config/dist/index.js')" && echo "Prisma deps OK"
```

This currently only validates `@prisma/config`. It should be extended to also validate `@prisma/dev`:

```dockerfile
RUN node -e "
  require('./node_modules/@prisma/config/dist/index.js');
  require('./node_modules/@prisma/dev/dist/state.cjs');
" && echo "Prisma CLI deps OK"
```

---

## Current Staging State

- Staging is running **v1.8.29** (rolled back by blue-green script Phase 7)
- The v1.8.31 image (`staging-latest`, id `50ce0159c6ab`) is present on the server but not running
- It can be tested: `docker run --rm --network app_default -e DATABASE_URL=... daatan-app:staging-latest node node_modules/prisma/build/index.js migrate deploy`
