import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { TopicRecord } from '@/lib/services/sourceTopicBoards'

/** Track record split by forecast topic (daatan#1917). Renders nothing when there is none. */
export default async function TopicBreakdown({ records, view }: { records: TopicRecord[]; view: 'outlets' | 'authors' }) {
  if (records.length === 0) return null
  const t = await getTranslations('topicBreakdown')
  return (
    <>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{t('title')}</h3>
      <div className="overflow-x-auto rounded-lg border border-navy-600 mb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-gray-500 border-b border-navy-600">
              <th className="px-3 py-2 font-medium text-start">{t('topic')}</th>
              <th className="px-3 py-2 font-medium text-end">{t('skill')}</th>
              <th className="px-3 py-2 font-medium text-end">{t('brier')}</th>
              <th className="px-3 py-2 font-medium text-end">{t('predictions')}</th>
            </tr>
          </thead>
          <tbody>
            {records.map(r => (
              <tr key={r.slug} className="border-t border-navy-700 first:border-t-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/leaderboard/sources?view=${view}&tag=${encodeURIComponent(r.slug)}`}
                    className="text-white hover:underline hover:text-cyan-300"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-end font-mono text-cyan-300">{r.skillConservative.toFixed(3)}</td>
                <td className="px-3 py-2 text-end font-mono text-gray-300">{r.brierScore.toFixed(3)}</td>
                <td className="px-3 py-2 text-end text-gray-500">{r.predictions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 mb-8">{t('hint')}</p>
    </>
  )
}
