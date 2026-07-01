import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Activity',
  description:
    "Live feed of every forecast on DAATAN as it happens — new predictions, incoming commitments, and resolved outcomes. Follow the community's calls in real time.",
  alternates: { canonical: '/activity' },
  openGraph: { url: '/activity', type: 'website' },
}

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
