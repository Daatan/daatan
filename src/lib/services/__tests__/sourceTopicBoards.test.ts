import { describe, it, expect, vi } from 'vitest'

vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }))
vi.mock('../sourceLeaderboard', () => ({
  getSourceLeaderboard: vi.fn(),
  canonicalOutlet: (n: string) => (n === 'ynetnews.com' ? 'ynet.co.il' : n),
  authorKey: (n: string) => n.toLowerCase(),
}))

import { STANDARD_TAGS } from '@/lib/constants'
import { getSourceLeaderboard } from '../sourceLeaderboard'
import { authorTopicRecords, getTopicBoards, outletTopicRecords, type TopicBoard } from '../sourceTopicBoards'

const outlet = (outletName: string, predictions: number) => ({
  id: outletName, outletName, skillConservative: 1, brierScore: 0.2, authorCount: 1, predictions, articles: 1,
})
const author = (a: string, outletName: string, predictions: number) => ({
  id: `${a}-${outletName}`, author: a, outletName, skillConservative: 1, brierScore: 0.2, predictions, articles: 1,
})

const boards: TopicBoard[] = [
  { slug: 'economy', name: 'Economy', outletRows: [outlet('ynet.co.il', 3)], authorRows: [author('Ann', 'ynet.co.il', 1)] },
  { slug: 'conflict', name: 'Conflict', outletRows: [outlet('ynet.co.il', 23), outlet('jpost.com', 15)], authorRows: [author('ann', 'ynetnews.com', 9)] },
  { slug: 'elections', name: 'Elections', outletRows: [], authorRows: [] },
]

describe('topic records (#1917)', () => {
  it('lists only the topics the outlet has a record in, biggest sample first', () => {
    const rows = outletTopicRecords(boards, new Set(['ynet.co.il']))
    expect(rows.map(r => [r.slug, r.predictions])).toEqual([['conflict', 23], ['economy', 3]])
  })

  it('matches an author across spelling and outlet alias', () => {
    const rows = authorTopicRecords(boards, 'Ann', 'ynet.co.il')
    expect(rows.map(r => [r.slug, r.predictions])).toEqual([['conflict', 9], ['economy', 1]])
  })

  it('is empty when nothing matches', () => {
    expect(outletTopicRecords(boards, new Set(['walla.co.il']))).toEqual([])
  })
})

describe('getTopicBoards (#2050)', () => {
  it('makes one Oracul call per topic, at most 5 in flight', async () => {
    let inFlight = 0
    let peak = 0
    vi.mocked(getSourceLeaderboard).mockImplementation(async (_view, _sort, _min, tag) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
      return {
        view: 'outlets', sortBy: 'skillConservative',
        outletRows: [outlet(`${tag}.com`, 1)], authorRows: [author('Ann', `${tag}.com`, 1)],
      }
    })

    const result = await getTopicBoards()

    expect(getSourceLeaderboard).toHaveBeenCalledTimes(STANDARD_TAGS.length)
    expect(peak).toBeLessThanOrEqual(5)
    expect(result).toHaveLength(STANDARD_TAGS.length)
    expect(result[0].outletRows[0].outletName).toBe(`${result[0].slug}.com`)
    expect(result[0].authorRows[0].outletName).toBe(`${result[0].slug}.com`)
  })
})
