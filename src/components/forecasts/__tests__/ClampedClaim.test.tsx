import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { ClampedClaim } from '../ClampedClaim'
import messages from '../../../../messages/en.json'

const renderWithIntl = (ui: React.ReactElement) =>
  render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>)

const longClaim = 'Will the ceasefire hold through the winter, '.repeat(12)

// happy-dom does no layout: fake the clamped box's heights and fire the observer on observe().
let scrollHeight = 0
let clientHeight = 0
const observers: Array<() => void> = []

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('ResizeObserver', class {
    cb: () => void
    constructor(cb: () => void) { this.cb = cb }
    observe() { observers.push(this.cb); this.cb() }
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => clientHeight)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// daatan#1805: a long claim is clamped to 3 lines but can be expanded inline.
describe('ClampedClaim', () => {
  it('shows no toggle when the claim fits', () => {
    scrollHeight = 60
    clientHeight = 60
    renderWithIntl(<ClampedClaim text="Short claim" />)
    expect(screen.queryByTestId('claim-toggle')).toBeNull()
    expect(screen.getByText('Short claim')).toHaveClass('line-clamp-3')
  })

  it('expands and collapses an overflowing claim without navigating', () => {
    scrollHeight = 200
    clientHeight = 60
    renderWithIntl(<ClampedClaim text={longClaim.trim()} />)
    const text = screen.getByText(longClaim.trim())
    const toggle = screen.getByRole('button', { name: 'Show more' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(text).toHaveClass('line-clamp-3')

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { toggle.dispatchEvent(click) })
    expect(click.defaultPrevented).toBe(true)
    expect(text).not.toHaveClass('line-clamp-3')
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(text).toHaveClass('line-clamp-3')
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })

  it('re-measures on resize', () => {
    scrollHeight = 60
    clientHeight = 60
    renderWithIntl(<ClampedClaim text="Claim that wraps on a narrow screen" as="h2" />)
    expect(screen.queryByTestId('claim-toggle')).toBeNull()
    scrollHeight = 120
    act(() => { observers.at(-1)!() })
    expect(screen.getByTestId('claim-toggle')).toBeInTheDocument()
  })
})
