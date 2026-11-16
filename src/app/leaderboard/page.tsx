import { getCachedLeaderboard } from '@/lib/services/leaderboard-cached'
import { listTags } from '@/lib/services/tag'
import LeaderboardClient from './LeaderboardClient'
import { FETCH_LIMIT, INITIAL_SORT } from './sort'

// Server-rendered so crawlers see the ranked table and profile links, not a spinner (#2212).
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams
  const tags = await listTags()
  // Only known slugs reach the cached compute: each distinct ?tag= is its own cache entry,
  // and this page, unlike /api/, is open to crawlers and not rate-limited.
  const initialTag = tags.some(t => t.slug === tag) ? tag! : null
  const users = await getCachedLeaderboard(Number(FETCH_LIMIT), INITIAL_SORT, initialTag ?? undefined)
  return (
    <LeaderboardClient
      initialUsers={users ?? []}
      initialTags={tags.map(({ name, slug }) => ({ name, slug }))}
      initialTag={initialTag}
    />
  )
}
