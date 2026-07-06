import { Accessibility } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Accessibility Statement',
  description: "DAATAN's accessibility statement: our WCAG 2.0 AA / IS 5568 conformance status, known limitations, and how to report an accessibility issue.",
}

const LAST_REVIEWED = 'July 6, 2026'

export default function AccessibilityPage() {
  return (
    <LegalPage title="Accessibility Statement" Icon={Accessibility}>
      <p className="text-sm text-text-subtle">Last reviewed: {LAST_REVIEWED}</p>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">1. Our Commitment</h2>
        <p>
          DAATAN is committed to making this platform usable by everyone, including people who rely on
          assistive technology such as screen readers, keyboard-only navigation, or browser zoom. We work
          toward conformance with the{' '}
          <a href="https://www.w3.org/TR/WCAG20/" target="_blank" rel="noopener noreferrer" className="text-cobalt-light hover:underline">
            Web Content Accessibility Guidelines (WCAG) 2.0
          </a>{' '}
          at Level AA, which is also the basis of Israeli Standard 5568 (IS 5568).
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">2. Conformance Status</h2>
        <p>
          We assess our conformance level as <strong>partially conformant</strong>: some parts of the site
          meet WCAG 2.0 AA, and we are actively working through the rest. &quot;Partially conformant&quot;
          means some parts of the content do not fully conform to the accessibility standard yet.
        </p>
        <p className="mt-2">
          Improvements made so far include: a skip-to-content link, visible keyboard-focus indicators
          throughout the site, labeled form controls and icon-only buttons for screen readers, and color
          contrast fixes across the main pages. Work is ongoing.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">3. Known Limitations</h2>
        <ul className="list-disc ml-6 mt-2 space-y-1">
          <li>Some pages have not yet been individually audited for color contrast and may not fully meet the 4.5:1 minimum ratio in every component.</li>
          <li>Pinch-to-zoom is currently disabled on mobile to prevent accidental double-tap zoom on interactive elements — this is a known trade-off we are reviewing, since it affects users who rely on zoom to read text comfortably.</li>
          <li>A full manual keyboard-only walkthrough of every user flow (forecast creation, resolution, commenting) is still in progress.</li>
        </ul>
        <p className="mt-2">
          If you encounter a barrier not listed here, please let us know using the contact information below —
          we want to hear about it.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">4. Feedback and Contact</h2>
        <p>
          We welcome your feedback on the accessibility of DAATAN. If you encounter an accessibility barrier,
          or have a suggestion for improvement, please contact us:
        </p>
        <p className="mt-2">
          <strong>Accessibility coordinator:</strong>{' '}
          <a href="mailto:office@daatan.com" className="text-cobalt-light hover:underline">office@daatan.com</a>
        </p>
        <p className="mt-2">We try to respond to accessibility feedback within a reasonable time.</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">5. Technical Specifications</h2>
        <p>
          Accessibility of DAATAN relies on HTML, CSS, and JavaScript rendered by modern browsers, in
          combination with assistive technology. These technologies are relied upon for conformance with the
          accessibility standards used.
        </p>
      </section>
    </LegalPage>
  )
}
