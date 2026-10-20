import type { Metadata } from 'next'
import HomeV5 from '@/components/home-v5/HomeV5'
import { homeV5Metadata } from '@/components/home-v5/meta'
import type { Locale } from '@/i18n/config'


export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return homeV5Metadata(locale)
}

export default async function LocaleHomeV5Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return <HomeV5 locale={locale as Locale} />
}
