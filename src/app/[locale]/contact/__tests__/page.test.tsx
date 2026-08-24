import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const NAMESPACES: Record<string, Record<string, string>> = {
  contact: {
    title: 'Contact Us',
    metaDescription: 'Get in touch',
    intro: "We'd love to hear from you.",
    getInTouch: 'Get in Touch',
    email: 'Email',
    githubIssues: 'GitHub Issues',
    githubIssuesDesc: 'Report bugs',
    twitter: 'Twitter / X',
    learnMore: 'Learn more about DAATAN →',
  },
}

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { namespace: string }) => {
    const messages = NAMESPACES[namespace]
    return (key: string) => messages[key]
  },
}))

const mockIsSelfHosted = vi.fn(() => false)
vi.mock('@/lib/edition', () => ({ isSelfHosted: () => mockIsSelfHosted() }))

const mockNotFound = vi.fn()
vi.mock('next/navigation', () => ({ notFound: () => mockNotFound() }))

import LocaleContactPage, { generateMetadata } from '../page'

describe('LocaleContactPage', () => {
  beforeEach(() => {
    mockIsSelfHosted.mockReturnValue(false)
    mockNotFound.mockClear()
  })

  it('renders the contact email and translated labels', async () => {
    const page = await LocaleContactPage({ params: Promise.resolve({ locale: 'ru' }) })
    const { container } = render(page)
    expect(container.querySelector('h1')?.textContent).toBe('Contact Us')
    const emailLink = container.querySelector('a[href^="mailto:"]')
    expect(emailLink?.textContent).toContain('office@daatan.com')
  })

  it('links "learn more" to the same-locale about page', async () => {
    const page = await LocaleContactPage({ params: Promise.resolve({ locale: 'eo' }) })
    const { getByText } = render(page)
    expect(getByText('Learn more about DAATAN →').getAttribute('href')).toBe('/eo/about')
  })

  it('is absent on self-hosted, like /contact', async () => {
    mockIsSelfHosted.mockReturnValue(true)
    await LocaleContactPage({ params: Promise.resolve({ locale: 'he' }) })
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })

  it('sets a full hreflang map on metadata', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'ru' }) })
    expect(meta.alternates?.canonical).toBe('https://daatan.com/ru/contact')
    expect(meta.alternates?.languages).toMatchObject({
      'x-default': 'https://daatan.com/contact',
      en: 'https://daatan.com/contact',
      he: 'https://daatan.com/he/contact',
      ru: 'https://daatan.com/ru/contact',
    })
  })
})
