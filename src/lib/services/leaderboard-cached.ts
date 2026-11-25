import { unstable_cache } from 'next/cache'
import { getLeaderboard, type SortBy } from '@/lib/services/leaderboard'
import {
  getSourceLeaderboard,
  type SourceLeaderboardView,
  type SourceSortBy,
} from '@/lib/services/sourceLeaderboard'

// Shared by the API routes and the server-rendered /leaderboard pages (#2212), so a crawler
// render and the client's follow-up fetch hit the same cache entry.

// Rankings move slowly (only on resolution events) — 5min TTL. unstable_cache keys on the
// serialized arguments in addition to keyParts, so each (limit, sortBy, tagSlug) combination
// gets its own entry.
export const getCachedLeaderboard = unstable_cache(
  async (limit: number, sortBy: SortBy, tagSlug?: string) => getLeaderboard(limit, sortBy, tagSlug),
  ['leaderboard-api'],
  { revalidate: 300, tags: ['leaderboard'] },
)

// Rows below this sample size are too noisy to rank publicly (a single lucky/unlucky
// call shouldn't top or bottom the board) — see daatan#1587. Single-row lookups
// (/sources/[name], /authors/[author]/[outlet]) call getSourceLeaderboard directly
// with the default minPredictions=0 and are unaffected. Lowered 5 -> 4 on 2026-10-11: with
// ~10 resolutions a month, 5 left two author rows on the board.
export const SOURCE_LEADERBOARD_MIN_PREDICTIONS = 4

// The public board is the only caller that pays for the "takes a side" pool query (daatan#2231);
// the single-row lookups and per-topic boards call getSourceLeaderboard without it.
export const getCachedSourceLeaderboard = unstable_cache(
  async (view: SourceLeaderboardView, sortBy: SourceSortBy, tag: string | null) =>
    getSourceLeaderboard(view, sortBy, SOURCE_LEADERBOARD_MIN_PREDICTIONS, tag ?? undefined, { sideCounts: true }),
  ['leaderboard-sources-api'],
  { revalidate: 300, tags: ['leaderboard-sources'] },
)

/** Outlets on the public sources board. Only their /sources pages are indexed and listed in the
 *  sitemap; a source below the board's threshold is a thin page (daatan#2337). Reads the board's
 *  own default cache entry. When the Oracul is unreachable the board is empty, so this fails
 *  closed: noindex and no sitemap entries, as the pages then show no track record either. */
export async function getBoardOutletNames(): Promise<string[]> {
  const board = await getCachedSourceLeaderboard('outlets', 'skillConservative', null)
  return board.outletRows.map((r) => r.outletName)
}
