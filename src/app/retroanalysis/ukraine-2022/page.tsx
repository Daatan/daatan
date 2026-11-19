import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import { retroMetadata } from '../metadata'
import UkraineRetroReport from './UkraineRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import type { PoolRow, ReportRow } from './types'

export function generateMetadata(): Promise<Metadata> {
  return retroMetadata('retroUkraine', '/retroanalysis/ukraine-2022')
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <UkraineRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} />
}
