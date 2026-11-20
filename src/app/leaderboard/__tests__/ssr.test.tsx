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
      // The rate it sorts by, with the sample size underneath (#2259 follow-up).
      expect(bySide).toContain('<span dir="ltr">75%</span>')
      expect(bySide).toContain('<span dir="ltr">10%</span>')
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

// #2259: bits vs a coin flip — signed, isolated LTR, highest first, rows without a value last.
describe('source leaderboard bits column', () => {
  const author = (author: string, bits: number | null, skillConservative = 0) => ({
    id: author, author, outletName: 'x.com', skillConservative, brierScore: 0.2, predictions: 9, articles: 9, bits,
  })
  const rows = [author('Cautious', 0.546, 0.9), author('Unscored', null, 0.8), author('Bold', 0.848), author('Wrong', -2.32)]
  const render = (query: string) => {
    nav.params = new URLSearchParams(query)
    try {
      return renderToString(
        <SourceLeaderboardClient authorRows={rows} outletRows={[]} hidden={{ authors: 0, outlets: 0, min: 4 }} tags={[]} />,
      )
    } finally {
      nav.params = new URLSearchParams()
    }
  }
  const order = (html: string) =>
    ['Bold', 'Cautious', 'Wrong', 'Unscored'].sort((a, b) => html.indexOf(`>${a}<`) - html.indexOf(`>${b}<`))

  it('renders signed values with a hint and a legend card', () => {
    const html = render('view=authors')
    expect(html).toContain('<span dir="ltr">+0.85</span>')
    expect(html).toContain('<span dir="ltr">-2.32</span>')
    expect(html).toContain('<span dir="ltr">—</span>')
    expect(html).toMatch(/role="tooltip"[^>]*>legend\.bitsDesc</)
    expect(html.split('legend.bitsDesc').length - 1).toBe(2)
  })

  it('hides "takes a side" on phones unless the board is sorted by it', () => {
    const hiddenOnPhones = (html: string) => (html.match(/hidden sm:table-cell/g) ?? []).length
    // Default view: the outlet column and "takes a side" both drop below sm, in the head and every row.
    expect(hiddenOnPhones(render('view=authors'))).toBe(2 * (rows.length + 1))
    expect(hiddenOnPhones(render('view=authors&sort=side'))).toBe(rows.length + 1)
  })

  it('sorts by bits from the URL, rows without a value last either way', () => {
    expect(order(render('view=authors&sort=bits'))).toEqual(['Bold', 'Cautious', 'Wrong', 'Unscored'])
    expect(order(render('view=authors&sort=bits&dir=asc'))).toEqual(['Wrong', 'Cautious', 'Bold', 'Unscored'])
  })

  it('stays off the board, legend and footnote until a row has a value', () => {
    nav.params = new URLSearchParams('view=authors&sort=bits')
    try {
      const unscored = rows.map(r => ({ ...r, bits: null }))
      const html = renderToString(
        <SourceLeaderboardClient authorRows={unscored} outletRows={[]} hidden={{ authors: 0, outlets: 0, min: 4 }} tags={[]} />,
      )
      expect(html).not.toContain('legend.bitsDesc')
      expect(html).not.toContain('footnoteBits')
      expect(html).not.toContain('>bits<')
      // sort=bits falls back to the default Skill order rather than sorting by an invisible column.
      expect(order(html)).toEqual(['Cautious', 'Unscored', 'Bold', 'Wrong'])
    } finally {
      nav.params = new URLSearchParams()
    }
    expect(render('view=authors')).toContain('footnoteBits')
  })

  it('shows bits on the outlets view too', () => {
    nav.params = new URLSearchParams('view=outlets')
    try {
      const html = renderToString(
        <SourceLeaderboardClient
          authorRows={[]}
          outletRows={[{ id: 'o1', outletName: 'Haaretz', authorCount: 3, skillConservative: 0.1, brierScore: 0.2, bits: 1.4, predictions: 9, articles: 12 }]}
          hidden={{ authors: 0, outlets: 0, min: 4 }}
          tags={[]}
        />,
      )
      expect(html).toContain('<span dir="ltr">+1.40</span>')
    } finally {
      nav.params = new URLSearchParams()
    }
  })
})

