import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetTagBySlug, mockGetVisibleCount, mockListForecasts, mockEnrichPredictions, mockNotFound } = vi.hoisted(() => ({
  mockGetTagBySlug: vi.fn(),
  mockGetVisibleCount: vi.fn(),
  mockListForecasts: vi.fn(),
  mockEnrichPredictions: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/lib/services/tag', () => ({
  getTagBySlug: mockGetTagBySlug,
  getVisibleTagPredictionCount: mockGetVisibleCount,
}))
vi.mock('@/lib/services/forecast', () => ({
  listForecasts: mockListForecasts,
  enrichPredictions: mockEnrichPredictions,
}))
vi.mock('next/navigation', () => ({ notFound: mockNotFound }))
vi.mock('./TagFeed', () => ({ default: () => null }))
vi.mock('@/components/JsonLd', () => ({ JsonLd: () => null }))

import TagPage, { generateMetadata } from '../page'

describe('tags/[slug] page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVisibleCount.mockResolvedValue(0)
    mockListForecasts.mockResolvedValue({ predictions: [], total: 0 })
    mockEnrichPredictions.mockReturnValue([])
  })

  const params = Promise.resolve({ slug: 'chess' })
  const searchParams = Promise.resolve({})

  it('generateMetadata returns noindex for an unknown slug', async () => {
    mockGetTagBySlug.mockResolvedValue(null)

    const metadata = await generateMetadata({ params, searchParams })

    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(mockGetVisibleCount).not.toHaveBeenCalled()
  })

  it('generateMetadata returns noindex for a tag that has never had any predictions', async () => {
    mockGetTagBySlug.mockResolvedValue({ id: 't1', name: 'Chess', slug: 'chess', count: 0 })

    const metadata = await generateMetadata({ params, searchParams })

    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(mockGetVisibleCount).not.toHaveBeenCalled()
  })

  it('generateMetadata returns noindex when the tag has predictions but none are currently visible', async () => {
    mockGetTagBySlug.mockResolvedValue({ id: 't1', name: 'Chess', slug: 'chess', count: 3 })
    mockGetVisibleCount.mockResolvedValue(0)

    const metadata = await generateMetadata({ params, searchParams })

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('generateMetadata returns a real canonical when the tag has visible predictions', async () => {
    mockGetTagBySlug.mockResolvedValue({ id: 't1', name: 'Chess', slug: 'chess', count: 3 })
    mockGetVisibleCount.mockResolvedValue(3)

    const metadata = await generateMetadata({ params, searchParams })

    expect(metadata.robots).toBeUndefined()
    expect(metadata.alternates).toEqual({ canonical: 'https://daatan.com/tags/chess' })
  })

  it('calls notFound() for an unknown slug', async () => {
    mockGetTagBySlug.mockResolvedValue(null)

    await expect(TagPage({ params, searchParams })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('calls notFound() for a tag that has never had any predictions', async () => {
    mockGetTagBySlug.mockResolvedValue({ id: 't1', name: 'Chess', slug: 'chess', count: 0 })

    await expect(TagPage({ params, searchParams })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders (does not 404) when the tag exists with predictions, even if none currently visible', async () => {
    mockGetTagBySlug.mockResolvedValue({ id: 't1', name: 'Chess', slug: 'chess', count: 3 })
    mockListForecasts.mockResolvedValue({ predictions: [], total: 0 })

    await expect(TagPage({ params, searchParams })).resolves.toBeTruthy()
    expect(mockNotFound).not.toHaveBeenCalled()
  })
})
