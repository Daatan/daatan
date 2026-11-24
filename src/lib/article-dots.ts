import { canonicalKey } from '@/lib/utils/canonical-url'
import { sourcePagePath } from '@/lib/utils/source-page'
import { getSide, stanceProbYes, type Side } from '@/lib/source-vote'

/**
 * The expanded "Probability over time" chart's article dots (daatan#2300): every article in the
 * Oracul's current pool for a forecast, one dot each, over the Oracul's own line.
 *
 * There is no table for this. Each evidence snapshot re-lists the whole pool in
 * `ContextSnapshot.oracleSnapshot.sources`, at ~1 KB per article — re-reading every snapshot's
 * pool costs ~50 s and 1.2M rows on the biggest prod forecast. So the DB query reads two cheap
 * things instead (`getArticleDotRows` in `src/lib/services/context.ts`): the latest snapshot's
 * pool for the readings, and the trigger-maintained `sources_delta` chain for when each URL first
 * appeared. The page payload strips `sources[]` from every snapshot but the latest
 * (`slim-context-snapshots.ts`), so the expanded view asks for this compact series on open.
 */

/**
 * Most dots one response carries. The biggest prod pool held 1,646 articles (2026-11-24); past
 * this the query keeps the most certain ones — the biggest dots — and the view says so.
 */
export const MAX_ARTICLE_DOTS = 2000

/** One `sources[]` entry of the latest snapshot's pool, with its first-seen time. */
export type ArticleDotRow = {
  /** The latest non-clock snapshot's `createdAt` — the reading y, size and side come from. */
  readAt: Date | string
  /**
   * The first evidence snapshot whose pool lists this exact URL (the `sources_delta` chain);
   * null when the chain can't place it, and the row then counts as first seen at `readAt`.
   */
  firstSeenAt: Date | string | null
  url: string | null
  /** [-1, 1]; null when the gatekeeper rejected the article (it casts no vote). */
  stance: number | null
  /** [0, 1] — the vote's weight in the pool. */
  certainty: number | null
  title: string | null
  /** The Oracul's display name for the outlet (a raw string, not an identity). */
  sourceName: string | null
  /** Resolved news-indexer outlet identity, when the capture-time lookup found one. */
  outletName: string | null
  /**
   * How many voting articles the pool holds before the `MAX_ARTICLE_DOTS` cap — the same on
   * every row.
   */
  poolSize: number
}

/** One dot: one canonical article. */
export type ArticleDot = {
  url: string
  title: string | null
  /** Display label for the outlet (`sourceName`), else null — the client falls back to the host. */
  outlet: string | null
  /** `/sources/[name]` for the outlet (#2298); null when there is neither a name nor a host. */
  outletPath: string | null
  /** ISO time of the first snapshot whose pool lists the article — the dot's x. */
  firstSeenAt: string
  /** (1 + stance) / 2 of the current reading, 0–1 — the dot's y, the same number as its badge. */
  probYes: number
  /** Certainty of the current reading, 0–1 — the dot's size; null when the Oracul gave none. */
  certainty: number | null
  side: Side
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * One dot per canonical article (`canonicalKey`, so a `www.`/tracking-param variant of a URL in
 * the same pool is the same article).
 *
 * - x is when the Oracul first read the article: the earliest `firstSeenAt` of the group
 *   (`readAt` for a row the delta chain couldn't place).
 * - y and size are the current reading. The Oracul re-reads the pool on every push and a stance
 *   can move between readings; the dot shows where the article stands now, at the time it
 *   arrived (the issue's call — a dot per reading would draw the same article several times).
 * - An article with no stance is skipped: the gatekeeper rejected it, so it casts no vote — the
 *   sources panel hides the same rows.
 *
 * Rows come in pool order; a later entry of the same article wins, display fields take the last
 * non-null value. Output is oldest first.
 */
export function buildArticleDots(rows: ArticleDotRow[]): ArticleDot[] {
  type Acc = {
    firstSeen: number
    latest: ArticleDotRow
    url: string
    title: string | null
    sourceName: string | null
    outletName: string | null
  }

  const byKey = new Map<string, Acc>()
  for (const row of rows) {
    if (typeof row.url !== 'string' || row.url.trim() === '') continue
    const readAt = new Date(row.readAt).getTime()
    if (!Number.isFinite(readAt)) continue
    const seen = row.firstSeenAt == null ? NaN : new Date(row.firstSeenAt).getTime()
    const t = Number.isFinite(seen) ? seen : readAt
    const url = row.url
    const key = canonicalKey(url)
    const acc = byKey.get(key)
    if (!acc) {
      byKey.set(key, {
        firstSeen: t,
        latest: row,
        url,
        title: row.title,
        sourceName: row.sourceName,
        outletName: row.outletName,
      })
      continue
    }
    acc.firstSeen = Math.min(acc.firstSeen, t)
    acc.latest = row
    acc.url = url
    acc.title = row.title ?? acc.title
    acc.sourceName = row.sourceName ?? acc.sourceName
    acc.outletName = row.outletName ?? acc.outletName
  }

  const dots: ArticleDot[] = []
  for (const acc of byKey.values()) {
    const stance = acc.latest.stance
    if (!finite(stance)) continue
    const certainty = finite(acc.latest.certainty) ? Math.min(1, Math.max(0, acc.latest.certainty)) : null
    dots.push({
      url: acc.url,
      title: acc.title,
      outlet: acc.sourceName,
      outletPath: sourcePagePath(acc.outletName, acc.url),
      firstSeenAt: new Date(acc.firstSeen).toISOString(),
      probYes: stanceProbYes(stance),
      certainty,
      side: getSide(stance),
    })
  }
  return dots.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt))
}
