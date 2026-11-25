import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../../../messages/en.json'
import ruMessages from '../../../../../../messages/ru.json'
import { EstimateLegend, type LegendMarket } from '../EstimateLegend'

const f = enMessages.forecast

const market = (over: Partial<LegendMarket> = {}): LegendMarket => ({
  provider: 'Polymarket',
  reading: { probability: 34, at: '2026-11-25T04:25:00Z', stale: false },
  question: 'Will X happen by June 30?',
  inverted: false,
  resolved: false,
  ...over,
})

const renderLegend = (props: Partial<Parameters<typeof EstimateLegend>[0]> = {}, messages = enMessages, locale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <EstimateLegend community={62} you={50} ai={{ kind: 'value', value: 74 }} market={null} {...props} />
    </NextIntlClientProvider>,
  )

describe('EstimateLegend (daatan#2323)', () => {
  it('shows the market price beside the other numbers, in the reader’s language', () => {
    renderLegend({ market: market() })
    expect(screen.getByText(`${f.legendCommunity} 62%`)).toBeInTheDocument()
    expect(screen.getByText(`${f.legendAI} 74%`)).toBeInTheDocument()
    expect(screen.getByTestId('legend-market')).toHaveTextContent('Polymarket 34%')
  })

  it('leaves the market out when none is linked', () => {
    renderLegend()
    expect(screen.queryByTestId('legend-market')).toBeNull()
    expect(screen.getByTestId('numbers-explainer')).not.toHaveTextContent('Polymarket')
  })

  it('explains every number, and says the market asks a related question, with its wording and price time', () => {
    renderLegend({ market: market() })
    const explainer = screen.getByTestId('numbers-explainer')
    expect(explainer).toHaveTextContent(f.numbersExplainer)
    expect(explainer).toHaveTextContent(f.numbersCommunity)
    expect(explainer).toHaveTextContent(f.numbersYou)
    expect(explainer).toHaveTextContent(f.numbersAiTitle)
    expect(explainer).toHaveTextContent(/not the same/)
    expect(explainer).toHaveTextContent('“Will X happen by June 30?”')
    expect(explainer).toHaveTextContent(/Price as of Nov 25, 2026/)
    // Same text on hover for desktop.
    expect(screen.getByTestId('legend-market').getAttribute('title')).toMatch(/not the same/)
  })

  it('greys out and marks a stale price, and says how stale', () => {
    renderLegend({ market: market({ reading: { probability: 34, at: '2026-11-20T00:00:00Z', stale: true } }) })
    const entry = screen.getByTestId('legend-market')
    expect(entry).toHaveTextContent(`Polymarket 34% · ${f.legendMarketStale}`)
    expect(entry.querySelector('span')?.className).toContain('text-gray-500')
    expect(screen.getByTestId('numbers-explainer')).toHaveTextContent('Not updated for more than 48 hours.')
  })

  it('marks a closed market and explains an inverted link', () => {
    renderLegend({ market: market({ resolved: true, inverted: true }) })
    expect(screen.getByTestId('legend-market')).toHaveTextContent(`· ${f.legendMarketClosed}`)
    const explainer = screen.getByTestId('numbers-explainer')
    expect(explainer).toHaveTextContent(f.numbersMarketClosed)
    expect(explainer).toHaveTextContent(f.numbersMarketInverted)
    expect(explainer).not.toHaveTextContent(/Price as of/)
  })

  it('says nobody has forecast yet instead of a made-up 50%', () => {
    renderLegend({ community: null })
    expect(screen.getByTestId('legend-community')).toHaveTextContent(`${f.legendCommunity} · ${f.legendNoForecastsYet}`)
    expect(screen.getByTestId('legend-community')).not.toHaveTextContent('%')
  })

  it('keeps the AI states it had', () => {
    renderLegend({ ai: { kind: 'none' } })
    expect(screen.getByTestId('ai-no-sources-yet')).toHaveTextContent(f.aiNoSourcesYet)
  })

  it('translates the hints', () => {
    renderLegend({ market: market() }, ruMessages, 'ru')
    expect(screen.getByTestId('numbers-explainer')).toHaveTextContent(ruMessages.forecast.numbersExplainer)
    expect(screen.getByTestId('numbers-explainer')).toHaveTextContent('Вопрос рынка: «Will X happen by June 30?».')
  })
})
