import { render, screen, fireEvent } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, it, expect, beforeEach } from 'vitest'
import CookieConsent from '../CookieConsent'

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not render when consent was already decided', () => {
    localStorage.setItem('daatan_analytics_consent', 'granted')
    render(<CookieConsent />)
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
  })

  it('moves focus onto the Decline button when the banner appears', () => {
    render(<CookieConsent />)
    expect(screen.getByText('Decline')).toHaveFocus()
  })

  it('restores focus to the previously-focused element after a choice is made', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'elsewhere'
    document.body.appendChild(trigger)
    trigger.focus()

    render(<CookieConsent />)
    expect(screen.getByText('Decline')).toHaveFocus()

    fireEvent.click(screen.getByText('Accept'))
    expect(trigger).toHaveFocus()

    document.body.removeChild(trigger)
  })

  it('dismisses on Escape, same as Decline', () => {
    localStorage.clear()
    render(<CookieConsent />)
    fireEvent.keyDown(screen.getByRole('region', { name: 'Cookie consent' }), { key: 'Escape' })
    expect(screen.queryByText('Accept')).not.toBeInTheDocument()
    expect(localStorage.getItem('daatan_analytics_consent')).toBe('denied')
  })

  it('has no automatically detectable a11y violations', async () => {
    const { container } = render(<CookieConsent />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
