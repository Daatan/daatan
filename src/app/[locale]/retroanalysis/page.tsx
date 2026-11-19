import type { Metadata } from 'next'
import RetroIndex from '@/app/retroanalysis/RetroIndex'
import { retroMetadata } from '@/app/retroanalysis/metadata'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return retroMetadata('retroIndex', '/retroanalysis', (await params).locale)
}

export default function LocaleRetroanalysisPage() {
  return <RetroIndex />
}
