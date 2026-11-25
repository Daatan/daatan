import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetPublicOutletDetail, mockGetSourceLeaderboard, mockNotFound, mockForecastRows, mockForecastLinks, mockLocale,
  mockBoardOutlets,
} = vi.hoisted(() => ({
  mockGetPublicOutletDetail: vi.fn(),
  mockGetSourceLeaderboard: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  mockForecastRows: vi.fn(),
  mockForecastLinks: vi.fn(),
  mockLocale: { value: 'en' },
  mockBoardOutlets: vi.fn(),
}))

vi.mock('@/lib/services/outlets', () => ({ getPublicOutletDetail: mockGetPublicOutletDetail }))
vi.mock('@/lib/services/outlet-forecasts', () => ({
  getOutletForecastRows: mockForecastRows,
  getPublicForecastLinks: mockForecastLinks,
}))
vi.mock('@/lib/services/sourceLeaderboard', () => ({
  getSourceLeaderboard: mockGetSourceLeaderboard,
  canonicalOutlet: (n: string) => (n === 'ynetnews.com' ? 'ynet.co.il' : n),
  authorsOfOutlet: () => [],
}))
vi.mock('@/lib/services/leaderboard-cached', () => ({
  SOURCE_LEADERBOARD_MIN_PREDICTIONS: 4,
  getBoardOutlets: mockBoardOutlets,
}))
vi.mock('@/lib/services/sourceTopicBoards', () => ({
  getTopicBoards: async () => [],
  outletTopicRecords: () => [],
}))
vi.mock('@/components/sources/TopicBreakdown', () => ({ default: () => null }))
vi.mock('@/components/sources/OutletForecastTable', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ notFound: mockNotFound }))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://daatan.com' }))
// key → key, or `key {json}` when the call passes values, so a test can see both.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  getLocale: async () => mockLocale.value,
}))

import OutletPublicPage, { generateMetadata } from '../page'

const sampleDetail = {
  name: 'maariv',
  displayName: {},
  description: {},
  wikipediaUrl: null,
  telegramChannel: null,
  links: [],
  sourceConfig: null,
  domains: [],
  impact: { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null },
  publications: [],
  linkedPeople: [],
}

const outletRow = (outletName: string, brierScore: number, predictions: number) => ({
  id: outletName, outletName, skillConservative: 0.05, brierScore, authorCount: 3, predictions, articles: 40,
})

/** Every string/number in a React element tree (props, not component internals). */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  else if (Array.isArray(node)) node.forEach(n => collectText(n, out))
  else if (node && typeof node === 'object' && 'props' in node) {
    for (const v of Object.values((node as { props: Record<string, unknown> }).props)) collectText(v, out)
  }
  return out
}

