import { describe, it, expect } from 'vitest'
import { localizedText, telegramHref } from '../outlet-identity'

describe('localizedText', () => {
  it('prefers the locale, then English, then any language set', () => {
    expect(localizedText({ en: 'Maariv', he: 'מעריב' }, 'he')).toBe('מעריב')
    expect(localizedText({ en: 'Maariv', he: 'מעריב' }, 'ru')).toBe('Maariv')
    expect(localizedText({ he: 'מעריב' }, 'ru')).toBe('מעריב')
    expect(localizedText({ en: '', ru: '' }, 'ru')).toBeNull()
    expect(localizedText({}, 'en')).toBeNull()
  })
})

describe('telegramHref', () => {
  it('links a handle and keeps a stored URL as it is', () => {
    expect(telegramHref('ynetnewslatest')).toBe('https://t.me/ynetnewslatest')
    expect(telegramHref('@ynetnewslatest')).toBe('https://t.me/ynetnewslatest')
    expect(telegramHref('https://t.me/The_Jerusalem_Post')).toBe('https://t.me/The_Jerusalem_Post')
  })
})
