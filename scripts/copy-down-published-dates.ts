/**
 * daatan#1679 item 5 — copy repaired publish dates down from news-indexer.
 *
 * 4,215 `evidence_pool_articles` rows carry a fabricated `published_date`: an ingest timestamp
 * written into the field, not a date from the source. The signature is exact and was verified in
 * news-indexer#166 — sub-second precision, seconds away from `added_at`. news-indexer stopped
 * producing them (ni#122/#165) and repairs its own copies in ni#166 tiers 2–3, but the pool is a
 * cache: it never re-reads. These rows keep the lie until something copies the truth down.
 *
 * ## Order matters
 *
 * This must run AFTER news-indexer#166 tier 2, not before. Running first copies down the same
 * fabricated dates it is trying to remove, and then reports success.
 *
 * ## What it does per row
 *
 * Asks news-indexer for the article by URL and acts on the PROVENANCE it reports, not just the
 * date (`publishedAtSource`, news-indexer#426):
 *
 *   pushed          Leave the date alone. Telegram and X posts have no page — post time IS
 *                   crawl time, so the sub-second signature is a false positive on ~431 rows.
 *                   Repairing them would move a correct date. Record the provenance and stop.
 *   page/feed/      Copy the date down with its provenance. This is a repaired row.
 *   archive
 *   null date       news-indexer could not date it either (ni#166 tier 3). NULL the pool row and
 *                   exclude it terminally as `undated_published` — the same treatment #1682
 *                   gives an undated article at claim time. An article we cannot date must never
 *                   be able to settle anything.
 *   not found       news-indexer has evicted it. Leave it: we have no better answer, and
 *                   inventing one is the bug.
 *
 * The `pushed` branch is the reason item 2 had to land first. Without provenance this pass
 * cannot tell a fabricated web date from a genuine Telegram post time, and the only options
 * were to corrupt 431 correct rows or to skip the whole Telegram cohort blind.
 *
 * ## What it does NOT do
 *
 * Recompute forecasts. Re-resolution does not propagate on its own (see the misresolution
 * runbook), and the 100 ACTIVE forecasts involved are handled deliberately afterwards, not as a
 * side effect of a data repair. Rows this pass excludes are reversible with one un-exclude.
 *
 * ## Expected yield — read before running
 *
 * Measured on the highest-risk 99-row slice (daatan#1679, 2026-08-30): one row was materially
 * wrong, it was repaired, and republishing its forecast returned `unchanged`, 46 → 46. Argue for
 * this on evidence-panel credibility and audit cost, NOT on forecast accuracy. The visible damage
 * was a per-article stance of 1.00 on a 2022 op-ed in the evidence panel; the headline number
 * barely moved, because a forecast has to be starved of usable rows before one bad row shows.
 *
 * ## Running
 *
 * Dry-run by default; prints the action split and writes nothing. Take a backup before --apply.
 *
 *   npx tsx scripts/copy-down-published-dates.ts
 *   npx tsx scripts/copy-down-published-dates.ts --limit 200
 *   npx tsx scripts/copy-down-published-dates.ts --apply
 *
 * Idempotent and resumable: a repaired row gets `published_date_source` set and no longer
 * matches the selection predicate.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const APPLY = process.argv.includes('--apply')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i === -1 ? null : Number(process.argv[i + 1])
})()

// news-indexer's /articles/by-url caps the batch at 50.
const BATCH = 50

/** Provenance values that mean "this date was never fabricated" — see the `pushed` note above. */
const TRUSTWORTHY_AS_IS = new Set(['pushed'])

/**
 * The fabrication signature: sub-second precision on `published_date`. Exact, per ni#166 — a
 * date reported by a source is never microsecond-precise; an ingest timestamp always is.
 *
 * `published_date_source IS NULL` is a guard: a row that already carries provenance has been
 * through this pass (or arrived with it), and must not be re-read.
 */
