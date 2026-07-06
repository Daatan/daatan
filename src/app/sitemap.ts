import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { env } from '@/env'
import { getAppUrl } from '@/lib/branding'

// Don't prerender at build time — DATABASE_URL is a placeholder during the
// Docker image build and Prisma can't reach it. Regenerate on demand instead.
export const dynamic = 'force-dynamic'

// Cache the DB queries for 1h so crawler hits don't hammer the DB.
// The route itself stays dynamic (avoids the build-time prerender problem
// that broke v1.10.76); only the data layer is cached.
const fetchSitemapData = unstable_cache(
  async () => {
    const [predictions, translatedPredictionIds, users, tags] = await Promise.all([
      prisma.prediction.findMany({
        where: {
          isPublic: true,
          status: { in: ['ACTIVE', 'PENDING', 'RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
        },
        select: { id: true, slug: true, status: true, updatedAt: true },
      }),
      prisma.predictionTranslation.findMany({
        where: { language: { in: ['he', 'ru'] } },
        select: { predictionId: true, language: true },
        distinct: ['predictionId', 'language'],
      }),
      prisma.user.findMany({
        where: { isPublic: true, username: { not: null } },
        select: { username: true, updatedAt: true },
      }),
      prisma.tag.findMany({
        where: {
          predictions: {
            some: {
              isPublic: true,
              status: { in: ['ACTIVE', 'PENDING', 'RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
            },
          },
        },
        select: {
          slug: true,
          predictions: { orderBy: { updatedAt: 'desc' }, take: 1, select: { updatedAt: true } },
        },
      }),
    ])
    return { predictions, translatedPredictionIds, users, tags }
  },
  ['sitemap-data'],
  { revalidate: 3600, tags: ['sitemap'] },
)

const BASE_URL = getAppUrl()

// Locales actively submitted to Google (eo intentionally excluded — low-value traffic)
const SITEMAP_LOCALES = ['he', 'ru'] as const

/** Build hreflang alternates for a path that has he/ru locale versions. */
function localizedAlternates(path: string) {
  return {
    'x-default': `${BASE_URL}${path}`,
    en: `${BASE_URL}${path}`,
    he: `${BASE_URL}/he${path}`,
    ru: `${BASE_URL}/ru${path}`,
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // APP_ENV, not NEXT_PUBLIC_ENV: staging and production run the same
  // promoted Docker image (build-time vars are frozen to whichever env built
  // it), so this must read the runtime-set instance var instead — see src/env.ts.
  const isProd = env.APP_ENV === 'production'

  // If not production, return empty sitemap to avoid indexing staging
  if (!isProd) {
    return []
  }

  // 1. Static routes (English)
  // Routes tagged with localized:true have /he and /ru counterparts in the sitemap.
  const staticRouteDefs = [
    { route: '',          lastModified: new Date(),              frequency: 'daily'   as const, priority: 1.0, localized: true  },
    { route: '/forecasts',lastModified: new Date(),              frequency: 'daily'   as const, priority: 0.8, localized: true  },
    { route: '/about',    lastModified: new Date('2026-03-26'), frequency: 'monthly' as const, priority: 0.8, localized: false },
    { route: '/methodology', lastModified: new Date('2026-07-05'), frequency: 'monthly' as const, priority: 0.6, localized: false },
    { route: '/leaderboard', lastModified: new Date(),           frequency: 'daily'   as const, priority: 0.8, localized: false },
    { route: '/activity', lastModified: new Date(),              frequency: 'daily'   as const, priority: 0.8, localized: false },
    { route: '/privacy',     lastModified: new Date('2026-03-26'), frequency: 'monthly' as const, priority: 0.3, localized: true  },
    { route: '/terms',       lastModified: new Date('2026-03-26'), frequency: 'monthly' as const, priority: 0.3, localized: true  },
    { route: '/disclaimer',  lastModified: new Date('2026-06-12'), frequency: 'monthly' as const, priority: 0.3, localized: true  },
    { route: '/accessibility', lastModified: new Date('2026-07-06'), frequency: 'monthly' as const, priority: 0.3, localized: false },
  ]

  const staticRoutes: MetadataRoute.Sitemap = staticRouteDefs.map(({ route, lastModified, frequency, priority, localized }) => ({
    url: `${BASE_URL}${route}`,
    lastModified,
    changeFrequency: frequency,
    priority,
    ...(localized ? { alternates: { languages: localizedAlternates(route) } } : {}),
  }))

  // 2. Locale static routes (he + ru only — eo excluded)
  const localeStaticRoutes: MetadataRoute.Sitemap = SITEMAP_LOCALES.flatMap((locale) => [
    {
      url: `${BASE_URL}/${locale}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.8,
      alternates: { languages: localizedAlternates('') },
    },
    {
      url: `${BASE_URL}/${locale}/forecasts`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
      alternates: { languages: localizedAlternates('/forecasts') },
    },
    {
      url: `${BASE_URL}/${locale}/privacy`,
      lastModified: new Date('2026-03-26'),
      changeFrequency: 'monthly' as const,
      priority: 0.3,
      alternates: { languages: localizedAlternates('/privacy') },
    },
    {
      url: `${BASE_URL}/${locale}/terms`,
      lastModified: new Date('2026-03-26'),
      changeFrequency: 'monthly' as const,
      priority: 0.3,
      alternates: { languages: localizedAlternates('/terms') },
    },
    {
      url: `${BASE_URL}/${locale}/disclaimer`,
      lastModified: new Date('2026-06-12'),
      changeFrequency: 'monthly' as const,
      priority: 0.3,
      alternates: { languages: localizedAlternates('/disclaimer') },
    },
  ])

  const { predictions, translatedPredictionIds, users, tags } = await fetchSitemapData()

  const translatedSet = new Set(
    translatedPredictionIds.map((t) => `${t.predictionId}:${t.language}`),
  )

  const resolvedStatuses = ['RESOLVED_CORRECT', 'RESOLVED_WRONG']

  const forecastRoutes: MetadataRoute.Sitemap = predictions.map((p) => {
    const slug = p.slug || p.id
    const isResolved = resolvedStatuses.includes(p.status)
    const hasHe = translatedSet.has(`${p.id}:he`)
    const hasRu = translatedSet.has(`${p.id}:ru`)
    return {
      url: `${BASE_URL}/forecasts/${slug}`,
      lastModified: p.updatedAt,
      changeFrequency: (isResolved ? 'monthly' : 'hourly') as 'monthly' | 'hourly',
      priority: isResolved ? 0.5 : 0.7,
      alternates: {
        languages: {
          'x-default': `${BASE_URL}/forecasts/${slug}`,
          en: `${BASE_URL}/forecasts/${slug}`,
          ...(hasHe ? { he: `${BASE_URL}/he/forecasts/${slug}` } : {}),
          ...(hasRu ? { ru: `${BASE_URL}/ru/forecasts/${slug}` } : {}),
        },
      },
    }
  })

  // 4. Locale forecast routes — only when a translation exists
  const localeForecastRoutes: MetadataRoute.Sitemap = predictions.flatMap((p) => {
    const slug = p.slug || p.id
    const isResolved = resolvedStatuses.includes(p.status)
    const hasHe = translatedSet.has(`${p.id}:he`)
    const hasRu = translatedSet.has(`${p.id}:ru`)
    return SITEMAP_LOCALES.flatMap((locale) => {
      if (!translatedSet.has(`${p.id}:${locale}`)) return []
      return [{
        url: `${BASE_URL}/${locale}/forecasts/${slug}`,
        lastModified: p.updatedAt,
        changeFrequency: (isResolved ? 'monthly' : 'hourly') as 'monthly' | 'hourly',
        priority: isResolved ? 0.4 : 0.6,
        alternates: {
          languages: {
            'x-default': `${BASE_URL}/forecasts/${slug}`,
            en: `${BASE_URL}/forecasts/${slug}`,
            ...(hasHe ? { he: `${BASE_URL}/he/forecasts/${slug}` } : {}),
            ...(hasRu ? { ru: `${BASE_URL}/ru/forecasts/${slug}` } : {}),
          },
        },
      }]
    })
  })

  // 5. Public profile routes (no locale variants)
  const profileRoutes: MetadataRoute.Sitemap = users.map((u) => ({
    url: `${BASE_URL}/profile/${u.username}`,
    lastModified: u.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }))

  // 6. Tag routes (no locale variants — English-only launch, matching profile routes)
  const tagRoutes: MetadataRoute.Sitemap = tags.map((t) => ({
    url: `${BASE_URL}/tags/${t.slug}`,
    lastModified: t.predictions[0]?.updatedAt ?? new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.5,
  }))

  return [
    ...staticRoutes,
    ...localeStaticRoutes,
    ...forecastRoutes,
    ...localeForecastRoutes,
    ...profileRoutes,
    ...tagRoutes,
  ]
}
