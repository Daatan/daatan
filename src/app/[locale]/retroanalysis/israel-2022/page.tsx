import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import { retroMetadata } from '@/app/retroanalysis/metadata'
import IsraelRetroReport from '@/app/retroanalysis/israel-2022/IsraelRetroReport'
import rows from '@/app/retroanalysis/israel-2022/rows.json'
import pool from '@/app/retroanalysis/israel-2022/pool.json'
import polls from '@/app/retroanalysis/israel-2022/polls.json'
import type { PollSeats, PoolRow, ReportRow } from '@/app/retroanalysis/israel-2022/types'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return retroMetadata('retroIsrael', '/retroanalysis/israel-2022', (await params).locale)
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <IsraelRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} polls={polls as PollSeats[]} />
}
