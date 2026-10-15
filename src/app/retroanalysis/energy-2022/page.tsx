import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import EnergyRetroReport from './EnergyRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import prices from './prices.json'
import type { PoolRow, Prices, ReportRow } from './types'

export const metadata: Metadata = {
  title: 'Who Saw $120 Oil and €200 Gas — Retro Analysis',
  description:
    '280 statements from the six months before the February 2022 invasion, each rated for how likely its speaker thought Brent above $120 and TTF gas above €200/MWh were.',
  alternates: { canonical: '/retroanalysis/energy-2022' },
  openGraph: { url: '/retroanalysis/energy-2022', type: 'article' },
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <EnergyRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} prices={prices as Prices} />
}
