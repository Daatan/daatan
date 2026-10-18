import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isSelfHosted } from '@/lib/edition'
import UkraineRetroReport from './UkraineRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import type { PoolRow, ReportRow } from './types'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('retroUkraine.meta')
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/retroanalysis/ukraine-2022' },
    openGraph: { url: '/retroanalysis/ukraine-2022', type: 'article' },
  }
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <UkraineRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} />
}
