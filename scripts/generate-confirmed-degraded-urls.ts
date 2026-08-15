/**
 * One-shot generator for src/lib/services/confirmed-degraded-urls.ts (daatan#1446).
 *
 * Input: a plain-text file of raw confirmed-degraded URLs, one per line — the output
 * of the oracle_log.txt × evidence_pool_articles join described in the issue's
 * 2026-08-13 17:41 comment (re-run 2026-08-15). Hashes each with hashUrl() so the
 * sweep can filter on the indexed url_hash column; raw-URL matching would miss rows
 * that differ only by protocol/trailing slash.
 *
 * Usage: npx tsx scripts/generate-confirmed-degraded-urls.ts <urls.txt>
 */
import fs from 'fs'
import { hashUrl } from '../src/lib/utils/hash'

const input = process.argv[2]
if (!input) {
  console.error('usage: npx tsx scripts/generate-confirmed-degraded-urls.ts <urls.txt>')
  process.exit(1)
}

const urls = fs
  .readFileSync(input, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

const hashes = [...new Set(urls.map(hashUrl))].sort()

const header = `/**
 * daatan#1446 — url_hash allowlist of the confirmed degraded-fetch rows.
 *
 * GENERATED FILE — do not hand-edit. Regenerate with:
 *   npx tsx scripts/generate-confirmed-degraded-urls.ts <urls.txt>
 *
 * Derivation (2026-08-15, second pass — flap correction): oracle_log.txt
 * \`article_fetch\` events on the 11 DEGRADED_FETCH_DOMAINS, joined row-level
 * against evidence_pool_articles (status=COMPLETE,
 * updated_at < CONFIRMED_DEGRADED_CUTOFF). A URL is confirmed degraded iff
 * for at least one of its pool rows, the fetch event immediately preceding
 * that row's updated_at (always within ~10s) used \`using=fallback\`. This
 * per-row rule supersedes the first pass's "never fetched real text or first
 * real-text fetch postdates updated_at" — thehill.com's fetch health FLAPPED
 * (real -> fallback -> real), which that rule misread as recovered, dropping
 * 9 URLs whose rows were written inside fallback windows. ${urls.length} raw
 * URLs -> ${hashes.length} distinct hashUrl() values covering 425 pool rows.
 */
export const CONFIRMED_DEGRADED_URL_HASHES: readonly string[] = [
`

const body = hashes.map((h) => `  '${h}',`).join('\n')
fs.writeFileSync('src/lib/services/confirmed-degraded-urls.ts', header + body + '\n]\n')
console.log(`wrote ${hashes.length} hashes from ${urls.length} urls`)
