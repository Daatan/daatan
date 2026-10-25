/**
 * Server-rendered internal links for crawlers (daatan#2027): related forecasts on a forecast
 * page, recent forecasts + top topics on home-v5, and the /tags index. Every reader here is
 * wrapped in `unstable_cache` — these render on crawler-heavy pages and must not add a DB
 * round-trip per hit. The arguments are part of each cache key.
 */
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { sourceHash } from '@/lib/services/translation'
import { VISIBLE_TAG_PREDICTION_WHERE } from '@/lib/services/tag'

/** What /forecasts and /tags/<slug> list — so every link here lands on a page that shows it. */
const VISIBLE_FORECAST = VISIBLE_TAG_PREDICTION_WHERE

export interface ForecastLink {
  id: string
  href: string
  text: string
}

export interface TagLink {
  name: string
  slug: string
  count: number
}

interface ForecastRow {
  id: string
  slug: string | null
  claimText: string
}

const ROW_SELECT = { id: true, slug: true, claimText: true } as const

/**
 * Locale-aware hrefs. A /he|ru|eo/forecasts/<slug> page without a translation is noindex, so a
 * link there is a crawl dead end: rows translated into `locale` get the locale path and their
 * translated claim; the rest keep the English URL and text. Translated rows are listed first.
 */
export async function toForecastLinks(rows: ForecastRow[], locale: string, limit: number): Promise<ForecastLink[]> {
  if (locale === 'en' || rows.length === 0) {
    return rows.slice(0, limit).map((r) => ({ id: r.id, href: `/forecasts/${r.slug || r.id}`, text: r.claimText }))
  }
  const translations = await prisma.predictionTranslation.findMany({
    where: { predictionId: { in: rows.map((r) => r.id) }, language: locale, fieldName: 'claimText' },
    select: { predictionId: true, translatedText: true, sourceHash: true },
  })
  const byId = new Map(translations.map((t) => [t.predictionId, t]))
  const links = rows.map((r) => {
    const t = byId.get(r.id)
    // Only a translation of the current claim counts (#1827) — a stale one reads as missing.
    const current = t && t.sourceHash === sourceHash(r.claimText) ? t.translatedText : null
    const slug = r.slug || r.id
    return current
      ? { id: r.id, href: `/${locale}/forecasts/${slug}`, text: current, translated: true }
      : { id: r.id, href: `/forecasts/${slug}`, text: r.claimText, translated: false }
  })
  return [...links.filter((l) => l.translated), ...links.filter((l) => !l.translated)]
    .slice(0, limit)
    .map(({ id, href, text }) => ({ id, href, text }))
}

async function findRelatedRows(predictionId: string, take: number): Promise<ForecastRow[]> {
  const self = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { tags: { select: { id: true } } },
  })
  const tagIds = self?.tags.map((t) => t.id) ?? []
  const byTag = tagIds.length
    ? await prisma.prediction.findMany({
        where: { ...VISIBLE_FORECAST, id: { not: predictionId }, tags: { some: { id: { in: tagIds } } } },
        select: ROW_SELECT,
        orderBy: { createdAt: 'desc' },
        take,
      })
    : []
  if (byTag.length >= take) return byTag
  const recent = await prisma.prediction.findMany({
    where: { ...VISIBLE_FORECAST, id: { notIn: [predictionId, ...byTag.map((r) => r.id)] } },
    select: ROW_SELECT,
    orderBy: { createdAt: 'desc' },
    take: take - byTag.length,
  })
  return [...byTag, ...recent]
}

// A wider candidate pool than shown, so non-English pages can prefer translated forecasts.
const CANDIDATE_FACTOR = 3

/** ~5 public ACTIVE forecasts sharing a tag with `predictionId` (topped up with recent ones). */
export const getRelatedForecastLinks = unstable_cache(
  async (predictionId: string, locale: string, limit: number): Promise<ForecastLink[]> => {
    const rows = await findRelatedRows(predictionId, locale === 'en' ? limit : limit * CANDIDATE_FACTOR)
    return toForecastLinks(rows, locale, limit)
  },
  ['crawl-links-related'],
  { revalidate: 600, tags: ['forecasts'] },
)

/** The newest public ACTIVE forecasts, for home-v5. */
export const getRecentForecastLinks = unstable_cache(
  async (locale: string, limit: number): Promise<ForecastLink[]> => {
    const rows = await prisma.prediction.findMany({
      where: VISIBLE_FORECAST,
      select: ROW_SELECT,
      orderBy: { createdAt: 'desc' },
      take: locale === 'en' ? limit : limit * CANDIDATE_FACTOR,
    })
    return toForecastLinks(rows, locale, limit)
  },
  ['crawl-links-recent'],
  { revalidate: 600, tags: ['forecasts'] },
)

/** Tags with at least one public ACTIVE forecast (what /tags/<slug> shows), most-used first. */
export const getVisibleTagLinks = unstable_cache(
  async (): Promise<TagLink[]> => {
    const tags = await prisma.tag.findMany({
      where: { predictions: { some: VISIBLE_FORECAST } },
      select: { name: true, slug: true, _count: { select: { predictions: { where: VISIBLE_FORECAST } } } },
    })
    return tags
      .map((t) => ({ name: t.name, slug: t.slug, count: t._count.predictions }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  },
  ['crawl-links-tags'],
  { revalidate: 3600, tags: ['forecasts'] },
)
