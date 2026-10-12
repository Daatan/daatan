import { render, screen, fireEvent } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, it, expect, vi } from 'vitest'
import MobileMenu from '../MobileMenu'
import { buildLinks, localePath } from '../links'

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-testid="img">{alt}</span>,
}))

const labels = {
  menu: 'Menu', close: 'Close', search: 'Search', searchPlaceholder: 'Find', nav: 'Main',
  create: 'Create', login: 'Sign in', contact: 'Contact', privacy: 'Privacy', terms: 'Terms', home: 'Home',
}

describe('home-v5 links', () => {
  it('prefixes only routes that exist under [locale]', () => {
    expect(localePath('he', '/about')).toBe('/he/about')
    expect(localePath('en', '/about')).toBe('/about')
    expect(localePath('ru', '/elections')).toBe('/elections')
    expect(localePath('he', '/')).toBe('/he')
  })

  it('has no placeholder hrefs', () => {
    for (const locale of ['en', 'he', 'ru', 'eo'] as const) {
      for (const href of Object.values(buildLinks(locale))) {
        expect(href).toMatch(/^\//)
        expect(href).not.toBe('#')
      }
    }
  })
})

describe('MobileMenu', () => {
  const links = buildLinks('he')
  const items = [{ href: links.forecasts, label: 'Forecasts' }]

  it('opens, exposes nav and closes on Escape', () => {
    render(<MobileMenu links={links} items={items} labels={labels} />)
    const opener = screen.getByRole('button', { name: 'Menu' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Forecasts' })).toHaveAttribute('href', '/he/forecasts')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has no axe violations when open', async () => {
    const { container } = render(<MobileMenu links={links} items={items} labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
