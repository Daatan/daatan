import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft, Newspaper } from 'lucide-react'
import {
  getSourceLeaderboard,
  type SourceLeaderboardView,
  type SourceSortBy,
} from '@/lib/services/sourceLeaderboard'
import EmptyState from '@/components/ui/EmptyState'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Source Leaderboard — bloggers & outlets scored on their own calls',
  description:
    'Shadow-scoring track record for byline authors and outlets: their own directional forecasts (author_lean), resolved against outcomes.',
  alternates: { canonical: '/leaderboard/sources' },
  robots: { index: false }, // experimental surface; keep it out of search for now
}

const VIEWS: SourceLeaderboardView[] = ['authors', 'outlets']
const SORTS: SourceSortBy[] = ['skillConservative', 'brierScore']

interface Props {
  searchParams: Promise<{ view?: string; sortBy?: string }>
}

/** Lower Brier is better. 0.25 is a coin flip; colour by how far below that a score is. */
function brierTone(brier: number): string {
  if (brier <= 0.1) return 'text-emerald-400'
  if (brier <= 0.2) return 'text-lime-400'
  if (brier < 0.25) return 'text-yellow-400'
  return 'text-red-400'
}

function toggleHref(view: SourceLeaderboardView, sortBy: SourceSortBy): string {
  return `/leaderboard/sources?view=${view}&sortBy=${sortBy}`
}

export default async function SourceLeaderboardPage({ searchParams }: Props) {
  const params = await searchParams
  const view: SourceLeaderboardView = params.view === 'outlets' ? 'outlets' : 'authors'
  const sortBy: SourceSortBy = params.sortBy === 'brierScore' ? 'brierScore' : 'skillConservative'

  const t = await getTranslations('sourceLeaderboard')
  const { authorRows, outletRows } = await getSourceLeaderboard(view, sortBy)

  // Normalize both views to one display shape so the table only renders once.
  const rows = view === 'outlets'
    ? outletRows.map(r => ({
        id: r.id,
        primary: r.outletName,
        secondary: t('authorsCount', { count: r.authorCount }),
        skillConservative: r.skillConservative,
        brierScore: r.brierScore,
        predictions: r.predictions,
      }))
    : authorRows.map(r => ({
        id: r.id,
        primary: r.author,
        secondary: r.outletName,
        skillConservative: r.skillConservative,
        brierScore: r.brierScore,
        predictions: r.predictions,
      }))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <Link
        href="/leaderboard"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('backToLeaderboard')}
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <Newspaper className="w-7 h-7 text-cyan-400" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
        <span className="rounded-full bg-navy-600 px-2 py-0.5 text-xs font-medium text-cyan-300">
          {t('experimental')}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">{t('explainer')}</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {VIEWS.map(v => (
          <Link
            key={v}
            href={toggleHref(v, sortBy)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              v === view ? 'bg-cyan-600 text-white' : 'bg-navy-700 text-gray-400 hover:text-white'
            }`}
          >
            {t(`view.${v}`)}
          </Link>
        ))}
        <span className="w-px h-5 bg-navy-600 mx-1" />
        {SORTS.map(s => (
          <Link
            key={s}
            href={toggleHref(view, s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              s === sortBy ? 'bg-cyan-600 text-white' : 'bg-navy-700 text-gray-400 hover:text-white'
            }`}
          >
            {t(`sortBy.${s}`)}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Newspaper className="w-10 h-10" />}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <div className="bg-navy-700 border border-navy-600 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-navy-600">
                <th className="px-4 sm:px-6 py-3 font-medium w-10">#</th>
                <th className="px-2 py-3 font-medium">{view === 'outlets' ? t('outlet') : t('author')}</th>
                <th className="px-2 py-3 font-medium">{view === 'outlets' ? t('authors') : t('outlet')}</th>
                <th className="px-2 py-3 font-medium text-right">{t('skillConservative')}</th>
                <th className="px-2 py-3 font-medium text-right">{t('brierScore')}</th>
                <th className="px-4 sm:px-6 py-3 font-medium text-right">{t('predictions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className="border-b border-navy-600/50 last:border-0">
                  <td className="px-4 sm:px-6 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-2 py-3 text-white font-medium">{row.primary}</td>
                  <td className="px-2 py-3 text-gray-400">{row.secondary}</td>
                  <td className="px-2 py-3 text-right font-mono text-cyan-300">
                    {row.skillConservative.toFixed(3)}
                  </td>
                  <td className={`px-2 py-3 text-right font-mono font-semibold ${brierTone(row.brierScore)}`}>
                    {row.brierScore.toFixed(3)}
                  </td>
                  <td className="px-4 sm:px-6 py-3 text-right text-gray-500">{row.predictions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-600 mt-4 max-w-2xl">{t('footnote')}</p>
    </div>
  )
}
