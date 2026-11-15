import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Activity',
  description:
    "Recent commitments on DAATAN — who forecast what, and how much they staked. Follow the community's calls as they come in.",
  alternates: { canonical: '/activity' },
  openGraph: { url: '/activity', type: 'website' },
}

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
