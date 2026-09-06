import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { negotiateLocale } from './negotiate'

/** Supported locales. */
export const locales = ['en', 'he', 'ru', 'eo'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'

function isLocale(value: string | undefined | null): value is Locale {
  return locales.includes(value as Locale)
}

export default getRequestConfig(async ({ requestLocale }) => {
  // A /he/… or /ru/… page names its locale explicitly — `getTranslations({ locale })` —
  // and next-intl hands that back here as `requestLocale`. It has to win: until it was
  // read, the cookie/Accept-Language locale below picked the messages instead, so
  // /he/terms rendered English text under Hebrew chrome for anyone whose browser was
  // not set to Hebrew (the client provider had the Hebrew messages, the server HTML
  // did not). Pages without an explicit locale — the English routes — still negotiate.
  const requested = await requestLocale
  if (isLocale(requested)) {
    return { locale: requested, messages: (await import(`../../messages/${requested}.json`)).default }
  }

  // Explicit choice (cookie set by the language picker) wins; without one,
  // follow the browser's Accept-Language, then fall back to English. The
  // detection is stateless — no cookie is written until the user picks.
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value

  const locale: Locale = isLocale(cookieLocale)
    ? cookieLocale
    : (negotiateLocale((await headers()).get('accept-language')) ?? defaultLocale)

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
