import type { Locale } from '@/i18n/config'

// Routes that exist under src/app/[locale]; everything else is served at the
// root path only, so a /he/elections link would 404.
const LOCALIZED = new Set(['/', '/about', '/forecasts', '/methodology', '/contact', '/privacy', '/terms'])

export function localePath(locale: Locale, path: string): string {
  if (locale === 'en' || !LOCALIZED.has(path)) return path
  return path === '/' ? `/${locale}` : `/${locale}${path}`
}

export type HomeLinks = ReturnType<typeof buildLinks>

export function buildLinks(locale: Locale) {
  const p = (path: string) => localePath(locale, path)
  return {
    home: p('/'),
    forecasts: p('/forecasts'),
    // No /sources index page yet (tracked in #1840) — the source leaderboard is the closest.
    sources: '/leaderboard',
    elections: '/elections',
    retro: '/retroanalysis',
    howItWorks: p('/methodology'),
    about: p('/about'),
    login: '/auth/signin',
    create: '/create',
    contact: p('/contact'),
    privacy: p('/privacy'),
    terms: p('/terms'),
  }
}
