import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { negotiateLocale } from './negotiate'

/** Supported locales. */
export const locales = ['en', 'he', 'ru', 'eo'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'

export default getRequestConfig(async () => {
  // Explicit choice (cookie set by the language picker) wins; without one,
  // follow the browser's Accept-Language, then fall back to English. The
  // detection is stateless — no cookie is written until the user picks.
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value

  const locale: Locale = locales.includes(cookieLocale as Locale)
    ? (cookieLocale as Locale)
    : (negotiateLocale((await headers()).get('accept-language')) ?? defaultLocale)

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
