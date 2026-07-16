import { describe, it, expect } from 'vitest'
import { matchCuratedAuthor, CURATED_ELECTION_AUTHORS } from '../authors'
import { buildElectionMatrix, stanceSide, type ElectionEventInput } from '../matrix'

describe('matchCuratedAuthor', () => {
  it('matches on English name, Hebrew name, and Telegram handle', () => {
    expect(matchCuratedAuthor({ author: 'Amit Segal' })).toBe('amit-segal')
    expect(matchCuratedAuthor({ author: 'אמית סגל' })).toBe('amit-segal')
    expect(matchCuratedAuthor({ sourceName: 'amitsegal' })).toBe('amit-segal')
  })

  it('prefers author but falls back to sourceName', () => {
    expect(matchCuratedAuthor({ author: null, sourceName: 'Ben Caspit' })).toBe('ben-caspit')
  })

  it('returns null for an untracked source', () => {
    expect(matchCuratedAuthor({ author: 'Some Rando', sourceName: 'Reuters' })).toBeNull()
    expect(matchCuratedAuthor({ author: null, sourceName: null })).toBeNull()
  })

  describe('person_id fast path (evidence-pool rows, Phase 2.3)', () => {
    const CASPIT_ID = '6b9ee26f-b1be-4ad4-be60-0a747a2caf07'

    it('resolves by person id alone — a surname-only byline no alias reaches', () => {
      expect(matchCuratedAuthor({ author: 'כספית' })).toBeNull()
      expect(matchCuratedAuthor({ author: 'כספית', personId: CASPIT_ID })).toBe('ben-caspit')
    })

    it('beats the alias match when both would fire', () => {
      expect(matchCuratedAuthor({ author: 'Amit Segal', personId: CASPIT_ID })).toBe('ben-caspit')
    })

    it('falls back to aliases for a person id we do not curate', () => {
      expect(matchCuratedAuthor({ author: 'Amit Segal', personId: '00000000-0000-0000-0000-000000000000' })).toBe(
        'amit-segal',
      )
    })

    it('every curated author with a person id resolves by it', () => {
      const withId = CURATED_ELECTION_AUTHORS.filter((a) => a.personId)
      expect(withId.map((a) => a.key).sort()).toEqual(['ben-caspit', 'edy-cohen', 'guy-bechor', 'ksenia-svetlova'])
      for (const a of withId) {
        expect(matchCuratedAuthor({ author: null, sourceName: null, personId: a.personId })).toBe(a.key)
      }
    })
  })
})

describe('stanceSide', () => {
  it('splits on the ±0.15 threshold', () => {
    expect(stanceSide(0.5)).toBe('yes')
    expect(stanceSide(-0.5)).toBe('no')
    expect(stanceSide(0.1)).toBe('neutral')
    expect(stanceSide(null)).toBe('neutral')
  })
})

describe('buildElectionMatrix', () => {
  const events: ElectionEventInput[] = [
    {
      id: 'e1',
      slug: 'e1',
      claimText: 'Party X will win',
      resolveByISO: '2026-11-01T00:00:00.000Z',
      status: 'ACTIVE',
      probabilityYes: 60,
      sources: [
        { author: 'Amit Segal', sourceName: 'amitsegal', url: 'https://t.me/amitsegal/1', stance: 0.8, certainty: 0.9, claims: ['X surges'], title: 'X surges' },
        { author: 'Amit Segal', sourceName: 'amitsegal', url: 'https://t.me/amitsegal/2', stance: 0.6, certainty: 0.7, claims: [], title: null },
        { author: 'Rando', sourceName: 'Reuters', url: 'https://r.com/1', stance: -0.9, certainty: 0.5, claims: ['nope'], title: 'nope' },
      ],
    },
    {
      id: 'e2',
      slug: 'e2',
      claimText: 'Turnout above 70%',
      resolveByISO: '2026-11-01T00:00:00.000Z',
      status: 'ACTIVE',
      probabilityYes: null,
      sources: [
        { author: 'Ben Caspit', sourceName: null, url: 'https://t.me/Ben_Caspit/9', stance: -0.4, certainty: 0.6, claims: ['low turnout'], title: 't' },
      ],
    },
  ]

  const matrix = buildElectionMatrix(events)

  it('keeps all curated authors as rows and all events as columns', () => {
    expect(matrix.authors).toHaveLength(CURATED_ELECTION_AUTHORS.length)
    expect(matrix.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    // events are stripped of their sources
    expect(matrix.events[0]).not.toHaveProperty('sources')
  })

  it('collapses an author’s multiple sources on one event into one aggregated cell', () => {
    const segal = matrix.authors.find((a) => a.key === 'amit-segal')!
    const cell = segal.cells['e1']
    expect(cell.side).toBe('yes')
    expect(cell.stance).toBeCloseTo(0.7) // mean of 0.8 and 0.6
    expect(cell.certainty).toBe(0.9) // max
    expect(cell.claim).toBe('X surges') // first source carrying a claim
    expect(segal.coverage).toBe(1)
  })

  it('ignores untracked sources and leaves uncovered cells absent', () => {
    const segal = matrix.authors.find((a) => a.key === 'amit-segal')!
    expect(segal.cells['e2']).toBeUndefined()
    const caspit = matrix.authors.find((a) => a.key === 'ben-caspit')!
    expect(caspit.cells['e2'].side).toBe('no')
    expect(caspit.coverage).toBe(1)
  })
})
