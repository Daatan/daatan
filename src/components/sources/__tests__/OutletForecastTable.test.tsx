import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../../../messages/en.json'
import OutletForecastTable, { INITIAL_ROWS } from '../OutletForecastTable'
import type { OutletForecastRow } from '@/lib/utils/outlet-forecasts'

const row = (i: number, over: Partial<OutletForecastRow> = {}): OutletForecastRow => ({
  forecastId: `f${i}`,
  href: `/forecasts/f${i}`,
  title: `Forecast ${i}`,
  state: 'open',
  articles: 1,
  lean: 50,
  trend: [50],
  lastArticle: `2026-11-${String(10 + (i % 18)).padStart(2, '0')}`,
  ...over,
})

const renderTable = (rows: OutletForecastRow[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <OutletForecastTable rows={rows} />
    </NextIntlClientProvider>,
  )

/** Titles in the desktop table, top to bottom. */
const tableTitles = () =>
  within(screen.getByRole('table')).getAllByRole('link').map((a) => a.textContent)

describe('OutletForecastTable (#2320)', () => {
  it('shows the first rows and the rest on request', () => {
    renderTable(Array.from({ length: INITIAL_ROWS + 5 }, (_, i) => row(i)))
    expect(tableTitles()).toHaveLength(INITIAL_ROWS)
    fireEvent.click(screen.getByRole('button', { name: `Show all (${INITIAL_ROWS + 5})` }))
    expect(tableTitles()).toHaveLength(INITIAL_ROWS + 5)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('sorts by a column header, flipping on the second click', () => {
    renderTable([row(1, { lean: 20 }), row(2, { lean: 90 }), row(3, { lean: 55 })])
    const lean = screen.getByRole('button', { name: 'Lean' })
    fireEvent.click(lean)
    expect(tableTitles()).toEqual(['Forecast 2', 'Forecast 3', 'Forecast 1'])
    expect(lean.closest('th')?.getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(lean)
    expect(tableTitles()).toEqual(['Forecast 1', 'Forecast 3', 'Forecast 2'])
  })

  it('offers the same orders as a select on a phone', () => {
    renderTable([row(1, { articles: 2 }), row(2, { articles: 7 })])
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'articles' } })
    expect(tableTitles()).toEqual(['Forecast 2', 'Forecast 1'])
  })

  it('reads status in words and draws a dot, not a line, under three articles', () => {
    const { container } = renderTable([
      row(1, { state: 'cameTrue', articles: 2, trend: [40, 60], lean: 60 }),
      row(2, { state: 'pending', articles: 4, trend: [50, 55, 60, 70], lean: 70 }),
    ])
    const table = within(screen.getByRole('table'))
    expect(table.getByText('Came true')).toBeTruthy()
    expect(table.getByText('Awaiting resolution')).toBeTruthy()
    expect(table.getByText('60%')).toBeTruthy()
    // Default order puts the pending (still open) forecast first.
    const svgs = screen.getByRole('table').querySelectorAll('svg')
    expect(svgs[0].querySelector('polyline')).not.toBeNull()
    expect(svgs[1].querySelector('circle')).not.toBeNull()
    expect(svgs[1].querySelector('polyline')).toBeNull()
    expect(container.querySelector('svg title')?.textContent).toBe('4 articles: 50% → 70%')
  })
})
