/**
 * One-time backfill: translate all predictions that have no cached translations yet.
 * Run with: npx tsx scripts/backfill-translations.ts
 *
 * Requires DATABASE_URL, plus credentials for the Google LLM leg the translation
 * service uses — `GOOGLE_VERTEX_*` in production, `GEMINI_API_KEY` on self-host.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const BATCH_SIZE = 10
const DELAY_MS = 1000 // stay well under Gemini quota

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter } as any)

  // Find predictions with no translation rows at all
  const untranslated = await prisma.prediction.findMany({
    where: { translations: { none: {} } },
    select: { id: true, claimText: true },
    orderBy: { createdAt: 'desc' },
  })

  console.log(`Found ${untranslated.length} predictions with no cached translations`)

  // Dynamic import so we use the app's own translation service (picks up llmService etc.)
  const { translatePredictionToAllLocales } = await import('../src/lib/services/translation')

  let done = 0
  let failed = 0

  for (let i = 0; i < untranslated.length; i += BATCH_SIZE) {
    const batch = untranslated.slice(i, i + BATCH_SIZE)

    await Promise.allSettled(
      batch.map(async ({ id, claimText }) => {
        try {
          await translatePredictionToAllLocales(id)
          done++
          console.log(`[${done}/${untranslated.length}] ✓ ${id} — ${claimText?.slice(0, 60)}`)
        } catch (err) {
          failed++
          console.error(`[fail] ${id}:`, err instanceof Error ? err.message : err)
        }
      }),
    )

    if (i + BATCH_SIZE < untranslated.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }
  }

  console.log(`\nDone. ${done} translated, ${failed} failed.`)
  await prisma.$disconnect()
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
