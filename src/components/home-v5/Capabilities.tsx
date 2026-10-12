import { Compass, Radio, Scale, Target } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { CONTAINER } from './ui'

export default async function Capabilities({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5.capabilities' })
  const items = [
    { icon: Target, title: t('expertiseTitle'), body: t('expertiseBody') },
    { icon: Scale, title: t('benchmarkTitle'), body: t('benchmarkBody') },
    { icon: Radio, title: t('trendsTitle'), body: t('trendsBody') },
    { icon: Compass, title: t('decisionsTitle'), body: t('decisionsBody') },
  ]
  return (
    <section className="bg-[var(--hv5-bg)] pb-14 pt-16 md:pb-28 md:pt-[120px]">
      <div className={CONTAINER}>
        <h2 className="m-0 text-[28px] font-extrabold leading-[1.2] text-white md:text-[42px] md:leading-[1.15]">{t('title')}</h2>
        <p className="mt-3 max-w-[38em] text-[17px] leading-[1.6] text-[var(--hv5-body)] md:mt-3.5 md:text-xl">{t('subtitle')}</p>
        <ul className="m-0 mt-8 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-x-10 gap-y-12 p-0 md:mt-16">
          {items.map(({ icon: Icon, title, body }) => (
            <li key={title} className="border-t border-[#1e3858] pt-7">
              <Icon className="h-[30px] w-[30px] text-[var(--hv5-accent-2)]" strokeWidth={1.6} aria-hidden="true" />
              <h3 className="m-0 mt-[18px] text-[21px] font-bold leading-[1.3] text-white">{title}</h3>
              <p className="m-0 mt-2.5 text-[17px] leading-[1.55] text-[var(--hv5-muted)]">{body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-16 flex flex-wrap items-baseline gap-x-12 gap-y-4 border-t border-[#1e3858] pt-11 md:mt-[88px]">
          <p className="m-0 text-base font-semibold text-[var(--hv5-accent-2)]">{t('leadsTo')}</p>
          <p className="m-0 max-w-[34em] flex-[1_1_520px] text-xl font-semibold leading-[1.5] text-[var(--hv5-ink)] md:text-[26px]">{t('leadsToBody')}</p>
        </div>
      </div>
    </section>
  )
}
