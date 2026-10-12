import { ChevronRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import RadarArt from './RadarArt'
import { CONTAINER, OutlineButton, PrimaryButton } from './ui'
import type { HomeLinks } from './links'

type StepKind = 'ring' | 'dot' | 'glow' | 'target'

function StepMark({ kind }: { kind: StepKind }) {
  const box = 'flex h-6 w-6 items-center justify-center bg-[var(--hv5-bg)]'
  if (kind === 'ring') return <span className={box}><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--hv5-accent-2)]" /></span>
  if (kind === 'dot') return <span className={box}><span className="h-2.5 w-2.5 rounded-full bg-[var(--hv5-accent-2)]" /></span>
  if (kind === 'glow')
    return <span className={box}><span className="h-3.5 w-3.5 rounded-full bg-[var(--hv5-accent)] shadow-[0_0_0_4px_rgba(63,125,198,0.28)]" /></span>
  return (
    <span className={box}>
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-[var(--hv5-accent)]">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--hv5-accent)]" />
      </span>
    </span>
  )
}

const RADAR_LABELS = [
  { top: '20%', title: 'radarOpenTitle', sub: 'radarOpenSub' },
  { top: '46.8%', title: 'radarResultsTitle', sub: 'radarResultsSub' },
  { top: '77.1%', title: 'radarRecordTitle', sub: 'radarRecordSub' },
] as const

export default async function Hero({ locale, links }: { locale: string; links: HomeLinks }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5.hero' })
  const steps: { key: string; kind: StepKind }[] = [
    { key: 'stepForecasts', kind: 'ring' },
    { key: 'stepResults', kind: 'dot' },
    { key: 'stepRecord', kind: 'glow' },
    { key: 'stepReputation', kind: 'target' },
  ]

  return (
    <section className="relative overflow-hidden bg-[var(--hv5-bg)]">
      <div className="pointer-events-none absolute -start-4 top-3 h-[320px] w-[280px] opacity-40 md:hidden ltr:-scale-x-100" aria-hidden="true">
        <RadarArt />
      </div>
      <div className={`${CONTAINER} relative flex flex-wrap items-center gap-10 pb-14 pt-10 md:pb-[104px] md:pt-[72px]`}>
        <div className="flex min-w-0 flex-[1_1_460px] flex-col items-start">
          <p className="mb-3.5 text-[15px] font-semibold text-[var(--hv5-accent-2)] md:mb-[18px] md:text-[17px]">{t('eyebrow')}</p>
          <h1 className="mb-6 text-[40px] font-extrabold leading-[1.1] tracking-[-0.01em] text-white md:text-[62px] md:leading-[1.06]">
            {t('titleLine1')}
            <br />
            {t('titleLine2')}
          </h1>
          <p className="mb-7 max-w-[30em] text-[17px] leading-[1.6] text-[var(--hv5-body)] md:mb-9 md:text-xl">{t('body')}</p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:gap-3.5">
            <PrimaryButton href={links.forecasts}>{t('ctaForecasts')}</PrimaryButton>
            <OutlineButton href={links.sources}>{t('ctaSources')}</OutlineButton>
          </div>
          <div className="relative mt-10 w-full max-w-[460px] md:mt-[52px]">
            <div aria-hidden="true" className="absolute inset-x-7 top-3 h-px bg-[#2c5a92]" />
            <ol aria-label={t('stepsLabel')} className="relative m-0 flex list-none items-start justify-between p-0">
              {steps.flatMap((s, i) => {
                const item = (
                  <li key={s.key} className="flex min-w-[52px] flex-col items-center gap-3">
                    <StepMark kind={s.kind} />
                    <span className="text-base font-semibold text-[var(--hv5-body)]">{t(s.key)}</span>
                  </li>
                )
                if (i === steps.length - 1) return [item]
                return [
                  item,
                  <li key={`${s.key}-sep`} aria-hidden="true" className="flex h-6 items-center bg-[var(--hv5-bg)] px-1 text-[var(--hv5-accent)]">
                    <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2} />
                  </li>,
                ]
              })}
            </ol>
          </div>
        </div>
        <div className="relative hidden aspect-[612/560] w-[612px] max-w-full flex-[0_1_612px] md:block">
          <div className="absolute inset-0 ltr:-scale-x-100">
            <RadarArt />
          </div>
          {RADAR_LABELS.map((l) => (
            <div key={l.title} className="absolute end-0 w-[134px] text-start" style={{ top: l.top }}>
              <span className="block text-[15px] font-bold leading-[1.3] text-[var(--hv5-ink)]">{t(l.title)}</span>
              <span className="block text-sm leading-[1.35] text-[var(--hv5-muted)]">{t(l.sub)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
