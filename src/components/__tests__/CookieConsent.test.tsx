import { render, screen, fireEvent, act } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import CookieConsent, { COOKIE_SETTINGS_EVENT } from '../CookieConsent'

function setRegion(notRequired: boolean | undefined) {
  if (notRequired === undefined) delete window.__daatanConsentNotRequired
  else window.__daatanConsentNotRequired = Promise.resolve(notRequired)
}

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.clear()
    setRegion(undefined)
    window.gtag = vi.fn()
  })
  afterEach(() => {
    delete window.gtag
  })

  it('does not render when consent was already decided', async () => {
    localStorage.setItem('daatan_analytics_consent', 'granted')
    setRegion(false)
    render(<CookieConsent />)
    await act(async () => {})
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    expect(screen.queryByText('OK')).not.toBeInTheDocument()
  })

  it('shows the opt-in banner when there is no region check (GA off / script missing)', async () => {
    render(<CookieConsent />)
    expect(await screen.findByText('Accept')).toBeInTheDocument()
  })

  it('shows the opt-in banner when the region requires consent', async () => {
    setRegion(false)
    render(<CookieConsent />)
    expect(await screen.findByText('Accept')).toBeInTheDocument()
    expect(window.gtag).not.toHaveBeenCalledWith('consent', 'update', expect.objectContaining({ analytics_storage: 'granted' }))
  })

  it('shows the opt-in banner when the region check failed', async () => {
    window.__daatanConsentNotRequired = Promise.reject(new Error('blocked')).catch(() => false)
    render(<CookieConsent />)
    expect(await screen.findByText('Accept')).toBeInTheDocument()
  })

  it('moves focus onto the Decline button when the banner appears', async () => {
    render(<CookieConsent />)
    expect(await screen.findByText('Decline')).toHaveFocus()
  })

  it('restores focus to the previously-focused element after a choice is made', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'elsewhere'
    document.body.appendChild(trigger)
    trigger.focus()

    render(<CookieConsent />)
    expect(await screen.findByText('Decline')).toHaveFocus()

    fireEvent.click(screen.getByText('Accept'))
    expect(trigger).toHaveFocus()
    expect(localStorage.getItem('daatan_analytics_consent')).toBe('granted')

    document.body.removeChild(trigger)
  })

  it('dismisses on Escape, same as Decline', async () => {
    render(<CookieConsent />)
    fireEvent.keyDown(await screen.findByRole('region', { name: 'Cookie consent' }), { key: 'Escape' })
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    expect(localStorage.getItem('daatan_analytics_consent')).toBe('denied')
  })

  it('has no automatically detectable a11y violations', async () => {
    const { container } = render(<CookieConsent />)
    await screen.findByText('Accept')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('links to the Privacy Policy', async () => {
    render(<CookieConsent />)
    expect(await screen.findByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  })
})

describe('CookieConsent outside opt-in regions', () => {
  beforeEach(() => {
    localStorage.clear()
    setRegion(true)
    window.gtag = vi.fn()
  })
  afterEach(() => {
    delete window.gtag
    setRegion(undefined)
  })

  it('shows a notice instead of the banner, without storing a consent choice', async () => {
    render(<CookieConsent />)
    expect(await screen.findByText('Opt out')).toBeInTheDocument()
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('OK'))
    expect(screen.queryByText('Opt out')).not.toBeInTheDocument()
    expect(localStorage.getItem('daatan_analytics_consent')).toBeNull()
    expect(localStorage.getItem('daatan_analytics_notice_seen')).not.toBeNull()
  })

  it('does not show the notice again once acknowledged', async () => {
    localStorage.setItem('daatan_analytics_notice_seen', '1')
    render(<CookieConsent />)
    await act(async () => {})
    expect(screen.queryByText('Opt out')).not.toBeInTheDocument()
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
  })

  it('Opt out stores denied, revokes consent and deletes GA cookies', async () => {
    document.cookie = '_ga=GA1.1.123; path=/'
    render(<CookieConsent />)
    fireEvent.click(await screen.findByText('Opt out'))
    expect(localStorage.getItem('daatan_analytics_consent')).toBe('denied')
    expect(window.gtag).toHaveBeenCalledWith('consent', 'update', expect.objectContaining({ analytics_storage: 'denied' }))
    expect(document.cookie).not.toContain('_ga=')
  })

  it('a stored denial wins over the region', async () => {
    localStorage.setItem('daatan_analytics_consent', 'denied')
    render(<CookieConsent />)
    await act(async () => {})
    expect(screen.queryByText('Opt out')).not.toBeInTheDocument()
    expect(window.gtag).toHaveBeenCalledWith('consent', 'update', expect.objectContaining({ analytics_storage: 'denied' }))
  })
})

describe('CookieConsent re-open from footer', () => {
  beforeEach(() => { localStorage.clear(); setRegion(undefined) })

  it('shows the banner again after a choice and revokes consent on Decline', async () => {
    localStorage.setItem('daatan_analytics_consent', 'granted')
    render(<CookieConsent />)
    await act(async () => {})
    expect(screen.queryByText('Decline')).not.toBeInTheDocument()

    act(() => { window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT)) })
    fireEvent.click(screen.getByText('Decline'))
    expect(localStorage.getItem('daatan_analytics_consent')).toBe('denied')
  })

  it('opens the full banner (not the notice) outside opt-in regions too', async () => {
    setRegion(true)
    localStorage.setItem('daatan_analytics_notice_seen', '1')
    render(<CookieConsent />)
    await act(async () => {})
    act(() => { window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT)) })
    expect(screen.getByText('Accept')).toBeInTheDocument()
    expect(screen.getByText('Decline')).toBeInTheDocument()
  })
})
