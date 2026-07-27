import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetPublicOutletDetail, mockGetSourceLeaderboard, mockNotFound } = vi.hoisted(() => ({
  mockGetPublicOutletDetail: vi.fn(),
  mockGetSourceLeaderboard: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/lib/services/outlets', () => ({ getPublicOutletDetail: mockGetPublicOutletDetail }))
vi.mock('@/lib/services/sourceLeaderboard', () => ({ getSourceLeaderboard: mockGetSourceLeaderboard }))
vi.mock('next/navigation', () => ({ notFound: mockNotFound }))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://daatan.com' }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

import OutletPublicPage, { generateMetadata } from '../page'

const sampleDetail = {
  name: 'maariv',
  wikipediaUrl: null,
  telegramChannel: null,
  links: [],
  sourceConfig: null,
  impact: { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null },
  publications: [],
  linkedPeople: [],
}

describe('sources/[name] page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSourceLeaderboard.mockResolvedValue({ view: 'outlets', sortBy: 'skillConservative', authorRows: [], outletRows: [] })
  })

  const params = Promise.resolve({ name: 'maariv' })

  it('generateMetadata returns noindex for an unknown outlet', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(null)
    const metadata = await generateMetadata({ params })
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('generateMetadata returns a canonical URL for a known outlet', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    const metadata = await generateMetadata({ params })
    expect(metadata.alternates).toEqual({ canonical: 'https://daatan.com/sources/maariv' })
  })

  it('calls notFound() for an unknown outlet', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(null)
    await expect(OutletPublicPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('renders when the outlet exists, even with no track record yet', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    await expect(OutletPublicPage({ params })).resolves.toBeTruthy()
    expect(mockNotFound).not.toHaveBeenCalled()
  })

  it('decodes a URL-encoded outlet name before looking it up', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    await OutletPublicPage({ params: Promise.resolve({ name: encodeURIComponent('some/outlet') }) })
    expect(mockGetPublicOutletDetail).toHaveBeenCalledWith('some/outlet')
  })
})
