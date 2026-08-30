import { withAuth } from '@/lib/api-middleware'
import { embedAndStoreExternalMarket } from '@/lib/services/embedding'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-backfill-market-embeddings')

const BATCH_SIZE = 10

/**
 * POST /api/admin/backfill-market-embeddings
 * Generates and stores embeddings for all external_markets rows that lack one —
 * chiefly the rows written before daatan#1640 fixed the write path, which have
 * been sitting NULL since the column was added. Mirrors
 * /api/admin/backfill-embeddings. Idempotent — safe to run multiple times.
 */
export const POST = withAuth(async () => {
  const started = Date.now()

  const missing = await prisma.$queryRaw<{ id: string; question: string }[]>`
    SELECT id, question FROM external_markets WHERE embedding IS NULL
  `

  log.info({ total: missing.length }, 'Backfill market embeddings started')

  let done = 0
  let failed = 0

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async ({ id, question }) => {
        try {
          await embedAndStoreExternalMarket(id, question)
          done++
        } catch (err) {
          log.error({ err, id }, 'Backfill embed failed for external market')
          failed++
        }
      })
    )
  }

  const elapsedMs = Date.now() - started
  log.info({ done, failed, elapsedMs }, 'Backfill market embeddings complete')

  return Response.json({ done, failed, total: missing.length, elapsedMs })
}, { roles: ['ADMIN'] })
