import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { VersusBoard } from '@/lib/services/versus-board'

const board = vi.hoisted(() => ({ current: null as unknown as VersusBoard }))

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/services/oracle', () => ({ getExpertResolutions: vi.fn() }))
vi.mock('@/lib/services/versus-board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/versus-board')>()),
  getVersusBoard: async () => board.current,
}))

import VersusLeaderboardPage from '../versus/page'

const render = async () => renderToString(await VersusLeaderboardPage())
const peopleVsOracul = { a: 'people', b: 'oracul', n: 60, aCloser: 43, bCloser: 15, ties: 2, aBrier: 0.179, bBrier: 0.24 } as const

describe('versus board page (#2266)', () => {
  beforeEach(() => {
    board.current = { strip: null, pairs: [], coverage: { people: 0, oracul: 0, experts: 0, market: 0 } }
  })

  it('marks its own tab current', async () => {
    const html = await render()
    const current = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((a) => a.includes('aria-current="page"'))
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('href="/leaderboard/versus"')
  })

  it('shows the empty state when no pair qualifies', async () => {
    const html = await render()
    expect(html).toContain('emptyTitle')
    expect(html).not.toContain('pairsTitle')
  })

  it('renders the people/Oracul pair and says experts are pending before the Oracul has them', async () => {
    board.current = { strip: null, pairs: [peopleVsOracul], coverage: { people: 72, oracul: 60, experts: 0, market: 2 } }
    const html = await render()
    expect(html).not.toContain('stripTitle')
    expect(html).toContain('pairsTitle')
    expect(html).toContain('group.people')
    expect(html).toContain('0.179')
    expect(html).toContain('ties{&quot;n&quot;:2}')
    expect(html).toContain('expertsPending')
    expect(html).toContain('marketPending{&quot;min&quot;:10,&quot;n&quot;:2}')
    expect(html).not.toContain('legend.expertsDesc')
  })

  it('ranks the strip best first and drops the experts note once they are in', async () => {
    board.current = {
      strip: { n: 34, rows: [{ group: 'people', brier: 0.146 }, { group: 'experts', brier: 0.235 }, { group: 'oracul', brier: 0.258 }] },
      pairs: [peopleVsOracul],
      coverage: { people: 72, oracul: 60, experts: 43, market: 0 },
    }
    const html = await render()
    expect(html).toContain('stripTitle{&quot;n&quot;:34}')
    expect(html.indexOf('0.146')).toBeLessThan(html.indexOf('0.235'))
    expect(html).not.toContain('expertsPending')
    expect(html).toContain('legend.expertsDesc')
  })
})
