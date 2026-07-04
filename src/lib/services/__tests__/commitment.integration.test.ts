import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createCommitment, updateCommitment, removeCommitment } from '../commitment'

// Mock external services that have side effects we don't want in DB tests
vi.mock('@/lib/services/telegram', () => ({
  notifyNewCommitment: vi.fn().mockResolvedValue(undefined),
  notifyServerError: vi.fn(),
}))

vi.mock('@/lib/services/notification', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined)
}))

describe('Commitment Service Integration', () => {
  it('should create a commitment and store confidence correctly', async () => {
    // 1. Setup data in real Postgres
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
        rs: 100,
      }
    })

    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Integration Test Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-' + Date.now(),
      }
    })

    // 2. Execute service call with new confidence-based API
    const result = await createCommitment(user.id, prediction.id, {
      confidence: 70,
    })

    // 3. Verify result
    expect(result.ok).toBe(true)

    // 4. Verify DB state - Commitment stores confidence in cuCommitted
    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id }
    })
    expect(commitment).toBeDefined()
    expect(commitment?.cuCommitted).toBe(70)
    expect(commitment?.binaryChoice).toBe(true)  // derived from positive confidence

    // 5. RS is unchanged (RS only changes on resolution)
    const unchangedUser = await prisma.user.findUnique({ where: { id: user.id } })
    expect(unchangedUser?.rs).toBe(100)
  })

  it('should derive binaryChoice false from negative confidence', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'bear@example.com',
        rs: 50,
      }
    })

    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Bearish Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-bear-' + Date.now(),
      }
    })

    const result = await createCommitment(user.id, prediction.id, {
      confidence: -40,
    })

    expect(result.ok).toBe(true)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id }
    })
    expect(commitment?.cuCommitted).toBe(-40)
    expect(commitment?.binaryChoice).toBe(false)  // derived from negative confidence
  })

  it('blocks a new commitment on a settled forecast', async () => {
    const user = await prisma.user.create({
      data: { email: 'settled-block@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Settled Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-settled-' + Date.now(),
        settled: true,
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 60 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment).toBeNull()
  })

  it('blocks a new commitment past the resolution deadline', async () => {
    const user = await prisma.user.create({
      data: { email: 'deadline-block@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Expired Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2020-01-01'),
        shareToken: 'test-token-expired-' + Date.now(),
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 60 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  it('blocks updating an existing commitment after settlement', async () => {
    const user = await prisma.user.create({
      data: { email: 'settled-update@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Update-Block Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-update-block-' + Date.now(),
      },
    })

    const created = await createCommitment(user.id, prediction.id, { confidence: 40 })
    expect(created.ok).toBe(true)

    await prisma.prediction.update({ where: { id: prediction.id }, data: { settled: true } })

    const result = await updateCommitment(user.id, prediction.id, { confidence: 90 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment?.cuCommitted).toBe(40) // unchanged
  })

  it('blocks removing a commitment after settlement', async () => {
    const user = await prisma.user.create({
      data: { email: 'settled-remove@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Remove-Block Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-remove-block-' + Date.now(),
      },
    })

    const created = await createCommitment(user.id, prediction.id, { confidence: -30 })
    expect(created.ok).toBe(true)

    await prisma.prediction.update({ where: { id: prediction.id }, data: { settled: true } })

    const result = await removeCommitment(user.id, prediction.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment).not.toBeNull()
  })

  it('allows the author to stake on a PENDING_APPROVAL forecast that is not settled', async () => {
    const user = await prisma.user.create({
      data: { email: 'author-stake@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Pending Approval Prediction',
        authorId: user.id,
        status: 'PENDING_APPROVAL',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-pending-' + Date.now(),
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 50 })
    expect(result.ok).toBe(true)
  })

  it('blocks the author staking on a PENDING_APPROVAL forecast that is settled', async () => {
    const user = await prisma.user.create({
      data: { email: 'author-stake-settled@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Pending Approval Settled Prediction',
        authorId: user.id,
        status: 'PENDING_APPROVAL',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-pending-settled-' + Date.now(),
        settled: true,
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 50 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })
})
