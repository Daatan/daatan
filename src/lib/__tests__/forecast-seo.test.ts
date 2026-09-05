import { describe, it, expect } from 'vitest'
import { buildForecastDescription, buildForecastKeywords, extractClaimEntities, globalKeywords } from '../forecast-seo'

describe('buildForecastDescription', () => {
  it('uses detailsText when long enough', () => {
    const claim = 'Will it rain tomorrow?'
    const details = 'A detailed analysis of weather patterns suggests rain is likely in the morning.'
    expect(buildForecastDescription(claim, details)).toBe(details)
  })

  it('falls back to claimText when detailsText is empty', () => {
    const claim = 'Will the candidate win the election by December 31, 2026?'
    expect(buildForecastDescription(claim, null)).toBe(claim)
    expect(buildForecastDescription(claim, '')).toBe(claim)
    expect(buildForecastDescription(claim, '   ')).toBe(claim)
  })

  it('falls back to claimText when detailsText is too short to be useful', () => {
    const claim = 'Will the candidate win the election by December 31, 2026?'
    expect(buildForecastDescription(claim, 'TBD')).toBe(claim)
  })

  it('truncates long detailsText to fit meta description limits', () => {
    const claim = 'Short claim'
    const long = 'a'.repeat(300)
    const result = buildForecastDescription(claim, long)
    expect(result.length).toBeLessThanOrEqual(158)
    expect(result.endsWith('…')).toBe(true)
  })

  it('truncates long claimText when no details are available', () => {
    const long = 'a'.repeat(300)
    const result = buildForecastDescription(long, null)
    expect(result.length).toBeLessThanOrEqual(158)
    expect(result.endsWith('…')).toBe(true)
  })

  it('returns unique descriptions for different forecasts (no shared template)', () => {
    const a = buildForecastDescription('Forecast A about Iran', null)
    const b = buildForecastDescription('Forecast B about Russia', null)
    expect(a).not.toBe(b)
  })

  it('enriches fallback with ctx when detailsText is absent', () => {
    const claim = 'Will inflation drop below 3% by year end?'
    const result = buildForecastDescription(claim, null, {
      commitmentCount: 12,
      resolveByDatetime: '2026-12-31T00:00:00Z',
    })
    expect(result).toContain('12 forecasters have committed')
    expect(result).toContain('resolves')
    expect(result.length).toBeLessThanOrEqual(158)
  })

  it('uses singular "forecaster" when commitmentCount is 1', () => {
    const result = buildForecastDescription('Will X happen?', null, { commitmentCount: 1 })
    expect(result).toContain('1 forecaster have committed')
  })

  it('ignores ctx when detailsText is long enough', () => {
    const details = 'A detailed analysis of weather patterns suggests rain is likely in the morning.'
    const result = buildForecastDescription('Will it rain?', details, {
      commitmentCount: 5,
      resolveByDatetime: '2026-12-31T00:00:00Z',
    })
    expect(result).toBe(details)
    expect(result).not.toContain('forecaster')
  })

  it('falls back to claimText when ctx is empty', () => {
    const claim = 'Will the market recover?'
    const result = buildForecastDescription(claim, null, {})
    expect(result).toBe(claim)
  })
})

describe('extractClaimEntities', () => {
  it('lifts proper-noun runs and keeps connectors inside them', () => {
    expect(
      extractClaimEntities('George RR Martin will release The Winds of Winter by December 31, 2026'),
    ).toEqual(['George RR Martin', 'The Winds of Winter'])
  })

  it('drops sentence-initial stopwords, months and numbers', () => {
    expect(extractClaimEntities('Will Saudi Arabia join the Abraham Accords by June 2027?')).toEqual([
      'Saudi Arabia',
      'Abraham Accords',
    ])
  })

  it('returns nothing for a caseless script instead of guessing', () => {
    expect(extractClaimEntities('האם נתניהו יהיה ראש הממשלה בסוף 2026')).toEqual([])
  })
})

describe('buildForecastKeywords', () => {
  it('orders tags, then claim entities, then locale generics, deduped', () => {
    const kws = buildForecastKeywords(
      'Benjamin Netanyahu will be the Prime Minister of Israel on December 31, 2026',
      [{ name: 'Israel' }, { name: 'Politics' }],
    )
    expect(kws).toEqual(['Israel', 'Politics', 'Benjamin Netanyahu', 'Prime Minister of Israel', 'forecast', 'prediction'])
  })

  it('caps the list at ten and never repeats a term case-insensitively', () => {
    const tags = Array.from({ length: 12 }, (_, i) => ({ name: `Tag ${i}` }))
    const kws = buildForecastKeywords('tag 0 is a Thing', tags)
    expect(kws).toHaveLength(10)
    expect(new Set(kws.map((k) => k.toLowerCase())).size).toBe(10)
  })

  it('uses locale generics for he/ru and falls back to en for unknown locales', () => {
    expect(buildForecastKeywords('x', [], 'ru')).toEqual(['прогноз', 'предсказание'])
    expect(buildForecastKeywords('x', [], 'he')).toEqual(['תחזית', 'חיזוי'])
    expect(buildForecastKeywords('x', [], 'eo')).toEqual(['forecast', 'prediction'])
  })
})

describe('globalKeywords', () => {
  it('returns a short per-locale list and falls back to en', () => {
    expect(globalKeywords('ru')[0]).toBe('платформа прогнозов')
    expect(globalKeywords('eo')).toEqual(globalKeywords('en'))
    expect(globalKeywords('en').length).toBeLessThanOrEqual(10)
  })
})

describe('extractClaimEntities — sentence-initial The', () => {
  it('strips "The" at sentence start but keeps it inside a title', () => {
    expect(extractClaimEntities('The US will officially declare war on Iran by December 31, 2026')).toEqual(['US', 'Iran'])
    expect(extractClaimEntities('The global fertility rate in 2050 will be less than 2')).toEqual([])
  })
})

describe('Russian claims', () => {
  it('lifts Cyrillic names and drops sentence-initial verbs and month names', () => {
    expect(extractClaimEntities('Будет ли мобилизация в России к 5 сентября 2026 года')).toEqual(['России'])
    expect(extractClaimEntities('Владимир Путин не будет президентом России к 8 мая 2027')).toEqual([
      'Владимир Путин',
      'России',
    ])
  })

  it('leads with the translated claim when several are passed', () => {
    const kws = buildForecastKeywords(
      ['Владимир Путин не будет президентом России к 8 мая 2027', 'Vladimir Putin will not be the president of Russia by May 8, 2027'],
      [{ name: 'Russia' }],
      'ru',
    )
    expect(kws).toEqual(['Russia', 'Владимир Путин', 'России', 'Vladimir Putin', 'прогноз', 'предсказание'])
  })
})
