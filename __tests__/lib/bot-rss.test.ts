import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock rss-parser at the module level so the module-level `parser` instance is mocked
const mockParseURL = vi.fn()
vi.mock('rss-parser', () => ({
  default: class MockParser {
    parseURL = mockParseURL
  },
}))

// Mock global fetch for scraping fallback
const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe('detectHotTopics', () => {
  // Helper to build an RssItem published `hoursAgo` hours in the past
  const makeItem = (
    title: string,
    source: string,
    hoursAgo = 1,
  ) => ({
    title,
    url: `https://${source}/article`,
    source,
    publishedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
  })

  let detectHotTopics: typeof import('@/lib/services/bots/rss').detectHotTopics

  beforeEach(async () => {
    vi.resetModules()
    detectHotTopics = (await import('@/lib/services/bots/rss')).detectHotTopics
  })

  it('returns empty array when given no items', () => {
    expect(detectHotTopics([], 2, 24)).toEqual([])
  })

  it('returns empty array when no topic meets minSources threshold', () => {
    const items = [
      makeItem('Bitcoin price hits new high today', 'source-a'),
      makeItem('Ethereum price hits new high today', 'source-a'), // same source — only 1 distinct
    ]
    const topics = detectHotTopics(items, 2, 24)
    expect(topics).toEqual([])
  })

  it('returns a hot topic when same cluster has items from multiple sources', () => {
    const items = [
      makeItem('Bitcoin price hits all time high record', 'source-a'),
      makeItem('Bitcoin price hits record high again', 'source-b'),
    ]
    const topics = detectHotTopics(items, 2, 24)
    expect(topics).toHaveLength(1)
    expect(topics[0].sourceCount).toBe(2)
    expect(topics[0].items).toHaveLength(2)
  })

  it('filters out items older than windowHours', () => {
    const items = [
      makeItem('Bitcoin price hits all time high record', 'source-a', 25), // 25 h ago — outside window
      makeItem('Bitcoin price hits record high today', 'source-b', 1),
    ]
    const topics = detectHotTopics(items, 2, 24)
    // Only one item is within the window so sourceCount will be 1 → below minSources=2
    expect(topics).toEqual([])
  })

  it('includes items exactly at the cutoff boundary', () => {
    // An item published at exactly `windowHours` ago should be excluded (< cutoff, not >=).
    // One item just inside (23.99 h) and one just outside (24.01 h).
    const windowHours = 24
    const justInside = {
      title: 'Bitcoin price hits record high this morning',
      url: 'https://source-a/article',
      source: 'source-a',
      publishedAt: new Date(Date.now() - (windowHours * 60 * 60 * 1000 - 1)),
    }
    const justOutside = {
      title: 'Bitcoin price hits record high tonight',
      url: 'https://source-b/article',
      source: 'source-b',
      publishedAt: new Date(Date.now() - (windowHours * 60 * 60 * 1000 + 1)),
    }
    const topics = detectHotTopics([justInside, justOutside], 2, windowHours)
    expect(topics).toEqual([])
  })

  it('counts distinct sources, not total items', () => {
    // source-a has two articles, source-b has one → only 2 distinct sources
    const items = [
      makeItem('Bitcoin price hits all time high record', 'source-a'),
      makeItem('Bitcoin price hits record high again now', 'source-a'),
      makeItem('Bitcoin price hits record high today here', 'source-b'),
    ]
    const topics = detectHotTopics(items, 2, 24)
    expect(topics).toHaveLength(1)
    expect(topics[0].sourceCount).toBe(2)
  })

  it('sorts results by sourceCount descending', () => {
    // Topic A: 3 sources, Topic B: 2 sources
    const itemsA = [
      makeItem('OpenAI releases new language model gpt', 'alpha'),
      makeItem('OpenAI releases language model gpt today', 'beta'),
      makeItem('OpenAI new language model gpt release', 'gamma'),
    ]
    const itemsB = [
      makeItem('Climate change summit talks policy agreement', 'delta'),
      makeItem('Climate summit policy agreement talks global', 'epsilon'),
    ]
    const topics = detectHotTopics([...itemsA, ...itemsB], 2, 24)
    expect(topics.length).toBeGreaterThanOrEqual(2)
    expect(topics[0].sourceCount).toBeGreaterThanOrEqual(topics[1].sourceCount)
  })

  it('uses the first item title as the representative title', () => {
    const items = [
      makeItem('Bitcoin price hits record high today across markets', 'source-a'),
      makeItem('Bitcoin hits record price high across markets now', 'source-b'),
    ]
    const topics = detectHotTopics(items, 2, 24)
    expect(topics[0].title).toBe('Bitcoin price hits record high today across markets')
  })

  it('does not cluster items that share fewer than 2 keywords', () => {
    // Only one overlapping meaningful keyword (e.g. "election") → separate clusters
    const items = [
      makeItem('United States election results announced today', 'source-a'),
      makeItem('France election campaign starts tomorrow morning', 'source-b'),
    ]
    // With only 1 overlap ("election") they should not cluster — each cluster has 1 source
    const topics = detectHotTopics(items, 2, 24)
    expect(topics).toEqual([])
  })

  it('handles items where all keywords are stop-words (empty keyword set)', () => {
    // Titles composed entirely of stop-words / short words produce empty keyword arrays
    // and should not throw
    const items = [
      makeItem('In on at to for', 'source-a'),
      makeItem('The a an is are', 'source-b'),
    ]
    expect(() => detectHotTopics(items, 2, 24)).not.toThrow()
  })

  it('returns empty when items array has all items outside window', () => {
    const items = [
      makeItem('Bitcoin price hits record high today', 'source-a', 48),
      makeItem('Bitcoin record price hits high again', 'source-b', 72),
    ]
    expect(detectHotTopics(items, 2, 24)).toEqual([])
  })

  it('clusters on short keywords like "AI" that the old length filter discarded', () => {
    // "ai" and "chip" are the only shared tokens; the previous length>3 filter
    // dropped "ai", leaving a single overlap and no cluster. Now they cluster.
    const items = [
      makeItem('AI chip demand surges', 'source-a'),
      makeItem('AI chip shortage worsens', 'source-b'),
    ]
    const topics = detectHotTopics(items, 2, 24)
    expect(topics).toHaveLength(1)
    expect(topics[0].sourceCount).toBe(2)
  })

  it('produces the same clusters regardless of item order (deterministic)', () => {
    const a = makeItem('OpenAI releases new language model gpt', 'alpha')
    const b = makeItem('OpenAI releases language model gpt today', 'beta')
    const c = makeItem('OpenAI new language model gpt release', 'gamma')

    const forward = detectHotTopics([a, b, c], 2, 24)
    const reversed = detectHotTopics([c, b, a], 2, 24)

    expect(forward).toHaveLength(1)
    expect(reversed).toHaveLength(1)
    expect(forward[0].sourceCount).toBe(3)
    expect(reversed[0].sourceCount).toBe(3)
  })
})

