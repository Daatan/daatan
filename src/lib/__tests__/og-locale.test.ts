import { describe, it, expect } from 'vitest'
import { ogLocale } from '../og-locale'

describe('ogLocale', () => {
  it('maps every app locale to language_TERRITORY', () => {
    expect(ogLocale('en')).toBe('en_US')
    expect(ogLocale('he')).toBe('he_IL')
    expect(ogLocale('ru')).toBe('ru_RU')
    expect(ogLocale('eo')).toBe('eo_EO')
  })

  it('falls back to en_US for an unknown locale', () => {
    expect(ogLocale('xx')).toBe('en_US')
  })
})
