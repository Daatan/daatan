import { describe, expect, it } from 'vitest'
import {
  forecastQuestion,
  forecastAnswer,
  forecastFaqJsonLd,
  latestProbabilityUpdateISO,
  type ForecastSeoCopy,
} from '../forecast-seo-schema'

const EN_CLAIM = 'Bitcoin will hit $100k by end of 2026.'
const HE_CLAIM = 'ביטקוין יגיע ל-100 אלף דולר עד סוף 2026'

const EN_COPY: ForecastSeoCopy = {
  questionOpen: 'What are the chances that',
  questionResolved: 'Did this come true:',
  answerAiEstimate: 'the AI estimate is',
  answerCommunity: 'the community estimate is',
  answerAsOf: 'As of',
  answerResolvedYes: 'Yes, this came true.',
  answerResolvedWrong: 'No, this did not happen.',
  answerNoEstimate: 'No estimate is available yet.',
  statusVoid: 'Void',
  statusUnresolvable: 'Unresolvable',
}

const HE_COPY: ForecastSeoCopy = {
  questionOpen: 'מה הסיכויים ש',
  questionResolved: 'האם זה התממש:',
  answerAiEstimate: 'הערכת ה-AI היא',
  answerCommunity: 'הערכת הקהילה היא',
  answerAsOf: 'נכון ל-',
  answerResolvedYes: 'כן, זה התממש.',
  answerResolvedWrong: 'לא, זה לא קרה.',
  answerNoEstimate: 'אין עדיין הערכה זמינה.',
  statusVoid: 'בוטל',
  statusUnresolvable: 'לא ניתן לפתרון',
}

describe('forecastQuestion', () => {
  it('wraps an open claim in question form, stripping the trailing period', () => {
    expect(forecastQuestion(EN_COPY, 'en', EN_CLAIM, 'ACTIVE')).toBe(
      'What are the chances that Bitcoin will hit $100k by end of 2026?',
    )
  })

  it('joins the Hebrew ש clitic without a space', () => {
    expect(forecastQuestion(HE_COPY, 'he', HE_CLAIM, 'ACTIVE')).toBe(
      'מה הסיכויים שביטקוין יגיע ל-100 אלף דולר עד סוף 2026?',
    )
  })

  it('uses past framing for resolved forecasts so they never read as open', () => {
    for (const status of ['RESOLVED_CORRECT', 'RESOLVED_WRONG']) {
      expect(forecastQuestion(EN_COPY, 'en', EN_CLAIM, status)).toBe(
        'Did this come true: Bitcoin will hit $100k by end of 2026?',
      )
    }
  })
})

describe('forecastAnswer', () => {
  const base = {
    locale: 'en' as const,
    claim: EN_CLAIM,
    aiProbability: 62,
    communityProbability: 55.4,
    lastUpdatedISO: '2026-08-08T10:00:00Z',
  }

  it('states both numbers with an as-of date for open forecasts', () => {
    const a = forecastAnswer(EN_COPY, { ...base, status: 'ACTIVE' })
    expect(a).toContain('As of')
    expect(a).toContain('the AI estimate is 62%')
    expect(a).toContain('the community estimate is 55%')
  })

  it('omits the as-of prefix when there is no timestamp', () => {
    const a = forecastAnswer(EN_COPY, { ...base, lastUpdatedISO: null, status: 'ACTIVE' })
    expect(a).not.toContain('As of')
    expect(a).toContain('62%')
  })

  it('drops null numbers individually and falls back when both are missing', () => {
    expect(
      forecastAnswer(EN_COPY, {
        ...base,
        status: 'ACTIVE',
        aiProbability: null,
        communityProbability: 55,
        lastUpdatedISO: null,
      }),
    ).toBe('the community estimate is 55%.')
    expect(
      forecastAnswer(EN_COPY, {
        ...base,
        status: 'ACTIVE',
        aiProbability: null,
        communityProbability: null,
        lastUpdatedISO: null,
      }),
    ).toBe('No estimate is available yet.')
  })

  it('keeps a 0% AI estimate (?? not ||)', () => {
    expect(
      forecastAnswer(EN_COPY, {
        ...base,
        status: 'ACTIVE',
        aiProbability: 0,
        communityProbability: null,
        lastUpdatedISO: null,
      }),
    ).toBe('the AI estimate is 0%.')
  })

  it('answers resolved forecasts with the outcome, not a stale probability', () => {
    expect(forecastAnswer(EN_COPY, { ...base, status: 'RESOLVED_CORRECT' })).toBe('Yes, this came true.')
    expect(forecastAnswer(EN_COPY, { ...base, status: 'RESOLVED_WRONG' })).toBe('No, this did not happen.')
    expect(forecastAnswer(EN_COPY, { ...base, status: 'RESOLVED_CORRECT' })).not.toContain('62')
  })

  it('answers VOID/UNRESOLVABLE with the status label', () => {
    expect(forecastAnswer(EN_COPY, { ...base, status: 'VOID' })).toBe('Void.')
    expect(forecastAnswer(HE_COPY, { ...base, locale: 'he', status: 'VOID' })).toBe('בוטל.')
  })
})

describe('forecastFaqJsonLd', () => {
  const input = {
    locale: 'en' as const,
    claim: EN_CLAIM,
    status: 'ACTIVE',
    aiProbability: 62,
    communityProbability: 55,
    lastUpdatedISO: '2026-08-08T10:00:00Z',
  }

  it('emits a single-question FAQPage with dateModified', () => {
    const ld = forecastFaqJsonLd(EN_COPY, input) as Record<string, unknown>
    expect(ld['@type']).toBe('FAQPage')
    expect(ld.dateModified).toBe('2026-08-08T10:00:00Z')
    const q = (ld.mainEntity as Array<Record<string, unknown>>)[0]
    expect(q['@type']).toBe('Question')
    expect(q.name).toContain('What are the chances')
    expect((q.acceptedAnswer as Record<string, unknown>).text).toContain('62%')
  })

  it('omits dateModified when there is no timestamp', () => {
    const ld = forecastFaqJsonLd(EN_COPY, { ...input, lastUpdatedISO: null }) as Record<string, unknown>
    expect('dateModified' in ld).toBe(false)
  })
})

describe('latestProbabilityUpdateISO', () => {
  it('prefers the latest snapshot over updatedAt', () => {
    expect(
      latestProbabilityUpdateISO('2026-01-01T00:00:00Z', [
        { createdAt: '2026-06-01T00:00:00Z' },
        { createdAt: '2026-08-08T09:00:00Z' },
      ]),
    ).toBe('2026-08-08T09:00:00Z')
  })

  it('falls back to updatedAt when there are no snapshots', () => {
    expect(latestProbabilityUpdateISO('2026-01-01T00:00:00Z', [])).toBe('2026-01-01T00:00:00Z')
  })

  it('accepts a Date object for updatedAt', () => {
    const d = new Date('2026-01-01T00:00:00Z')
    expect(latestProbabilityUpdateISO(d, [])).toBe(d.toISOString())
  })
})
