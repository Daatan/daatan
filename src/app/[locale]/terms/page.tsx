import { BookOpen } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
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
      <section>
        <h2 className="text-xl font-semibold text-white mb-3">1. Acceptance of Terms</h2>
        <p>
          By accessing or using DAATAN, you agree to be bound by these Terms of Service. If you do not agree, please do not use our services.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">2. Forecast Tracking Nature</h2>
        <p>
          DAATAN is a forecast tracking platform for informational and entertainment purposes. Confidence Units (CU) and Reputation Score (RS) have <strong>no monetary value</strong>. They cannot be bought, sold, or redeemed for cash or physical goods.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">3. User Conduct</h2>
        <p>
          You agree not to use DAATAN for any illegal or unauthorized purpose. You must not:
        </p>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li>Create multiple accounts to manipulate market outcomes.</li>
          <li>Spam or abuse other users in comments.</li>
          <li>Attempt to interfere with the proper working of the platform.</li>
          <li>Misrepresent your identity or credentials.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">4. Forecast Resolution</h2>
        <p>
          Forecasts are resolved by designated resolvers based on the criteria specified at the time of creation. Resolutions are final once processed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">5. Disclaimer of Warranties</h2>
        <p>
          DAATAN is provided &quot;as is&quot; without any warranties. We do not guarantee the accuracy of predictions or the continuous availability of the service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">6. Limitation of Liability</h2>
        <p>
          DAATAN and its developers shall not be liable for any indirect, incidental, or consequential damages arising from your use of the platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">7. Contact</h2>
        <p>
          For any legal inquiries, please contact office@daatan.com.
        </p>
      </section>
    </LegalPage>
  )
}
