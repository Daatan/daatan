import { describe, it, expect, vi } from 'vitest'
import en from '../../../../../messages/en.json'
import he from '../../../../../messages/he.json'
import ru from '../../../../../messages/ru.json'
import eo from '../../../../../messages/eo.json'

const MESSAGES: Record<string, unknown> = { en, he, ru, eo }
const requested: (string | undefined)[] = []

// Resolves keys from the real message files, so a page that forgets to pass its URL locale
// gets English (the cookie-less negotiation result) and fails the he/ru assertions below.
vi.mock('next-intl/server', () => ({
  getTranslations: async (arg: string | { locale: string; namespace: string }) => {
    const { locale, namespace } = typeof arg === 'string' ? { locale: undefined, namespace: arg } : arg
    requested.push(locale)
    const root = MESSAGES[locale ?? 'en']
    return (key: string) =>
      `${namespace}.${key}`.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], root)
  },
}))

import { generateMetadata as localeIndexMeta } from '../page'
import { generateMetadata as localeUkraineMeta } from '../ukraine-2022/page'
import { generateMetadata as localeIsraelMeta } from '../israel-2022/page'
import { generateMetadata as localeEnergyMeta } from '../energy-2022/page'
import { generateMetadata as enIndexMeta } from '@/app/retroanalysis/layout'
import { generateMetadata as enUkraineMeta } from '@/app/retroanalysis/ukraine-2022/page'
import { retroHref } from '@/app/retroanalysis/links'

const params = (locale: string) => ({ params: Promise.resolve({ locale }) })

describe('localized retroanalysis metadata (daatan#2249)', () => {
  it('renders the URL locale, not the negotiated one', async () => {
    const meta = await localeUkraineMeta(params('he'))
    expect(meta.title).toEqual({ absolute: he.retroUkraine.meta.title })
    expect(meta.description).toBe(he.retroUkraine.meta.description)
    expect(requested.at(-1)).toBe('he')
  })

  it('gives every case study a self-canonical and the full en/he/ru hreflang set', async () => {
    for (const [fn, path] of [
      [localeUkraineMeta, '/retroanalysis/ukraine-2022'],
      [localeIsraelMeta, '/retroanalysis/israel-2022'],
      [localeEnergyMeta, '/retroanalysis/energy-2022'],
    ] as const) {
      const meta = await fn(params('ru'))
      expect(meta.alternates?.canonical).toBe(`/ru${path}`)
      expect(meta.alternates?.languages).toEqual({ 'x-default': path, en: path, he: `/he${path}`, ru: `/ru${path}` })
      expect(meta.openGraph).toMatchObject({ url: `/ru${path}`, type: 'article', locale: 'ru_RU' })
    }
  })

  it('lets the index take the root " | DAATAN" title template', async () => {
    const meta = await localeIndexMeta(params('ru'))
    expect(meta.title).toBe(ru.retroIndex.meta.title)
    expect(meta.alternates?.canonical).toBe('/ru/retroanalysis')
  })

  it('keeps the English pages canonical at the root, now with the hreflang twins', async () => {
    const index = await enIndexMeta()
    expect(index.alternates?.canonical).toBe('/retroanalysis')
    expect(index.alternates?.languages).toMatchObject({ he: '/he/retroanalysis', ru: '/ru/retroanalysis' })
    const ukraine = await enUkraineMeta()
    expect(ukraine.title).toEqual({ absolute: en.retroUkraine.meta.title })
    expect(ukraine.alternates?.canonical).toBe('/retroanalysis/ukraine-2022')
    expect(requested.at(-1)).toBeUndefined()
  })
})

describe('retroHref', () => {
  it('keeps English at the root and prefixes the other locales', () => {
    expect(retroHref('en', '/retroanalysis/israel-2022')).toBe('/retroanalysis/israel-2022')
    expect(retroHref('he', '/retroanalysis')).toBe('/he/retroanalysis')
    expect(retroHref('eo', '/retroanalysis/energy-2022')).toBe('/eo/retroanalysis/energy-2022')
  })
})
