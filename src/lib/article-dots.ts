import { canonicalKey } from '@/lib/utils/canonical-url'
import { sourcePagePath } from '@/lib/utils/source-page'
import { getSide, stanceProbYes, type Side } from '@/lib/source-vote'

/**
 * The expanded "Probability over time" chart's article dots (daatan#2300): every article the
 * Oracul read for a forecast, one dot each, over the Oracul's own line.
 *
 * There is no table for this. The history lives in `ContextSnapshot.oracleSnapshot.sources`
 * — each evidence snapshot re-lists the pool it pooled — and the page payload strips
 * `sources[]` from every snapshot but the latest (`slim-context-snapshots.ts`), so the
 * expanded view asks for this compact series on open instead.
 */

/** One `sources[]` entry of one evidence snapshot, flattened — what the DB projection returns. */
export type ArticleDotRow = {
  /** The snapshot's `createdAt` — when the Oracul read this pool. */
  snapshotAt: Date | string
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
  /** (1 + stance) / 2 of the LATEST reading, 0–1 — the dot's y, the same number as its badge. */
  probYes: number
  /** Certainty of the latest reading, 0–1 — the dot's size; null when the Oracul gave none. */
  certainty: number | null
  side: Side
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Collapse every snapshot's pool into one dot per canonical article (`canonicalKey`, so a
 * `www.`/tracking-param variant of a URL is the same article).
 *
 * - x is the FIRST snapshot that lists the article: when the Oracul first read it.
 * - y and size come from the LATEST snapshot that lists it. The Oracul re-reads a pool on
 *   every push and a stance can move between readings; the dot shows where the article
 *   stands now, at the time it arrived (the issue's call — a dot per reading would draw the
 *   same article several times).
 * - An article whose latest reading has no stance is skipped: the gatekeeper rejected it,
 *   so it casts no vote — the sources panel hides the same rows.
 *
 * Rows may come in any order; ties on time keep their input order (a later entry in the
 * same snapshot wins). Display fields take the newest non-null value. Output is oldest first.
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

  const ordered = rows
    .map((row, i) => ({ row, i, t: new Date(row.snapshotAt).getTime() }))
    .filter((e) => typeof e.row.url === 'string' && e.row.url.trim() !== '' && Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t || a.i - b.i)

  const byKey = new Map<string, Acc>()
  for (const { row, t } of ordered) {
    const url = row.url as string
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
