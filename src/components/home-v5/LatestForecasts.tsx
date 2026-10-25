import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getRecentForecastLinks, getVisibleTagLinks, type ForecastLink, type TagLink } from '@/lib/services/crawl-links'
import { createLogger } from '@/lib/logger'
import { CONTAINER } from './ui'
import type { HomeLinks } from './links'

const log = createLogger('home-v5')

export const LATEST_FORECASTS_LIMIT = 6
export const TOP_TAGS_LIMIT = 8

/** Reads the links; empty on any problem so the page never breaks. */
export async function getLatestBlockData(locale: string): Promise<{ forecasts: ForecastLink[]; tags: TagLink[] }> {
  try {
    const [forecasts, tags] = await Promise.all([
      getRecentForecastLinks(locale, LATEST_FORECASTS_LIMIT),
      getVisibleTagLinks(),
    ])
    return { forecasts, tags: tags.slice(0, TOP_TAGS_LIMIT) }
  } catch (err) {
    log.error({ err }, 'latest forecasts lookup failed')
    return { forecasts: [], tags: [] }
  }
}

const TEXT_LINK = 'text-base font-semibold text-[var(--hv5-accent-2)] underline decoration-1 underline-offset-[5px] md:text-[17px]'

/**
 * A small, crawlable block of the newest forecasts and the busiest topics (daatan#2027). The
 * page is what crawlers get at "/", and without it nothing on it led to a forecast or a tag.
 */
export default async function LatestForecasts({
  locale,
  links,
  forecasts,
  tags,
}: {
  locale: string
  links: HomeLinks
  forecasts: ForecastLink[]
  tags: TagLink[]
}) {
  if (forecasts.length === 0 && tags.length === 0) return null
  const t = await getTranslations({ locale, namespace: 'HomeV5.latest' })
  return (
    <section aria-labelledby="hv5-latest" className="bg-[var(--hv5-bg)] pt-16 md:pt-[120px]">
      <div className={CONTAINER}>
        <h2 id="hv5-latest" className="m-0 text-[24px] font-extrabold leading-[1.2] text-white md:text-[32px]">{t('title')}</h2>
        {forecasts.length > 0 && (
          <ul className="m-0 mt-6 grid list-none grid-cols-1 gap-x-10 p-0 md:mt-9 md:grid-cols-2">
            {forecasts.map((f) => (
              <li key={f.id} className="border-t border-[#1e3858] py-4">
                <Link href={f.href} dir="auto" className="text-[17px] font-semibold leading-[1.45] text-[var(--hv5-ink)] no-underline hover:text-white hover:underline">
                  {f.text}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {tags.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-3 md:mt-8">
            <span className="text-sm text-[var(--hv5-muted)]">{t('topics')}</span>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {tags.map((tag) => (
                <li key={tag.slug}>
                  <Link href={`/tags/${tag.slug}`} className="block rounded-full border border-[#2c4f7c] px-3 py-[3px] text-sm leading-[1.4] text-[var(--hv5-accent-2)] no-underline hover:bg-white/5">
                    {tag.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-x-7 gap-y-3 md:mt-8">
          <Link href={links.forecasts} className={TEXT_LINK}>{t('allForecasts')}</Link>
          <Link href="/tags" className={TEXT_LINK}>{t('allTopics')}</Link>
        </div>
      </div>
    </section>
  )
}
