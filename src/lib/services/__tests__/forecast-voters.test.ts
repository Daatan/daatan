/**
 * @jest-environment node
 *
 * getForecastVoters merges the Oracle-snapshot stream and the news-indexer stream,
 * deduping by canonical URL (Oracle stance wins on overlap, origins union).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/env', () => ({ env: { NEWS_INDEXER_URL: 'http://ni', NEWS_INDEXER_API_KEY: 'k' } }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/services/context', () => ({ getLatestOracleSnapshot: vi.fn() }))
vi.mock('@/lib/services/sourceLeaderboard', () => ({ getSourceLeaderboard: vi.fn() }))

import { getForecastVoters } from '../forecast-sources'
import { getLatestOracleSnapshot } from '@/lib/services/context'
import { getSourceLeaderboard } from '@/lib/services/sourceLeaderboard'

const mockSnapshot = vi.mocked(getLatestOracleSnapshot)
const mockLeaderboard = vi.mocked(getSourceLeaderboard)

/** Author-shadow board with the given scored (author, outletName) pairs — the row set the
 *  linkability check matches against (same criterion as /authors/[author]/[outlet]). */
function mockScoredAuthors(pairs: Array<{ author: string; outletName: string }>) {
  mockLeaderboard.mockResolvedValue({
    view: 'authors',
    sortBy: 'skillConservative',
    authorRows: pairs.map((p, i) => ({
      id: `row-${i}`, author: p.author, outletName: p.outletName,
      skillConservative: 0.1, brierScore: 0.2, predictions: 3, articles: 5,
    })),
    outletRows: [],
  })
}

function mockIndexerRows(rows: unknown[]) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => rows })) as unknown as typeof fetch
}

/** Routes by URL so the indexer-rows fetch and the by-url identity-lookup fetch (both hit
 *  during getContributingSources) can return different, purpose-shaped payloads. */
function mockFetchRouted(indexerRows: unknown[], metaRows: unknown[]) {
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    return { ok: true, json: async () => (url.includes('/articles/by-url') ? metaRows : indexerRows) }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  mockScoredAuthors([]) // sparse board by default — nothing linkable
})

