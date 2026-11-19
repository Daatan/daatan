import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import { retroMetadata } from '@/app/retroanalysis/metadata'
import EnergyRetroReport from '@/app/retroanalysis/energy-2022/EnergyRetroReport'
import rows from '@/app/retroanalysis/energy-2022/rows.json'
import pool from '@/app/retroanalysis/energy-2022/pool.json'
import prices from '@/app/retroanalysis/energy-2022/prices.json'
import type { PoolRow, Prices, ReportRow } from '@/app/retroanalysis/energy-2022/types'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return retroMetadata('retroEnergy', '/retroanalysis/energy-2022', (await params).locale)
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <EnergyRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} prices={prices as Prices} />
}
