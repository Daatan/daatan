import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Bot, Newspaper, Swords, TrendingDown, TrendingUp, Users } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import {
  BODY, BoardTabs, ColumnHint, HEAD_CELL, HEAD_ROW, LEGEND_GRID, LegendCard, LowerIsBetter, RankBadge, TABLE_CARD,
  brierTone, valueSize,
} from '@/components/leaderboard/LeaderboardParts'
import { MARKET_MIN, PAIR_MIN, VERSUS_GROUPS, getVersusBoard, type VersusGroup } from '@/lib/services/versus-board'

export const metadata: Metadata = {
  title: 'People vs AI vs Experts — who forecasts better',
  description:
    "The crowd, the Oracul and pundits' published leans, each scored as one forecaster on the same resolved forecasts.",
  alternates: { canonical: '/leaderboard/versus' },
  robots: { index: false }, // experimental and a small sample, like the AI board; keep it out of search for now
}

const GROUP_ICON: Record<VersusGroup, ReactNode> = {
  people: <Users className="w-4 h-4 text-amber-400" />,
  oracul: <Bot className="w-4 h-4 text-cyan-400" />,
  experts: <Newspaper className="w-4 h-4 text-emerald-400" />,
  market: <TrendingUp className="w-4 h-4 text-pink-400" />,
}