describe('getForecastVoters', () => {
  it('returns indexer-only when no Oracle snapshot exists', async () => {
    mockSnapshot.mockResolvedValue(null)
    mockIndexerRows([{ url: 'https://bbc.com/x', stance: -0.3, author: 'Tom' }])
    const out = await getForecastVoters('fc-1')
    expect(out).toHaveLength(1)
    expect(out[0].origin).toBe('indexer')
  })

  it('merges disjoint sources from both streams', async () => {
    mockSnapshot.mockResolvedValue({
      oracleSnapshot: { sources: [{ url: 'https://reuters.com/a', stance: 0.5, certainty: 0.8 }] },
      createdAt: new Date(),
    } as never)
    mockIndexerRows([{ url: 'https://bbc.com/b', stance: -0.3, author: 'Tom' }])
    const out = await getForecastVoters('fc-1')
    expect(out).toHaveLength(2)
    expect(out.map(s => s.origin).sort()).toEqual(['indexer', 'oracle'])
  })

  it('dedups overlapping URLs by canonical key: Oracle stance wins, author filled from indexer, origin=both', async () => {
    mockSnapshot.mockResolvedValue({
      oracleSnapshot: { sources: [{ url: 'https://reuters.com/a', sourceName: 'Reuters', stance: 0.5, certainty: 0.8, author: null }] },
      createdAt: new Date(),
    } as never)
    // same article, www. + tracking param, indexer knows the author
    mockIndexerRows([{ url: 'https://www.reuters.com/a?utm_source=rss', stance: -0.9, author: 'Jane Doe', publishedAt: '2026-06-18' }])
    const out = await getForecastVoters('fc-1')
    expect(out).toHaveLength(1)
    expect(out[0].origin).toBe('both')
    expect(out[0].stance).toBe(0.5) // Oracle wins
    expect(out[0].author).toBe('Jane Doe') // filled from indexer (Oracle had null)
    expect(out[0].publishedAt).toBe('2026-06-18')
  })

  it('enriches indexer-origin rows with outletName from the by-url identity lookup', async () => {
    mockSnapshot.mockResolvedValue(null)
    mockFetchRouted(
      [{ url: 'https://bbc.com/x', stance: -0.3, author: 'Tom' }],
      [{ requestedUrl: 'https://bbc.com/x', outletName: 'bbc' }],
    )
    const out = await getForecastVoters('fc-1')
    expect(out[0].outletName).toBe('bbc')
  })

  it('nulls outletName when the by-url lookup has no match for the article', async () => {
    mockSnapshot.mockResolvedValue(null)
    mockFetchRouted([{ url: 'https://bbc.com/x', stance: -0.3 }], [])
    const out = await getForecastVoters('fc-1')
    expect(out[0].outletName).toBeNull()
  })

  it('carries the indexer-resolved outletName through a both-origin merge', async () => {
    mockSnapshot.mockResolvedValue({
      oracleSnapshot: { sources: [{ url: 'https://reuters.com/a', stance: 0.5, certainty: 0.8 }] },
      createdAt: new Date(),
    } as never)
    mockFetchRouted(
      [{ url: 'https://www.reuters.com/a?utm_source=rss', stance: -0.9 }],
      [{ requestedUrl: 'https://www.reuters.com/a?utm_source=rss', outletName: 'reuters' }],
    )
    const out = await getForecastVoters('fc-1')
    expect(out).toHaveLength(1)
    expect(out[0].origin).toBe('both')
    expect(out[0].outletName).toBe('reuters')
  })

  it('enriches personName and flags authorLinkable when the pair has a scored leaderboard row (#1213)', async () => {
    mockSnapshot.mockResolvedValue(null)
    mockScoredAuthors([{ author: 'Jane Doe', outletName: 'reuters' }])
    mockFetchRouted(
      [{ url: 'https://reuters.com/x', stance: 0.4 }],
      [{ requestedUrl: 'https://reuters.com/x', outletName: 'reuters', personName: 'Jane Doe' }],
    )
    const out = await getForecastVoters('fc-1')
    expect(out[0].personName).toBe('Jane Doe')
    expect(out[0].authorLinkable).toBe(true)
  })

  it('leaves authorLinkable unset when the pair has no scored row — the profile page would 404', async () => {
    mockSnapshot.mockResolvedValue(null)
    mockScoredAuthors([{ author: 'Jane Doe', outletName: 'bbc' }]) // scored at a DIFFERENT outlet
    mockFetchRouted(
      [{ url: 'https://reuters.com/x', stance: 0.4 }],
      [{ requestedUrl: 'https://reuters.com/x', outletName: 'reuters', personName: 'Jane Doe' }],
    )
    const out = await getForecastVoters('fc-1')
    expect(out[0].personName).toBe('Jane Doe')
    expect(out[0].authorLinkable).toBeFalsy()
  })

  it('skips the leaderboard fetch entirely when no row carries a resolved (person, outlet) pair', async () => {
    mockSnapshot.mockResolvedValue(null)
    mockFetchRouted(
      [{ url: 'https://bbc.com/x', stance: -0.3, author: 'Tom' }],
      [{ requestedUrl: 'https://bbc.com/x', outletName: 'bbc' }], // outlet resolved, person not
    )
    const out = await getForecastVoters('fc-1')
    expect(out[0].personName).toBeNull()
    expect(mockLeaderboard).not.toHaveBeenCalled()
  })

  it('carries personName + authorLinkable through a both-origin merge', async () => {
    mockSnapshot.mockResolvedValue({
      oracleSnapshot: { sources: [{ url: 'https://reuters.com/a', stance: 0.5, certainty: 0.8 }] },
      createdAt: new Date(),
    } as never)
    mockScoredAuthors([{ author: 'Jane Doe', outletName: 'reuters' }])
    mockFetchRouted(
      [{ url: 'https://www.reuters.com/a?utm_source=rss', stance: -0.9 }],
      [{ requestedUrl: 'https://www.reuters.com/a?utm_source=rss', outletName: 'reuters', personName: 'Jane Doe' }],
    )
    const out = await getForecastVoters('fc-1')
    expect(out).toHaveLength(1)
    expect(out[0].origin).toBe('both')
    expect(out[0].personName).toBe('Jane Doe')
    expect(out[0].authorLinkable).toBe(true)
  })
})
