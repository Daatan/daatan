# Build stage
FROM node:24-bookworm-slim AS builder

# Install OpenSSL for Prisma during build
RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Stable build args (rarely change — declared before npm ci to maximise layer cache)
ARG DATABASE_URL
ARG NEXTAUTH_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY

# Hardcoded fallback values for the build phase only (@t3-oss/env-nextjs validates at runtime; skip during build)
ENV SKIP_ENV_VALIDATION=1
ENV DATABASE_URL=${DATABASE_URL:-"postgresql://daatan:dummy@localhost:5432/daatan"}
ENV NEXTAUTH_SECRET="dummy-secret-for-build"
ENV NEXTAUTH_URL=${NEXTAUTH_URL:-"http://localhost:3000"}
ENV GOOGLE_CLIENT_ID=123456789-dummy.apps.googleusercontent.com
ENV GOOGLE_CLIENT_SECRET=dummysecret12
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

# Copy package files and install dependencies.
# These layers are cached by ECR BuildKit when package.json is unchanged.
# IMPORTANT: volatile per-build args (APP_VERSION, GIT_COMMIT) are declared
# AFTER this block so they don't bust the npm ci cache on every deploy.
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./prisma.config.ts

RUN --mount=type=cache,target=/root/.npm npm ci

# Per-build args — injected after npm ci so that version/commit changes
# do not invalidate the expensive dependency install layer above.
ARG NEXT_PUBLIC_APP_VERSION
ARG GIT_COMMIT="unknown"
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV GIT_COMMIT=$GIT_COMMIT

# Copy source
COPY . .

# Build Next.js
# (prisma generate already ran during `npm ci`'s postinstall hook above —
# schema/config were copied before that step for exactly this reason)
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build 2>&1 || (echo "Build failed!" && cat .next/build-error.log 2>/dev/null && exit 1)

# Compile seed.ts → seed.js so it can run in the slim production image (tsx is a devDep)
RUN npx esbuild prisma/seed.ts --bundle --platform=node --outfile=prisma/seed.js --packages=external

# Migrations stage — has the full node_modules from builder so prisma CLI
# and ALL its transitive deps (@prisma/dev, effect, pathe, etc.) are always
# available without hand-copying individual packages.
# Run as a short-lived container during deploy (docker run --rm), not as a
# long-running service. This is the Docker equivalent of a Kubernetes init container.
FROM builder AS migrations
RUN rm -rf .next public
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# Production stage
FROM node:24-bookworm-slim AS runner

# Install OpenSSL for Prisma and wget for health checks
RUN apt-get update && apt-get install -y --no-install-recommends openssl wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pass GIT_COMMIT from build stage
ARG GIT_COMMIT="unknown"
ENV GIT_COMMIT=$GIT_COMMIT

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Copy standalone build and static files
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/.next/static ./.next/static

# Copy compiled seed script (seed.ts compiled to seed.js during builder stage)
COPY --from=builder --chown=nodejs:nodejs /app/prisma/seed.js ./prisma/seed.js
# Copy generated Prisma client (needed by app + seed at runtime)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
# Note: node_modules/prisma (CLI) and migration deps are NOT copied here.
# Migrations now run in the dedicated migrations container which has full node_modules.
# Copy sharp for Next.js Image optimization (required in standalone mode)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/sharp ./node_modules/sharp
# Copy pg driver (used by @prisma/adapter-pg for database connections)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/pg ./node_modules/pg
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/pg-types ./node_modules/pg-types

# Verify @prisma/adapter-pg and its deps are present (fails build if missing)
RUN node -e "require('./node_modules/@prisma/adapter-pg')" && echo "Prisma adapter OK"

USER nodejs

EXPOSE 3000

# Start Next.js using the standalone server
CMD ["node", "server.js"]
