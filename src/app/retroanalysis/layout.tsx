import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('retroIndex.meta')
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: '/retroanalysis' },
    openGraph: { url: '/retroanalysis', type: 'website' },
  }
}

export default function RetroanalysisLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
