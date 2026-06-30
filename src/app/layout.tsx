import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Inter, Heebo } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import './globals.css'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })
// Hebrew glyphs aren't in Inter; Heebo covers them and matches Inter's geometry.
const heebo = Heebo({ subsets: ['hebrew', 'latin'], display: 'swap', variable: '--font-heebo' })
import { StagingBanner } from '@/components/StagingBanner'
import { NextBanner } from '@/components/NextBanner'
import Sidebar from '@/components/Sidebar'
import { MainContent } from '@/components/MainContent'
import SessionWrapper from '@/components/SessionWrapper'
import { CapabilitiesProvider } from '@/components/CapabilitiesProvider'
import { getCapabilities } from '@/lib/capabilities'
import { isSelfHosted } from '@/lib/edition'
import { BrandingProvider } from '@/components/BrandingProvider'
import PwaInstaller from '@/components/PwaInstaller'
import PushPermissionPrompt from '@/components/PushPermissionPrompt'
import GoogleAnalytics from '@/components/GoogleAnalytics'
import CookieConsent from '@/components/CookieConsent'
import AnalyticsUserSync from '@/components/AnalyticsUserSync'
import { Toaster } from 'react-hot-toast'
import { isRtl } from '@/i18n/config'
import type { Locale } from '@/i18n/config'

import { env } from '@/env'
import { getAppName, getAppUrl, getVerificationTokens, shouldIndex, getBranding } from '@/lib/branding'

export async function generateMetadata(): Promise<Metadata> {
  // SaaS keeps the literal DAATAN identity (these resolve byte-identically when
  // APP_* are unset); self-host overrides via APP_NAME / APP_URL.
  const appName = getAppName()
  const baseUrl = getAppUrl()
  const indexable = shouldIndex()
  const tokens = getVerificationTokens()
  const defaultTitle = `${appName} — Measurable Forecasts`
  const description =
    'Turn opinions into measurable forecasts. Track accuracy over time and build a public track record.'

  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: defaultTitle,
      template: `%s | ${appName}`,
    },
    description,
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/logo-icon.png', type: 'image/png', sizes: '512x512' },
      ],
      apple: '/apple-touch-icon.png',
    },
    // No PWA on self-host: the manifest is DAATAN-branded and installability
    // isn't wanted for an internal tool.
    ...(isSelfHosted() ? {} : { manifest: '/manifest.webmanifest' }),
    ...(tokens && {
      verification: {
        google: tokens.google,
        other: {
          'msvalidate.01': tokens.bing,
        },
      },
    }),
    openGraph: {
      type: 'website',
      siteName: appName,
      title: defaultTitle,
      description,
      url: baseUrl,
    },
    twitter: {
      card: 'summary_large_image',
      site: '@daatan_dev',
      title: defaultTitle,
      description,
    },
    alternates: {
      languages: {
        'x-default': baseUrl,
        'en': baseUrl,
        'he': `${baseUrl}/he`,
        'ru': `${baseUrl}/ru`,
      },
    },
    robots: {
      index: indexable,
      follow: indexable,
      googleBot: {
        index: indexable,
        follow: indexable,
      },
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

function localeFromPathname(pathname: string | null): Locale | null {
  if (!pathname) return null
  const match = pathname.match(/^\/(he|ru|eo)(\/|$)/)
  return (match?.[1] as Locale | undefined) ?? null
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Prefer URL-derived locale (set by middleware) over cookie so crawlers
  // see the correct <html lang> on /he and /ru pages.
  const headersList = await headers()
  const urlLocale = localeFromPathname(headersList.get('x-pathname'))
  const cookieLocale = (await getLocale()) as Locale
  const locale: Locale = urlLocale ?? cookieLocale
  const messages = await getMessages()
  const isStaging = env.NEXT_PUBLIC_ENV === 'staging'
  const gaMeasurementId = isStaging ? 'G-Z4XXM7GYHW' : (process.env.GA_MEASUREMENT_ID ?? '')

  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <body className={`${inter.variable} ${heebo.variable}`} suppressHydrationWarning>
        <GoogleAnalytics measurementId={gaMeasurementId} isStaging={isStaging} />
        <NextIntlClientProvider messages={messages}>
          <CapabilitiesProvider value={getCapabilities()}>
          <BrandingProvider value={getBranding()}>
          <SessionWrapper>
            <AnalyticsUserSync />
            <StagingBanner />
            <NextBanner />
            <div className="flex min-h-screen overflow-x-hidden">
              <Sidebar />
              <MainContent>{children}</MainContent>
            </div>
            {!isSelfHosted() && <PwaInstaller />}
            <PushPermissionPrompt />
            <CookieConsent />
            <Toaster position="bottom-right" />
          </SessionWrapper>
          </BrandingProvider>
          </CapabilitiesProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
