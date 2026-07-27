import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ExternalLink, Newspaper } from 'lucide-react'
import { getSourceLeaderboard } from '@/lib/services/sourceLeaderboard'
import { getPublicArticlesByAuthorOutlet } from '@/lib/services/evidence-pool'
import { getAppUrl } from '@/lib/branding'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ author: string; outlet: string }>
}

function isUrl(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//.test(s)
}

async function findRow(author: string, outlet: string) {
  const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative')
  return authorRows.find(r => r.author === author && r.outletName === outlet) ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, outlet } = await params
  const decodedAuthor = decodeURIComponent(author)
  const decodedOutlet = decodeURIComponent(outlet)
  const row = await findRow(decodedAuthor, decodedOutlet)
  if (!row) return { title: 'Author Not Found', robots: { index: false, follow: false } }

  const title = `${row.author} (${row.outletName}) — author profile | Daatan`
  const description = `Track record for ${row.author} at ${row.outletName} on Daatan.`
  const url = `${getAppUrl()}/authors/${encodeURIComponent(row.author)}/${encodeURIComponent(row.outletName)}`
  return {
    title,
    description,
    // Parallel to /leaderboard/sources's own experimental/noindex status until the
    // shadow-scoring feature graduates out of experimental.
    robots: { index: false },
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
  }
}

export default async function AuthorPublicPage({ params }: Props) {
  const { author, outlet } = await params
  const decodedAuthor = decodeURIComponent(author)
  const decodedOutlet = decodeURIComponent(outlet)

  const row = await findRow(decodedAuthor, decodedOutlet)
  if (!row) notFound()

  const publications = await getPublicArticlesByAuthorOutlet(decodedAuthor, decodedOutlet)
  const t = await getTranslations('authorPage')

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <Link
        href="/leaderboard/sources"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
      >
        <Newspaper className="w-4 h-4" />
        {t('backToLeaderboard')}
      </Link>

      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">{row.author}</h1>
      <p className="text-sm text-gray-400 mb-6">
        {t('writesFor')}{' '}
        <Link href={`/sources/${encodeURIComponent(row.outletName)}`} className="text-blue-400 hover:underline">
          {row.outletName}
        </Link>
      </p>

      <div className="p-4 rounded-xl bg-navy-700 border border-navy-600 mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">{t('trackRecord')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={t('skill')} value={row.skillConservative.toFixed(3)} />
          <Stat label={t('brier')} value={row.brierScore.toFixed(3)} />
          <Stat label={t('predictions')} value={String(row.predictions)} />
          <Stat label={t('articles')} value={String(row.articles)} />
        </div>
      </div>

      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
        {t('publications')} ({publications.length})
      </h3>
      {publications.length === 0 ? (
        <p className="text-sm text-gray-500">{t('noPublications')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-navy-600">
          <table className="w-full text-sm">
            <tbody>
              {publications.map((p) => (
                <tr key={p.id} className="border-t border-navy-700 first:border-t-0">
                  <td className="px-3 py-2 max-w-[26rem]">
                    {isUrl(p.url) ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-blue-500 hover:underline truncate">
                        <span className="truncate">{p.title || p.url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-white">{p.title || '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/forecasts/${p.predictionId}`} className="text-blue-500 hover:underline">
                      {t('forecast')}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-400">{p.predictionStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-navy-800 border border-navy-600">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    </div>
  )
}
