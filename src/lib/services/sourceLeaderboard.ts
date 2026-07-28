import { getAuthorShadowLeaderboard, type OracleAuthorShadowEntry } from '@/lib/services/oracle'

export type SourceLeaderboardView = 'authors' | 'outlets'
export type SourceSortBy = 'skillConservative' | 'brierScore'

export interface AuthorLeaderboardRow {
  id: string
  author: string
  outletName: string
  skillConservative: number
  brierScore: number
  predictions: number
  articles: number
}

export interface OutletLeaderboardRow {
  id: string
  outletName: string
  skillConservative: number
  brierScore: number
  authorCount: number
  predictions: number
  articles: number
}

export interface SourceLeaderboardResult {
  view: SourceLeaderboardView
  sortBy: SourceSortBy
  authorRows: AuthorLeaderboardRow[]
  outletRows: OutletLeaderboardRow[]
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function toAuthorRow(e: OracleAuthorShadowEntry): AuthorLeaderboardRow {
  return {
    id: e.id,
    author: e.author,
    outletName: e.outlet_name,
    skillConservative: round3(e.skill_conservative),
    brierScore: round3(e.brier_score),
    predictions: e.predictions,
    articles: e.articles,
  }
}

/**
 * Roll authors up to their outlet. Retro's author-shadow board is keyed by (author,
 * outlet_name) as plain strings — no outlet_id join exists or is needed for this: every
 * author row already carries outlet_name, so grouping is all it takes.
 *
 * Both metrics are weighted by each author's `predictions` count so one prolific author
 * doesn't get diluted by several single-prediction bylines at the same outlet (and vice
 * versa) — same intent as the predictions-count gating already used elsewhere on this board.
 */
export function aggregateByOutlet(entries: OracleAuthorShadowEntry[]): OutletLeaderboardRow[] {
  const groups = new Map<string, OracleAuthorShadowEntry[]>()
  for (const e of entries) {
    const list = groups.get(e.outlet_name) ?? []
    list.push(e)
    groups.set(e.outlet_name, list)
  }

  const rows: OutletLeaderboardRow[] = []
  for (const [outletName, group] of groups) {
    const totalPredictions = group.reduce((sum, e) => sum + e.predictions, 0)
    const totalArticles = group.reduce((sum, e) => sum + e.articles, 0)
    const weighted = (pick: (e: OracleAuthorShadowEntry) => number) =>
      totalPredictions > 0
        ? group.reduce((sum, e) => sum + pick(e) * e.predictions, 0) / totalPredictions
        : group.reduce((sum, e) => sum + pick(e), 0) / group.length

    rows.push({
      id: outletName,
      outletName,
      skillConservative: round3(weighted(e => e.skill_conservative)),
      brierScore: round3(weighted(e => e.brier_score)),
      authorCount: group.length,
      predictions: totalPredictions,
      articles: totalArticles,
    })
  }
  return rows
}

/** skillConservative is higher-is-better; brierScore is lower-is-better. */
function sortRows<T extends { skillConservative: number; brierScore: number }>(
  rows: T[],
  sortBy: SourceSortBy,
): T[] {
  return [...rows].sort((a, b) =>
    sortBy === 'brierScore' ? a.brierScore - b.brierScore : b.skillConservative - a.skillConservative,
  )
}

/**
 * Source leaderboard — bloggers/outlets measured on their `author_lean` shadow-scoring
 * track record (daatan#1195), the parallel counterpart to the user leaderboard. Backed by
 * retro's `GET /leaderboard/author-shadow` (retro PR #315). Shadow scoring: informational
 * track record only, never feeds the live forecast.
 *
 * Fails open — returns empty rows (never throws) when the Oracle is unconfigured or
 * unreachable, matching every other Oracle-backed service in this file.
 */
export async function getSourceLeaderboard(
  view: SourceLeaderboardView = 'authors',
  sortBy: SourceSortBy = 'skillConservative',
): Promise<SourceLeaderboardResult> {
  const data = await getAuthorShadowLeaderboard()
  const entries = data?.authors ?? []

  return {
    view,
    sortBy,
    authorRows: sortRows(entries.map(toAuthorRow), sortBy),
    outletRows: sortRows(aggregateByOutlet(entries), sortBy),
  }
}

/**
 * Author-shadow rows for a single outlet — backs the admin outlet detail page
 * (`/admin/sources/[name]`). Reuses the full-board fetch and filters by `outlet_name`
 * in-memory; the board already carries it on every row, so no separate Oracle endpoint is
 * needed. Fails open to `[]`, same as `getSourceLeaderboard`.
 */
export async function getAuthorShadowRowsForOutlet(outletName: string): Promise<AuthorLeaderboardRow[]> {
  const data = await getAuthorShadowLeaderboard({ source: 'admin-outlet-detail' })
  const entries = (data?.authors ?? []).filter(e => e.outlet_name === outletName)
  return sortRows(entries.map(toAuthorRow), 'skillConservative')
}
