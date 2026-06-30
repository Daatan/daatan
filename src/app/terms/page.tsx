import { BookOpen } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: "DAATAN's Terms of Service: the rules for using the reputation-based forecasting platform — account responsibilities, acceptable use, and how forecasts and scoring work.",
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" Icon={BookOpen}>
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
