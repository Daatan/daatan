import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import IsraelRetroReport from './IsraelRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import polls from './polls.json'
import type { PollSeats, PoolRow, ReportRow } from './types'

export const metadata: Metadata = {
  title: 'Who Saw 64 Seats Coming — Retro Analysis',
  description:
    "1,100 statements from the six months before Israel's November 2022 Knesset election, each rated for how likely its speaker thought a 61-seat majority for Netanyahu's bloc was.",
  alternates: { canonical: '/retroanalysis/israel-2022' },
  openGraph: { url: '/retroanalysis/israel-2022', type: 'article' },
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <IsraelRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} polls={polls as PollSeats[]} />
}