export default async function VersusLeaderboardPage() {
  const t = await getTranslations('versusLeaderboard')
  const tl = await getTranslations('leaderboard')
  const board = await getVersusBoard()

  const name = (g: VersusGroup) => t(`group.${g}`)
  const shown = VERSUS_GROUPS.filter(
    (g) => board.strip?.rows.some((r) => r.group === g) || board.pairs.some((p) => p.a === g || p.b === g),
  )
  const sideClass = (mine: number, theirs: number) =>
    mine > theirs ? 'font-black text-white' : 'font-bold text-gray-400'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <BoardTabs
        active="versus"
        ariaLabel={tl('boards.nav')}
        labels={{ users: tl('boards.users'), ai: tl('boards.ai'), sources: tl('boards.sources'), versus: tl('boards.versus') }}
      />

      {/* The badge sits inside the heading so a long title wraps around it instead of being squeezed. */}
      <div className="flex items-start gap-3 mb-2">
        <Swords className="w-7 h-7 mt-0.5 sm:mt-1 text-amber-400 shrink-0" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">
          {t('title')}{' '}
          <span className="inline-block align-middle rounded-full bg-navy-600 px-2 py-0.5 text-xs font-medium text-cyan-300">
            {t('experimental')}
          </span>
        </h1>
      </div>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">{t('explainer')}</p>

      {!board.strip && board.pairs.length === 0 ? (
        <EmptyState
          icon={<Swords className="w-10 h-10" />}
          title={t('emptyTitle')}
          description={t('emptyDesc', { min: PAIR_MIN })}
        />
      ) : (
        <div className="space-y-6">
          {board.strip && (
            <section className={`${TABLE_CARD} overflow-hidden`}>
              <div className="px-4 sm:px-6 py-3 border-b border-navy-600 bg-navy-800">
                <h2 className="text-sm sm:text-base font-bold text-white">{t('stripTitle', { n: board.strip.n })}</h2>
                <p className="text-xs text-gray-500 mt-1">{t('stripDesc')}</p>
              </div>
              <table className="w-full text-start">
                <thead>
                  <tr className={HEAD_ROW}>
                    <th className={`px-1 sm:px-4 ${HEAD_CELL} text-gray-500 text-center w-10 sm:w-20`}>
                      <span className="sm:hidden" aria-hidden="true">#</span>
                      <span className="sr-only sm:not-sr-only">{tl('rank')}</span>
                    </th>
                    <th className={`px-2 sm:px-4 ${HEAD_CELL} text-gray-500`}>{t('who')}</th>
                    <th className={`px-2 sm:px-4 ${HEAD_CELL} text-white text-end relative group`}>
                      <span aria-describedby="versus-hint-brier" className="inline-block">
                        {t('brier')}
                        <span aria-hidden="true"> ↑</span>
                        <LowerIsBetter label={tl('lowerIsBetter')} />
                      </span>
                      <ColumnHint id="versus-hint-brier">{t('legend.brierDesc')}</ColumnHint>
                    </th>
                  </tr>
                </thead>
                <tbody className={BODY}>
                  {board.strip.rows.map((r, i) => (
                    <tr key={r.group} className={`hover:bg-white/5 transition-colors ${i === 0 ? 'bg-amber-400/5' : ''}`}>
                      <td className="px-1 sm:px-4 py-3 sm:py-4">
                        <div className="flex justify-center"><RankBadge rank={i} /></div>
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4">
                        <span className="flex items-center gap-2 font-bold text-white text-sm sm:text-base">
                          {GROUP_ICON[r.group]}
                          {name(r.group)}
                        </span>
                      </td>
                      <td className={`px-2 sm:px-4 py-3 sm:py-4 text-end tabular-nums ${valueSize(true)} ${brierTone(r.brier)}`}>
                        {r.brier.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {board.pairs.length > 0 && (
            <section className={`${TABLE_CARD} overflow-hidden`}>
              <div className="px-4 sm:px-6 py-3 border-b border-navy-600 bg-navy-800">
                <h2 className="text-sm sm:text-base font-bold text-white">{t('pairsTitle')}</h2>
                <p className="text-xs text-gray-500 mt-1">{t('pairsDesc')}</p>
              </div>
              <table className="w-full text-start">
                <thead>
                  <tr className={HEAD_ROW}>
                    <th className={`px-3 sm:px-6 ${HEAD_CELL} text-gray-500`}>{t('pair')}</th>
                    <th className={`px-2 sm:px-4 ${HEAD_CELL} text-gray-500 text-end`}>{t('forecasts')}</th>
                    <th className={`px-2 sm:px-4 ${HEAD_CELL} text-white text-end`}>{t('closer')}</th>
                    <th className={`px-2 sm:px-4 ${HEAD_CELL} text-gray-500 text-end relative group`}>
                      <span aria-describedby="versus-hint-pair-brier" className="inline-block">
                        {t('brier')}
                        <LowerIsBetter label={tl('lowerIsBetter')} />
                      </span>
                      <ColumnHint id="versus-hint-pair-brier">{t('legend.brierDesc')}</ColumnHint>
                    </th>
                  </tr>
                </thead>
                <tbody className={BODY}>
                  {board.pairs.map((p) => (
                    <tr key={`${p.a}-${p.b}`} className="align-top hover:bg-white/5 transition-colors">
                      <td className="px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base">
                        <div className={sideClass(p.aCloser, p.bCloser)}>{name(p.a)}</div>
                        <div className={sideClass(p.bCloser, p.aCloser)}>{name(p.b)}</div>
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 text-end tabular-nums text-sm sm:text-base font-bold text-gray-400">{p.n}</td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 text-end tabular-nums text-sm sm:text-base">
                        <div className={sideClass(p.aCloser, p.bCloser)}>{p.aCloser}</div>
                        <div className={sideClass(p.bCloser, p.aCloser)}>{p.bCloser}</div>
                        {p.ties > 0 && (
                          <div className="text-[10px] sm:text-xs font-normal text-gray-500">{t('ties', { n: p.ties })}</div>
                        )}
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 text-end tabular-nums text-sm sm:text-base font-bold">
                        <div className={brierTone(p.aBrier)}>{p.aBrier.toFixed(3)}</div>
                        <div className={brierTone(p.bBrier)}>{p.bBrier.toFixed(3)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      {(board.coverage.experts === 0 || board.coverage.market < MARKET_MIN) && (
        <ul className="mt-4 space-y-1 text-xs text-gray-500">
          {board.coverage.experts === 0 && <li>{t('expertsPending')}</li>}
          {board.coverage.market < MARKET_MIN && (
            <li>{t('marketPending', { min: MARKET_MIN, n: board.coverage.market })}</li>
          )}
        </ul>
      )}

      <div className={LEGEND_GRID}>
        <LegendCard icon={<TrendingDown className="w-4 h-4 text-purple-500" />} title={t('brier')}>
          {t('legend.brierDesc')}
        </LegendCard>
        {shown.map((g) => (
          <LegendCard key={g} icon={GROUP_ICON[g]} title={name(g)}>
            {t(`legend.${g}Desc`)}
          </LegendCard>
        ))}
      </div>

      <p className="text-xs text-gray-500 mt-4 max-w-2xl">{t('footnote')}</p>
    </div>
  )
}
