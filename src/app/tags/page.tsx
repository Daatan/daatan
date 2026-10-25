import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { getTranslations } from 'next-intl/server'
import { Tag as TagIcon } from 'lucide-react'
import { getVisibleTagLinks, type TagLink } from '@/lib/services/crawl-links'
import { getAppUrl } from '@/lib/branding'
import { JsonLd } from '@/components/JsonLd'

export const metadata: Metadata = {
  title: 'Topics — Browse Forecasts by Tag',
  description: 'Every topic with open forecasts on DAATAN — geopolitics, economics, technology and more. Pick a topic to see its community forecasts.',
  alternates: { canonical: '/tags' },
  openGraph: { url: '/tags', type: 'website' },
}

async function getTags(): Promise<TagLink[]> {
  try {
    return await getVisibleTagLinks()
  } catch {
    return []
  }
}

/** Index of tags with visible (public, ACTIVE) forecasts — the tag pages' only crawl entry besides the sitemap (daatan#2027). */
export default async function TagsIndexPage() {
  // Reads only cached DB data: without this it would be prerendered at build, against no DB.
  await connection()
  const [tags, t] = await Promise.all([getTags(), getTranslations('tagsIndex')])
  const appUrl = getAppUrl()
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: appUrl },
      { '@type': 'ListItem', position: 2, name: 'Topics', item: `${appUrl}/tags` },
    ],
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <JsonLd data={breadcrumbJsonLd} />
      <div className="flex items-center gap-3 mb-2">
        <TagIcon className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6 lg:mb-8">{t('subtitle')}</p>
      {tags.length === 0 ? (
        <p className="text-text-secondary">
          {t('empty')}{' '}
          <Link href="/forecasts" className="text-blue-400 hover:underline">{t('browseForecasts')}</Link>
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.slug}>
              <Link
                href={`/tags/${tag.slug}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-navy-700 border border-navy-600 text-text-secondary hover:bg-navy-600 hover:text-white transition-colors"
              >
                {tag.name}
                <span className="text-xs text-gray-500">{t('count', { count: tag.count })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
