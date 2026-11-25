import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { MIN_CALL_ARTICLES, type OutletCall } from '@/lib/utils/outlet-forecasts'

/** Calls listed per side; the count in each heading covers the rest. */
export const CALLS_SHOWN = 3

function CallColumn({ heading, calls }: { heading: string; calls: OutletCall[] }) {
  const t = useTranslations('outletPage')
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="text-sm font-semibold text-gray-200">{heading}</h3>
      {calls.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{t('callsNone')}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {calls.slice(0, CALLS_SHOWN).map((c) => (
            <li key={c.forecastId}>
              {/* dir="auto": most titles are Hebrew (see the publications list). */}
              <Link href={c.href} dir="auto" className="block text-sm text-white hover:underline hover:text-cyan-300 break-words">
                {c.title}
              </Link>
              <p className="mt-0.5 text-xs text-gray-400">
                {t('callMeta', { lean: c.lean, count: c.articles })}
                {' · '}
                <span className={c.state === 'cameTrue' ? 'text-emerald-400' : 'text-rose-400'}>
                  {t(c.state === 'cameTrue' ? 'outcomeYes' : 'outcomeNo')}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Resolved forecasts where this outlet's articles took a side before the outcome was public
 * (daatan#2340), both sides shown so the block can't read as a highlight reel. Describes the
 * coverage; the board above is the score.
 */
export default function OutletCalls({ heldUp, missed }: { heldUp: OutletCall[]; missed: OutletCall[] }) {
  const t = useTranslations('outletPage')
  return (
    <section className="pt-8">
      <h2 className="text-lg font-bold text-white">{t('callsTitle')}</h2>
      <p className="mt-1 mb-4 text-xs text-gray-500 max-w-2xl">{t('callsHint', { min: MIN_CALL_ARTICLES })}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <CallColumn heading={t('callsHeldUp', { count: heldUp.length })} calls={heldUp} />
        <CallColumn heading={t('callsMissed', { count: missed.length })} calls={missed} />
      </div>
    </section>
  )
}
