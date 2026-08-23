import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Source Leaderboard — bloggers & outlets scored on their own calls',
  description:
    'Shadow-scoring track record for byline authors and outlets: their own directional forecasts (author_lean), resolved against outcomes.',
  alternates: { canonical: '/leaderboard/sources' },
  openGraph: { url: '/leaderboard/sources', type: 'website' },
}

export default function SourceLeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
