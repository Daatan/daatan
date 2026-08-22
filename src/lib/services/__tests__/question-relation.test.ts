import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    questionRelation: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { canonicalPair, proposeRelation } from '../question-relation'

/**
 * daatan#1555 — the two invariants of question_relations.
 *
 * The table is structure only and post-moderated. What makes it unusable is
 * not a missing column but a typer that re-proposes a pair a human already
 * rejected, or stores one complement pair as two rows. Both are decided here,
 * not at the call site.
 */

const base = {
  fromPredictionId: 'b-pred',
  toPredictionId: 'a-pred',
  createdBy: 'EXTRACTED' as const,
}

describe('canonicalPair', () => {
  it('orients symmetric kinds by id so (A,B) and (B,A) are one row', () => {
    expect(canonicalPair('b', 'a', 'COMPLEMENT')).toEqual({ fromPredictionId: 'a', toPredictionId: 'b' })
    expect(canonicalPair('a', 'b', 'COMPLEMENT')).toEqual({ fromPredictionId: 'a', toPredictionId: 'b' })
  })

  it('keeps the caller orientation for directed kinds — from→to is the claim', () => {
    expect(canonicalPair('b', 'a', 'IMPLIES')).toEqual({ fromPredictionId: 'b', toPredictionId: 'a' })
    expect(canonicalPair('b', 'a', 'NESTED_DEADLINE')).toEqual({ fromPredictionId: 'b', toPredictionId: 'a' })
  })
})

describe('proposeRelation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a PROPOSED row in canonical orientation', async () => {
    vi.mocked(prisma.questionRelation.findUnique).mockResolvedValue(null)
    const out = await proposeRelation({ ...base, kind: 'COMPLEMENT', cosine: 0.91, sharedTag: true })
    expect(out).toBe('created')
    expect(prisma.questionRelation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromPredictionId: 'a-pred',
        toPredictionId: 'b-pred',
        kind: 'COMPLEMENT',
        status: 'PROPOSED',
        cosine: 0.91,
        sharedTag: true,
        sign: null,
      }),
    })
  })

  it('never revives a REJECTED pair — a human said no once', async () => {
    vi.mocked(prisma.questionRelation.findUnique).mockResolvedValue({ status: 'REJECTED' } as never)
    const out = await proposeRelation({ ...base, kind: 'COMPLEMENT' })
    expect(out).toBe('kept_rejected')
    expect(prisma.questionRelation.create).not.toHaveBeenCalled()
    expect(prisma.questionRelation.update).not.toHaveBeenCalled()
  })

  it('never downgrades a CONFIRMED pair back to PROPOSED', async () => {
    vi.mocked(prisma.questionRelation.findUnique).mockResolvedValue({ status: 'CONFIRMED' } as never)
    expect(await proposeRelation({ ...base, kind: 'IMPLIES' })).toBe('kept_decided')
    expect(prisma.questionRelation.update).not.toHaveBeenCalled()
  })

  it('refreshes the evidence on a still-PROPOSED pair instead of duplicating it', async () => {
    vi.mocked(prisma.questionRelation.findUnique).mockResolvedValue({ status: 'PROPOSED' } as never)
    expect(await proposeRelation({ ...base, kind: 'IMPLIES', cosine: 0.88 })).toBe('refreshed')
    expect(prisma.questionRelation.create).not.toHaveBeenCalled()
    expect(prisma.questionRelation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cosine: 0.88 }) }),
    )
  })

  it('refuses a self-relation and a sign on a non-conditional kind', async () => {
    expect(await proposeRelation({ ...base, toPredictionId: 'b-pred', kind: 'ALIAS' })).toBe('self')
    await expect(proposeRelation({ ...base, kind: 'COMPLEMENT', sign: 1 })).rejects.toThrow(/CONDITIONAL/)
    expect(prisma.questionRelation.findUnique).not.toHaveBeenCalled()
  })

  it('stores the sign for a CONDITIONAL relation', async () => {
    vi.mocked(prisma.questionRelation.findUnique).mockResolvedValue(null)
    await proposeRelation({ ...base, kind: 'CONDITIONAL', sign: -1 })
    expect(prisma.questionRelation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'CONDITIONAL', sign: -1, fromPredictionId: 'b-pred' }),
    })
  })
})
