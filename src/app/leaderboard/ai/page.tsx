import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Bot, Hash, TrendingDown, Trophy } from 'lucide-react'
import { getAiLeaderboard } from '@/lib/services/ai-panel-leaderboard'
import EmptyState from '@/components/ui/EmptyState'
import {
  BODY, BoardTabs, ColumnHint, HEAD_CELL, HEAD_ROW, LEGEND_GRID, LegendCard, LowerIsBetter, RankBadge, TABLE_CARD,
  brierTone, valueSize,
} from '@/components/leaderboard/LeaderboardParts'


export const metadata: Metadata = {
  title: 'AI Panel Leaderboard — LLM forecasters vs the crowd',
  description:
    'Matched-time Brier scores for each AI-panel model and the Oracul, compared with human forecasters on the same commitments.',
  alternates: { canonical: '/leaderboard/ai' },
  robots: { index: false }, // experimental surface; keep it out of search for now
}

export default async function AiLeaderboardPage() {
  const t = await getTranslations('aiLeaderboard')
  const tl = await getTranslations('leaderboard')
  const lb = await getAiLeaderboard()

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <BoardTabs
        active="ai"
        ariaLabel={tl('boards.nav')}
        labels={{ users: tl('boards.users'), ai: tl('boards.ai'), sources: tl('boards.sources') }}
      />

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
        <div className={`${TABLE_CARD} overflow-hidden`}>
          {/* Human baseline: the same crowd, scored on the same commitments. */}
          {lb.humanAvgBrier != null && (
            <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-navy-600 bg-navy-800">
              <div className="flex items-center gap-2 text-sm text-gray-300">
                <Trophy className="w-4 h-4 text-amber-400" />
                {t('humanBaseline')}
                <span className="text-gray-500">({t('nScores', { n: lb.humanCount })})</span>
              </div>
              <span className={`tabular-nums ${valueSize(false)} ${brierTone(lb.humanAvgBrier)}`}>
                {lb.humanAvgBrier.toFixed(3)}
              </span>
            </div>
          )}

          <table className="w-full text-left">
            <thead>
              <tr className={HEAD_ROW}>
                <th className={`px-1 sm:px-4 ${HEAD_CELL} text-gray-500 text-center w-10 sm:w-20`}>
                  <span className="sm:hidden" aria-hidden="true">#</span>
                  <span className="sr-only sm:not-sr-only">{tl('rank')}</span>
                </th>
                <th className={`px-2 sm:px-4 ${HEAD_CELL} text-gray-500`}>{t('model')}</th>
                {/* Members arrive best-first by avgBrier, so that column is the active one. */}
                <th className={`px-2 sm:px-4 ${HEAD_CELL} text-white text-right relative group`}>
                  <span aria-describedby="ai-hint-brier" className="inline-block">
                    {t('avgBrier')}
                    <span aria-hidden="true"> ↑</span>
                    <LowerIsBetter label={tl('lowerIsBetter')} />
                  </span>
                  <ColumnHint id="ai-hint-brier">{t('legend.avgBrierDesc')}</ColumnHint>
                </th>
                <th className={`px-2 sm:px-4 ${HEAD_CELL} text-gray-500 text-right relative group`}>
                  <span aria-describedby="ai-hint-scores" className="inline-block">
                    {t('scores')}
                  </span>
                  <ColumnHint id="ai-hint-scores">{t('legend.scoresDesc')}</ColumnHint>
                </th>
              </tr>
            </thead>
            <tbody className={BODY}>
              {lb.members.map((m, i) => (
                <tr
                  key={`${m.model}:${m.mode}:${m.promptVersion ?? ''}`}
                  className={`hover:bg-white/5 transition-colors ${i < 3 ? 'bg-amber-400/5' : ''}`}
                >
                  <td className="px-1 sm:px-4 py-3 sm:py-4">
                    <div className="flex justify-center"><RankBadge rank={i} /></div>
                  </td>
                  <td className="px-2 sm:px-4 py-3 sm:py-4">
                    <span className="font-bold text-white text-sm sm:text-base">{m.label}</span>
                    {m.isOracle && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">
                        {t('oraculBadge')}
                      </span>
                    )}
                    {m.isMarket && (
                      <span className="ml-2 rounded bg-pink-500/15 px-1.5 py-0.5 text-xs text-pink-300">
                        {t('marketBadge')}
                      </span>
                    )}
                    {m.isControl && (
                      <span className="ml-2 rounded bg-navy-600 px-1.5 py-0.5 text-xs text-gray-400">
                        {t('controlBadge')}
                      </span>
                    )}
                  </td>
                  <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right tabular-nums ${valueSize(true)} ${brierTone(m.avgBrier)}`}>
                    {m.avgBrier.toFixed(3)}
                  </td>
                  <td className="px-2 sm:px-4 py-3 sm:py-4 text-right tabular-nums text-sm font-bold text-gray-400">{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={LEGEND_GRID}>
        <LegendCard icon={<TrendingDown className="w-4 h-4 text-purple-500" />} title={t('avgBrier')}>{t('legend.avgBrierDesc')}</LegendCard>
        <LegendCard icon={<Trophy className="w-4 h-4 text-amber-400" />} title={t('humanBaseline')}>{t('legend.humanDesc')}</LegendCard>
        <LegendCard icon={<Hash className="w-4 h-4 text-cyan-400" />} title={t('scores')}>{t('legend.scoresDesc')}</LegendCard>
      </div>

      <p className="text-xs text-gray-500 mt-4 max-w-2xl">{t('footnote')}</p>
    </div>
  )
}
