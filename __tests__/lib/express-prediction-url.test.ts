import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies before importing the module under test
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const mockOracleSearch = vi.fn()
vi.mock('@/lib/services/oracleSearch', () => ({
  oracleSearch: (...args: unknown[]) => mockOracleSearch(...args),
}))

const mockFetchUrlContent = vi.fn()
vi.mock('@/lib/utils/scraper', () => ({
  fetchUrlContent: (...args: unknown[]) => mockFetchUrlContent(...args),
}))

const mockGenerateContent = vi.fn()
vi.mock('@/lib/llm/index', () => ({
  llmService: {
    generateContent: (...args: unknown[]) => mockGenerateContent(...args),
  },
}))

vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn().mockImplementation((name) => {
    if (name === 'topic-extraction') return 'Extract the main topic: {{articleContent}}'
    if (name === 'content-moderation') return 'Moderation prompt: {{text}}'
    return 'Mock template: {{userInput}} {{articlesText}}'
  }),
  fillPrompt: vi.fn().mockImplementation((t, v) => t + ' ' + Object.values(v).join(' ')),
}))

import { generateExpressPrediction, extractDomainFromUrl } from '@/lib/llm/expressPrediction'
import type { SearchResult } from '@/lib/services/oracleSearch'

// Standard mock data
const mockArticles: SearchResult[] = [
  { title: 'Bitcoin surges past $90k', url: 'https://cnn.com/btc', snippet: 'Bitcoin hit new highs...', source: 'cnn.com', publishedDate: '2026-02-19' },
  { title: 'Crypto market rally continues', url: 'https://bloomberg.com/crypto', snippet: 'The crypto rally...', source: 'bloomberg.com', publishedDate: '2026-02-18' },
  { title: 'BTC analysis', url: 'https://coindesk.com/btc', snippet: 'Analysts predict...', source: 'coindesk.com' },
]

const mockLlmPrediction = {
  claimText: 'Bitcoin will reach $100,000 by December 31, 2026',
  resolveByDatetime: '2026-12-31T23:59:59Z',
  detailsText: 'Bitcoin has been surging recently.',
  tags: ['Crypto'],
  resolutionRules: 'Resolved when BTC crosses $100k on major exchanges.',
  domain: 'General',
  outcomeType: 'BINARY',
  options: [],
  probabilitySuggestion: 75,
  probabilityReasoning: 'Bullish trend.',
}

const mockModerationPass = { isOffensive: false, reason: '' }

// The text flow extracts a focused search query via an LLM call before searching.
const MOCK_EXTRACTED_QUERY = 'bitcoin 100k 2026'

function setupLlmMock() {
  // 1. Moderation check
  mockGenerateContent.mockResolvedValueOnce({
    text: JSON.stringify(mockModerationPass),
  })
  // 2. Search-query extraction (text flow only)
  mockGenerateContent.mockResolvedValueOnce({
    text: MOCK_EXTRACTED_QUERY,
  })
  // 3. The structured prediction call (with schema)
  mockGenerateContent.mockResolvedValueOnce({
    text: JSON.stringify(mockLlmPrediction),
  })
}

describe('extractDomainFromUrl', () => {
  it('extracts domain from a standard URL', () => {
    expect(extractDomainFromUrl('https://www.cnn.com/2026/02/article')).toBe('cnn.com')
  })

  it('extracts domain without www prefix', () => {
    expect(extractDomainFromUrl('https://bloomberg.com/news')).toBe('bloomberg.com')
  })

  it('handles subdomains', () => {
    expect(extractDomainFromUrl('https://news.bbc.co.uk/article')).toBe('news.bbc.co.uk')
  })

  it('returns Unknown for invalid URLs', () => {
    expect(extractDomainFromUrl('not-a-url')).toBe('Unknown')
  })

  it('returns Unknown for empty string', () => {
    expect(extractDomainFromUrl('')).toBe('Unknown')
  })
})

