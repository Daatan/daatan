import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Bot, ArrowLeft, Trophy } from 'lucide-react'
import { getAiLeaderboard } from '@/lib/services/ai-panel-leaderboard'
import EmptyState from '@/components/ui/EmptyState'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AI Panel Leaderboard — LLM forecasters vs the crowd',
  description:
    'Matched-time Brier scores for each AI-panel model and the Oracle, compared with human forecasters on the same commitments.',
  alternates: { canonical: '/leaderboard/ai' },
  robots: { index: false }, // experimental surface; keep it out of search for now
}

/** Lower Brier is better. 0.25 is a coin flip; colour by how far below that a score is. */
function brierTone(brier: number): string {
  if (brier <= 0.1) return 'text-emerald-400'
  if (brier <= 0.2) return 'text-lime-400'
  if (brier < 0.25) return 'text-yellow-400'
  return 'text-red-400'
}

export default async function AiLeaderboardPage() {
  const t = await getTranslations('aiLeaderboard')
  const lb = await getAiLeaderboard()

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
        <Bot className="w-7 h-7 text-cyan-400" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
        <span className="rounded-full bg-navy-600 px-2 py-0.5 text-xs font-medium text-cyan-300">
          {t('experimental')}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">{t('explainer')}</p>

      {lb.members.length === 0 ? (
        <EmptyState
          icon={<Bot className="w-10 h-10" />}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <div className="bg-navy-700 border border-navy-600 rounded-xl overflow-hidden">
          {/* Human baseline: the same crowd, scored on the same commitments. */}
          {lb.humanAvgBrier != null && (
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-navy-600 bg-navy-800/50">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Trophy className="w-4 h-4 text-amber-400" />
                {t('humanBaseline')}
                <span className="text-gray-500">({t('nScores', { n: lb.humanCount })})</span>
              </div>
              <span className={`font-mono font-semibold ${brierTone(lb.humanAvgBrier)}`}>
                {lb.humanAvgBrier.toFixed(3)}
              </span>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-navy-600">
                <th className="px-4 sm:px-6 py-3 font-medium w-10">#</th>
                <th className="px-2 py-3 font-medium">{t('model')}</th>
                <th className="px-2 py-3 font-medium text-right">{t('avgBrier')}</th>
                <th className="px-4 sm:px-6 py-3 font-medium text-right">{t('scores')}</th>
              </tr>
            </thead>
            <tbody>
              {lb.members.map((m, i) => (
                <tr key={m.model} className="border-b border-navy-600/50 last:border-0">
                  <td className="px-4 sm:px-6 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-2 py-3">
                    <span className="text-white font-medium">{m.label}</span>
                    {m.isOracle && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">
                        {t('oracleBadge')}
                      </span>
                    )}
                    {m.model.startsWith('google/gemma') && (
                      <span className="ml-2 rounded bg-navy-600 px-1.5 py-0.5 text-xs text-gray-400">
                        {t('controlBadge')}
                      </span>
                    )}
                  </td>
                  <td className={`px-2 py-3 text-right font-mono font-semibold ${brierTone(m.avgBrier)}`}>
                    {m.avgBrier.toFixed(3)}
                  </td>
                  <td className="px-4 sm:px-6 py-3 text-right text-gray-500">{m.count}</td>
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
