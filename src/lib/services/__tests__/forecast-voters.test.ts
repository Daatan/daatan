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

import { getForecastVoters } from '../forecast-sources'
import { getLatestOracleSnapshot } from '@/lib/services/context'

const mockSnapshot = vi.mocked(getLatestOracleSnapshot)

function mockIndexerRows(rows: unknown[]) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => rows })) as unknown as typeof fetch
}

beforeEach(() => vi.clearAllMocks())

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
})
