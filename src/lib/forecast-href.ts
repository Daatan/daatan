import { locales } from '@/i18n/config'

/**
 * A forecast page in the reader's language. English lives at the root; he/ru/eo have their own
 * `/[locale]/forecasts/[id]` route, so a card on a Hebrew page links the Hebrew page and crawlers
 * reach translated pages through links, not only through the sitemap (daatan#2336).
 *
 * Unlike `toForecastLinks` (crawl-links.ts) this does not check that a translation exists: a card
 * shown on a locale page requests one, and on 2026-11-25 1 of 338 he/ru list cards led to an
 * untranslated (noindex) page.
 */
export function forecastHref(slugOrId: string, locale: string): string {
  const path = `/forecasts/${slugOrId}`
  return locale !== 'en' && (locales as readonly string[]).includes(locale) ? `/${locale}${path}` : path
}
