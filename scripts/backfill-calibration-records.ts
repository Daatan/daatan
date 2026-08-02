/**
 * One-time backfill: build a calibration record for every already-resolved
 * binary (daatan#1233).
 *
 * Run with: npx tsx scripts/backfill-calibration-records.ts [--dry-run]
 *
 * Reuses `buildCalibrationRecord` rather than reimplementing the selection
 * rules — a backfill that picks "the final probability" by its own logic would
 * produce a history the live writer can never reproduce, which is the whole
 * failure mode this table exists to avoid.
 *
 * Idempotent (upsert on predictionId), so it is safe to re-run. Expect a large
 * share of records with `pFinal = null`: most resolutions predate Oracle
 * snapshot coverage, and only ~17 of the first 45 had a usable published
 * probability at all. A null record is the honest answer — it says "this
 * resolution is not scorable" instead of inventing a number for it.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { buildCalibrationRecord } from '../src/lib/services/calibration'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const resolved = await prisma.prediction.findMany({
    where: {
      status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
      outcomeType: 'BINARY',
      resolvedAt: { not: null },
    },
    select: { id: true, status: true, resolvedAt: true },
    orderBy: { resolvedAt: 'asc' },
  })

  console.log(`${resolved.length} resolved binaries${dryRun ? ' (dry run)' : ''}`)
  let scorable = 0

  for (const p of resolved) {
    const snapshots = await prisma.contextSnapshot.findMany({
      where: { predictionId: p.id, insufficientData: false },
      orderBy: { createdAt: 'asc' },
      select: {
        externalProbability: true, createdAt: true, kind: true, origin: true, oracleSnapshot: true,
      },
    })
    const data = buildCalibrationRecord({
      predictionId: p.id,
      outcome: p.status === 'RESOLVED_CORRECT' ? 'correct' : 'wrong',
      resolvedAt: p.resolvedAt!,
      snapshots,
    })
    if (data.pFinal !== null) scorable++
    console.log(
      `  ${p.id} ${data.outcome.padEnd(7)} p_final=${String(data.pFinal ?? '—').padStart(4)}` +
      ` (${data.pFinalKind ?? 'none'}/${data.pFinalOrigin ?? 'none'})` +
      ` p7d=${String(data.p7d ?? '—').padStart(4)} p30d=${String(data.p30d ?? '—').padStart(4)}` +
      ` clock=${data.clockSnapshots} evidence=${data.evidenceSnapshots}`,
    )
    if (!dryRun) {
      await prisma.calibrationRecord.upsert({
        where: { predictionId: p.id },
        create: data,
        update: data,
      })
    }
  }

  console.log(`\n${scorable}/${resolved.length} carry a published probability (scorable)`)
  await prisma.$disconnect()
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
