import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getRelatedForecastLinks } from '@/lib/services/crawl-links'
import { createLogger } from '@/lib/logger'

const log = createLogger('related-forecasts')

export const RELATED_FORECASTS_LIMIT = 5

/**
 * Server-rendered "Related forecasts" (daatan#2027): real links to other public forecasts that
 * share a tag, so a crawler can move between forecast pages without the sitemap. `linkLocale`
 * picks the URLs (/he/forecasts/… for translated ones); `uiLocale` the heading, when the route
 * names it explicitly — the English route leaves it to the negotiated locale, like its other UI.
 */
export default async function RelatedForecasts({
  predictionId,
  linkLocale,
  uiLocale,
}: {
  predictionId: string
  linkLocale: string
  uiLocale?: string
}) {
  let links
  try {
    links = await getRelatedForecastLinks(predictionId, linkLocale, RELATED_FORECASTS_LIMIT)
  } catch (err) {
    log.error({ err, predictionId }, 'related forecasts lookup failed')
    return null
  }
  if (links.length === 0) return null
  const t = uiLocale
    ? await getTranslations({ locale: uiLocale, namespace: 'forecast' })
    : await getTranslations('forecast')
  return (
    <section aria-labelledby="related-forecasts" className="px-4 sm:px-6 lg:px-8 pb-8 max-w-5xl mx-auto">
      <div className="p-4 sm:p-5 bg-navy-700 border border-navy-600 rounded-xl">
        <h2 id="related-forecasts" className="text-base font-semibold text-white mb-3">{t('relatedTitle')}</h2>
        <ul className="space-y-2">
          {links.map((l) => (
            <li key={l.id}>
              <Link href={l.href} dir="auto" className="text-sm text-blue-400 hover:text-blue-300 hover:underline">
                {l.text}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
