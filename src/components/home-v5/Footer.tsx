import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CONTAINER } from './ui'
import type { HomeLinks } from './links'

export default async function Footer({ locale, links }: { locale: string; links: HomeLinks }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5' })
  const items = [
    { href: links.forecasts, label: t('nav.forecasts') },
    { href: links.sources, label: t('nav.sources') },
    { href: links.elections, label: t('nav.elections') },
    { href: links.retro, label: t('nav.retro') },
    { href: links.howItWorks, label: t('nav.howItWorks') },
    { href: links.about, label: t('nav.about') },
    { href: links.contact, label: t('footer.contact') },
    { href: links.privacy, label: t('footer.privacy') },
    { href: links.terms, label: t('footer.terms') },
  ]
  return (
    <footer className="border-t border-[var(--hv5-line)] bg-[var(--hv5-bg)]">
      <div className={`${CONTAINER} pb-14 pt-12`}>
        <div className="flex flex-wrap items-center justify-between gap-7">
          <Image src="/home-v5/logo.png" alt="Daatan" width={292} height={129} className="h-9 w-auto" />
          <nav aria-label={t('footer.label')} className="flex flex-wrap gap-x-[26px] gap-y-3.5">
            {items.map((i) => (
              <Link key={i.href + i.label} href={i.href} className="text-[15px] text-[var(--hv5-muted)] no-underline hover:text-white">
                {i.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="m-0 mt-8 max-w-[52em] text-sm leading-[1.6] text-[var(--hv5-muted)]">{t('footer.disclaimer')}</p>
      </div>
    </footer>
  )
}
