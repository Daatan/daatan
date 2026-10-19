import { BookOpen } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import TermsContent from '@/components/legal/TermsContent'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: "DAATAN's Terms of Service: the rules for using the reputation-based forecasting platform — account responsibilities, acceptable use, and how forecasts and scoring work.",
  alternates: {
    canonical: '/terms',
    // he/ru render this same English text (see [locale]/terms/page.tsx) —
    // matches the hreflang shape sitemap.ts already emits for this route.
    languages: { 'x-default': '/terms', en: '/terms', he: '/he/terms', ru: '/ru/terms' },
  },
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" Icon={BookOpen}>
      <TermsContent />
    </LegalPage>
  )
}
