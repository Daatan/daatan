import { BarChart3, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ForecastCard, SourceCard } from './cards'
import type { ForecastCardData, SourceCardData } from './cards'
import { CONTAINER, OutlineButton, PrimaryButton } from './ui'
import type { HomeLinks } from './links'

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="m-0 mt-6 flex list-none flex-col gap-2.5 p-0">
      {items.map((b) => (
        <li key={b} className="flex items-center gap-3">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--hv5-accent)" />
          <span className="text-base leading-normal text-(--hv5-light-body) md:text-[17px]">{b}</span>
        </li>
      ))}
    </ul>
  )
}

function Heading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 lg:self-start">
      <span aria-hidden="true" className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[10px] bg-(--hv5-light-icon-bg) text-(--hv5-accent) md:h-[46px] md:w-[46px]">
        {icon}
      </span>
      <h3 className="m-0 text-[26px] font-extrabold leading-[1.2] text-(--hv5-light-ink) md:text-3xl md:leading-9">{children}</h3>
    </div>
  )
}

// Desktop: both columns are subgrids sharing the parent's five rows (heading,
// tagline, bullets, card, CTA), so the two dark cards start and end at the
// same y — and the CTA rows line up — whatever each locale's text heights are.
// Every column always has exactly five children (the card slot renders even
// when its card is absent), so the CTA never slips into the card row.
// Mobile/tablet (< lg) stays a plain single-column flex stack.
const COLUMN = 'flex flex-col lg:row-span-5 lg:grid lg:grid-rows-subgrid lg:gap-y-0'
const CARD_SLOT = 'flex flex-col'

const LINK = 'text-base font-semibold text-(--hv5-accent) underline decoration-1 underline-offset-[5px] md:text-[17px]'

export default async function TwoUses({
  locale,
  links,
  forecast,
  source,
}: {
  locale: string
  links: HomeLinks
  forecast?: ForecastCardData
  source?: SourceCardData
}) {
  const t = await getTranslations({ locale, namespace: 'HomeV5' })
  const retroLabel = t('nav.retro')
  return (
    <section className="bg-(--hv5-light-bg) py-16 md:py-[120px]">
      <div className={CONTAINER}>
        <h2 className="m-0 text-[28px] font-extrabold leading-[1.2] text-(--hv5-light-ink) md:text-[42px] md:leading-[1.15]">{t('uses.title')}</h2>
        <p className="mt-3 max-w-[40em] text-[17px] leading-[1.55] text-(--hv5-light-body) md:mt-3.5 md:text-xl md:leading-7">{t('uses.subtitle')}</p>
        <div className="mt-11 grid grid-cols-1 gap-x-0 gap-y-[52px] md:mt-[72px] lg:grid-cols-2 lg:gap-y-0">
          <article className={`${COLUMN} lg:pe-14`}>
            <Heading icon={<BarChart3 className="h-6 w-6" strokeWidth={1.75} />}>{t('uses.forecastsTitle')}</Heading>
            <p className="mt-3.5 text-[17px] leading-normal text-(--hv5-light-body) md:text-[19px]">{t('uses.forecastsTagline')}</p>
            <Bullets items={[t('uses.forecastsB1'), t('uses.forecastsB2'), t('uses.forecastsB3')]} />
            <div className={CARD_SLOT}>{forecast && <ForecastCard locale={locale} data={forecast} />}</div>
            <div className="mt-5 flex flex-col md:mt-7 md:flex-row lg:self-start">
              <PrimaryButton href={links.forecasts}>{t('hero.ctaForecasts')}</PrimaryButton>
            </div>
          </article>
          <article className={`${COLUMN} border-(--hv5-light-rule) lg:border-s lg:ps-14`}>
            <Heading icon={<Users className="h-6 w-6" strokeWidth={1.75} />}>{t('uses.sourcesTitle')}</Heading>
            <p className="mt-3.5 text-[17px] leading-normal text-(--hv5-light-body) md:text-[19px]">{t('uses.sourcesTagline')}</p>
            <Bullets items={[t('uses.sourcesB1'), t('uses.sourcesB2'), t('uses.sourcesB3')]} />
            <div className={CARD_SLOT}>{source && <SourceCard locale={locale} data={source} />}</div>
            <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-4 md:mt-7 lg:self-start">
              <OutlineButton href={links.sources} light className="max-md:w-full">{t('hero.ctaSources')}</OutlineButton>
              <span className="flex gap-7 max-md:w-full max-md:justify-center">
                <a href={links.elections} className={LINK}>{t('nav.elections')}</a>
                <a href={links.retro} className={LINK}>{retroLabel}</a>
              </span>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
