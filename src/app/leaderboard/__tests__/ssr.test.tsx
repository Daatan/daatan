import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/leaderboard',
  useSearchParams: () => nav.params,
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
    expect(html).not.toContain('sideRate')
  })

  // #2231: the server render sorts by the URL's `sort`, so `sort=side` needs no server sortBy.
  it('renders the authors "takes a side" column and sorts by it from the URL', () => {
    const author = (author: string, sideTaken: number | null, sideTotal: number | null, skillConservative = 0) => ({
      id: author, author, outletName: 'x.com', skillConservative, brierScore: 0.2, predictions: 9, articles: 9, sideTaken, sideTotal,
    })
    const rows = [author('Hedger', 1, 10, 0.9), author('Unknown', null, null, 0.8), author('Sider', 3, 4), author('Sider Big', 6, 8)]
    const render = (query: string) => {
      nav.params = new URLSearchParams(query)
      return renderToString(
        <SourceLeaderboardClient authorRows={rows} outletRows={[]} hidden={{ authors: 0, outlets: 0, min: 4 }} tags={[]} />,
      )
    }
    const order = (html: string) => ['Sider Big', 'Sider', 'Hedger', 'Unknown'].sort((a, b) => html.indexOf(`>${a}<`) - html.indexOf(`>${b}<`))
    try {
      const bySide = render('view=authors&sort=side')
      expect(bySide).toContain('sideRate')
      expect(bySide).toContain('6/8')
      expect(bySide).toContain('—')
      expect(order(bySide)).toEqual(['Sider Big', 'Sider', 'Hedger', 'Unknown'])
      expect(order(render('view=authors&sort=side&dir=asc'))).toEqual(['Hedger', 'Sider', 'Sider Big', 'Unknown'])
      expect(order(render('view=authors'))).toEqual(['Hedger', 'Unknown', 'Sider', 'Sider Big'])
    } finally {
      nav.params = new URLSearchParams()
    }
  })
})

// A server page that imports a named export from a 'use client' module gets a client reference,
// not the value: calling it throws at render, which no unit test or build catches (#2212).
describe('server/client boundary', () => {
  it('server pages take only the default export from client modules', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const page of ['page.tsx', 'sources/page.tsx']) {
      const src = readFileSync(join(__dirname, '..', page), 'utf-8')
      expect(src).not.toMatch(/import\s+\w*\s*,?\s*\{[^}]*\}\s+from\s+'\.\/\w*Client'/)
    }
  })
})