describe('generateExpressPrediction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('text input flow', () => {
    it('searches articles using user text and returns prediction', async () => {
      mockOracleSearch.mockResolvedValue(mockArticles)
      setupLlmMock()

      const result = await generateExpressPrediction('Bitcoin price prediction')

      expect(mockOracleSearch).toHaveBeenCalledWith(MOCK_EXTRACTED_QUERY, 15, undefined, { source: 'express-creation' })
      expect(mockFetchUrlContent).not.toHaveBeenCalled()
      expect(result.claimText).toBe(mockLlmPrediction.claimText)
      expect(result.newsAnchor!.url).toBe('https://cnn.com/btc')
      expect(result.additionalLinks).toHaveLength(2)
    })

    it('throws NO_ARTICLES_FOUND when search returns empty', async () => {
      // 1. Moderation passes
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockModerationPass),
      })
      mockOracleSearch.mockResolvedValue([])

      await expect(generateExpressPrediction('obscure topic xyz'))
        .rejects.toThrow('NO_ARTICLES_FOUND')
    })

    it('detects and anchors on a URL pasted alongside free text', async () => {
      // Regression: "link + text" must honor the link as the source (Andrej's case),
      // not fall back to a keyword search that anchors on a different article.
      mockFetchUrlContent.mockResolvedValue('CNN Bitcoin Rally. Full body text here.')
      mockOracleSearch.mockResolvedValue(mockArticles)
      setupLlmMock()

      const result = await generateExpressPrediction('check https://cnn.com for news about bitcoin')

      expect(mockFetchUrlContent).toHaveBeenCalledWith('https://cnn.com')
      expect(result.newsAnchor!.url).toBe('https://cnn.com')
    })

    it('anchors on the model-selected relevant article, not the first result', async () => {
      mockOracleSearch.mockResolvedValue(mockArticles) // [cnn, bloomberg, coindesk]
      mockGenerateContent
        .mockResolvedValueOnce({ text: JSON.stringify(mockModerationPass) })
        .mockResolvedValueOnce({ text: MOCK_EXTRACTED_QUERY })
        // relevantArticleIndices is 1-based → [2] selects the 2nd article (bloomberg)
        .mockResolvedValueOnce({ text: JSON.stringify({ ...mockLlmPrediction, relevantArticleIndices: [2] }) })

      const result = await generateExpressPrediction('Bitcoin price')

      expect(result.newsAnchor!.url).toBe('https://bloomberg.com/crypto')
      expect(result.additionalLinks).toHaveLength(0) // only one relevant article
    })

    it('creates the forecast source-free when no articles are relevant', async () => {
      mockOracleSearch.mockResolvedValue(mockArticles)
      mockGenerateContent
        .mockResolvedValueOnce({ text: JSON.stringify(mockModerationPass) })
        .mockResolvedValueOnce({ text: MOCK_EXTRACTED_QUERY })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            ...mockLlmPrediction,
            detailsText: 'The provided articles do not contain specific information about this topic.',
            relevantArticleIndices: [], // explicit: none relevant
          }),
        })

      const result = await generateExpressPrediction('EU will admit two new members by 2028')

      expect(result.newsAnchor).toBeNull()
      expect(result.additionalLinks).toHaveLength(0)
      // Article-derived "no info" description is dropped deterministically.
      expect(result.detailsText).toBe('')
    })
  })

  describe('URL input flow', () => {
    const testUrl = 'https://www.cnn.com/2026/02/19/business/bitcoin-rally/index.html'

    it('fetches article, extracts topic, and searches for related articles', async () => {
      mockFetchUrlContent.mockResolvedValue('Bitcoin Rally Reaches New Heights...')
      
      // URL input skips moderation: 1. Topic extraction, 2. Structured prediction
      mockGenerateContent
        .mockResolvedValueOnce({ text: 'Bitcoin price rally 2026' })
        .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })

      mockOracleSearch.mockResolvedValue(mockArticles)

      const result = await generateExpressPrediction(testUrl)

      // Should fetch the URL content
      expect(mockFetchUrlContent).toHaveBeenCalledWith(testUrl)

      // Should extract topic via LLM
      expect(mockGenerateContent).toHaveBeenCalledTimes(2)
      const topicCall = mockGenerateContent.mock.calls[0][0] // first call (no moderation for URLs)
      expect(topicCall.prompt).toContain('Extract the main topic')

      // Should search for related articles using extracted topic
      expect(mockOracleSearch).toHaveBeenCalledWith('Bitcoin price rally 2026', 15, undefined, { source: 'express-creation' })

      // Primary article (the URL) should be the news anchor
      expect(result.newsAnchor!.url).toBe(testUrl)
    })

    it('uses original URL as news anchor, not search results', async () => {
      mockFetchUrlContent.mockResolvedValue('Article about climate change...')
      mockGenerateContent
        .mockResolvedValueOnce({ text: 'European climate policy' })
        .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })
      mockOracleSearch.mockResolvedValue(mockArticles)

      const result = await generateExpressPrediction(testUrl)

      expect(result.newsAnchor!.url).toBe(testUrl)
    })

    it('deduplicates original URL from search results', async () => {
      mockFetchUrlContent.mockResolvedValue('Some article content here...')
      mockGenerateContent
        .mockResolvedValueOnce({ text: 'test topic' })
        .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })
      
      mockOracleSearch.mockResolvedValue([
        { title: 'Same article', url: testUrl, snippet: 'Same content', source: 'cnn.com' },
        ...mockArticles,
      ])

      const result = await generateExpressPrediction(testUrl)

      const allUrls = [result.newsAnchor!.url, ...result.additionalLinks.map(l => l.url)]
      const uniqueUrls = new Set(allUrls)
      expect(uniqueUrls.size).toBe(allUrls.length)
    })

    it('keeps the user URL as the anchor when the fetch fails (no search-result substitution)', async () => {
      // Bot-blocked/paywalled pages (e.g. Walla) fail to scrape; the user's link must
      // still anchor the forecast rather than being replaced by the first Oracle hit.
      mockFetchUrlContent.mockRejectedValue(new Error('Network error'))
      mockOracleSearch.mockResolvedValue(mockArticles)

      mockGenerateContent
        .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })

      const result = await generateExpressPrediction(testUrl)

      // Related-article search still runs (best effort), but the anchor stays the user's URL.
      expect(mockOracleSearch).toHaveBeenCalledWith(testUrl, 15, undefined, { source: 'express-creation' })
      expect(mockGenerateContent).toHaveBeenCalledTimes(1)
      expect(result.newsAnchor!.url).toBe(testUrl)
    })

    it('falls back to URL as search topic when topic extraction fails', async () => {
      mockFetchUrlContent.mockResolvedValue('Some article content...')
      mockGenerateContent
        .mockRejectedValueOnce(new Error('LLM error')) // topic extraction fails
        .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) }) 
      mockOracleSearch.mockResolvedValue(mockArticles)

      const result = await generateExpressPrediction(testUrl)

      // Should fall back to using the URL as search query
      expect(mockOracleSearch).toHaveBeenCalledWith(testUrl, 15, undefined, { source: 'express-creation' })
      expect(result.newsAnchor!.url).toBe(testUrl)
    })

    it('works when related article search returns empty', async () => {
      mockFetchUrlContent.mockResolvedValue('Article about a niche topic...')
      mockGenerateContent
        .mockResolvedValueOnce({ text: 'niche topic' })
        .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })
      mockOracleSearch.mockResolvedValue([])

      const result = await generateExpressPrediction(testUrl)

      expect(result.newsAnchor!.url).toBe(testUrl)
      expect(result.additionalLinks).toHaveLength(0)
    })

    it('strips quotes from extracted topic', async () => {
      mockFetchUrlContent.mockResolvedValue('Article content...')
      mockGenerateContent
        .mockResolvedValueOnce({ text: '"Bitcoin rally 2026"' })
        .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })
      mockOracleSearch.mockResolvedValue(mockArticles)

      await generateExpressPrediction(testUrl)

      expect(mockOracleSearch).toHaveBeenCalledWith('Bitcoin rally 2026', 15, undefined, { source: 'express-creation' })
    })
  })

  describe('progress callbacks', () => {
    it('emits source summary in found_articles stage', async () => {
      mockOracleSearch.mockResolvedValue(mockArticles)
      setupLlmMock()

      const stages: Array<{ stage: string; data?: Record<string, unknown> }> = []
      await generateExpressPrediction('Bitcoin', (stage, data) => {
        stages.push({ stage, data })
      })

      const foundStage = stages.find(s => s.stage === 'found_articles')
      expect(foundStage).toBeDefined()
      expect(foundStage!.data!.sources).toBe('cnn.com, bloomberg.com, coindesk.com')
    })
  })

  describe('URL detection', () => {
    it.each([
      ['https://cnn.com/article', true],
      ['Bitcoin will reach $100k', false],
    ])('input "%s" detected as URL: %s', async (input, isUrl) => {
      mockOracleSearch.mockResolvedValue(mockArticles)
      mockFetchUrlContent.mockResolvedValue('Some fetched content.')
      
      if (isUrl) {
        // URL skips moderation: 1. Topic, 2. Prediction
        mockGenerateContent
          .mockResolvedValueOnce({ text: 'extracted topic' })
          .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })
      } else {
        // 1. Moderation, 2. Search-query extraction, 3. Prediction
        mockGenerateContent
          .mockResolvedValueOnce({ text: JSON.stringify(mockModerationPass) })
          .mockResolvedValueOnce({ text: MOCK_EXTRACTED_QUERY })
          .mockResolvedValueOnce({ text: JSON.stringify(mockLlmPrediction) })
      }

      await generateExpressPrediction(input)

      if (isUrl) {
        expect(mockFetchUrlContent).toHaveBeenCalled()
      } else {
        expect(mockFetchUrlContent).not.toHaveBeenCalled()
      }
    })
  })
})
