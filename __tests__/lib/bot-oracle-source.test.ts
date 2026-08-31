import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

// Mock the Oracul search client and the DEFAULT_MAX_ARTICLES budget so this test
// stays isolated from the prisma-backed oracle client module graph.
const mockOraculSearch = vi.fn()
vi.mock('@/lib/services/oracleSearch', () => ({
  oracleSearch: (...args: unknown[]) => mockOraculSearch(...args),
}))
vi.mock('@/lib/services/oracle', () => ({ DEFAULT_MAX_ARTICLES: 15 }))

describe('fetchOraculSources', () => {
  let fetchOraculSources: typeof import('@/lib/services/bots/oracleSource').fetchOraculSources
  const meta = { source: 'bot-sourcing' as const, userId: 'bot-1' }

  beforeEach(async () => {
    vi.resetModules()
    mockOraculSearch.mockReset()
    fetchOraculSources = (await import('@/lib/services/bots/oracleSource')).fetchOraculSources
  })

  it('returns empty array (and makes no calls) for an empty query list', async () => {
    const items = await fetchOraculSources([], { windowHours: 6, meta })
    expect(items).toEqual([])
    expect(mockOraculSearch).not.toHaveBeenCalled()
  })

  it('maps Oracul search results to RssItems with their real publisher as source', async () => {
    mockOraculSearch.mockResolvedValue([
      {
        title: '  OpenAI ships a new model  ',
        url: 'https://theverge.com/openai',
        snippet: 'Details.',
        source: 'The Verge',
        publishedDate: '2026-02-01T10:00:00Z',
      },
    ])

    const items = await fetchOraculSources(['openai model'], { windowHours: 6, meta })

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
    mockOraculSearch.mockResolvedValue([])
    const before = Date.now() - 6 * 60 * 60 * 1000

    await fetchOraculSources(['breaking news'], { windowHours: 6, meta })

    const after = Date.now() - 6 * 60 * 60 * 1000
    expect(mockOraculSearch).toHaveBeenCalledTimes(1)
    const [query, limit, options, passedMeta] = mockOraculSearch.mock.calls[0]
    expect(query).toBe('breaking news')
    expect(limit).toBe(15)
    expect(passedMeta).toEqual(meta)
    const dateFrom = (options as { dateFrom: Date }).dateFrom.getTime()
    expect(dateFrom).toBeGreaterThanOrEqual(before)
    expect(dateFrom).toBeLessThanOrEqual(after)
  })

  it('falls back to the URL hostname when a result has no source', async () => {
    mockOraculSearch.mockResolvedValue([
      { title: 'No publisher article', url: 'https://news.example.com/a/1', snippet: '', source: '' },
    ])

    const items = await fetchOraculSources(['x'], { windowHours: 6, meta })
    expect(items[0].source).toBe('news.example.com')
  })

  it('skips queries that return null or reject, keeping results from the rest', async () => {
    mockOraculSearch
      .mockResolvedValueOnce(null) // unconfigured / empty
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([
        { title: 'Good one', url: 'https://good.com/1', snippet: '', source: 'Good' },
      ])

    const items = await fetchOraculSources(['a', 'b', 'c'], { windowHours: 6, meta })
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Good one')
  })

  it('truncates snippets to 500 characters', async () => {
    mockOraculSearch.mockResolvedValue([
      { title: 'Long', url: 'https://x.com/1', snippet: 'y'.repeat(600), source: 'X' },
    ])
    const items = await fetchOraculSources(['x'], { windowHours: 6, meta })
    expect(items[0].snippet).toHaveLength(500)
  })
})
