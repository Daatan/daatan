import { getCachedSourceLeaderboard } from '@/lib/services/leaderboard-cached'
import { listTags } from '@/lib/services/tag'
import SourceLeaderboardClient from './SourceLeaderboardClient'
import { parseView } from './view'

// Server-rendered so crawlers see the ranked outlets/authors and their links (#2212).
export default async function SourceLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; tag?: string }>
}) {
  const sp = await searchParams
  const view = parseView(sp.view)
  const tags = await listTags()
  // Known slugs only — see the same guard in ../page.tsx.
  const tag = tags.some(t => t.slug === sp.tag) ? sp.tag! : null
  const board = await getCachedSourceLeaderboard(view, 'skillConservative', tag)
  return (
    <SourceLeaderboardClient
      authorRows={board.authorRows ?? []}
      outletRows={board.outletRows ?? []}
      hidden={{ authors: board.hiddenAuthors ?? 0, outlets: board.hiddenOutlets ?? 0, min: board.minPredictions ?? 0 }}
      tags={tags.map(({ name, slug }) => ({ name, slug }))}
    />
  )
}
