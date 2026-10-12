import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import HomeV5 from '@/components/home-v5/HomeV5'
import { homeV5Metadata } from '@/components/home-v5/meta'
import type { Locale } from '@/i18n/config'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return homeV5Metadata(await getLocale())
}

export default async function HomeV5Page() {
  return <HomeV5 locale={(await getLocale()) as Locale} />
}
