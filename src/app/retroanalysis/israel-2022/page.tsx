import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import { retroMetadata } from '../metadata'
import IsraelRetroReport from './IsraelRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import polls from './polls.json'
import type { PollSeats, PoolRow, ReportRow } from './types'

export function generateMetadata(): Promise<Metadata> {
  return retroMetadata('retroIsrael', '/retroanalysis/israel-2022')
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <IsraelRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} polls={polls as PollSeats[]} />
}