const FABRICATED_SIGNATURE = `
  published_date IS NOT NULL
  AND published_date_source IS NULL
  AND published_date ~ '\\.\\d+'
`

export type CopyDownAction = 'copied' | 'nulled' | 'kept_pushed' | 'not_found' | 'unchanged'

export interface CopyDownDecision {
  action: CopyDownAction
  /** Prisma `data` for the row update, or null when the row must be left untouched. */
  data: Record<string, unknown> | null
}

/**
 * What to do with one fabricated-date pool row, given what news-indexer now reports for its URL.
 * Pure, and the part worth testing: every branch here is a way to make the corpus worse if it
 * fires on the wrong row.
 */
export function decideCopyDown(
  currentDate: string,
  meta: { publishedAt: string | null; publishedAtSource?: string | null } | undefined,
): CopyDownDecision {
  // news-indexer has evicted the article. We have no better answer, and inventing one is the bug.
  if (!meta) return { action: 'not_found', data: null }

  const source = meta.publishedAtSource ?? null

  // A pushed article's crawl-time-looking date IS its publication time — Telegram and X posts
  // have no page to read a date off. ~431 rows match the sub-second signature for this reason
  // alone, and repairing them would replace a correct date with an older one. Record the
  // provenance so the row stops matching; keep the value.
  if (source && TRUSTWORTHY_AS_IS.has(source)) {
    return { action: 'kept_pushed', data: { publishedDateSource: source } }
  }

  // news-indexer could not date it either (ni#166 tier 3). Same terminal treatment
  // claimArticleForExtraction gives an undated article today (#1682): an article we cannot
  // date must never be able to settle anything.
  if (!meta.publishedAt) {
    return {
      action: 'nulled',
      data: {
        publishedDate: null,
        publishedDateSource: null,
        status: 'FAILED',
        statusReason: 'undated_published',
        excluded: true,
      },
    }
  }

  // Approximate on purpose — the two sides may format the same instant differently. Getting it
  // wrong only moves a row between `copied` and `unchanged` in the dry-run report; both write
  // the same provenance, and `copied` additionally normalises the date to news-indexer's form.
  if (meta.publishedAt === currentDate) {
    return { action: 'unchanged', data: { publishedDateSource: source } }
  }

  return {
    action: 'copied',
    data: { publishedDate: meta.publishedAt, publishedDateSource: source },
  }
}


async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter } as any)

  const { getArticleMetaByUrl } = await import('../src/lib/services/forecast-sources')

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT id, url, published_date
    FROM evidence_pool_articles
    WHERE ${FABRICATED_SIGNATURE}
    ORDER BY id
    ${LIMIT ? `LIMIT ${Number(LIMIT)}` : ''}
  `)) as { id: string; url: string; published_date: string }[]

  console.log(`${rows.length} pool rows carry the fabricated-date signature`)

  const counts: Record<CopyDownAction, number> = {
    copied: 0, nulled: 0, kept_pushed: 0, not_found: 0, unchanged: 0,
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const meta = await getArticleMetaByUrl(chunk.map((r) => r.url))

    for (const row of chunk) {
      const { action, data } = decideCopyDown(row.published_date, meta.get(row.url))
      counts[action]++
      if (APPLY && data) {
        await prisma.evidencePoolArticle.update({ where: { id: row.id }, data: data as never })
      }
    }

    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`, counts)
  }

  console.log('\nDone.', counts)
  if (!APPLY) console.log('No changes written. Re-run with --apply to execute.')
  console.log(
    'Forecasts are NOT recomputed by this script — re-resolution does not propagate on its own. ' +
    'Handle the affected ACTIVE forecasts deliberately (daatan#1679).',
  )

  await prisma.$disconnect()
  await pool.end()
}

// Only when invoked as a script. `decideCopyDown` is imported by its tests, and without this
// guard that import opens a database connection and runs the whole pass.
if (process.argv[1]?.endsWith('copy-down-published-dates.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
