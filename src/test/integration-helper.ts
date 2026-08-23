import { execSync } from 'child_process'
import { prisma } from '@/lib/prisma'

/**
 * Ensures the test database is running and has the latest schema.
 * This should be called once before running integration tests.
 */
export async function setupTestDatabase() {
  console.log('🏗️ Setting up test database...')
  
  // 1. Start the container
  execSync('docker compose -f docker-compose.test.yml up -d postgres-test', { stdio: 'inherit' })
  
  // 2. Wait for postgres to be ready
  console.log('⏳ Waiting for postgres to be ready...')
  let ready = false
  for (let i = 0; i < 30; i++) {
    try {
      execSync('docker exec daatan-postgres-test pg_isready -U daatan_test', { stdio: 'pipe' })
      ready = true
      break
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  if (!ready) {
    throw new Error('Test database failed to start')
  }

  // 3. Apply migrations
  console.log('🗄️ Applying migrations to test database...')
  // We use a different DB URL for migration
  const testDbUrl = 'postgresql://daatan_test:daatan_test@localhost:5433/daatan_test'
  // No --skip-seed: Prisma v7 removed the flag (seeding moved to prisma.config.ts,
  // which declares no seed here). Passing it makes `migrate reset` print usage and
  // exit non-zero, which took the whole integration suite down with it.
  execSync(`DATABASE_URL="${testDbUrl}" npx prisma migrate reset --force`, { stdio: 'inherit' })
  
  console.log('✅ Test database ready')
}

// Static allow-list of tables that may be truncated in tests.
// Adding tables here is intentional — prevents accidental use of $executeRawUnsafe
// with dynamic/interpolated names that could be copy-pasted into production code.
const TRUNCATABLE_TABLES = [
  'users', 'predictions', 'prediction_options', 'prediction_translations',
  'commitments', 'cu_transactions', 'comments', 'comment_reactions', 'comment_translations',
  'notifications', 'notification_preferences', 'push_subscriptions',
  'tags', 'bot_config', 'bot_run_logs', 'bot_rejected_topics',
  'news_anchors', 'leaderboard_cache', 'resolution_contexts',
  // AI panel (docs/LASSO.md). ai_estimates cascades from ai_estimate_runs, but
  // list both: TRUNCATE is explicit here, not inferred from FKs.
  'ai_estimate_runs', 'ai_estimates',
  // Oracle 2.0 storage (daatan#1555/#1556). latent_nodes cascades from
  // question_relations FKs, but list both: TRUNCATE is explicit here.
  'question_relations', 'latent_nodes',
] as const

/**
 * Cleans up all known tables in the test database.
 * Uses a static allow-list to prevent $executeRawUnsafe with interpolated names.
 * Use this between test cases to ensure isolation.
 */
export async function truncateDatabase() {
  for (const table of TRUNCATABLE_TABLES) {
    try {
      // Table names come from the static allow-list above, not from user input.
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`)
    } catch {
      // Table may not exist yet (e.g. new migration not applied) — ignore
    }
  }
}

/**
 * Stops and removes the test database container.
 */
export async function teardownTestDatabase() {
  console.log('🛑 Tearing down test database...')
  execSync('docker compose -f docker-compose.test.yml down', { stdio: 'inherit' })
}
