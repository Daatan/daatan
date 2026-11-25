import { describe, it, expect } from 'vitest'
import { forecastHref } from '../forecast-href'

describe('forecastHref (daatan#2336)', () => {
  it('keeps English at the root', () => {
    expect(forecastHref('will-x-happen', 'en')).toBe('/forecasts/will-x-happen')
  })

  it.each(['he', 'ru', 'eo'])('prefixes the %s forecast route', (locale) => {
    expect(forecastHref('will-x-happen', locale)).toBe(`/${locale}/forecasts/will-x-happen`)
  })

  it('falls back to the root for a locale without a route', () => {
    expect(forecastHref('cm123', 'fr')).toBe('/forecasts/cm123')
  })
})
