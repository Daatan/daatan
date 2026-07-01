import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Retro Analysis',
  description:
    "Retrospective analyses on DAATAN: how real-world events resolved versus the community's forecasts, scored for accuracy across politics, war, and energy.",
  alternates: { canonical: '/retroanalysis' },
  openGraph: { url: '/retroanalysis', type: 'website' },
}

export default function RetroanalysisLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
