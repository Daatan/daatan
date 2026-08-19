/**
 * One-time backfill: embed all predictions that have no embedding yet.
 * Run with: npx tsx scripts/backfill-embeddings.ts
 *
 * Requires DATABASE_URL, plus whatever `embedText()` needs to reach Google —
 * `GOOGLE_VERTEX_PROJECT_ID`/`_CLIENT_EMAIL`/`_PRIVATE_KEY` in production, or
 * `GEMINI_API_KEY` on a self-host install (see docs/EMBEDDINGS.md).
 *
 * This delegates to `src/lib/services/embedding.ts` rather than calling Google
 * itself. It used to hold its own `@google/generative-ai` client keyed on
 * GEMINI_API_KEY — which by #1472 was both the last Developer-API caller outside
 * the service *and* silently wrong: it still asked for `text-embedding-004`, so
 * every row it wrote landed in the same cosine-searched `vector(768)` column as
 * the app's `gemini-embedding-2` vectors and could not be compared against them.
 *
 * `POST /api/cron/backfill-embeddings` and `/api/admin/backfill-embeddings` do the
 * same job from inside the app; prefer them unless you need to run against a
 * database the app isn't serving.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const BATCH_SIZE = 20
const DELAY_MS = 500 // stay well under quota

async function main() {
  // Imported lazily so dotenv has already populated the environment the
  // embedding service reads its credentials from at module load.
  const { embedText } = await import('../src/lib/services/embedding')

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter } as any)

  const total = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) FROM predictions WHERE embedding IS NULL
  `
  const count = Number(total[0].count)
  console.log(`Found ${count} predictions without embeddings`)

  let processed = 0
  const failedIds = new Set<string>()

  while (true) {
    // Re-query each iteration — successfully embedded rows drop out of
    // WHERE embedding IS NULL, so LIMIT alone walks through all unprocessed rows.
    const rows = await prisma.$queryRaw<{ id: string; claimText: string }[]>`
      SELECT id, "claimText" FROM predictions
      WHERE embedding IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${BATCH_SIZE}
    `

    // Only rows in failedIds remain unprocessed — stop to avoid an infinite loop
    if (rows.length === 0 || rows.every(r => failedIds.has(r.id))) break

    for (const row of rows) {
      if (failedIds.has(row.id)) continue
      try {
        // embedText() returns null on a handled failure rather than throwing, and
        // the row would stay NULL — so treat null as failed too, or the outer loop
        // re-selects it forever.
        const embedding = await embedText(row.claimText)
        if (!embedding) throw new Error('embedText returned no vector')
        const vectorStr = `[${embedding.join(',')}]`
        await prisma.$executeRaw(
          Prisma.sql`UPDATE predictions SET embedding = ${Prisma.raw(`'${vectorStr}'::vector`)} WHERE id = ${row.id}`
        )
        processed++
        if (processed % 10 === 0) console.log(`  ${processed}/${count} done`)
      } catch (err) {
        console.error(`  Failed ${row.id}: ${err}`)
        failedIds.add(row.id)
      }
    }

    if (rows.length === BATCH_SIZE) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log(`Done. Processed: ${processed}, Failed: ${failedIds.size}`)
  if (failedIds.size > 0) console.log('Failed IDs:', [...failedIds].join(', '))

  await prisma.$disconnect()
  await pool.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
