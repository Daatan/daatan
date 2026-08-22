import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn().mockResolvedValue('<a>{{aClaim}}</a><b>{{bClaim}}</b>'),
  fillPrompt: (t: string, v: Record<string, string | number>) =>
    Object.entries(v).reduce((s, [k, val]) => s.replace(`{{${k}}}`, String(val)), t),
}))
vi.mock('../question-relation', () => ({ proposeRelation: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { llmService } from '@/lib/llm'
import { proposeRelation } from '../question-relation'
import { toProposal, runRelationTyper, MIN_CONFIDENCE, type CandidatePair, type TyperVerdict } from '../relation-typer'

/**
 * retro#574 — what the typer must get right that cosine cannot.
 *
 * The mapping from a verdict to a stored row is where the sign lives: a
 * complement stored as an alias would make a coherence engine pull P(H) and
 * P(¬H) together instead of toward 1. These tests pin the mapping, the
 * direction handling, and that "independent" / unsure verdicts store nothing.
 */

const pair: CandidatePair = {
  aId: 'a', aClaim: 'Israel withdraws from southern Lebanon by Dec 31', aDeadline: new Date('2026-12-31'), aDirection: 'ARRIVAL',
  bId: 'b', bClaim: 'IDF maintains presence in Lebanon through Dec 31', bDeadline: new Date('2026-12-31'), bDirection: 'SURVIVAL',
  cosine: 0.91, sharedTags: ['lebanon'],
}
const verdict = (over: Partial<TyperVerdict>): TyperVerdict => ({
  relation: 'complement', direction: null, a_span: 'withdraws', b_span: 'maintains presence', confidence: 0.9, notes: '', ...over,
})

describe('toProposal', () => {
  it('types a negation pair as COMPLEMENT with the evidence attached', () => {
    const p = toProposal(pair, verdict({}))
    expect(p).toMatchObject({ fromPredictionId: 'a', toPredictionId: 'b', kind: 'COMPLEMENT', createdBy: 'MODEL', cosine: 0.91, sharedTag: true })
    expect(p?.typerOutput).toMatchObject({ version: 'v1', relation: 'complement', aId: 'a', bId: 'b' })
  })

  it('orients directed kinds by the verdict — b_to_a flips from/to', () => {
    expect(toProposal(pair, verdict({ relation: 'implies', direction: 'b_to_a' }))).toMatchObject({
      fromPredictionId: 'b', toPredictionId: 'a', kind: 'IMPLIES',
    })
    expect(toProposal(pair, verdict({ relation: 'nested', direction: 'a_to_b' }))).toMatchObject({
      fromPredictionId: 'a', toPredictionId: 'b', kind: 'NESTED_DEADLINE',
    })
    expect(toProposal(pair, verdict({ relation: 'threshold', direction: 'a_to_b' }))?.kind).toBe('THRESHOLD_NESTING')
  })

  it('drops a directed kind with no direction rather than guessing', () => {
    expect(toProposal(pair, verdict({ relation: 'implies', direction: null }))).toBeNull()
  })

  it('records independent as a NONE ledger row and stores nothing for low confidence', () => {
    expect(toProposal(pair, verdict({ relation: 'independent' }))).toMatchObject({ kind: 'NONE', createdBy: 'MODEL' })
    expect(toProposal(pair, verdict({ confidence: MIN_CONFIDENCE - 0.01 }))).toBeNull()
  })
})

describe('runRelationTyper', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proposes typed pairs, ledgers independent ones, and never writes on dryRun', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([pair, { ...pair, bId: 'c', bClaim: 'Lebanon recognises Israel' }])
    vi.mocked(llmService.generateContent)
      .mockResolvedValueOnce({ text: JSON.stringify(verdict({})) } as never)
      .mockResolvedValueOnce({ text: JSON.stringify(verdict({ relation: 'independent' })) } as never)
    vi.mocked(proposeRelation).mockResolvedValue('created')

    const s = await runRelationTyper({ limit: 10 })
    expect(s).toMatchObject({ candidates: 2, typed: 2, independent: 1, failed: 0, outcomes: { created: 2 } })
    expect(proposeRelation).toHaveBeenCalledTimes(2)
    expect(vi.mocked(proposeRelation).mock.calls.map(c => c[0].kind).sort()).toEqual(['COMPLEMENT', 'NONE'])

    vi.mocked(prisma.$queryRaw).mockResolvedValue([pair])
    vi.mocked(llmService.generateContent).mockResolvedValueOnce({ text: JSON.stringify(verdict({})) } as never)
    const dry = await runRelationTyper({ dryRun: true })
    expect(dry.proposals).toHaveLength(1)
    expect(proposeRelation).toHaveBeenCalledTimes(2)
  })

  it('fails open per pair — a malformed verdict is counted, not thrown', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([pair])
    vi.mocked(llmService.generateContent).mockResolvedValueOnce({ text: '{"relation":"sideways"}' } as never)
    const s = await runRelationTyper()
    expect(s).toMatchObject({ candidates: 1, typed: 0, failed: 1 })
    expect(proposeRelation).not.toHaveBeenCalled()
  })
})
