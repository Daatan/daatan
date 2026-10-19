import { Shield } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import PrivacyContent from '@/components/legal/PrivacyContent'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: "DAATAN's Privacy Policy: what data we collect, how we use and protect it, your rights, and how cookies and authentication work on the forecasting platform.",
  alternates: {
    canonical: '/privacy',
    // he/ru render this same English text (see [locale]/privacy/page.tsx) —
    // matches the hreflang shape sitemap.ts already emits for this route.
    languages: { 'x-default': '/privacy', en: '/privacy', he: '/he/privacy', ru: '/ru/privacy' },
  },
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" Icon={Shield}>
      <PrivacyContent />
    </LegalPage>
  )
}
