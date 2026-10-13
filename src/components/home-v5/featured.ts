import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { getCachedPredictionTranslation } from '@/lib/services/translation'
import { isForecastViewableByVisitor } from '@/lib/forecast-visibility'
import type { Locale } from '@/i18n/config'
import type { ForecastCardData, SourceCardData } from './cards'
import { FEATURED_FORECAST_ID, FEATURED_SOURCE } from './examples'
import type { FeaturedSource } from './examples'

const log = createLogger('home-v5')

const SHOWN_STATUSES = new Set(['ACTIVE', 'RESOLVED_CORRECT', 'RESOLVED_WRONG'])

function formatDate(iso: Date | string, locale: Locale): string {
  const d = new Date(iso)
  // Esperanto has no CLDR date data in every runtime; fall back to ISO order.
  try {
    return new Intl.DateTimeFormat(locale === 'eo' ? 'en-GB' : locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export function toSourceCard(src: FeaturedSource, locale: Locale): SourceCardData {
  return {
    name: src.name[locale],
    role: src.role[locale],
    saidOn: formatDate(src.saidOn, locale),
    statement: src.statement[locale],
    whatHappened: src.whatHappened[locale],
    verdict: src.verdict,
    tag: src.tag[locale],
    record: src.record,
  }
}

export function getFeaturedSource(locale: Locale): SourceCardData | undefined {
  return FEATURED_SOURCE ? toSourceCard(FEATURED_SOURCE, locale) : undefined
}

/** Reads the pinned forecast; returns undefined (card hidden) on any problem so the page never breaks. */
export async function getFeaturedForecast(locale: Locale): Promise<ForecastCardData | undefined> {
  if (!FEATURED_FORECAST_ID) return undefined
  try {
    const p = await prisma.prediction.findFirst({
      where: { OR: [{ id: FEATURED_FORECAST_ID }, { slug: FEATURED_FORECAST_ID }] },
      select: {
        id: true,
        claimText: true,
        status: true,
        isPublic: true,
        confidence: true,
        resolveByDatetime: true,
        author: { select: { id: true } },
        tags: { select: { name: true }, take: 2 },
      },
    })
    if (!p) {
      log.warn({ id: FEATURED_FORECAST_ID }, 'featured forecast not found')
      return undefined
    }
    if (!isForecastViewableByVisitor(p, {}) || !SHOWN_STATUSES.has(p.status) || p.confidence == null) {
      log.warn({ id: p.id, status: p.status }, 'featured forecast not displayable')
      return undefined
    }
    const translated = locale === 'en' ? {} : await getCachedPredictionTranslation(p.id, locale)
    return {
      tags: p.tags.map((t) => t.name),
      statement: translated.claimText || p.claimText,
      confidence: p.confidence,
      resolvesOn: formatDate(p.resolveByDatetime, locale),
      open: p.status === 'ACTIVE',
    }
  } catch (err) {
    log.error({ err }, 'featured forecast lookup failed')
    return undefined
  }
}
