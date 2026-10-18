import { unstable_cache } from 'next/cache'
import { STANDARD_TAGS } from '@/lib/constants'
import { tagSlug } from '@/lib/utils/tag-slug'
import {
  authorKey,
  canonicalOutlet,
  getSourceLeaderboard,
  type AuthorLeaderboardRow,
  type OutletLeaderboardRow,
} from '@/lib/services/sourceLeaderboard'

export interface TopicBoard {
  slug: string
  name: string
  outletRows: OutletLeaderboardRow[]
  authorRows: AuthorLeaderboardRow[]
}

export interface TopicRecord {
  slug: string
  name: string
  skillConservative: number
  brierScore: number
  predictions: number
}

/**
 * Every standard topic's board (daatan#1917). One Oracul call per topic, so cached: the shadow
 * boards move slowly and a profile page must not fan out ~20 requests per view.
 */
export const getTopicBoards = unstable_cache(
  async (): Promise<TopicBoard[]> =>
    Promise.all(
      STANDARD_TAGS.map(async name => {
        const slug = tagSlug(name)
        const [outlets, authors] = await Promise.all([
          getSourceLeaderboard('outlets', 'skillConservative', 0, slug),
          getSourceLeaderboard('authors', 'skillConservative', 0, slug),
        ])
        return { slug, name, outletRows: outlets.outletRows, authorRows: authors.authorRows }
      }),
    ),
  ['source-topic-boards'],
  { revalidate: 300, tags: ['leaderboard-sources'] },
)

const byPredictions = (a: TopicRecord, b: TopicRecord) => b.predictions - a.predictions || a.name.localeCompare(b.name)

/** The outlet's record in each topic it has one in, biggest sample first. */
export function outletTopicRecords(boards: TopicBoard[], outletKeys: Set<string | null>): TopicRecord[] {
  return boards
    .flatMap(b => {
      const row = b.outletRows.find(r => outletKeys.has(canonicalOutlet(r.outletName)))
      return row ? [{ slug: b.slug, name: b.name, skillConservative: row.skillConservative, brierScore: row.brierScore, predictions: row.predictions }] : []
    })
    .sort(byPredictions)
}

/** The author's record (at this outlet) in each topic it has one in, biggest sample first. */
export function authorTopicRecords(boards: TopicBoard[], author: string, outlet: string): TopicRecord[] {
  return boards
    .flatMap(b => {
      const row = b.authorRows.find(
        r => authorKey(r.author) === authorKey(author) && canonicalOutlet(r.outletName) === canonicalOutlet(outlet),
      )
      return row ? [{ slug: b.slug, name: b.name, skillConservative: row.skillConservative, brierScore: row.brierScore, predictions: row.predictions }] : []
    })
    .sort(byPredictions)
}
