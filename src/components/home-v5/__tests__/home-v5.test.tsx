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
  create: 'Create', login: 'Sign in', profile: 'My profile', contact: 'Contact', privacy: 'Privacy', terms: 'Terms', home: 'Home',
}

describe('home-v5 links', () => {
  it('prefixes only routes that exist under [locale]', () => {
    expect(localePath('he', '/about')).toBe('/he/about')
    expect(localePath('en', '/about')).toBe('/about')
    expect(localePath('ru', '/elections')).toBe('/elections')
    expect(localePath('he', '/')).toBe('/he')
  })

  it('points Sources at the source leaderboard and Elections at the elections app', () => {
    const links = buildLinks('en')
    expect(links.sources).toBe('/leaderboard/sources')
    expect(links.elections).toBe('https://elections.daatan.com')
  })

  it('has no placeholder hrefs', () => {
    for (const locale of ['en', 'he', 'ru', 'eo'] as const) {
      for (const href of Object.values(buildLinks(locale))) {
        expect(href).toMatch(/^(\/|https:\/\/elections\.daatan\.com$)/)
        expect(href).not.toBe('#')
      }
    }
  })
})

describe('MobileMenu', () => {
  const links = buildLinks('he')
  const items = [{ href: links.forecasts, label: 'Forecasts' }]

  it('opens, exposes nav and closes on Escape', () => {
    render(<MobileMenu links={links} items={items} signedIn={false} labels={labels} />)
    const opener = screen.getByRole('button', { name: 'Menu' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Forecasts' })).toHaveAttribute('href', '/he/forecasts')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the profile link instead of sign-in when signed in', () => {
    render(<MobileMenu links={links} items={items} signedIn labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('link', { name: 'My profile' })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('has no axe violations when open', async () => {
    const { container } = render(<MobileMenu links={links} items={items} signedIn={false} labels={labels} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('home-v5 featured examples', () => {
  it('has every locale filled in for the featured source', async () => {
    const { FEATURED_SOURCE } = await import('../examples')
    if (!FEATURED_SOURCE) return
    for (const locale of ['en', 'he', 'ru', 'eo'] as const) {
      for (const field of ['name', 'role', 'statement', 'whatHappened', 'tag'] as const) {
        expect(FEATURED_SOURCE[field][locale].trim().length).toBeGreaterThan(0)
      }
    }
    expect(FEATURED_SOURCE.record.length).toBeGreaterThan(0)
  })

  it('maps the source to card data with a localized date', async () => {
    const { FEATURED_SOURCE } = await import('../examples')
    const { toSourceCard } = await import('../featured')
    if (!FEATURED_SOURCE) return
    const card = toSourceCard(FEATURED_SOURCE, 'ru')
    expect(card.name).toBe(FEATURED_SOURCE.name.ru)
    expect(card.saidOn).toMatch(/2021/)
  })
})