/** Props of the first element in the tree that satisfies `match`. */
function findProps(node: unknown, match: (p: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(n => findProps(n, match)).find(Boolean)
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined
  const props = (node as { props: Record<string, unknown> }).props
  return match(props) ? props : Object.values(props).map(v => findProps(v, match)).find(Boolean)
}

describe('sources/[name] page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale.value = 'en'
    mockGetSourceLeaderboard.mockResolvedValue({ view: 'outlets', sortBy: 'skillConservative', authorRows: [], outletRows: [] })
    mockForecastRows.mockResolvedValue([])
    mockForecastLinks.mockResolvedValue(new Map())
    mockBoardOutlets.mockResolvedValue([])
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

  it('generateMetadata indexes an outlet on the public board, without a second brand (daatan#2337)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    mockBoardOutlets.mockResolvedValue([outletRow('ynetnews.com', 0.2, 30), outletRow('maariv', 0.281, 21)])
    const metadata = await generateMetadata({ params })
    expect(metadata.robots).toEqual({ index: true })
    expect(metadata.title).toBe('maariv — source profile')
  })

  it('generateMetadata leads the snippet with the board numbers, then the outlet description (daatan#2339)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, description: { en: 'Israeli daily.' } })
    mockBoardOutlets.mockResolvedValue([outletRow('ynetnews.com', 0.2, 30), outletRow('maariv', 0.281, 21)])
    const metadata = await generateMetadata({ params })
    expect(metadata.description).toBe(
      'metaBoard {"name":"maariv","brier":"0.28","count":21,"rank":2,"total":2} Israeli daily.',
    )
  })

  it('generateMetadata keeps the generic snippet for an outlet off the board', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    const metadata = await generateMetadata({ params })
    expect(metadata.description).toBe('Track record, publications, and identity info for maariv on Daatan.')
  })

  it('generateMetadata finds the board row through a domain, as the page body does (#1891)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, name: 'Ynet', domains: ['ynet.co.il'] })
    mockBoardOutlets.mockResolvedValue([outletRow('ynet.co.il', 0.15, 40)])
    const metadata = await generateMetadata({ params: Promise.resolve({ name: 'Ynet' }) })
    expect(metadata.robots).toEqual({ index: true })
  })

  it('generateMetadata keeps an outlet below the board threshold out of search (daatan#2337)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    mockBoardOutlets.mockResolvedValue([outletRow('ynetnews.com', 0.2, 30)])
    const metadata = await generateMetadata({ params })
    expect(metadata.robots).toEqual({ index: false })
  })

  it('titles and describes the page in the reader’s language, falling back to English', async () => {
    mockLocale.value = 'he'
    mockGetPublicOutletDetail.mockResolvedValue({
      ...sampleDetail,
      displayName: { en: 'Maariv', he: 'מעריב' },
      description: { en: 'Israeli daily.' },
    })
    const metadata = await generateMetadata({ params })
    expect(metadata.title).toBe('מעריב — source profile')
    expect(metadata.description).toBe('Israeli daily.')
  })

  it('calls notFound() for an unknown outlet', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(null)
    await expect(OutletPublicPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('renders when the outlet exists, even with no track record yet', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    const texts = collectText(await OutletPublicPage({ params }))
    expect(mockNotFound).not.toHaveBeenCalled()
    expect(texts).toContain('maariv')
    expect(texts).toContain('noTrackRecord')
    expect(texts).toContain('noForecasts')
  })

  it('decodes a URL-encoded outlet name before looking it up', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    await OutletPublicPage({ params: Promise.resolve({ name: encodeURIComponent('some/outlet') }) })
    expect(mockGetPublicOutletDetail).toHaveBeenCalledWith('some/outlet')
  })

  it('shows the display name and description when news-indexer has them', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({
      ...sampleDetail, displayName: { en: 'Maariv' }, description: { en: 'Israeli daily.' },
    })
    const texts = collectText(await OutletPublicPage({ params }))
    expect(texts).toContain('Maariv')
    expect(texts).toContain('Israeli daily.')
  })

  it('grades the track record in words, found through a domain when the URL carries the name (#1891)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, name: 'Ynet', domains: ['ynet.co.il'] })
    mockGetSourceLeaderboard.mockResolvedValue({
      view: 'outlets',
      sortBy: 'skillConservative',
      authorRows: [],
      outletRows: [outletRow('jpost.com', 0.15, 40), outletRow('tiny.com', 0.1, 2), outletRow('ynet.co.il', 0.433, 29)],
    })
    const texts = collectText(await OutletPublicPage({ params: Promise.resolve({ name: 'Ynet' }) }))
    expect(texts).toContain('grade.poor')
    expect(texts).toContain('gradeNote {"brier":"0.43","count":29}')
    expect(texts).toContain('lowSample')
    // Ranked as the board shows it: tiny.com sits under the 4-prediction floor.
    expect(texts).toContain('rankValue {"rank":2,"total":2}')
    expect(texts).not.toContain('noTrackRecord')
  })

  it('sums the forecast table into the header stats', async () => {
    mockGetPublicOutletDetail.mockResolvedValue(sampleDetail)
    mockForecastRows.mockResolvedValue([
      { forecastId: 'a', href: '/forecasts/a', title: 'A', state: 'cameTrue', articles: 3, lean: 70, trend: [70], lastArticle: '2026-11-20' },
      { forecastId: 'b', href: '/forecasts/b', title: 'B', state: 'open', articles: 2, lean: 40, trend: [40], lastArticle: '2026-11-02' },
    ])
    const tree = await OutletPublicPage({ params })
    const stat = (label: string) => findProps(tree, p => p.label === label)?.value
    expect(stat('forecastsCovered')).toBe('2')
    expect(stat('articlesCited')).toBe('5')
    expect(stat('lastArticle')).toMatch(/Nov 20, 2026/)
    // Open forecasts first by default.
    const rows = findProps(tree, p => Array.isArray(p.rows))?.rows as { forecastId: string }[]
    expect(rows.map(r => r.forecastId)).toEqual(['b', 'a'])
  })

  it('lists an article that fed two forecasts once, linking each by its public title (#2292)', async () => {
    const pub = { title: 'Zelenskyy on four-party talks', url: 'https://example.com/a', source: 'example.com', publishedAt: '2026-11-20T10:00:00Z', pushedAt: null, outcome: null }
    mockGetPublicOutletDetail.mockResolvedValue({
      ...sampleDetail,
      publications: [
        { ...pub, forecastId: 'f1' },
        { ...pub, forecastId: 'f2', outcome: 'YES' },
        { ...pub, forecastId: 'private' },
      ],
    })
    mockForecastLinks.mockResolvedValue(new Map([
      ['f1', { href: '/forecasts/slug-f1', title: 'Talks happen by March', status: 'ACTIVE' }],
      ['f2', { href: '/forecasts/slug-f2', title: 'Ceasefire holds', status: 'RESOLVED_CORRECT' }],
    ]))
    const texts = collectText(await OutletPublicPage({ params }))
    expect(mockForecastLinks).toHaveBeenCalledWith(['f1', 'f2', 'private'], 'en')
    expect(texts.filter((x) => x === 'Zelenskyy on four-party talks')).toHaveLength(1)
    expect(texts).toContain('Talks happen by March')
    expect(texts).toContain('Ceasefire holds')
    expect(texts).toContain('outcomeYes')
    expect(texts).toContain('/forecasts/slug-f2')
    expect(texts.some((x) => x.includes('private'))).toBe(false)
  })

  it('lets a Hebrew title set its own direction on an English page (#2292)', async () => {
    const url = 'https://ynet.co.il/a'
    mockGetPublicOutletDetail.mockResolvedValue({
      ...sampleDetail,
      publications: [{ title: 'הדמוקרטים: "מוכר את הביטחון"', url, source: 'ynet.co.il', publishedAt: null, pushedAt: null, outcome: null, forecastId: 'f1' }],
    })
    expect(findProps(await OutletPublicPage({ params }), p => p.href === url)?.dir).toBe('auto')
  })

  it('says the rank is head-to-head, apart from the Brier grade (daatan#2339)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, name: 'kikar.co.il', domains: ['kikar.co.il'] })
    mockGetSourceLeaderboard.mockResolvedValue({
      view: 'outlets', sortBy: 'skillConservative', authorRows: [],
      outletRows: [outletRow('a.com', 0.2, 40), outletRow('kikar.co.il', 0.28, 21)],
    })
    const tree = await OutletPublicPage({ params: Promise.resolve({ name: 'kikar.co.il' }) })
    const rank = findProps(tree, p => p.label === 'rankLabel')
    expect(rank?.value).toBe('rankValue {"rank":2,"total":2}')
    expect(rank?.note).toBe('rankNote')
    expect(findProps(tree, p => p.label === 'trackRecord')?.value).toBe('grade.poor')
  })

  it('describes the outlet in identity-only JSON-LD (daatan#2339)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({
      ...sampleDetail, name: 'Ynet', displayName: { en: 'Ynet' }, domains: ['ynet.co.il'],
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Ynet', telegramChannel: 'ynetalerts',
    })
    const tree = await OutletPublicPage({ params: Promise.resolve({ name: 'Ynet' }) })
    const data = findProps(tree, p => typeof p.data === 'object' && p.data !== null && '@type' in p.data)?.data
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      url: 'https://daatan.com/sources/Ynet',
      name: 'Ynet — source profile',
      about: {
        '@type': 'Organization',
        name: 'Ynet',
        url: 'https://ynet.co.il',
        logo: 'https://daatan.com/outlet-logos/ynet.co.il.png',
        sameAs: ['https://en.wikipedia.org/wiki/Ynet', 'https://t.me/ynetalerts'],
      },
    })
  })

  it('shows the bundled logo on a light plate in place of the letter avatar (daatan#2341)', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, name: 'Ynet', domains: ['ynet.co.il'] })
    const tree = await OutletPublicPage({ params: Promise.resolve({ name: 'Ynet' }) })
    const img = findProps(tree, p => p.src === '/outlet-logos/ynet.co.il.png')
    expect(img).toMatchObject({ alt: '', width: 93, height: 40 })
    expect(collectText(tree)).not.toContain('Y')
  })

  it('finds the logo through an alias domain', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, name: 'Ynetnews', domains: ['ynetnews.com'] })
    const tree = await OutletPublicPage({ params: Promise.resolve({ name: 'Ynetnews' }) })
    expect(findProps(tree, p => p.src === '/outlet-logos/ynet.co.il.png')).toBeDefined()
  })

  it('keeps the letter avatar and no JSON-LD logo when the outlet has no logo', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, domains: ['maariv.co.il'] })
    const tree = await OutletPublicPage({ params })
    expect(findProps(tree, p => typeof p.src === 'string' && p.src.startsWith('/outlet-logos/'))).toBeUndefined()
    expect(collectText(tree)).toContain('M')
    const data = findProps(tree, p => typeof p.data === 'object' && p.data !== null && '@type' in p.data)?.data as
      { about: Record<string, unknown> }
    expect(data.about).not.toHaveProperty('logo')
  })

  it('links a Telegram channel stored as a full URL without prefixing it again', async () => {
    mockGetPublicOutletDetail.mockResolvedValue({ ...sampleDetail, telegramChannel: 'https://t.me/ynetnewslatest' })
    const texts = collectText(await OutletPublicPage({ params }))
    expect(texts).toContain('https://t.me/ynetnewslatest')
    expect(texts.some((x) => x.includes('t.me/https'))).toBe(false)
  })
})
