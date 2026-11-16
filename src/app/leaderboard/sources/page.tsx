import { getCachedSourceLeaderboard } from '@/lib/services/leaderboard-cached'
import { listTags } from '@/lib/services/tag'
import SourceLeaderboardClient, { parseView } from './SourceLeaderboardClient'

// Server-rendered so crawlers see the ranked outlets/authors and their links (#2212).
export default async function SourceLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; tag?: string }>
}) {
  const sp = await searchParams
  const view = parseView(sp.view)
  const tag = sp.tag?.slice(0, 80) || null
  const [board, tags] = await Promise.all([
    getCachedSourceLeaderboard(view, 'skillConservative', tag),
    listTags(),
  ])
  return (
    <SourceLeaderboardClient
      authorRows={board.authorRows ?? []}
      outletRows={board.outletRows ?? []}
      hidden={{ authors: board.hiddenAuthors ?? 0, outlets: board.hiddenOutlets ?? 0, min: board.minPredictions ?? 0 }}
      tags={tags.map(({ name, slug }) => ({ name, slug }))}
    />
  )
}
