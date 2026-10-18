import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isSelfHosted } from '@/lib/edition'
import IsraelRetroReport from './IsraelRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import polls from './polls.json'
import type { PollSeats, PoolRow, ReportRow } from './types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('retroIsrael.meta')
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/retroanalysis/israel-2022' },
    openGraph: { url: '/retroanalysis/israel-2022', type: 'article' },
  }
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <IsraelRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} polls={polls as PollSeats[]} />
}
