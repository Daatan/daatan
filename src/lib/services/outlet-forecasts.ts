import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { CURRENT_VERSION_ONLY } from '@/lib/services/evidence-pool'
import { approvedCutoffs, isScorableReading } from '@/lib/services/outcome-cutoff'
import { stanceToPercent } from '@/lib/services/oracle-snapshot'
import { getCachedClaimTranslations } from '@/lib/services/translation'
import { articleDay, forecastState, runningTrend, type OutletForecastRow } from '@/lib/utils/outlet-forecasts'

const log = createLogger('outlet-forecasts')

const HIDDEN_STATUSES = ['DRAFT', 'PENDING_APPROVAL'] as const
const RESOLVED_STATUSES: ReadonlySet<string> = new Set(['RESOLVED_CORRECT', 'RESOLVED_WRONG'])

/** Mean lean of the articles that may count as calls before `cutoff`: published before it, by
 *  the scoring rule's own date handling, and not reporting the outcome as settled fact. */
function leanBefore(
  list: { stance: number; publishedDate: string | null; settled: boolean | null }[],
  cutoff: Date | undefined,
): { lean: number; articles: number } | null {
  const before = list.filter((a) => isScorableReading(a, cutoff))
  if (before.length === 0) return null
  return { lean: stanceToPercent(before.reduce((n, a) => n + a.stance, 0) / before.length), articles: before.length }
}

export interface PublicForecastLink {
  href: string
  title: string
  status: string
}

/**
 * Link and title for each id that is a public forecast, the title in `locale` when a cached
 * translation exists. Private, draft and unapproved forecasts are left out, so a public page
 * never prints their claim.
 */
export async function getPublicForecastLinks(ids: string[], locale: string): Promise<Map<string, PublicForecastLink>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const [forecasts, translated] = await Promise.all([
    prisma.prediction.findMany({
      where: { id: { in: unique }, isPublic: true, status: { notIn: [...HIDDEN_STATUSES] } },
      select: { id: true, slug: true, claimText: true, status: true },
    }),
    getCachedClaimTranslations(unique, locale),
  ])
  return new Map(forecasts.map((f) => [
    f.id,
    { href: `/forecasts/${f.slug ?? f.id}`, title: translated.get(f.id) ?? f.claimText, status: f.status },
  ]))
}

/**
 * One row per public forecast this outlet's articles fed (daatan#2320): the outlet's lean on it
 * (the mean stance of its current, non-excluded articles, as a percentage) and how that mean
 * moved article by article. An article counts for the outlet when its `source` is one of the
 * outlet's domains or news-indexer resolved it to the outlet by name.
 *
 * Shows the stance aggregate publicly, as the forecast page and elections already do (chosen in
 * the #2320 interview). Author scoring stays on the leaderboard.
 *
 * Fails open to [] so a pool query problem costs the table, not the page.
 */
export async function getOutletForecastRows(name: string, domains: string[], locale: string): Promise<OutletForecastRow[]> {
  try {
    const articles = await prisma.evidencePoolArticle.findMany({
      where: {
        ...CURRENT_VERSION_ONLY,
        excluded: false,
        status: 'COMPLETE',
        stance: { not: null },
        OR: [{ source: { in: domains } }, { outletName: name }],
        prediction: { isPublic: true, status: { notIn: [...HIDDEN_STATUSES] } },
      },
      select: { predictionId: true, stance: true, publishedDate: true, settled: true, addedAt: true },
    })

    type Article = { stance: number; day: string; addedAt: Date; publishedDate: string | null; settled: boolean | null }
    const byForecast = new Map<string, Article[]>()
    for (const a of articles) {
      if (a.stance === null) continue
      const list = byForecast.get(a.predictionId) ?? []
      list.push({
        stance: a.stance, day: articleDay(a.publishedDate, a.addedAt), addedAt: a.addedAt,
        publishedDate: a.publishedDate, settled: a.settled,
      })
      byForecast.set(a.predictionId, list)
    }

    const links = await getPublicForecastLinks([...byForecast.keys()], locale)
    // The outcome instant is the approved outcome cutoff (daatan#2144) and nothing else: a
    // forecast without one, or ruled `insufficient`, shows no pre-outcome lean (daatan#2340).
    const resolved = [...links].filter(([, l]) => RESOLVED_STATUSES.has(l.status)).map(([id]) => id)
    const outcomeAt = await approvedCutoffs(resolved)
    return [...byForecast].flatMap(([forecastId, list]) => {
      const link = links.get(forecastId)
      if (!link) return []
      list.sort((a, b) => a.day.localeCompare(b.day) || a.addedAt.getTime() - b.addedAt.getTime())
      const trend = runningTrend(list.map((a) => a.stance), stanceToPercent)
      return [{
        forecastId,
        href: link.href,
        title: link.title,
        state: forecastState(link.status),
        articles: list.length,
        lean: trend[trend.length - 1],
        trend,
        lastArticle: list[list.length - 1].day,
        beforeOutcome: leanBefore(list, outcomeAt.get(forecastId)),
      }]
    })
  } catch (err) {
    log.error({ err, name }, 'event=outlet_forecast_rows_failed')
    return []
  }
}
