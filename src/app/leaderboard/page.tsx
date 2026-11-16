import { getCachedLeaderboard } from '@/lib/services/leaderboard-cached'
import { listTags } from '@/lib/services/tag'
import LeaderboardClient, { INITIAL_SORT } from './LeaderboardClient'
import { FETCH_LIMIT } from './sort'

// Server-rendered so crawlers see the ranked table and profile links, not a spinner (#2212).
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams
  const initialTag = tag?.slice(0, 80) || null
  const [users, tags] = await Promise.all([
    getCachedLeaderboard(Number(FETCH_LIMIT), INITIAL_SORT, initialTag ?? undefined),
    listTags(),
  ])
  return (
    <LeaderboardClient
      initialUsers={users ?? []}
      initialTags={tags.map(({ name, slug }) => ({ name, slug }))}
      initialTag={initialTag}
    />
  )
}
