import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { getLeaderboard } from '@/lib/services/leaderboard'
import { JsonLd } from '@/components/JsonLd'
import { getAppUrl } from '@/lib/branding'

// Don't prerender at build time — DATABASE_URL is a placeholder during the
// Docker image build. Route stays dynamic; the DB call below is cached.
export const dynamic = 'force-dynamic'

// Top 10 by RS moves slowly; 5min TTL is plenty fresh and avoids a DB
// hit on every leaderboard request.
const fetchTopUsersForJsonLd = unstable_cache(
  async () => (await getLeaderboard(10, 'rs')) ?? [],
  ['leaderboard-jsonld-top10-rs'],
  { revalidate: 300, tags: ['leaderboard'] },
)

export const metadata: Metadata = {
  title: 'Leaderboard — Top Forecasters by Accuracy & Reputation',
  description: 'See who leads on DAATAN. Rankings by Reputation Score, Brier calibration, ELO, peer score, and more — across all forecasts and filtered by topic.',
  alternates: { canonical: '/leaderboard' },
  openGraph: { url: '/leaderboard', type: 'website' },
}

export default async function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  let topUsers: Array<{ id: string; name: string | null; username: string | null }> = []
  try {
    topUsers = await fetchTopUsersForJsonLd()
  } catch {
    topUsers = []
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'DAATAN Leaderboard',
    description: 'Top forecasters on DAATAN ranked by reputation score.',
    numberOfItems: topUsers.length,
    itemListElement: topUsers.map((u, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${getAppUrl()}/profile/${u.username ?? u.id}`,
      name: u.name ?? u.username ?? 'Anonymous',
    })),
  }

  return (
    <>
      <JsonLd data={itemListJsonLd} />
      {children}
    </>
  )
}
