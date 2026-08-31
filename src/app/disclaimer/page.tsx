import { AlertTriangle } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'
import { isSelfHosted } from '@/lib/edition'
import { getContactEmail } from '@/lib/branding'

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: 'DAATAN Disclaimer: forecasts and AI estimates are informational only — not financial, legal, or professional advice. Understand the limits before relying on them.',
  alternates: {
    canonical: '/disclaimer',
    // he/ru render this same English text (see [locale]/disclaimer/page.tsx) —
    // matches the hreflang shape sitemap.ts already emits for this route.
    languages: { 'x-default': '/disclaimer', en: '/disclaimer', he: '/he/disclaimer', ru: '/ru/disclaimer' },
  },
}

export default function DisclaimerPage() {
  // The self-hosted edition has no bot system, so the bot references are dropped.
  const selfHosted = isSelfHosted()
  return (
    <LegalPage title="Disclaimer" Icon={AlertTriangle}>
      <section>
        <h2 className="text-xl font-semibold text-white mb-3">1. For Informational Purposes Only</h2>
        <p>
          DAATAN is a community forecasting and prediction-tracking platform. All forecasts, probability estimates, and leaderboard rankings are provided for informational and entertainment purposes only. Nothing on this platform constitutes financial, investment, legal, medical, political, or any other form of professional advice. Do not make real-world decisions — including business, trading, or medical decisions — based on anything you read here.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">2. AI-Generated Content</h2>
        <p>
          Some forecasts and probability estimates on DAATAN are generated or informed by AI systems (including the Oracul{selfHosted ? '' : ' and bot users'}). AI-generated content may be inaccurate, incomplete, or outdated. AI models can hallucinate — they may produce confident-sounding statements that are factually wrong. We do not independently verify every AI output before it appears on the platform.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">3. Source Comprehension Not Guaranteed</h2>
        <p>
          When the Oracul system {selfHosted ? 'cites' : 'or bot users cite'} external articles, news items, or links as supporting evidence for a forecast, we do not claim to have fully or correctly understood those sources. The AI may misread, misrepresent, selectively quote, or misinterpret the linked content. External links are provided as references only — always read the source yourself before drawing conclusions.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">4. External Links and Third-Party Content</h2>
        <p>
          DAATAN links to external articles and websites. We do not control, endorse, or take responsibility for the content, availability, or accuracy of third-party websites. Linked articles may become unavailable, be updated, or be retracted after a forecast is made. The existence of a link does not imply endorsement of the source.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">5. User Forecasts Are Not Expert Opinions</h2>
        <p>
          Forecasts on DAATAN are made by community members of varying backgrounds and expertise. A high Reputation Score or leaderboard ranking indicates historical forecasting performance on this platform — it does not imply domain expertise, professional qualifications, or insider knowledge. Past performance on DAATAN is no guarantee of accuracy on any specific future question.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">6. Forecast Resolution</h2>
        <p>
          Forecasts are resolved by designated resolvers according to the criteria stated at creation time. Resolution may require subjective judgment calls, especially for complex or ambiguous outcomes. Resolutions are final once processed and are not a statement of ground truth — the resolved outcome reflects what was verifiable at resolution time, not necessarily what will later turn out to be correct.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">7. No Warranties</h2>
        <p>
          DAATAN is provided &quot;as is&quot; without any warranties, express or implied. We do not guarantee the accuracy, completeness, or timeliness of any information on the platform. The service may be unavailable, incorrect, or delayed at any time.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">8. Questions</h2>
        <p>
          If you have questions about this disclaimer, contact us at {getContactEmail()}.
        </p>
      </section>
    </LegalPage>
  )
}
