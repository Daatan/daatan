import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import { retroMetadata } from '../metadata'
import EnergyRetroReport from './EnergyRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import prices from './prices.json'
import type { PoolRow, Prices, ReportRow } from './types'

export function generateMetadata(): Promise<Metadata> {
  return retroMetadata('retroEnergy', '/retroanalysis/energy-2022')
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <EnergyRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} prices={prices as Prices} />
}
