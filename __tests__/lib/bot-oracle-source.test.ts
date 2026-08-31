import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

// Mock the Oracul search client and the DEFAULT_MAX_ARTICLES budget so this test
// stays isolated from the prisma-backed oracle client module graph.
const mockOracleSearch = vi.fn()
vi.mock('@/lib/services/oracleSearch', () => ({
  oracleSearch: (...args: unknown[]) => mockOracleSearch(...args),
}))
vi.mock('@/lib/services/oracle', () => ({ DEFAULT_MAX_ARTICLES: 15 }))

describe('fetchOracleSources', () => {
  let fetchOracleSources: typeof import('@/lib/services/bots/oracleSource').fetchOracleSources
  const meta = { source: 'bot-sourcing' as const, userId: 'bot-1' }

  beforeEach(async () => {
    vi.resetModules()
    mockOracleSearch.mockReset()
    fetchOracleSources = (await import('@/lib/services/bots/oracleSource')).fetchOracleSources
  })

  it('returns empty array (and makes no calls) for an empty query list', async () => {
    const items = await fetchOracleSources([], { windowHours: 6, meta })
    expect(items).toEqual([])
    expect(mockOracleSearch).not.toHaveBeenCalled()
  })

  it('maps Oracle search results to RssItems with their real publisher as source', async () => {
    mockOracleSearch.mockResolvedValue([
      {
        title: '  OpenAI ships a new model  ',
        url: 'https://theverge.com/openai',
        snippet: 'Details.',
        source: 'The Verge',
        publishedDate: '2026-02-01T10:00:00Z',
      },
    ])

    const items = await fetchOracleSources(['openai model'], { windowHours: 6, meta })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'OpenAI ships a new model',
      url: 'https://theverge.com/openai',
      source: 'The Verge',
      snippet: 'Details.',
    })
    expect(items[0].publishedAt).toBeInstanceOf(Date)
  })

  it('passes DEFAULT_MAX_ARTICLES, a dateFrom bound from windowHours, and the meta', async () => {
    mockOracleSearch.mockResolvedValue([])
    const before = Date.now() - 6 * 60 * 60 * 1000

    await fetchOracleSources(['breaking news'], { windowHours: 6, meta })

    const after = Date.now() - 6 * 60 * 60 * 1000
    expect(mockOracleSearch).toHaveBeenCalledTimes(1)
    const [query, limit, options, passedMeta] = mockOracleSearch.mock.calls[0]
    expect(query).toBe('breaking news')
    expect(limit).toBe(15)
    expect(passedMeta).toEqual(meta)
    const dateFrom = (options as { dateFrom: Date }).dateFrom.getTime()
    expect(dateFrom).toBeGreaterThanOrEqual(before)
    expect(dateFrom).toBeLessThanOrEqual(after)
  })

  it('falls back to the URL hostname when a result has no source', async () => {
    mockOracleSearch.mockResolvedValue([
      { title: 'No publisher article', url: 'https://news.example.com/a/1', snippet: '', source: '' },
    ])

    const items = await fetchOracleSources(['x'], { windowHours: 6, meta })
    expect(items[0].source).toBe('news.example.com')
  })

  it('skips queries that return null or reject, keeping results from the rest', async () => {
    mockOracleSearch
      .mockResolvedValueOnce(null) // unconfigured / empty
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        { title: 'Good one', url: 'https://good.com/1', snippet: '', source: 'Good' },
      ])

    const items = await fetchOracleSources(['a', 'b', 'c'], { windowHours: 6, meta })
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Good one')
  })

  it('truncates snippets to 500 characters', async () => {
    mockOracleSearch.mockResolvedValue([
      { title: 'Long', url: 'https://x.com/1', snippet: 'y'.repeat(600), source: 'X' },
    ])
    const items = await fetchOracleSources(['x'], { windowHours: 6, meta })
    expect(items[0].snippet).toHaveLength(500)
  })
})
