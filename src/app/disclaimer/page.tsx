import { AlertTriangle } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import DisclaimerContent from '@/components/legal/DisclaimerContent'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: 'DAATAN Disclaimer: forecasts and AI estimates are informational only — not financial, legal, or professional advice. Understand the limits before relying on them.',
  alternates: {
    canonical: '/disclaimer',
    // he/ru render this same English text (see [locale]/disclaimer/page.tsx) —
    // matches the hreflang shape sitemap.ts already emits for this route.
    languages: { 'x-default': '/disclaimer', en: '/disclaimer', he: '/he/disclaimer', ru: '/ru/disclaimer' },
  },
}

export default function DisclaimerPage() {
  return (
    <LegalPage title="Disclaimer" Icon={AlertTriangle}>
      <DisclaimerContent />
    </LegalPage>
  )
}
