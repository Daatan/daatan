import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

const { mockGetFeedPage, mockNotFound } = vi.hoisted(() => ({
  mockGetFeedPage: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('../feed-page', async (orig) => ({
  ...(await orig<typeof import('../feed-page')>()),
  getFeedPage: mockGetFeedPage,
}))
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/services/forecast', () => ({ listForecasts: vi.fn(), enrichPredictions: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: mockNotFound }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('../PredictionsClient', () => ({ PredictionsPage: () => null }))
vi.mock('@/components/JsonLd', () => ({ JsonLd: () => null }))
vi.mock('@/lib/services/topic-counts', () => ({ getOpenTopicCounts: vi.fn(async () => ({ politics: 4 })) }))

import ForecastsPage, { generateMetadata } from '../page'

const sp = (page?: string) => ({ searchParams: Promise.resolve(page ? { page } : {}) })

describe('/forecasts page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFeedPage.mockResolvedValue({ predictions: [], total: 45, totalPages: 3 })
  })

  it('page 1 keeps the bare canonical; page N is self-canonical', async () => {
    expect((await generateMetadata(sp())).alternates?.canonical).toBe('/forecasts')
    expect((await generateMetadata(sp('2'))).alternates?.canonical).toBe('/forecasts?page=2')
  })

  it('fetches the requested page and passes prev/next links down', async () => {
    const out = (await ForecastsPage(sp('2'))) as ReactElement<{ children: ReactElement[] }>
    expect(mockGetFeedPage).toHaveBeenCalledWith(2)
    const client = out.props.children[1] as ReactElement<{ pagination: ReactElement<{ page: number; totalPages: number; base: string }> }>
    expect(isValidElement(client.props.pagination)).toBe(true)
    expect(client.props.pagination.props).toMatchObject({ base: '/forecasts', page: 2, totalPages: 3 })
  })

  it('keeps a topic-filtered view out of the index and hands the topic counts down (daatan#2330)', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ tags: 'Politics' }) })
    expect(meta.robots).toEqual({ index: false, follow: false })
    expect((await generateMetadata(sp())).robots).toBeUndefined()
    const out = (await ForecastsPage(sp())) as ReactElement<{ children: ReactElement[] }>
    const client = out.props.children[1] as ReactElement<{ topicCounts: Record<string, number> }>
    expect(client.props.topicCounts).toEqual({ politics: 4 })
  })

  it('404s a page past the end', async () => {
    await expect(ForecastsPage(sp('9'))).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
