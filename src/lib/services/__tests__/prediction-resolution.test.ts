import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Resolution-time write path for the LASSO matched-time scores (docs/LASSO.md §7).
 *
 * ai-panel-score.ts is deliberately NOT mocked: these tests verify the real wiring from
 * the pinned run's estimates to the `ai_member_scores` upserts — the leaderboard's only
 * data source — not the arithmetic (covered in ai-panel-score.test.ts).
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findUnique: vi.fn() }, $transaction: vi.fn() },
}))
vi.mock('@/lib/services/expertise', () => ({ applyGlicko2Update: vi.fn() }))
vi.mock('@/lib/services/elo', () => ({ calculateEloUpdates: vi.fn(() => new Map()) }))
vi.mock('@/lib/services/tag-ratings', () => ({ updateTagRatingsInTx: vi.fn() }))
vi.mock('@/lib/services/indexnow', () => ({ notifySearchEngines: vi.fn() }))
vi.mock('@/lib/services/calibration', () => ({ recordCalibration: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { recordCalibration } from '@/lib/services/calibration'
import { resolvePrediction } from '../prediction-resolution'

const findUnique = vi.mocked(prisma.prediction.findUnique)
const transaction = vi.mocked(prisma.$transaction)

function makeTx() {
  return {
    prediction: { update: vi.fn().mockResolvedValue({ id: 'p1', status: 'RESOLVED_CORRECT' }) },
    predictionOption: { update: vi.fn().mockResolvedValue({}) },
    aiMemberScore: { upsert: vi.fn().mockResolvedValue({}) },
    commitment: { update: vi.fn().mockResolvedValue({}) },
    user: { update: vi.fn().mockResolvedValue({}) },
  }
}
type Tx = ReturnType<typeof makeTx>

function user(id: string) {
  return {
    id,
    rs: 100,
    mu: 25,
    sigma: 8,
    volatility: 0.06,
    totalPredictions: 1,
    correctPredictions: 1,
    eloRating: 1500,
  }
}

function commitment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    userId: 'u1',
    optionId: null,
    cuCommitted: 60, // BINARY: p = (60+100)/200 = 0.8
    createdAt: new Date('2026-07-03T00:00:00Z'),
    communityProbabilityAtCommit: null,
    aiProbabilityAtCommit: null,
    aiRunAtCommit: null,
    user: user('u1'),
    ...overrides,
  }
}

function prediction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    status: 'ACTIVE',
    outcomeType: 'BINARY',
    isPublic: false,
    slug: 'p1',
    tags: [],
    options: [],
    externalMarket: null,
    externalMarketInverted: false,
    commitments: [commitment()],
    ...overrides,
  }
}

/** All aiMemberScore.upsert calls, flattened to their create payloads keyed by model. */
function upserts(tx: Tx) {
  return tx.aiMemberScore.upsert.mock.calls.map(([arg]) => arg)
}

let tx: Tx

beforeEach(() => {
  vi.clearAllMocks()
  tx = makeTx()
  transaction.mockImplementation(async (cb: unknown) => (cb as (t: typeof tx) => unknown)(tx))
})

