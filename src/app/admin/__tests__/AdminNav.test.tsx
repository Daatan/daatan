import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import AdminNav from '../AdminNav'
import enMessages from '../../../../messages/en.json'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/users',
}))

const renderWithIntl = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

describe('AdminNav', () => {
  it('renders the Authors tab as an in-app link, not an external hand-off', () => {
    renderWithIntl(<AdminNav isAdmin={true} />)

    const link = screen.getByRole('link', { name: /Authors/ })
    // The panel is served from Daatan behind the ADMIN gate; sending the operator
    // to scrapper.daatan.com would make them paste NEWS_INDEXER_SECRET into a browser.
    expect(link).toHaveAttribute('href', '/admin/authors')
    expect(link).not.toHaveAttribute('target')
  })

  it('hides the Authors tab in the self-hosted edition', () => {
    renderWithIntl(<AdminNav isAdmin={true} selfHosted={true} />)

    expect(screen.queryByRole('link', { name: /Authors/ })).not.toBeInTheDocument()
  })

  it('hides admin-only tabs (including Authors) for non-admin roles', () => {
    renderWithIntl(<AdminNav isAdmin={false} />)

    expect(screen.queryByRole('link', { name: /Authors/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument()
  })
})
