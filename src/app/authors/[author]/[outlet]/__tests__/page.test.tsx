import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSourceLeaderboard, mockGetPublicArticles, mockNotFound } = vi.hoisted(() => ({
  mockGetSourceLeaderboard: vi.fn(),
  mockGetPublicArticles: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/lib/services/sourceLeaderboard', () => ({ getSourceLeaderboard: mockGetSourceLeaderboard }))
vi.mock('@/lib/services/evidence-pool', () => ({ getPublicArticlesByAuthorOutlet: mockGetPublicArticles }))
vi.mock('next/navigation', () => ({ notFound: mockNotFound }))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://daatan.com' }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import AuthorPublicPage, { generateMetadata } from '../page'

const sampleRow = {
  id: 'Ben Caspit — maariv',
  author: 'Ben Caspit',
  outletName: 'maariv',
  skillConservative: 0.01,
  brierScore: 0.49,
  predictions: 1,
  articles: 3,
}

describe('authors/[author]/[outlet] page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPublicArticles.mockResolvedValue([])
  })

  const params = Promise.resolve({ author: 'Ben Caspit', outlet: 'maariv' })

  it('generateMetadata returns noindex when no matching row exists', async () => {
    mockGetSourceLeaderboard.mockResolvedValue({ authorRows: [], outletRows: [] })
    const metadata = await generateMetadata({ params })
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('generateMetadata returns a canonical URL for a known author+outlet pair', async () => {
    mockGetSourceLeaderboard.mockResolvedValue({ authorRows: [sampleRow], outletRows: [] })
    const metadata = await generateMetadata({ params })
    expect(metadata.alternates).toEqual({ canonical: 'https://daatan.com/authors/Ben%20Caspit/maariv' })
  })

  it('calls notFound() when no row matches the (author, outlet) pair', async () => {
    mockGetSourceLeaderboard.mockResolvedValue({ authorRows: [], outletRows: [] })
    await expect(AuthorPublicPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('does not match a same-named author at a different outlet', async () => {
    mockGetSourceLeaderboard.mockResolvedValue({
      authorRows: [{ ...sampleRow, outletName: 'ynet' }],
      outletRows: [],
    })
    await expect(AuthorPublicPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders when the (author, outlet) pair exists', async () => {
    mockGetSourceLeaderboard.mockResolvedValue({ authorRows: [sampleRow], outletRows: [] })
    await expect(AuthorPublicPage({ params })).resolves.toBeTruthy()
    expect(mockNotFound).not.toHaveBeenCalled()
    expect(mockGetPublicArticles).toHaveBeenCalledWith('Ben Caspit', 'maariv')
  })

  it('decodes URL-encoded author/outlet segments before matching', async () => {
    mockGetSourceLeaderboard.mockResolvedValue({ authorRows: [sampleRow], outletRows: [] })
    await AuthorPublicPage({
      params: Promise.resolve({ author: encodeURIComponent('Ben Caspit'), outlet: encodeURIComponent('maariv') }),
    })
    expect(mockGetPublicArticles).toHaveBeenCalledWith('Ben Caspit', 'maariv')
  })
})
