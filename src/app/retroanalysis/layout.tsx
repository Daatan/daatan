import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Retro Analysis',
  description:
    "Retrospective case studies on DAATAN: who saw a real event coming, rated from what each speaker published at the time.",
  alternates: { canonical: '/retroanalysis' },
  openGraph: { url: '/retroanalysis', type: 'website' },
}

export default function RetroanalysisLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
