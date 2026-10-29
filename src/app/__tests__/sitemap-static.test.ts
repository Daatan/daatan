import { describe, it, expect, vi } from 'vitest'

vi.mock('next/server', () => ({ connection: vi.fn() }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }))
vi.mock('@/env', () => ({ env: { APP_ENV: 'production' } }))
vi.mock('@/lib/branding', () => ({ getAppUrl: () => 'https://daatan.com' }))
vi.mock('@/lib/prisma', () => {
  const empty = { findMany: vi.fn().mockResolvedValue([]) }
  return { prisma: { prediction: empty, predictionTranslation: empty, user: empty, tag: empty } }
})

import sitemap from '../sitemap'

async function urls(): Promise<string[]> {
  return (await sitemap()).map((e) => e.url)
}

describe('sitemap static routes (daatan#2057)', () => {
  it('lists the site root per locale, not the /home-v5 paths it serves', async () => {
    const list = await urls()
    expect(list).toEqual(expect.arrayContaining(['https://daatan.com', 'https://daatan.com/he', 'https://daatan.com/ru']))
    expect(list.filter((u) => u.includes('home-v5'))).toEqual([])
  })

  it('lists legal pages in English only while /he and /ru render the English text', async () => {
    const list = await urls()
    expect(list).toEqual(expect.arrayContaining(['https://daatan.com/privacy', 'https://daatan.com/terms', 'https://daatan.com/disclaimer']))
    expect(list.filter((u) => /\/(he|ru)\/(privacy|terms|disclaimer)$/.test(u))).toEqual([])
  })
})
