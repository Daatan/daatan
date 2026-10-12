import { getTranslations } from 'next-intl/server'
import { CONTAINER, OutlineButton, PrimaryButton } from './ui'
import type { HomeLinks } from './links'

function Rings({ side }: { side: 'start' | 'end' }) {
  const dots =
    side === 'start'
      ? [{ cx: 302.9, cy: 144, r: 5, ok: true }, { cx: 261.6, cy: 268, r: 4, ok: false }]
      : [{ cx: 57.1, cy: 144, r: 5, ok: true }, { cx: 187.8, cy: 140.3, r: 4, ok: false }]
  return (
    <svg aria-hidden="true" width="360" height="460" viewBox="0 0 360 460" fill="none" className="block">
      {[[90, 0.32], [150, 0.22], [210, 0.14]].map(([r, o]) => (
        <circle key={r} cx="180" cy="230" r={r} stroke="#3F7DC6" strokeOpacity={o} />
      ))}
      {dots.map((d) =>
        d.ok ? (
          <circle key={d.cx} cx={d.cx} cy={d.cy} r={d.r} fill="#46B19B" />
        ) : (
          <circle key={d.cx} cx={d.cx} cy={d.cy} r={d.r} fill="#10233F" stroke="#7AA8DF" strokeWidth="1.5" />
        ),
      )}
    </svg>
  )
}

export default async function ClosingCta({ locale, links }: { locale: string; links: HomeLinks }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5' })
  return (
    <section className="relative overflow-hidden bg-[var(--hv5-panel)]">
      <div className="pointer-events-none absolute -start-[140px] top-1/2 hidden -translate-y-1/2 md:block rtl:-scale-x-100" aria-hidden="true">
        <Rings side="start" />
      </div>
      <div className="pointer-events-none absolute -end-[140px] top-1/2 hidden -translate-y-1/2 md:block rtl:-scale-x-100" aria-hidden="true">
        <Rings side="end" />
      </div>
      <div className={`${CONTAINER} relative flex flex-col items-center py-16 text-center md:py-24`}>
        <h2 className="m-0 text-[30px] font-extrabold leading-[1.2] text-white md:text-[40px]">{t('cta.title')}</h2>
        <p className="mt-3.5 text-lg leading-[1.55] text-[var(--hv5-body)] md:text-xl">{t('cta.subtitle')}</p>
        <div className="mt-9 flex w-full flex-col justify-center gap-3.5 sm:w-auto sm:flex-row">
          <PrimaryButton href={links.forecasts}>{t('hero.ctaForecasts')}</PrimaryButton>
          <OutlineButton href={links.sources}>{t('hero.ctaSources')}</OutlineButton>
        </div>
      </div>
    </section>
  )
}
