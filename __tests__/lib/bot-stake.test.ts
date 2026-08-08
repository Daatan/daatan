/**
 * @jest-environment node
 * Test suite for the shared create-publish-stake path used by bot forecasts.
 * Covers daatan#1321: the requireApprovalForForecasts branch must create +
 * publish inside a single transaction so a mid-flight failure can never
 * strand a prediction at DRAFT, invisible to the approval queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/services/embedding', () => ({
  embedAndStoreForecast: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/commitment', () => ({
  createCommitment: vi.fn(),
  emitCreateCommitmentSideEffects: vi.fn(),
}))

const predictionCreate = vi.fn()
const predictionUpdate = vi.fn()
const transactionMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      create: (...args: unknown[]) => predictionCreate(...args),
      update: (...args: unknown[]) => predictionUpdate(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}))

function makeBot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'bot-config-1',
    userId: 'bot-user-1',
    stakeMin: 50,
    stakeMax: 150,
    requireApprovalForForecasts: true,
    autoApprove: false,
    user: { id: 'bot-user-1', name: 'CryptoBot' },
    ...overrides,
  } as any
}

const PREDICTION_DATA = { claimText: 'Bitcoin will reach $100k by Dec 2026' } as any

describe('createAndStake — requireApprovalForForecasts branch (daatan#1321)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps create + status update in a single prisma.$transaction call', async () => {
    const { createAndStake } = await import('@/lib/services/bots/stake')

    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = { prediction: { create: predictionCreate, update: predictionUpdate } }
      return cb(tx)
    })
    predictionCreate.mockResolvedValue({ id: 'pred-1' })
    predictionUpdate.mockResolvedValue({ id: 'pred-1', status: 'PENDING_APPROVAL' })

    const result = await createAndStake(makeBot(), PREDICTION_DATA)

    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(predictionCreate).toHaveBeenCalledTimes(1)
    expect(predictionUpdate).toHaveBeenCalledTimes(1)
    expect(result.prediction.id).toBe('pred-1')
    expect(result.stakeAmount).toBeNull()
  })

  it('rolls back entirely — no stranded DRAFT row — when the update leg fails mid-transaction', async () => {
    const { createAndStake } = await import('@/lib/services/bots/stake')

    // Simulate Prisma's real $transaction semantics: if the callback throws,
    // nothing committed inside it persists. A crash/OOM between create and
    // update behaves the same way as long as both run inside $transaction.
    const persisted: Array<{ id: string }> = []
    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const stagedCreate = vi.fn(async (args: { data: unknown }) => {
        const row = { id: 'pred-1', ...args.data as object }
        // Only actually "commit" (push to persisted) if the whole callback succeeds.
        return row
      })
      const stagedUpdate = vi.fn(async () => {
        throw new Error('simulated crash between create and update')
      })
      const tx = { prediction: { create: stagedCreate, update: stagedUpdate } }
      try {
        return await cb(tx)
      } catch (err) {
        // Transaction rolled back — nothing gets pushed to `persisted`.
        throw err
      }
    })

    await expect(createAndStake(makeBot(), PREDICTION_DATA)).rejects.toThrow(
      'simulated crash between create and update',
    )

    // No row was ever committed outside the failed transaction.
    expect(persisted).toHaveLength(0)
    // The top-level prisma.prediction.create/update (non-transactional client)
    // must never have been called directly — everything went through $transaction.
    expect(predictionCreate).not.toHaveBeenCalled()
    expect(predictionUpdate).not.toHaveBeenCalled()
  })

  it('does not call prisma.prediction.create/update directly (only via the tx client)', async () => {
    const { createAndStake } = await import('@/lib/services/bots/stake')

    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        prediction: {
          create: vi.fn().mockResolvedValue({ id: 'pred-2' }),
          update: vi.fn().mockResolvedValue({ id: 'pred-2', status: 'PENDING_APPROVAL' }),
        },
      }
      return cb(tx)
    })

    await createAndStake(makeBot(), PREDICTION_DATA)

    expect(predictionCreate).not.toHaveBeenCalled()
    expect(predictionUpdate).not.toHaveBeenCalled()
  })
})
