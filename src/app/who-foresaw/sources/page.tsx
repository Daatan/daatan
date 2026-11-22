import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getTranslations } from 'next-intl/server'
import { isSelfHosted } from '@/lib/edition'
import { BOARD_MIN_EVENTS, getForesawSourceBoard, type ForesawSide, type ForesawSourceBoard } from '@/lib/services/retro-foresaw'
import { percent } from '../format'

const SIDE_TONE: Record<ForesawSide, string> = {
  called: 'text-teal-400',
  against: 'text-rose-400',
  neutral: 'text-gray-400',
}

async function getBoard(): Promise<ForesawSourceBoard> {
  try {
    return await getForesawSourceBoard()
  } catch {
    return { eventCount: 0, rows: [], hiddenOutlets: 0 }
  }
}

export async function generateMetadata(): Promise<Metadata> {
  await connection()
  const t = await getTranslations('whoForesaw.board')
  return {
    title: t('metaTitle'),
    description: t('subtitle'),
    // Thin by construction for now (daatan#2217 PR 4): only the hub is indexed.
    robots: { index: false, follow: true },
    alternates: { canonical: '/who-foresaw/sources' },
  }
}

/** The retro-only source board (daatan#2217 PR 4): kept apart from /leaderboard/sources. */
export default async function WhoForesawSourcesPage() {
  await connection()
  if (isSelfHosted()) notFound()
  const [board, t] = await Promise.all([getBoard(), getTranslations('whoForesaw')])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      <div className="mb-6 lg:mb-8 space-y-2">
        <Link href="/who-foresaw" className="text-sm text-blue-400 hover:underline">{t('back')}</Link>
        <h1 className="pt-1 text-2xl sm:text-3xl font-bold text-white">{t('board.title')}</h1>
        <p className="text-sm text-gray-400">{t('board.subtitle')}</p>
        <p className="text-xs text-gray-500">{t('board.method', { min: BOARD_MIN_EVENTS })}</p>
        {board.eventCount > 0 && (
          <p className="text-xs text-amber-400/80">{t('board.caveat', { events: board.eventCount })}</p>
        )}
      </div>

      {board.rows.length === 0 ? (
        <p className="text-text-secondary">{t('board.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {board.rows.map((row) => (
            <li key={row.outlet} className="rounded-lg border border-navy-600 bg-navy-700 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p dir="auto" className="text-white font-medium break-all">{row.outlet}</p>
                <p className="text-sm text-gray-300">
                  {t('board.counts', { called: row.called, against: row.against, total: row.total, share: percent(row.called / row.total) })}
                </p>
              </div>
              <ul className="mt-2 space-y-1">
                {row.events.map((e) => (
                  <li key={e.slug} className="text-xs">
                    <span className={SIDE_TONE[e.side]}>{t(`board.side.${e.side}`)}</span>
                    {' · '}
                    <Link href={`/who-foresaw/${e.slug}`} dir="auto" className="text-gray-300 hover:underline">{e.eventText}</Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {board.hiddenOutlets > 0 && (
        <p className="mt-4 text-xs text-gray-500">{t('board.hidden', { count: board.hiddenOutlets, min: BOARD_MIN_EVENTS })}</p>
      )}
    </div>
  )
}
