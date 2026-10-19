import { BookOpen } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import TermsContent from '@/components/legal/TermsContent'
import { getTranslations } from 'next-intl/server'
import { getAppUrl } from '@/lib/branding'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'footer' })
  return {
    title: t('terms'),
    // Same rationale as the locale privacy page: the rendered content is the
    // English text on every locale, so consolidate canonicals on /terms.
    alternates: { canonical: `${getAppUrl()}/terms` },
  }
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'footer' })
  
  return (
    <LegalPage title={t('terms')} Icon={BookOpen}>
      <p className="text-sm italic mb-4">
        Authoritative version in English.
      </p>
      <TermsContent />
    </LegalPage>
  )
}
