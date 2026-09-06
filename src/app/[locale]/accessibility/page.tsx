import type { Metadata } from 'next'
import { Accessibility } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import LegalPage from '@/components/LegalPage'
import { getAppUrl, getContactEmail } from '@/lib/branding'

const LAST_REVIEWED = 'September 6, 2026'
/** The election-forecast site links back to this statement from every page. */
const ELECTIONS_URL = 'https://elections.daatan.com'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'accessibility' })
  const appUrl = getAppUrl()
  return {
    title: t('title'),
    description: t('metaDescription'),
    alternates: {
      canonical: `${appUrl}/${locale}/accessibility`,
      languages: {
        'x-default': `${appUrl}/accessibility`,
        en: `${appUrl}/accessibility`,
        he: `${appUrl}/he/accessibility`,
        ru: `${appUrl}/ru/accessibility`,
      },
    },
  }
}

export default async function LocaleAccessibilityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'accessibility' })
  const contactEmail = getContactEmail()

  return (
    <div dir={locale === 'he' ? 'rtl' : 'ltr'}>
      <LegalPage title={t('title')} Icon={Accessibility}>
        <p className="text-sm text-text-subtle">{t('lastReviewed', { date: LAST_REVIEWED })}</p>

        <p>
          {t.rich('body', {
            wcag: (chunks) => (
              <a href="https://www.w3.org/TR/WCAG20/" target="_blank" rel="noopener noreferrer" className="text-cobalt-light hover:underline">
                {chunks}
              </a>
            ),
            email: (chunks) => (
              <a href={`mailto:${contactEmail}`} className="text-cobalt-light hover:underline">
                {chunks}
              </a>
            ),
            emailAddress: contactEmail,
          })}
        </p>

        <p>
          {t.rich('scope', {
            elections: (chunks) => (
              <a href={ELECTIONS_URL} className="text-cobalt-light hover:underline">
                {chunks}
              </a>
            ),
          })}
        </p>
      </LegalPage>
    </div>
  )
}
