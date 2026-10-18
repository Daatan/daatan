import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetPublicOutletDetail, mockGetSourceLeaderboard, mockNotFound } = vi.hoisted(() => ({
  mockGetPublicOutletDetail: vi.fn(),
  mockGetSourceLeaderboard: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/lib/services/outlets', () => ({ getPublicOutletDetail: mockGetPublicOutletDetail }))
vi.mock('@/lib/services/sourceLeaderboard', () => ({
  getSourceLeaderboard: mockGetSourceLeaderboard,
  canonicalOutlet: (n: string) => n,
  authorsOfOutlet: () => [],
}))
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
  domains: [],
  impact: { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null },
  publications: [],
  linkedPeople: [],
}

/** Every string/number in a React element tree (props, not component internals). */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  else if (Array.isArray(node)) node.forEach(n => collectText(n, out))
  else if (node && typeof node === 'object' && 'props' in node) {
    for (const v of Object.values((node as { props: Record<string, unknown> }).props)) collectText(v, out)
  }
  return out
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

  it('finds the track record through a domain when the URL carries the display name (#1891)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, name: 'Ynet', domains: ['ynet.co.il'] })
    mockGetSourceLeaderboard.mockResolvedValue({
      view: 'outlets',
      sortBy: 'skillConservative',
      authorRows: [],
      outletRows: [{ id: 'ynet.co.il', outletName: 'ynet.co.il', skillConservative: 0.078, brierScore: 0.433, authorCount: 25, predictions: 29, articles: 40 }],
    })
    const texts = collectText(await OutletPublicPage({ params: Promise.resolve({ name: 'Ynet' }) }))
    expect(texts).toContain('0.078')
    expect(texts).not.toContain('noTrackRecord')
  })
})
