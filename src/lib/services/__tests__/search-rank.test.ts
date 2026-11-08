import { describe, it, expect } from 'vitest'
import { rankSearchMatches, type SearchCandidate } from '../search-rank'

let t = 0
const c = (id: string, claimText: string, extra: Partial<SearchCandidate> = {}): SearchCandidate => ({
  id, claimText, createdAt: new Date(Date.UTC(2026, 0, 1) + (t++) * 1000), tags: [], translations: [], ...extra,
})

describe('rankSearchMatches (daatan#1878)', () => {
  it('drops substring-only hits for a short query and keeps whole-word ones', () => {
    const rows = [
      c('again', 'Eisenkot will offer Netanyahu a unity government again'),
      c('ai', 'An AI lab will release a model with 10T parameters'),
      c('ukraine', 'Ukraine and Russia will sign a ceasefire'),
    ]
    expect(rankSearchMatches('AI', rows)).toEqual(['ai'])
  })

  it('keeps a short query that matches a tag exactly or a translation word', () => {
    const rows = [
      c('tag', 'Chip export controls will tighten', { tags: [{ name: 'AI' }] }),
      c('tr', 'Something in English', { translations: [{ translatedText: 'ИИ и AI в России' }] }),
      c('noise', 'Paid leave will expand'),
    ]
    expect(rankSearchMatches('ai', rows)).toEqual(['tr', 'tag'])
  })

  it('orders whole word > prefix > substring > trigram, newest first within a tier', () => {
    const rows = [
      c('fuzzy', 'Gadi Eizenkot will form a government'),
      c('sub', 'The Knesset will pass a preelection budget'),
      c('prefix', 'Elections will be held before March'),
      c('wordOld', 'The election will be postponed'),
      c('wordNew', 'Turnout in the election will exceed 70%'),
    ]
    expect(rankSearchMatches('election', rows, ['fuzzy'])).toEqual(['wordNew', 'wordOld', 'prefix', 'sub', 'fuzzy'])
  })

  it('keeps the DB word_similarity order among trigram-only matches', () => {
    const rows = [c('b', 'Gadi Ajzenkot leads'), c('a', 'Gadi Eizenkot wins')]
    expect(rankSearchMatches('Eisenkot', rows, ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('handles regex metacharacters and non-Latin scripts', () => {
    const rows = [
      c('usd', 'RAM will cost over $450 (retail)'),
      c('he', 'x', { translations: [{ translatedText: 'הממשלה תיפול לפני הבחירות' }] }),
    ]
    expect(rankSearchMatches('$450', rows)).toEqual(['usd', 'he'])
    expect(rankSearchMatches('הבחירות', rows)).toEqual(['he', 'usd'])
  })
  it('never drops a row the DB matched for a longer query, only ranks it last', () => {
    const rows = [c('tagFuzzy', 'Chip export controls', { tags: [{ name: 'Elektions' }] }), c('word', 'The election is near')]
    expect(rankSearchMatches('election', rows)).toEqual(['word', 'tagFuzzy'])
  })
  it('ranks a claim prefix above a tag match, as the scores say', () => {
    const rows = [c('prefix', 'Elections will be held early'), c('tag', 'Coalition talks', { tags: [{ name: 'election' }] })]
    expect(rankSearchMatches('election', rows)).toEqual(['prefix', 'tag'])
  })
})
