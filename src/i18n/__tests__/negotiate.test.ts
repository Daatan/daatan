/**
 * @jest-environment node
 */
import { describe, it, expect } from 'vitest'
import { negotiateLocale } from '../negotiate'

describe('negotiateLocale', () => {
  it('returns null for missing or empty headers', () => {
    expect(negotiateLocale(null)).toBeNull()
    expect(negotiateLocale(undefined)).toBeNull()
    expect(negotiateLocale('')).toBeNull()
  })

  it('matches a supported base language from a region tag', () => {
    expect(negotiateLocale('he-IL,he;q=0.9,en-US;q=0.8')).toBe('he')
    expect(negotiateLocale('ru-RU')).toBe('ru')
  })

  it('returns the highest-q supported language, not header order', () => {
    expect(negotiateLocale('en;q=0.5,he')).toBe('he')
    expect(negotiateLocale('eo;q=0.3,ru;q=0.7')).toBe('ru')
  })

  it('skips unsupported languages and falls through to a supported one', () => {
    expect(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.5')).toBe('en')
  })

  it('returns null when nothing is supported', () => {
    expect(negotiateLocale('fr-FR,de;q=0.9')).toBeNull()
    expect(negotiateLocale('*')).toBeNull()
  })

  it('ignores q=0 entries', () => {
    expect(negotiateLocale('he;q=0,en;q=0.5')).toBe('en')
  })

  it('is case-insensitive', () => {
    expect(negotiateLocale('HE-IL')).toBe('he')
  })

  it('survives malformed input', () => {
    expect(negotiateLocale('xyz;;q=abc,,;')).toBeNull()
    expect(negotiateLocale(';q=0.5')).toBeNull()
  })
})
