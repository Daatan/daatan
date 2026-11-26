import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../messages/en.json'
import OutletCalls, { CALLS_SHOWN } from '../OutletCalls'
import type { OutletCall } from '@/lib/utils/outlet-forecasts'

const call = (i: number, over: Partial<OutletCall> = {}): OutletCall => ({
  forecastId: `f${i}`, href: `/forecasts/f${i}`, title: `Forecast ${i}`, state: 'cameTrue', lean: 80, articles: 4, ...over,
})

const renderCalls = (heldUp: OutletCall[], missed: OutletCall[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <OutletCalls heldUp={heldUp} missed={missed} />
    </NextIntlClientProvider>,
  )

describe('OutletCalls (#2340)', () => {
  it('shows both sides with their full counts, listing the first few of each', () => {
    renderCalls(Array.from({ length: CALLS_SHOWN + 2 }, (_, i) => call(i)), [call(9, { state: 'didNotHappen', lean: 75, articles: 1 })])
    const right = screen.getByRole('heading', { name: `Leaned the right way (${CALLS_SHOWN + 2})` }).parentElement as HTMLElement
    expect(within(right).getAllByRole('link')).toHaveLength(CALLS_SHOWN)
    const wrong = screen.getByRole('heading', { name: 'Leaned the wrong way (1)' }).parentElement as HTMLElement
    expect(within(wrong).getByRole('link', { name: 'Forecast 9' }).getAttribute('href')).toBe('/forecasts/f9')
    expect(within(wrong).getByText(/Lean 75% before the outcome · 1 article/)).toBeTruthy()
    expect(within(wrong).getByText("Didn't happen")).toBeTruthy()
  })

  it('says so when a side has none', () => {
    renderCalls([call(1)], [])
    const wrong = screen.getByRole('heading', { name: 'Leaned the wrong way (0)' }).parentElement as HTMLElement
    expect(within(wrong).getByText('None')).toBeTruthy()
    expect(screen.getByText(/at least 3 such articles/)).toBeTruthy()
  })
})