describe('source leaderboard rank and hints', () => {
  const outlet = (outletName: string, skillConservative: number, brierScore: number) => ({
    id: outletName, outletName, authorCount: 2, skillConservative, brierScore, predictions: 9, articles: 9,
  })
  // Skill order: A > B > C. Brier order (lower first): C < B < A.
  const rows = [outlet('A.com', 0.9, 0.4), outlet('B.com', 0.5, 0.3), outlet('C.com', 0.1, 0.1)]
  const render = (query: string) => {
    nav.params = new URLSearchParams(query)
    try {
      return renderToString(
        <SourceLeaderboardClient authorRows={[]} outletRows={rows} hidden={{ authors: 0, outlets: 0, min: 4 }} tags={[]} />,
      )
    } finally {
      nav.params = new URLSearchParams()
    }
  }
  // The 4th-ranked row would print its number; with three rows only medals show, so read the
  // rank from the row order of the medal colours instead.
  const medalOrder = (html: string) =>
    [...html.matchAll(/lucide-medal[^"]*text-(yellow-500|gray-400|amber-600)"/g)].map(m => m[1])
  // Domains render with a <wbr> after each dot (#2259).
  const rowOrder = (html: string) =>
    ['A.<wbr/>com', 'B.<wbr/>com', 'C.<wbr/>com']
      .sort((a, b) => html.indexOf(`>${a}<`) - html.indexOf(`>${b}<`))
      .map(n => n.replace('<wbr/>', ''))

  it('ranks by Brier from the lowest even when the URL lists the worst first', () => {
    const html = render('view=outlets&sort=brier&dir=desc')
    expect(rowOrder(html)).toEqual(['A.com', 'B.com', 'C.com'])
    // A is the worst Brier → bronze; C is the best → gold, at the bottom.
    expect(medalOrder(html)).toEqual(['amber-600', 'gray-400', 'yellow-500'])
  })

  it('keeps tied scores numbered in order when the list is reversed', () => {
    const tied = [...rows, outlet('D.com', 0.3, 0.2), outlet('E.com', 0.2, 0.2)]
    nav.params = new URLSearchParams('view=outlets&sort=brier&dir=desc')
    try {
      const html = renderToString(
        <SourceLeaderboardClient authorRows={[]} outletRows={tied} hidden={{ authors: 0, outlets: 0, min: 4 }} tags={[]} />,
      )
      // Ranks 4 and 5 are the tied D/E pair; worst-first prints 5 before 4.
      const numbers = [...html.matchAll(/w-6 text-center">(\d+)</g)].map(m => Number(m[1]))
      expect(numbers).toEqual([5, 4])
    } finally {
      nav.params = new URLSearchParams()
    }
  })

  it('ranks by Skill when sorted by a column that is not a quality metric', () => {
    const html = render('view=outlets&sort=name&dir=desc')
    expect(rowOrder(html)).toEqual(['C.com', 'B.com', 'A.com'])
    expect(medalOrder(html)).toEqual(['amber-600', 'gray-400', 'yellow-500'])
  })

  it('explains Skill, Brier and Predictions in column hints and the legend', () => {
    const html = render('view=outlets')
    for (const key of ['legend.skillDesc', 'legend.brierDesc', 'legend.predictionsDesc']) {
      expect(html).toMatch(new RegExp(`role="tooltip"[^>]*>${key}<`))
      expect(html.split(key).length - 1).toBe(2)
    }
    expect(html).toContain('lowerIsBetter')
  })
})

// #2253: in he (RTL) a leading sign is a bidi-neutral character and is drawn after the digits
// ("1.970-") unless the number is isolated as LTR.
describe('signed numbers keep their sign in front in RTL', () => {
  it('isolates Skill on the sources board', () => {
    const html = renderToString(
      <SourceLeaderboardClient
        authorRows={[]}
        outletRows={[{ id: 'o1', outletName: 'x.com', authorCount: 1, skillConservative: -1.97, brierScore: 0.4, predictions: 9, articles: 9 }]}
        hidden={{ authors: 0, outlets: 0, min: 4 }}
        tags={[]}
      />,
    )
    expect(html).toContain('<span dir="ltr">-1.970</span>')
  })

  it('isolates Peer and AI score on the user board', () => {
    const html = renderToString(
      <LeaderboardClient initialUsers={[user({ peerScoreSum: -0.16, aiScoreSum: 0.99 })]} initialTags={[]} initialTag={null} />,
    )
    expect(html).toMatch(/<span dir="ltr"[^>]*>-0\.16<\/span>/)
    expect(html).toMatch(/<span dir="ltr"[^>]*>\+0\.99<\/span>/)
  })

  it('isolates the @username line (#2255)', () => {
    const html = renderToString(<LeaderboardClient initialUsers={[user({})]} initialTags={[]} initialTag={null} />)
    expect(html).toContain('<bdi>@<!-- -->ada</bdi>')
  })
})

describe('board switcher (#2257)', () => {
  const tabs = (html: string) =>
    [...html.matchAll(/<a [^>]*href="(\/leaderboard[^"]*)"[^>]*>/g)].map(m => [m[1], m[0].includes('aria-current="page"')])

  it('links all four boards and marks the user board current', () => {
    const html = renderToString(<LeaderboardClient initialUsers={[user({})]} initialTags={[]} initialTag={null} />)
    expect(html).toContain('aria-label="boards.nav"')
    expect(tabs(html)).toEqual([
      ['/leaderboard', true], ['/leaderboard/ai', false], ['/leaderboard/sources', false], ['/leaderboard/versus', false],
    ])
  })

  it('marks the sources board current and drops the old back link', () => {
    nav.params = new URLSearchParams()
    const html = renderToString(
      <SourceLeaderboardClient authorRows={[]} outletRows={[]} hidden={{ authors: 0, outlets: 0, min: 4 }} tags={[]} />,
    )
    expect(tabs(html).slice(0, 4)).toEqual([
      ['/leaderboard', false], ['/leaderboard/ai', false], ['/leaderboard/sources', true], ['/leaderboard/versus', false],
    ])
    expect(html).not.toContain('backToLeaderboard')
  })
})

// A server page that imports a named export from a 'use client' module gets a client reference,
// not the value: calling it throws at render, which no unit test or build catches (#2212).
describe('server/client boundary', () => {
  it('server pages take only the default export from client modules', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const page of ['page.tsx', 'sources/page.tsx', 'versus/page.tsx']) {
      const src = readFileSync(join(__dirname, '..', page), 'utf-8')
      expect(src).not.toMatch(/import\s+\w*\s*,?\s*\{[^}]*\}\s+from\s+'\.\/\w*Client'/)
    }
  })
})
