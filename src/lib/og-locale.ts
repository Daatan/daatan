// og:locale is language_TERRITORY (ogp.me); a bare "he" or "ru" is not a value Facebook
// or LinkedIn recognise, so they fall back to en_US.
const OG_LOCALES: Record<string, string> = {
  en: 'en_US',
  he: 'he_IL',
  ru: 'ru_RU',
  eo: 'eo_EO',
}

export function ogLocale(locale: string): string {
  return OG_LOCALES[locale] ?? 'en_US'
}
