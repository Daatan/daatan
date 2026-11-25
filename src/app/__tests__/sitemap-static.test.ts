import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({ connection: vi.fn() }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }))
vi.mock('@/env', () => ({ env: { APP_ENV: 'production' } }))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://daatan.com' }))
vi.mock('@/lib/prisma', () => {
  const empty = { findMany: vi.fn().mockResolvedValue([]) }
  return { prisma: { prediction: empty, predictionTranslation: empty, user: empty, tag: empty } }
})

const { mockBoardOutlets } = vi.hoisted(() => ({ mockBoardOutlets: vi.fn() }))
vi.mock('@/lib/services/leaderboard-cached', () => ({ getBoardOutlets: mockBoardOutlets }))

import sitemap from '../sitemap'

async function urls(): Promise<string[]> {
  return (await sitemap()).map((e) => e.url)
}

describe('sitemap static routes (daatan#2057)', () => {
  beforeEach(() => {
    mockBoardOutlets.mockReset().mockResolvedValue([])
  })

  it('lists the site root per locale, not the /home paths it serves', async () => {
    const list = await urls()
    expect(list).toEqual(expect.arrayContaining(['https://daatan.com', 'https://daatan.com/he', 'https://daatan.com/ru']))
    expect(list.filter((u) => u.includes('home-v5'))).toEqual([])
  })

  it('lists legal pages in English only while /he and /ru render the English text', async () => {
    const list = await urls()
    expect(list).toEqual(expect.arrayContaining(['https://daatan.com/privacy', 'https://daatan.com/terms', 'https://daatan.com/disclaimer']))
    expect(list.filter((u) => /\/(he|ru)\/(privacy|terms|disclaimer)$/.test(u))).toEqual([])
  })

  it('lists the "Who foresaw X?" hub but none of its noindex event pages (daatan#2217)', async () => {
    const list = await urls()
    expect(list).toContain('https://daatan.com/who-foresaw')
    expect(list.filter((u) => u.includes('/who-foresaw/'))).toEqual([])
  })

  it('lists the retro case studies in en/he/ru with hreflang, but not the eo copies (daatan#2249)', async () => {
    const entries = await sitemap()
    const retro = entries.filter((e) => e.url.includes('/retroanalysis'))
    expect(retro).toHaveLength(12)
    expect(retro.filter((e) => e.url.includes('/eo/'))).toEqual([])
    const he = retro.find((e) => e.url === 'https://daatan.com/he/retroanalysis/ukraine-2022')
    expect(he?.alternates?.languages).toMatchObject({
      en: 'https://daatan.com/retroanalysis/ukraine-2022',
      ru: 'https://daatan.com/ru/retroanalysis/ukraine-2022',
    })
  })
})

describe('sitemap source pages (daatan#2337)', () => {
  beforeEach(() => {
    mockBoardOutlets.mockReset()
  })

  it('lists the sources board and each source page on it, at its canonical URL', async () => {
    mockBoardOutlets.mockResolvedValue([{ outletName: 'ynetnews.com' }, { outletName: 'Ben Caspit' }])
    const list = await urls()
    expect(list).toContain('https://daatan.com/leaderboard/sources')
    expect(list).toEqual(expect.arrayContaining([
      'https://daatan.com/sources/ynetnews.com',
      'https://daatan.com/sources/Ben%20Caspit',
    ]))
  })

  it('lists no source pages while the board is empty (the Oracul unreachable)', async () => {
    mockBoardOutlets.mockResolvedValue([])
    const list = await urls()
    expect(list).toContain('https://daatan.com/forecasts')
    expect(list.filter((u) => u.includes('/sources/'))).toEqual([])
  })
})
