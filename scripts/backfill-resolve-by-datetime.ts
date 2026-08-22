/**
 * One-time backfill: correct the ACTIVE forecasts whose resolveByDatetime sits
 * off the UTC 23:59:59.999 convention (daatan#1367, daatan#1406).
 *
 * Run with: npx tsx scripts/backfill-resolve-by-datetime.ts [--apply]
 *
 * Reuses `updateForecast` rather than writing raw Prisma updates — this is the
 * same write path `PATCH /api/forecasts/[id]` uses, so it fires the
 * `auditResolveByDatetime` shadow-check (daatan#1536) and stays consistent with
 * every other forecast edit. Every target value below was individually
 * reviewed against its claim text (case-by-case discipline, per #1363) — this
 * script applies already-decided values, it does not compute or guess them.
 *
 * Two rows (cmqtl8kh1..., cmoinim1p...) have a corrected *day*, not just a
 * corrected time-of-day, because normalizeResolveByDatetime cannot fix a
 * wrong calendar day on its own — both were confirmed against their claim
 * text (and, for the withdrawal-deadline row, against three sibling
 * forecasts sharing the identical claim phrase) before inclusion here.
 *
 * All 22 rows already carry live commitments except two (Gantz, EU defense
 * initiative) — `lockedAt` gates the HTTP route for non-admins but does not
 * gate `updateForecast` itself, so this script can write regardless. That is
 * intentional: the whole point of this backfill is correcting forecasts that
 * already have commitments riding on the wrong deadline.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { updateForecast } from '../src/lib/services/forecast'

const CORRECTIONS: Record<string, string> = {
  cmqti86px000h01ll8m5hitv8: '2026-09-11T23:59:59.999Z',
  cmqti12av000201ll8jjrnqnd: '2026-09-11T23:59:59.999Z',
  cmraoiwcf001y01rwgcy8f4f0: '2026-09-11T23:59:59.999Z',
  cmqtiawt7001201llxm76qt8m: '2026-09-11T23:59:59.999Z',
  cmqtl8kh1002301llezx64up2: '2026-09-11T23:59:59.999Z', // day corrected: matches sibling list-submission-deadline forecasts
  cmskq8dzl00a601plb2lt21dk: '2026-11-04T23:59:59.999Z',
  cmreyz610000301oighjefvny: '2026-11-04T23:59:59.999Z',
  cmrezah9e000901nx4l1ntpvq: '2026-11-04T23:59:59.999Z',
  cmltdeo5300029pc55oitzq78: '2026-12-31T23:59:59.999Z',
  cmlnme8dc0002h2t2aue7fn7a: '2026-12-31T23:59:59.999Z',
  cmlteqiw000021228ul9za28t: '2026-12-31T23:59:59.999Z',
  cmnnny73s000z147c1dau6qtb: '2026-12-31T23:59:59.999Z',
  cmrt7f5il0om601mqel3dqoju: '2026-12-31T23:59:59.999Z',
  cmnd33a0c000714c313hm5b4o: '2027-12-31T23:59:59.999Z',
  cmoinim1p000b01nq3s0n8u75: '2027-12-31T23:59:59.999Z', // day corrected: claim text says "by December 31, 2027", stored was 2028-01-01
  cms7cxm9k00uf01qntfgt54k1: '2028-07-20T23:59:59.999Z',
  cmm0hcvzk00021353qczwehz1: '2028-12-31T23:59:59.999Z',
  cmo8kkom7001d01pgwmuta2w3: '2028-12-31T23:59:59.999Z',
  cmrma4xyi015h01s9h8941stn: '2029-12-31T23:59:59.999Z',
  cmrowky6t02eu01mq5zloer17: '2031-07-17T23:59:59.999Z',
  cmok50jcv001b01nqwj6441ie: '2032-01-01T23:59:59.999Z',
  cmnn551lg0007147cog1pk2os: '2049-12-31T23:59:59.999Z',
}

async function main() {
  const apply = process.argv.includes('--apply')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  const ids = Object.keys(CORRECTIONS)
  const rows = await prisma.prediction.findMany({
    where: { id: { in: ids } },
    select: { id: true, claimText: true, resolveByDatetime: true, lockedAt: true, status: true },
  })

  console.log(`${rows.length}/${ids.length} target rows found${apply ? '' : ' (dry run)'}`)

  let changed = 0
  for (const row of rows) {
    const target = CORRECTIONS[row.id]
    const current = row.resolveByDatetime.toISOString()
    if (current === target) {
      console.log(`  ${row.id} already correct, skipping`)
      continue
    }
    changed++
    console.log(
      `  ${row.id} [${row.status}]${row.lockedAt ? ' (has commitments)' : ''}\n` +
        `    ${row.claimText.slice(0, 90)}\n` +
        `    ${current} -> ${target}`,
    )
    if (apply) {
      await updateForecast(row.id, { resolveByDatetime: target })
    }
  }

  console.log(`\n${changed}/${rows.length} rows ${apply ? 'updated' : 'would be updated'}`)
  const missing = ids.filter((id) => !rows.some((r) => r.id === id))
  if (missing.length) console.log(`WARNING: not found in DB: ${missing.join(', ')}`)

  await prisma.$disconnect()
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