describe('resolvePrediction — ai_member_scores write path', () => {
  it('writes one row per estimating member (with its promptVersion) plus oracle and market rows (null promptVersion); abstainers get nothing', async () => {
    findUnique.mockResolvedValue(
      prediction({
        externalMarket: {
          snapshots: [
            { createdAt: new Date('2026-07-01T00:00:00Z'), probability: 60 },
            // After the commit — must not be used.
            { createdAt: new Date('2026-07-05T00:00:00Z'), probability: 90 },
          ],
        },
        commitments: [
          commitment({
            aiProbabilityAtCommit: 0.9,
            aiRunAtCommit: {
              estimates: [
                { model: 'qwen.qwen3-235b-a22b-2507-v1:0', mode: 'ungrounded', probability: 80, promptVersion: 'pv1' },
                // The grounded twin: same model string, its own row via the mode axis.
                { model: 'qwen.qwen3-235b-a22b-2507-v1:0', mode: 'grounded-indexer', probability: 70, promptVersion: 'pv2' },
                { model: 'x-ai/grok-4.3', mode: 'ungrounded', probability: 40, promptVersion: 'pv1' },
                { model: 'google/gemma-3-4b-it', mode: 'ungrounded', probability: null, promptVersion: 'pv1' },
              ],
            },
          }),
        ],
      }) as never,
    )

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin' })

    const rows = upserts(tx)
    const byMember = new Map(rows.map((r) => [`${r.create.model}:${r.create.mode}`, r]))
    expect([...byMember.keys()].sort()).toEqual([
      'market:sentinel',
      'oracle:sentinel',
      'qwen.qwen3-235b-a22b-2507-v1:0:grounded-indexer',
      'qwen.qwen3-235b-a22b-2507-v1:0:ungrounded',
      'x-ai/grok-4.3:ungrounded',
    ])

    const qwen = byMember.get('qwen.qwen3-235b-a22b-2507-v1:0:ungrounded')!
    expect(qwen.where).toEqual({
      commitmentId_model_mode: {
        commitmentId: 'c1',
        model: 'qwen.qwen3-235b-a22b-2507-v1:0',
        mode: 'ungrounded',
      },
    })
    expect(qwen.create).toMatchObject({
      predictionId: 'p1',
      commitmentId: 'c1',
      brierScore: expect.closeTo(0.04, 6), // (0.8 − 1)²
      promptVersion: 'pv1',
    })
    // Re-resolution overwrites in place: update mirrors create.
    expect(qwen.update).toEqual({ brierScore: qwen.create.brierScore, promptVersion: 'pv1' })

    // The twin scores independently, under its own prompt version.
    expect(byMember.get('qwen.qwen3-235b-a22b-2507-v1:0:grounded-indexer')!.create).toMatchObject({
      brierScore: expect.closeTo(0.09, 6), // (0.7 − 1)²
      promptVersion: 'pv2',
    })

    expect(byMember.get('x-ai/grok-4.3:ungrounded')!.create.brierScore).toBeCloseTo(0.36, 6)
    expect(byMember.get('oracle:sentinel')!.create).toMatchObject({
      brierScore: expect.closeTo(0.01, 6), // (0.9 − 1)²
      promptVersion: null,
    })
    // Market price as of the commit instant (60, not the later 90), straight polarity.
    expect(byMember.get('market:sentinel')!.create).toMatchObject({
      brierScore: expect.closeTo(0.16, 6), // (0.6 − 1)²
      promptVersion: null,
    })
  })

  it('applies inverted market polarity', async () => {
    findUnique.mockResolvedValue(
      prediction({
        externalMarketInverted: true,
        externalMarket: {
          snapshots: [{ createdAt: new Date('2026-07-01T00:00:00Z'), probability: 60 }],
        },
      }) as never,
    )

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin' })

    const market = upserts(tx).find((r) => r.create.model === 'market')!
    expect(market.create.brierScore).toBeCloseTo(0.36, 6) // ((100−60)/100 − 1)²
  })

  it('writes nothing to ai_member_scores when no run was pinned, no Oracle estimate existed and no market is linked — the commitment itself still resolves', async () => {
    findUnique.mockResolvedValue(prediction() as never)

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin' })

    expect(tx.aiMemberScore.upsert).not.toHaveBeenCalled()
    expect(tx.commitment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ brierScore: expect.closeTo(0.04, 6) }),
      }),
    )
  })

  it('void outcomes score nobody: no member rows, no Brier, rsChange 0', async () => {
    findUnique.mockResolvedValue(
      prediction({
        commitments: [
          commitment({
            aiProbabilityAtCommit: 0.9,
            aiRunAtCommit: {
              estimates: [{ model: 'x-ai/grok-4.3', mode: 'ungrounded', probability: 40, promptVersion: 'pv1' }],
            },
          }),
        ],
      }) as never,
    )

    await resolvePrediction('p1', { outcome: 'void', resolvedById: 'admin' })

    expect(tx.aiMemberScore.upsert).not.toHaveBeenCalled()
    expect(tx.commitment.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { rsChange: 0 },
    })
  })

  it('never touches the needle: the prediction update carries only resolution fields', async () => {
    findUnique.mockResolvedValue(prediction() as never)

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin' })

    const data = tx.prediction.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('confidence')
    expect(data).not.toHaveProperty('aiCiLow')
    expect(data).not.toHaveProperty('aiCiHigh')
    expect(data).toMatchObject({ status: 'RESOLVED_CORRECT', resolutionOutcome: 'correct' })
  })

  it('MULTIPLE_CHOICE resolutions write no member scores — sentinels are BINARY-only', async () => {
    // On MC the per-commitment outcome is "did this user's option win", a different
    // question from the BINARY "did the claim resolve true" every other row answers.
    // Mixing them would blend two question types into one leaderboard aggregate, so
    // oracle/market sentinels are not scored on MC — the humans still resolve normally.
    findUnique.mockResolvedValue(
      prediction({
        outcomeType: 'MULTIPLE_CHOICE',
        options: [{ id: 'o1' }, { id: 'o2' }],
        externalMarket: {
          snapshots: [{ createdAt: new Date('2026-07-01T00:00:00Z'), probability: 60 }],
        },
        commitments: [
          commitment({ id: 'cA', userId: 'u1', optionId: 'o1', cuCommitted: 70, aiProbabilityAtCommit: 0.9, user: user('u1') }),
          commitment({ id: 'cB', userId: 'u2', optionId: 'o2', cuCommitted: 70, aiProbabilityAtCommit: 0.9, user: user('u2') }),
        ],
      }) as never,
    )

    await resolvePrediction('p1', {
      outcome: 'correct',
      resolvedById: 'admin',
      correctOptionId: 'o1',
    })

    expect(tx.aiMemberScore.upsert).not.toHaveBeenCalled()
    // The human side of the resolution is untouched by the sentinel gate.
    expect(tx.commitment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cA' },
        data: expect.objectContaining({ brierScore: expect.closeTo(0.09, 6) }), // (0.7 − 1)²
      }),
    )
  })
})

