import { notFound } from 'next/navigation'
import { globalKeywords } from '@/lib/forecast-seo'
import { NextIntlClientProvider } from 'next-intl'
import type { Metadata } from 'next'
import { getAppUrl } from '@/lib/branding'

/**
 * Locale sub-routes: /he/... and /ru/...
 *
 * Safety invariant: this layout calls notFound() for any segment that is NOT
 * an explicitly supported non-default locale. This prevents arbitrary path
 * segments (e.g. /about, /profile) from accidentally matching this dynamic
 * route and producing 404-looking pages.
 *
 * No next-intl middleware is used — these pages are served by Next.js static
 * segment priority. English routes are completely unaffected.
 */

const ALLOWED_LOCALES = ['he', 'ru', 'eo'] as const
type AllowedLocale = (typeof ALLOWED_LOCALES)[number]

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const appUrl = getAppUrl()
  return {
    // Locale-specific site keywords; without this every /he/* and /ru/* page that
    // doesn't set its own would inherit the root layout's English set.
    keywords: globalKeywords(locale),
    // eo is supported for UI purposes but excluded from Google indexing
    ...(locale === 'eo' ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      languages: {
        'x-default': appUrl,
        en: appUrl,
        he: `${appUrl}/he`,
        ru: `${appUrl}/ru`,
      },
    },
    openGraph: {
      locale,
    },
  }
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params

  if (!ALLOWED_LOCALES.includes(locale as AllowedLocale)) {
    notFound()
  }

  const messages =
    locale === 'he'
      ? (await import('../../../messages/he.json')).default
      : locale === 'eo'
        ? (await import('../../../messages/eo.json')).default
        : (await import('../../../messages/ru.json')).default

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