describe('fetchRssFeeds', () => {
  let fetchRssFeeds: typeof import('@/lib/services/bots/rss').fetchRssFeeds

  beforeEach(async () => {
    vi.resetModules()
    mockParseURL.mockReset()
    mockFetch.mockReset()
    fetchRssFeeds = (await import('@/lib/services/bots/rss')).fetchRssFeeds
  })

  it('returns mapped RssItems from a successful feed', async () => {
    mockParseURL.mockResolvedValue({
      title: 'Tech News',
      items: [
        {
          title: ' Bitcoin soars to record high ',
          link: 'https://technews.com/bitcoin',
          pubDate: '2026-02-01T10:00:00Z',
          contentSnippet: 'Details about Bitcoin.',
        },
      ],
    })

    const results = await fetchRssFeeds(['https://technews.com/rss'])

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      title: 'Bitcoin soars to record high',
      url: 'https://technews.com/bitcoin',
      source: 'Tech News',
      snippet: 'Details about Bitcoin.',
    })
    expect(results[0].publishedAt).toBeInstanceOf(Date)
  })

  it('uses URL hostname as source when feed title is absent', async () => {
    mockParseURL.mockResolvedValue({
      title: undefined,
      items: [
        { title: 'Some headline', link: 'https://feeds.example.com/article-1', pubDate: '2026-02-01T00:00:00Z' },
      ],
    })

    const results = await fetchRssFeeds(['https://feeds.example.com/rss'])
    expect(results[0].source).toBe('feeds.example.com')
  })

  it('skips items without a title or link', async () => {
    mockParseURL.mockResolvedValue({
      title: 'Feed',
      items: [
        { title: 'Valid headline', link: 'https://example.com/1', pubDate: '2026-02-01T00:00:00Z' },
        { title: null, link: 'https://example.com/2', pubDate: '2026-02-01T00:00:00Z' },
        { title: 'No link item', link: null, pubDate: '2026-02-01T00:00:00Z' },
      ],
    })

    const results = await fetchRssFeeds(['https://example.com/rss'])
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Valid headline')
  })

  it('falls back to current date when pubDate is missing', async () => {
    const before = Date.now()
    mockParseURL.mockResolvedValue({
      title: 'Feed',
      items: [{ title: 'Undated headline', link: 'https://example.com/undated' }],
    })

    const results = await fetchRssFeeds(['https://example.com/rss'])
    const after = Date.now()

    expect(results).toHaveLength(1)
    expect(results[0].publishedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(results[0].publishedAt.getTime()).toBeLessThanOrEqual(after)
  })

  it('truncates contentSnippet to 500 characters', async () => {
    const longSnippet = 'x'.repeat(600)
    mockParseURL.mockResolvedValue({
      title: 'Feed',
      items: [{ title: 'Long snippet item', link: 'https://example.com/long', contentSnippet: longSnippet }],
    })

    const results = await fetchRssFeeds(['https://example.com/rss'])
    expect(results[0].snippet).toHaveLength(500)
  })

  it('skips a failed feed and still returns items from the successful one', async () => {
    mockParseURL
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({
        title: 'Good Feed',
        items: [{ title: 'Good headline', link: 'https://goodfeed.com/1', pubDate: '2026-02-01T00:00:00Z' }],
      })

    const results = await fetchRssFeeds([
      'https://badfeed.com/rss',
      'https://goodfeed.com/rss',
    ])

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Good headline')
  })

  it('returns empty array when all feeds fail', async () => {
    mockParseURL.mockRejectedValue(new Error('Timeout'))

    const results = await fetchRssFeeds(['https://bad1.com/rss', 'https://bad2.com/rss'])
    expect(results).toEqual([])
  })

  it('returns empty array for empty feed URL list', async () => {
    const results = await fetchRssFeeds([])
    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('aggregates items from multiple successful feeds', async () => {
    mockParseURL
      .mockResolvedValueOnce({
        title: 'Feed A',
        items: [{ title: 'Headline from A', link: 'https://a.com/1', pubDate: '2026-02-01T00:00:00Z' }],
      })
      .mockResolvedValueOnce({
        title: 'Feed B',
        items: [{ title: 'Headline from B', link: 'https://b.com/1', pubDate: '2026-02-01T00:00:00Z' }],
      })

    const results = await fetchRssFeeds(['https://a.com/rss', 'https://b.com/rss'])
    expect(results).toHaveLength(2)
    expect(results.map(r => r.source)).toEqual(['Feed A', 'Feed B'])
  })

  it('supports "Search:" prefix by using google news rss', async () => {
    mockParseURL.mockResolvedValue({
      title: 'Google News',
      items: [{ title: 'Search result', link: 'https://news.google.com/1', pubDate: '2026-02-01T00:00:00Z' }],
    })

    await fetchRssFeeds(['Search: bitcoin'])

    expect(mockParseURL).toHaveBeenCalledWith(expect.stringContaining('news.google.com/rss/search?q=bitcoin'))
  })

  it('returns empty (no HTML scrape fallback) when a feed is not valid RSS', async () => {
    mockParseURL.mockRejectedValue(new Error('Not RSS'))

    const results = await fetchRssFeeds(['https://example.com/news'])

    expect(results).toEqual([])
  })

  // ── Google News per-article publisher attribution ─────────────────────────

  it('uses the per-item <source> element as the source for Google News results', async () => {
    mockParseURL.mockResolvedValue({
      title: 'Google News',
      items: [
        {
          title: 'OpenAI ships new model - The Verge',
          link: 'https://news.google.com/articles/1',
          pubDate: '2026-02-01T00:00:00Z',
          sourceTag: { _: 'The Verge', $: { url: 'https://www.theverge.com' } },
        },
        {
          title: 'OpenAI ships new model - Reuters',
          link: 'https://news.google.com/articles/2',
          pubDate: '2026-02-01T00:00:00Z',
          sourceTag: { _: 'Reuters', $: { url: 'https://www.reuters.com' } },
        },
      ],
    })

    const results = await fetchRssFeeds(['Search: openai model'])

    expect(results.map(r => r.source)).toEqual(['The Verge', 'Reuters'])
    // The " - Publisher" suffix is stripped from the title for cleaner clustering
    expect(results.map(r => r.title)).toEqual(['OpenAI ships new model', 'OpenAI ships new model'])
  })

  it('falls back to the " - Publisher" title suffix when no <source> element is present', async () => {
    mockParseURL.mockResolvedValue({
      title: 'Google News',
      items: [
        { title: 'Senate passes the bill - Politico', link: 'https://news.google.com/a/1', pubDate: '2026-02-01T00:00:00Z' },
      ],
    })

    const results = await fetchRssFeeds(['Search: senate bill'])

    expect(results[0].source).toBe('Politico')
    expect(results[0].title).toBe('Senate passes the bill')
  })

  it('does not strip " - " suffixes or override source for ordinary (non-Google-News) feeds', async () => {
    mockParseURL.mockResolvedValue({
      title: 'The Verge',
      items: [
        { title: 'A look at design - and why it matters', link: 'https://theverge.com/1', pubDate: '2026-02-01T00:00:00Z' },
      ],
    })

    const results = await fetchRssFeeds(['https://www.theverge.com/rss/index.xml'])

    expect(results[0].source).toBe('The Verge')
    expect(results[0].title).toBe('A look at design - and why it matters')
  })

  // ── SSRF URL validation tests ─────────────────────────────────────────────

  it('rejects HTTP URLs (non-HTTPS) without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['http://example.com/rss'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects file:// URLs without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['file:///etc/passwd'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects localhost URLs without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['https://localhost/feed'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects .localhost subdomains without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['https://app.localhost/feed'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects private IP hostnames (192.168.x.x) without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['https://192.168.1.1/feed'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects 127.x.x.x loopback IPs without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['https://127.0.0.1/rss'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects .internal hostnames without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['https://internal.service.internal/feed'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects .local hostnames without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['https://myserver.local/rss'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('rejects invalid (non-parseable) URLs without calling RSS parser', async () => {
    const results = await fetchRssFeeds(['not a url at all'])

    expect(results).toEqual([])
    expect(mockParseURL).not.toHaveBeenCalled()
  })

  it('still fetches valid HTTPS public URLs after SSRF checks pass', async () => {
    mockParseURL.mockResolvedValue({
      title: 'Public Feed',
      items: [{ title: 'Good item', link: 'https://public.example.com/1', pubDate: '2026-02-01T00:00:00Z' }],
    })

    const results = await fetchRssFeeds(['https://public.example.com/rss'])

    expect(results).toHaveLength(1)
    expect(mockParseURL).toHaveBeenCalledWith('https://public.example.com/rss')
  })

  it('skips only the blocked URLs and still fetches safe ones in the same batch', async () => {
    mockParseURL.mockResolvedValue({
      title: 'Safe Feed',
      items: [{ title: 'Safe item', link: 'https://safe.example.com/1', pubDate: '2026-02-01T00:00:00Z' }],
    })

    const results = await fetchRssFeeds([
      'http://evil.com/rss',          // blocked (HTTP)
      'https://192.168.0.1/feed',    // blocked (private IP)
      'https://safe.example.com/rss', // allowed
    ])

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Safe item')
    expect(mockParseURL).toHaveBeenCalledTimes(1)
    expect(mockParseURL).toHaveBeenCalledWith('https://safe.example.com/rss')
  })
})