/**
 * daatan#1233 — the calibration record is written from here, and only here, so
 * every resolution produces one without anyone remembering to.
 */
describe('resolvePrediction — calibration record', () => {
  const recorded = vi.mocked(recordCalibration)

  it('records a resolved binary', async () => {
    findUnique.mockResolvedValue(prediction() as never)
    tx.prediction.update.mockResolvedValue({
      id: 'p1', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-08-01T12:00:00Z'),
    })

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin' })

    expect(recorded).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: 'p1', outcome: 'correct', disputed: false, disputeNote: undefined }),
    )
  })

  // daatan#1234 check #3
  it('flags the calibration record disputed, with a note, when the resolution overrode a pin', async () => {
    findUnique.mockResolvedValue(prediction({ settled: true, confidence: 3 }) as never)
    tx.prediction.update.mockResolvedValue({
      id: 'p1', status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-08-01T12:00:00Z'),
    })

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin', resolutionOverrodePin: true })

    expect(recorded).toHaveBeenCalledWith(
      expect.objectContaining({
        disputed: true,
        disputeNote: "Oracle settled this 'wrong' at confidence=3; resolver declared 'correct'",
      }),
    )
  })

  it('does not flag the calibration record when the outcome agrees with the pin', async () => {
    findUnique.mockResolvedValue(prediction({ settled: true, confidence: 3 }) as never)
    tx.prediction.update.mockResolvedValue({
      id: 'p1', status: 'RESOLVED_WRONG', resolvedAt: new Date('2026-08-01T12:00:00Z'),
    })

    await resolvePrediction('p1', { outcome: 'wrong', resolvedById: 'admin' })

    expect(recorded).toHaveBeenCalledWith(
      expect.objectContaining({ disputed: false, disputeNote: undefined }),
    )
  })

  it('records nothing for void or unresolvable — there is no outcome to score against', async () => {
    for (const outcome of ['void', 'unresolvable'] as const) {
      vi.clearAllMocks()
      tx = makeTx()
      transaction.mockImplementation(async (cb: unknown) => (cb as (t: typeof tx) => unknown)(tx))
      findUnique.mockResolvedValue(prediction() as never)

      await resolvePrediction('p1', { outcome, resolvedById: 'admin' })

      expect(recorded).not.toHaveBeenCalled()
    }
  })

  it('records nothing for multiple choice — there is no single probability to score', async () => {
    findUnique.mockResolvedValue(
      prediction({
        outcomeType: 'MULTIPLE_CHOICE',
        options: [{ id: 'o1' }, { id: 'o2' }],
        commitments: [],
      }) as never,
    )

    await resolvePrediction('p1', {
      outcome: 'correct', resolvedById: 'admin', correctOptionId: 'o1',
    })

    expect(recorded).not.toHaveBeenCalled()
  })
})

/**
 * daatan#1234 check #2 — recomputed server-side (never trusts the client's
 * checkbox), so a direct API call can't bypass it and poison a future
 * calibration-record marking with an unacknowledged disagreement.
 */
describe('resolvePrediction — pin-acknowledgment gate', () => {
  it('rejects a contradicting resolution when unacknowledged', async () => {
    findUnique.mockResolvedValue(prediction({ settled: true, confidence: 3 }) as never)

    await expect(
      resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin' }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('proceeds when the contradiction is explicitly acknowledged, and persists the flag', async () => {
    findUnique.mockResolvedValue(prediction({ settled: true, confidence: 3 }) as never)

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin', resolutionOverrodePin: true })

    expect(tx.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolutionOverrodePin: true }) }),
    )
  })

  it('does not gate a resolution that agrees with the pin', async () => {
    findUnique.mockResolvedValue(prediction({ settled: true, confidence: 3 }) as never)

    await resolvePrediction('p1', { outcome: 'wrong', resolvedById: 'admin' })

    expect(tx.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolutionOverrodePin: null }) }),
    )
  })

  it('does not gate when there is no pin or extreme confidence at all', async () => {
    findUnique.mockResolvedValue(prediction({ settled: false, confidence: 55 }) as never)

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin' })

    expect(tx.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolutionOverrodePin: null }) }),
    )
  })

  it('does not gate MULTIPLE_CHOICE resolutions even with a contradicting pin', async () => {
    findUnique.mockResolvedValue(
      prediction({
        outcomeType: 'MULTIPLE_CHOICE',
        options: [{ id: 'o1' }, { id: 'o2' }],
        settled: true,
        confidence: 3,
        commitments: [],
      }) as never,
    )

    await resolvePrediction('p1', { outcome: 'correct', resolvedById: 'admin', correctOptionId: 'o1' })

    expect(tx.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolutionOverrodePin: null }) }),
    )
  })
})

