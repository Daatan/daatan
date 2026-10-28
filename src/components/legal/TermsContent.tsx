import { getContactEmail } from '@/lib/branding'
import LegalMeta from './LegalMeta'
import { MINIMUM_AGE } from './version'

const H2 = 'text-xl font-semibold text-white mb-3'

export default function TermsContent() {
  return (
    <>
      <LegalMeta />
      <section>
        <h2 className={H2}>1. Acceptance of Terms</h2>
        <p>
          By creating an account or using DAATAN, you agree to be bound by these Terms of Service and by our Privacy Policy and Disclaimer. If you do not agree, please do not use our services.
        </p>
      </section>

      <section>
        <h2 className={H2}>2. Forecast Tracking Nature</h2>
        <p>
          DAATAN is a forecast tracking platform for informational purposes. Confidence Units (CU) and Reputation Score (RS) have <strong>no monetary value</strong>. They cannot be bought, sold, or redeemed for cash or physical goods.
        </p>
      </section>

      <section>
        <h2 className={H2}>3. Eligibility and Accounts</h2>
        <p>
          You must be at least {MINIMUM_AGE} years old to create an account. You are responsible for keeping your credentials secure and for activity under your account.
        </p>
      </section>

      <section>
        <h2 className={H2}>4. User Conduct</h2>
        <p>
          You agree not to use DAATAN for any illegal or unauthorized purpose. You must not:
        </p>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li>Create multiple accounts to manipulate market outcomes.</li>
          <li>Spam or abuse other users in comments.</li>
          <li>Post unlawful, defamatory, or infringing content.</li>
          <li>Attempt to interfere with the proper working of the platform.</li>
          <li>Misrepresent your identity or credentials.</li>
        </ul>
      </section>

      <section>
        <h2 className={H2}>5. Your Content</h2>
        <p>
          You keep ownership of the forecasts and comments you post. You grant DAATAN a worldwide, non-exclusive, royalty-free licence to host, display, score, and distribute them as part of the platform. Because DAATAN is a permanent track-record product, your resolved forecasts may remain visible and continue to feed other users&apos; scores; you can delete your account or detach your resolved history at any time from Settings (see the Privacy Policy). Comments are moderated automatically, and we may remove content that breaks these Terms. To report content, write to {getContactEmail()}.
        </p>
      </section>

      <section>
        <h2 className={H2}>6. Forecast Resolution</h2>
        <p>
          Forecasts are resolved by designated resolvers based on the criteria specified at the time of creation. Resolutions are final once processed, except where we correct a clear error.
        </p>
      </section>

      <section>
        <h2 className={H2}>7. AI-Generated Content</h2>
        <p>
          Some content is generated or informed by AI systems and may be wrong. See the Disclaimer for details.
        </p>
      </section>

      <section>
        <h2 className={H2}>8. Suspension and Termination</h2>
        <p>
          We may suspend or close accounts that violate these Terms. You may stop using DAATAN and delete your account at any time.
        </p>
      </section>

      <section>
        <h2 className={H2}>9. Disclaimer of Warranties</h2>
        <p>
          DAATAN is provided &quot;as is&quot; without any warranties. We do not guarantee the accuracy of predictions or the continuous availability of the service.
        </p>
      </section>

      <section>
        <h2 className={H2}>10. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, DAATAN and its developers shall not be liable for any indirect, incidental, or consequential damages arising from your use of the platform.
        </p>
      </section>

      <section>
        <h2 className={H2}>11. Changes to These Terms</h2>
        <p>
          We may update these Terms. The &quot;Last updated&quot; date above shows the current version; continuing to use DAATAN after a change means you accept it.
        </p>
      </section>

      <section>
        <h2 className={H2}>12. Governing Law and Jurisdiction</h2>
        <p>
          These Terms and your use of DAATAN are governed by the laws of the State of Israel, without regard to its conflict-of-laws rules. The competent courts in Tel Aviv-Jaffa have exclusive jurisdiction over any dispute arising from them, except where the mandatory law of your place of residence gives you the right to bring a claim elsewhere.
        </p>
      </section>

      <section>
        <h2 className={H2}>13. Contact</h2>
        <p>
          For any legal inquiries, please contact {getContactEmail()}.
        </p>
      </section>
    </>
  )
}
