import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import { retroMetadata } from '@/app/retroanalysis/metadata'
import UkraineRetroReport from '@/app/retroanalysis/ukraine-2022/UkraineRetroReport'
import rows from '@/app/retroanalysis/ukraine-2022/rows.json'
import pool from '@/app/retroanalysis/ukraine-2022/pool.json'
import type { PoolRow, ReportRow } from '@/app/retroanalysis/ukraine-2022/types'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return retroMetadata('retroUkraine', '/retroanalysis/ukraine-2022', (await params).locale)
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <UkraineRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} />
}
