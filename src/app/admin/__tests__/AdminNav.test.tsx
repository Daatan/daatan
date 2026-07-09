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
  it('renders the Authors tab as an external link to the news-indexer admin panel', () => {
    renderWithIntl(<AdminNav isAdmin={true} />)

    const link = screen.getByRole('link', { name: /Authors/ })
    expect(link).toHaveAttribute('href', 'https://scrapper.daatan.com/admin')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
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
