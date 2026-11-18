import { describe, it, expect } from 'vitest'
import {
  buildForecastDescription,
  buildForecastKeywords,
  extractClaimEntities,
  globalKeywords,
  isSelfReferentialContext,
  publicDetailsText,
} from '../forecast-seo'

describe('buildForecastDescription', () => {
  it('does not double the claim\'s own full stop or question mark when appending context', () => {
    const resolveBy = new Date('2026-12-31T12:00:00Z')
    const stop = buildForecastDescription('The Houthi movement will lose ground by December 31, 2026.', null, { commitmentCount: 2, resolveByDatetime: resolveBy })
    expect(stop).not.toContain('..')
    expect(stop).toContain('2026. 2 forecasters have committed')
    const question = buildForecastDescription('Will it rain tomorrow?', null, { commitmentCount: 1 })
    expect(question).toBe('Will it rain tomorrow? 1 forecaster have committed')
  })

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

  it('cuts at a word boundary, never mid-word', () => {
    const details = 'Benjamin Netanyahu\'s criminal trial continues, with recent reports indicating the prosecution maintains a bribery charge despite judicial warnings, while other sources suggest judges have been pressured'
    const result = buildForecastDescription('Claim', details)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(158)
    const body = result.slice(0, -1)
    expect(details.startsWith(body)).toBe(true)
    expect(details[body.length]).toBe(' ')
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

// Openings of real context summaries on daatan.com forecast pages (sampled 2026-11-18).
const SELF_REFERENTIAL = [
  "The previous context noted a lack of data on Esperanto Wikipedia's current article count.",
  "The provided articles do not offer specific context regarding the Houthi movement's territorial control in Yemen.",
  "The recent articles do not provide any new information or developments regarding the release of 'The Winds of Winter'.",
  'No relevant articles or context were provided regarding the weather forecast for Ramat-Gan on February 26, 2026.',
  'The recent articles primarily serve as general information portals for the club.',
  'There is no new information about the negotiations in the recent coverage.',
]
const REAL_CONTENT = [
  'Recent articles indicate AI is increasingly enabling non-technical individuals to code.',
  'Recent reports indicate Israel has seized Palestinian land for military expansion.',
  'Recent articles confirm Iron Maiden was active, having supported Killswitch Engage.',
  'Significant new developments indicate the EU is actively discussing the proposal.',
  'No country has left the eurozone since its creation, and none has formally applied to.',
  'The Abraham Accords are a series of normalization agreements between Israel and Arab states.',
]

describe('isSelfReferentialContext', () => {
  it.each(SELF_REFERENTIAL)('flags a summary that describes its inputs: %s', (text) => {
    expect(isSelfReferentialContext(text)).toBe(true)
  })

  it.each(REAL_CONTENT)('keeps a summary about the world: %s', (text) => {
    expect(isSelfReferentialContext(text)).toBe(false)
  })

  it('ignores leading whitespace', () => {
    expect(isSelfReferentialContext('  The previous summary said nothing new.')).toBe(true)
  })
})

describe('publicDetailsText', () => {
  it('drops the translation too when the original describes its inputs', () => {
    expect(publicDetailsText(SELF_REFERENTIAL[1], 'המאמרים שסופקו אינם מציעים הקשר')).toBeNull()
  })

  it('prefers the translation of real content', () => {
    expect(publicDetailsText(REAL_CONTENT[0], 'Последние статьи показывают…')).toBe('Последние статьи показывают…')
  })

  it('falls back to the original, then null', () => {
    expect(publicDetailsText(REAL_CONTENT[0], null)).toBe(REAL_CONTENT[0])
    expect(publicDetailsText(null)).toBeNull()
  })
})

describe('buildForecastDescription with a self-referential summary', () => {
  it('uses the claim path instead of the summary', () => {
    const claim = 'Esperanto Wikipedia will have more than 400,000 articles by December 31, 2026.'
    const result = buildForecastDescription(claim, SELF_REFERENTIAL[0], { commitmentCount: 2 })
    expect(result).toBe(`${claim} 2 forecasters have committed`)
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
