import { getContactEmail } from '@/lib/branding'
import LegalMeta from './LegalMeta'
import { MINIMUM_AGE } from './version'

const H2 = 'text-xl font-semibold text-white mb-3'

export default function PrivacyContent() {
  const email = getContactEmail()
  return (
    <>
      <LegalMeta />
      <section>
        <h2 className={H2}>1. Who We Are</h2>
        <p>
          DAATAN (daatan.com) operates this platform and is the controller of your personal data. Contact: {email}.
        </p>
      </section>

      <section>
        <h2 className={H2}>2. Information We Collect</h2>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li>Account data: your email address, name and profile picture from Google or GitHub sign-in, or the email, name and a salted password hash if you register with a password.</li>
          <li>Content you create: forecasts, commitments (stakes), comments and your resulting scores.</li>
          <li>Notification data: web-push subscriptions and Telegram identifiers, only if you enable those notifications.</li>
          <li>Usage analytics, only with your consent: page views and an internal account ID (never your email) sent to Google Analytics.</li>
        </ul>
      </section>

      <section>
        <h2 className={H2}>3. How We Use It and Why</h2>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li>To run your account, record your predictions and compute the leaderboard and reputation system (performance of the contract).</li>
          <li>To send notifications about your forecasts, resolutions and account activity (performance of the contract; push and Telegram on your opt-in).</li>
          <li>To moderate content and keep the service secure (legitimate interests).</li>
          <li>To understand and improve the product through analytics (consent).</li>
        </ul>
      </section>

      <section>
        <h2 className={H2}>4. Service Providers and Transfers</h2>
        <p>We do not sell your personal data. Providers that process data for us:</p>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li><strong>Amazon Web Services:</strong> hosting, database, email delivery infrastructure and AI model access (Bedrock).</li>
          <li><strong>Google:</strong> sign-in (OAuth), Google Analytics (with consent) and AI models (Vertex AI / Gemini).</li>
          <li><strong>GitHub:</strong> sign-in (OAuth).</li>
          <li><strong>Resend:</strong> transactional emails.</li>
          <li><strong>OpenRouter:</strong> fallback AI model access.</li>
          <li><strong>Telegram:</strong> notifications you opt into.</li>
        </ul>
        <p className="mt-2">
          Text you submit (for example forecast wording and comments) may be sent to AI providers for moderation and analysis. Some providers are located outside your country, including the United States; where required we rely on appropriate safeguards such as standard contractual clauses.
        </p>
      </section>

      <section>
        <h2 className={H2}>5. Cookies and Local Storage</h2>
        <p>
          Essential cookies keep you signed in and remember your preferences. Analytics cookies are used only if you accept them in the cookie banner; the choice is stored in your browser and you can change it at any time with the &quot;Cookie settings&quot; link in the footer. We use no advertising and no cross-site tracking.
        </p>
      </section>

      <section>
        <h2 className={H2}>6. Retention</h2>
        <p>
          DAATAN is a permanent track-record product, so forecasts and commitments are kept while your account exists. Deleting your account (Settings → Delete account) removes your account and associated data immediately. &quot;Forget history&quot; in Settings instead detaches you from your resolved commitments and resets your derived scores, while other users&apos; scores computed against them stay intact. Server backups are overwritten on their regular rotation.
        </p>
      </section>

      <section>
        <h2 className={H2}>7. Your Rights</h2>
        <p>
          Depending on where you live, you have the right to access, correct, export, restrict or object to the processing of your data, to withdraw consent, and to lodge a complaint with your data-protection authority. You can delete your account yourself in Settings, or write to {email} for any of these requests.
        </p>
      </section>

      <section>
        <h2 className={H2}>8. Children</h2>
        <p>
          DAATAN is not intended for anyone under {MINIMUM_AGE}. If you believe a child has registered, contact {email} and we will delete the account.
        </p>
      </section>

      <section>
        <h2 className={H2}>9. Changes</h2>
        <p>
          We will update the &quot;Last updated&quot; date above when this policy changes.
        </p>
      </section>

      <section>
        <h2 className={H2}>10. Contact Us</h2>
        <p>
          Questions about this Privacy Policy: {email}.
        </p>
      </section>
    </>
  )
}
