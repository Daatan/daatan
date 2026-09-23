import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import UkraineRetroReport from './UkraineRetroReport'
import rows from './rows.json'
import pool from './pool.json'
import type { PoolRow, ReportRow } from './types'

export const metadata: Metadata = {
  title: 'Who Saw February 24 Coming — Retro Analysis',
  description:
    "913 statements from the three months before Russia's full-scale invasion of Ukraine, each rated for how likely its speaker thought the invasion was.",
  alternates: { canonical: '/retroanalysis/ukraine-2022' },
  openGraph: { url: '/retroanalysis/ukraine-2022', type: 'article' },
}

export default function Page() {
  if (isSelfHosted()) notFound()
  return <UkraineRetroReport rows={rows as ReportRow[]} pool={pool as PoolRow[]} />
}
