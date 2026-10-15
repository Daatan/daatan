import Image from 'next/image'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import MobileMenu from './MobileMenu'
import { CONTAINER } from './ui'
import type { HomeLinks } from './links'

export default async function Header({ locale, links, signedIn }: { locale: string; links: HomeLinks; signedIn: boolean }) {
  const t = await getTranslations({ locale, namespace: 'HomeV5.nav' })
  const tf = await getTranslations({ locale, namespace: 'HomeV5.footer' })
  const items = [
    { href: links.forecasts, label: t('forecasts') },
    { href: links.sources, label: t('sources') },
    { href: links.elections, label: t('elections') },
    { href: links.retro, label: t('retro') },
    { href: links.howItWorks, label: t('howItWorks') },
    { href: links.about, label: t('about') },
  ]
  const logo = (
    <Link href={links.home} aria-label={t('home')} className="flex shrink-0 items-center">
      <Image src="/home-v5/logo.png" alt="" width={292} height={129} priority className="h-8 w-auto md:h-10" />
    </Link>
  )

  return (
    <header className="border-b border-[var(--hv5-line)] bg-[var(--hv5-bg)]">
      <div className="flex h-16 items-center justify-between ps-2 pe-5 md:hidden">
        {logo}
        <MobileMenu
          links={links}
          items={items}
          signedIn={signedIn}
          labels={{
            menu: t('menu'),
            close: t('closeMenu'),
            search: t('search'),
            searchPlaceholder: t('searchPlaceholder'),
            nav: t('label'),
            create: t('create'),
            login: t('login'),
            profile: t('profile'),
            contact: tf('contact'),
            privacy: tf('privacy'),
            terms: tf('terms'),
            home: t('home'),
          }}
        />
      </div>
      <div className={`${CONTAINER} hidden min-h-[76px] items-center gap-10 md:flex`}>
        {logo}
        <nav aria-label={t('label')} className="flex flex-1 flex-wrap items-center gap-[30px]">
          {items.map((i) => (
            <Link key={i.href + i.label} href={i.href} className="text-base font-medium text-[var(--hv5-body)] no-underline hover:text-white">
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-[18px]">
          <Link href={links.forecasts} aria-label={t('search')} className="flex h-11 w-11 items-center justify-center text-[var(--hv5-body)] hover:text-white">
            <Search className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link
            href={signedIn ? links.profile : links.login}
            className="text-base font-medium text-[var(--hv5-body)] no-underline hover:text-white"
          >
            {signedIn ? t('profile') : t('login')}
          </Link>
          <Link
            href={links.create}
            className="inline-flex h-11 items-center whitespace-nowrap rounded-lg bg-[var(--hv5-accent)] px-5 text-[17px] font-bold text-white no-underline hover:bg-[#4a8bd6]"
          >
            {t('create')}
          </Link>
        </div>
      </div>
    </header>
  )
}
