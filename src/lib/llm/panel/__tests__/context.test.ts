import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/env', () => ({
  env: {
    AI_PANEL_GROUNDED_TAG: 'israeli-elections-2026',
    NEWS_INDEXER_URL: 'https://indexer.test',
    NEWS_INDEXER_API_KEY: 'k',
  },
}))

import { env } from '@/env'
import {
  contextFingerprint,
  formatArticlesBlock,
  groundedPanelTag,
  retrievePanelContext,
  type PanelContextArticle,
  type PanelContextSnapshot,
} from '../context'

const NOW = new Date('2026-07-12T04:43:00.000Z')

const HIT = {
  title: 'Knesset dissolution vote scheduled',
  url: 'https://news.example/a1',
  snippet: 'The vote is expected on Wednesday. Coalition sources are split.',
  source: 'ynet',
  published_date: '2026-07-11',
}

function article(over: Partial<PanelContextArticle> = {}): PanelContextArticle {
  return {
    title: HIT.title,
    url: HIT.url,
    snippet: HIT.snippet,
    source: HIT.source,
    publishedDate: HIT.published_date,
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('groundedPanelTag', () => {
  it('returns the configured tag when the news-indexer connection also exists', () => {
    expect(groundedPanelTag()).toBe('israeli-elections-2026')
  })

  it('is null — grounding off — when any piece of the configuration is missing', () => {
    const mutable = env as { AI_PANEL_GROUNDED_TAG?: string; NEWS_INDEXER_URL?: string }
    const tag = mutable.AI_PANEL_GROUNDED_TAG
    mutable.AI_PANEL_GROUNDED_TAG = undefined
    expect(groundedPanelTag()).toBeNull()
    mutable.AI_PANEL_GROUNDED_TAG = tag

    const url = mutable.NEWS_INDEXER_URL
    mutable.NEWS_INDEXER_URL = undefined
    expect(groundedPanelTag()).toBeNull()
    mutable.NEWS_INDEXER_URL = url
  })
})

describe('retrievePanelContext', () => {
  it('queries /search with the claim text and maps hits into the snapshot', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [HIT] })

    const snapshot = await retrievePanelContext('Will the Knesset dissolve?', NOW)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://indexer.test/search?q=Will%20the%20Knesset%20dissolve%3F&limit=5')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k')
    expect(snapshot).toEqual({
      query: 'Will the Knesset dissolve?',
      retrievedAt: NOW.toISOString(),
      articles: [article()],
    })
  })

  it('treats an empty result as a real "no matching news" snapshot, not a failure', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] })
    const snapshot = await retrievePanelContext('claim', NOW)
    expect(snapshot).toEqual({ query: 'claim', retrievedAt: NOW.toISOString(), articles: [] })
  })

  it('returns null on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    expect(await retrievePanelContext('claim', NOW)).toBeNull()
  })

  it('returns null when the request throws (down, timeout)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await retrievePanelContext('claim', NOW)).toBeNull()
  })
})

describe('contextFingerprint', () => {
  const snapshot = (articles: PanelContextArticle[], retrievedAt: string): PanelContextSnapshot => ({
    query: 'q',
    retrievedAt,
    articles,
  })

  it('is stable across retrieval instants — only the articles are input', () => {
    const a = snapshot([article()], '2026-07-12T04:43:00Z')
    const b = snapshot([article()], '2026-07-12T16:43:00Z')
    expect(contextFingerprint(a)).toBe(contextFingerprint(b))
  })

  it('changes when the article set changes', () => {
    const a = snapshot([article()], NOW.toISOString())
    const b = snapshot([article({ snippet: 'Updated wording.' })], NOW.toISOString())
    expect(contextFingerprint(a)).not.toBe(contextFingerprint(b))
  })
})

describe('formatArticlesBlock', () => {
  it('renders numbered source/date/title/snippet entries', () => {
    const block = formatArticlesBlock([article(), article({ source: '', publishedDate: '' })])
    expect(block).toContain('1. [ynet, 2026-07-11] Knesset dissolution vote scheduled')
    expect(block).toContain('The vote is expected on Wednesday.')
    // Missing metadata degrades readably instead of rendering empty brackets.
    expect(block).toContain('2. [unknown]')
  })

  it('says so explicitly when the index had nothing', () => {
    expect(formatArticlesBlock([])).toBe('(no matching articles in the news index)')
  })
})
