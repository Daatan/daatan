import { Shield } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import { getTranslations } from 'next-intl/server'
import { getAppUrl, getContactEmail } from '@/lib/branding'

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
      <section>
        <h2 className="text-xl font-semibold text-white mb-3">1. Information We Collect</h2>
        <p>
          When you sign in to DAATAN, we collect information provided by your authentication provider (Google or GitHub), including your email address, name, and profile picture.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">2. How We Use Your Information</h2>
        <p>
          We use your information to:
        </p>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li>Identify your predictions and commitments on the platform.</li>
          <li>Send you important notifications about your forecasts, resolutions, and account activity.</li>
          <li>Maintain the integrity of our leaderboard and reputation system.</li>
          <li>Improve our services through analytics.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">3. Data Sharing and Third Parties</h2>
        <p>
          We do not sell your personal data. We use trusted third-party services to provide our platform:
        </p>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li><strong>AWS & Vercel:</strong> For hosting and infrastructure.</li>
          <li><strong>Google Analytics:</strong> To understand how users interact with our platform.</li>
          <li><strong>Resend:</strong> To send transactional emails.</li>
          <li><strong>Prisma/PostgreSQL:</strong> To store your prediction data.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">4. Cookies</h2>
        <p>
          We use cookies to keep you signed in and to remember your preferences. You can manage your cookie settings through our cookie consent banner.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">5. Your Rights</h2>
        <p>
          You can request to delete your account and associated data at any time by contacting us at {getContactEmail()}.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">6. Contact Us</h2>
        <p>
          If you have any questions about this Privacy Policy, please contact us at {getContactEmail()}.
        </p>
      </section>
    </LegalPage>
  )
}
