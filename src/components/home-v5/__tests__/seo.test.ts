import { describe, it, expect, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://daatan.com' }))

import { homeV5Metadata } from '../meta'
import { buildSiteJsonLd } from '../seo'

describe('home-v5 metadata', () => {
  it.each([
    ['en', 'https://daatan.com'],
    ['he', 'https://daatan.com/he'],
    ['ru', 'https://daatan.com/ru'],
  ])('canonicalizes to the site root and has a share image for %s', async (locale, canonical) => {
    const m = await homeV5Metadata(locale)
    expect(m.alternates?.canonical).toBe(canonical)
    expect(m.alternates?.languages).toMatchObject({
      'x-default': 'https://daatan.com',
      he: 'https://daatan.com/he',
      ru: 'https://daatan.com/ru',
    })
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ url: 'https://daatan.com/opengraph-image' })])
    expect(m.twitter?.images).toEqual(['https://daatan.com/opengraph-image'])
  })
})

describe('buildSiteJsonLd', () => {
  it('describes the organization and a WebSite with a search action', () => {
    const ld = buildSiteJsonLd('https://daatan.com', 'he')
    const site = ld['@graph'].find((n) => n['@type'] === 'WebSite')
    expect(ld['@graph'].map((n) => n['@type'])).toEqual(['Organization', 'WebSite'])
    expect(site?.url).toBe('https://daatan.com')
    expect(site?.inLanguage).toBe('he')
    expect(site?.potentialAction?.target.urlTemplate).toBe('https://daatan.com/forecasts?q={search_term_string}')
  })
})
