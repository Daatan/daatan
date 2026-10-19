import { Shield } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import PrivacyContent from '@/components/legal/PrivacyContent'
import { getTranslations } from 'next-intl/server'
import { getAppUrl } from '@/lib/branding'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'footer' })
  return {
    title: t('privacy'),
    // Content is the same English text on every locale (page literally says
    // "Authoritative version in English"), so consolidate the duplicates by
    // pointing all locale canonicals at the en URL until the content is translated.
    alternates: { canonical: `${getAppUrl()}/privacy` },
  }
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'footer' })
  
  return (
    <LegalPage title={t('privacy')} Icon={Shield}>
      <p className="text-sm italic mb-4">
        Authoritative version in English.
      </p>
      <PrivacyContent />
    </LegalPage>
  )
}
