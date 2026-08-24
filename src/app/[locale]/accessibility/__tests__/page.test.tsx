import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const NAMESPACES: Record<string, Record<string, string>> = {
  accessibility: {
    title: 'Accessibility Statement',
    metaDescription: 'DAATAN accessibility statement',
    lastReviewed: 'Last reviewed: {date}',
    body: "We're working toward <wcag>WCAG 2.0</wcag> AA. Email <email>{emailAddress}</email> for help.",
  },
}

// Lightweight stand-in for next-intl's translator: interpolates {var} and
// resolves <tag>chunks</tag> rich-text markers against the renderer
// functions passed to t.rich, without pulling in the real i18n request
// context (this repo mocks next-intl/server the same way in
// src/app/sources/[name]/__tests__/page.test.tsx).
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { namespace: string }) => {
    const messages = NAMESPACES[namespace]
    const interpolate = (raw: string, vars?: Record<string, unknown>) => {
      let s = raw
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
      return s
    }
    const t = (key: string, vars?: Record<string, unknown>) => interpolate(messages[key], vars)
    t.rich = (key: string, opts: Record<string, unknown>) => {
      const values: Record<string, unknown> = {}
      const renderers: Record<string, (chunks: unknown) => unknown> = {}
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v === 'function') renderers[k] = v as (chunks: unknown) => unknown
        else values[k] = v
      }
      const s = interpolate(messages[key], values)
      const parts: unknown[] = []
      const re = /<(\w+)>(.*?)<\/\1>/g
      let lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(s))) {
        if (m.index > lastIndex) parts.push(s.slice(lastIndex, m.index))
        parts.push(renderers[m[1]] ? renderers[m[1]](m[2]) : m[2])
        lastIndex = re.lastIndex
      }
      if (lastIndex < s.length) parts.push(s.slice(lastIndex))
      return parts
    }
    return t
  },
}))

import LocaleAccessibilityPage, { generateMetadata } from '../page'

describe('LocaleAccessibilityPage', () => {
  it('renders the WCAG link and the mailto link with the interpolated address', async () => {
    const page = await LocaleAccessibilityPage({ params: Promise.resolve({ locale: 'ru' }) })
    const { container } = render(page)

    const wcagLink = container.querySelector('a[href="https://www.w3.org/TR/WCAG20/"]')
    expect(wcagLink?.textContent).toBe('WCAG 2.0')

    const emailLink = container.querySelector('a[href^="mailto:"]')
    expect(emailLink?.textContent).toBe('office@daatan.com')
  })

  it('sets dir=rtl for locale=he and dir=ltr otherwise', async () => {
    const he = await LocaleAccessibilityPage({ params: Promise.resolve({ locale: 'he' }) })
    const { container: heContainer } = render(he)
    expect(heContainer.querySelector('[dir="rtl"]')).not.toBeNull()

    const eo = await LocaleAccessibilityPage({ params: Promise.resolve({ locale: 'eo' }) })
    const { container: eoContainer } = render(eo)
    expect(eoContainer.querySelector('[dir="rtl"]')).toBeNull()
  })

  it('sets a full hreflang map on metadata', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'he' }) })
    expect(meta.alternates?.canonical).toBe('https://daatan.com/he/accessibility')
    expect(meta.alternates?.languages).toMatchObject({
      'x-default': 'https://daatan.com/accessibility',
      en: 'https://daatan.com/accessibility',
      he: 'https://daatan.com/he/accessibility',
      ru: 'https://daatan.com/ru/accessibility',
    })
  })
})
