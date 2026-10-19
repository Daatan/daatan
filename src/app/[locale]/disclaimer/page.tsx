import { AlertTriangle } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import DisclaimerContent from '@/components/legal/DisclaimerContent'
import { getTranslations } from 'next-intl/server'
import { getAppUrl } from '@/lib/branding'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'footer' })
  return {
    title: t('disclaimer'),
    alternates: { canonical: `${getAppUrl()}/disclaimer` },
  }
}

export default async function DisclaimerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'footer' })

  return (
    <LegalPage title={t('disclaimer')} Icon={AlertTriangle}>
      <p className="text-sm italic mb-4">
        Authoritative version in English.
      </p>
      <DisclaimerContent />
    </LegalPage>
  )
}
