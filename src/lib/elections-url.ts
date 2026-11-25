/** The standalone elections app (Daatan/elections). SaaS-only: hidden on self-host. */
export const ELECTIONS_URL = 'https://elections.daatan.com'

/**
 * The elections app in the viewer's language (daatan#2332). It reads the language only from
 * `?lang=en|ru`; the bare URL is Hebrew, and it has no Esperanto, which falls back to English.
 */
export function electionsUrl(locale: string): string {
  if (locale === 'he') return ELECTIONS_URL
  return `${ELECTIONS_URL}/?lang=${locale === 'ru' ? 'ru' : 'en'}`
}
