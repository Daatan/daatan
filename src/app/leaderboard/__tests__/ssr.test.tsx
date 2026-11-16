import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/leaderboard',
  useSearchParams: () => new URLSearchParams(),
}))

import LeaderboardClient from '../LeaderboardClient'
import SourceLeaderboardClient from '../sources/SourceLeaderboardClient'
import type { LeaderboardUser } from '../sort'

const user = (over: Partial<LeaderboardUser>): LeaderboardUser => ({
  id: 'u1', name: 'Ada', username: 'ada', image: null, eloRating: 1600, totalCorrect: 6,
  totalResolved: 8, accuracy: 75, avgBrierScore: 0.12, brierCount: 8, peerScoreSum: 1, aiScoreSum: 0.5,
  ...over,
})

// #2212: the server render must already contain the table — crawlers never run the client fetch.
describe('leaderboard server render', () => {
  it('renders ranked users with crawlable profile links, not the loading state', () => {
    const html = renderToString(
      <LeaderboardClient
        initialUsers={[user({}), user({ id: 'cuid2', name: 'Bo', username: null })]}
        initialTags={[{ name: 'Politics', slug: 'politics' }]}
        initialTag={null}
      />,
    )
    expect(html).toContain('href="/profile/ada"')
    expect(html).toContain('href="/profile/cuid2"')
    expect(html).toContain('Politics')
    expect(html).not.toContain('calculating')
  })

  it('renders source rows with links from props', () => {
    const html = renderToString(
      <SourceLeaderboardClient
        authorRows={[]}
        outletRows={[{ id: 'o1', outletName: 'Haaretz', authorCount: 3, skillConservative: 0.1, brierScore: 0.2, predictions: 9, articles: 12 }]}
        hidden={{ authors: 0, outlets: 0, min: 4 }}
        tags={[]}
      />,
    )
    expect(html).toContain('href="/sources/Haaretz"')
  })
})
