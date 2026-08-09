import { Accessibility } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Accessibility Statement',
  description: "DAATAN's accessibility statement: our WCAG 2.0 AA / IS 5568 conformance status, known limitations, and how to report an accessibility issue.",
  alternates: { canonical: '/accessibility' },
}

const LAST_REVIEWED = 'July 6, 2026'

export default function AccessibilityPage() {
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
        keyboard-focus indicators, labels for screen readers on form controls and icon buttons, and fixed
        some color-contrast issues, but plenty of the site hasn&apos;t been individually audited yet, and
        pinch-to-zoom is currently disabled on mobile (a trade-off we&apos;re reconsidering). If you hit a
        barrier, please tell us — email our accessibility coordinator at{' '}
        <a href="mailto:office@daatan.com" className="text-cobalt-light hover:underline">office@daatan.com</a>{' '}
        and we&apos;ll look into it.
      </p>
    </LegalPage>
  )
}
