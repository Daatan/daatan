import { Accessibility } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'
import { getContactEmail } from '@/lib/branding'

export const metadata: Metadata = {
  title: 'Accessibility Statement',
  description: "DAATAN's accessibility statement: our WCAG 2.0 AA / IS 5568 conformance status, known limitations, and how to report an accessibility issue.",
  alternates: { canonical: '/accessibility' },
}

const LAST_REVIEWED = 'September 6, 2026'
/** The election-forecast site links back to this statement from every page. */
const ELECTIONS_URL = 'https://elections.daatan.com'

export default function AccessibilityPage() {
  const contactEmail = getContactEmail()
  return (
    <LegalPage title="Accessibility Statement" Icon={Accessibility}>
      <p className="text-sm text-text-subtle">Last reviewed: {LAST_REVIEWED}</p>

      <p>
        We&apos;re working toward{' '}
        <a href="https://www.w3.org/TR/WCAG20/" target="_blank" rel="noopener noreferrer" className="text-cobalt-light hover:underline">
          WCAG 2.0
        </a>{' '}
        Level AA conformance (the basis of Israeli Standard IS 5568), but we&apos;re not there yet —
        we&apos;d call it partially conformant. So far we&apos;ve added a skip-to-content link, visible
        keyboard-focus indicators, labels for screen readers on form controls and icon buttons, fixed
        several color-contrast issues, and re-enabled pinch-to-zoom on mobile, but plenty of the site
        hasn&apos;t been individually audited yet. If you hit a barrier, please tell us — email our
        accessibility coordinator at{' '}
        <a href={`mailto:${contactEmail}`} className="text-cobalt-light hover:underline">{contactEmail}</a>{' '}
        and we&apos;ll look into it.
      </p>

      <p>
        This statement also covers our election-forecast site,{' '}
        <a href={ELECTIONS_URL} className="text-cobalt-light hover:underline">elections.daatan.com</a>.
        That site has not been audited separately yet; report a barrier there to the same address.
      </p>
    </LegalPage>
  )
}
