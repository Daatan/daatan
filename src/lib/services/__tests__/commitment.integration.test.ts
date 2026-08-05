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

  // Matched-time Brier for the AI panel (docs/LASSO.md §7). This FK is the one
  // value that cannot be reconstructed after the fact: it records which panel run was
  // current at the instant the user staked. If it is not captured on write, the
  // commitment is permanently unscoreable against the panel.
  it('pins the latest AI-panel run at commit time', async () => {
    const user = await prisma.user.create({
      data: { email: `panel-${Date.now()}@example.com`, name: 'Panel User', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Panel run is pinned at commit',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'panel-token-' + Date.now(),
      },
    })

    const stale = await prisma.aiEstimateRun.create({
      data: {
        predictionId: prediction.id,
        inputHash: 'a'.repeat(64),
        createdAt: new Date('2026-07-01T00:00:00Z'),
        estimates: {
          create: [
            {
              model: 'qwen/qwen3-235b-a22b-2507',
              mode: 'ungrounded',
              promptVersion: 'v1',
              probability: 30,
            },
          ],
        },
      },
    })
    const current = await prisma.aiEstimateRun.create({
      data: {
        predictionId: prediction.id,
        inputHash: 'b'.repeat(64),
        createdAt: new Date('2026-07-08T00:00:00Z'),
        estimates: {
          create: [
            {
              model: 'qwen/qwen3-235b-a22b-2507',
              mode: 'ungrounded',
              promptVersion: 'v1',
              probability: 55,
            },
            // An abstaining member still occupies a row: null, not a fabricated number.
            {
              model: 'x-ai/grok-4.3',
              mode: 'ungrounded',
              promptVersion: 'v1',
              probability: null,
              insufficientData: true,
            },
          ],
        },
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 70 })
    expect(result.ok).toBe(true)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
      include: { aiRunAtCommit: { include: { estimates: true } } },
    })

    expect(commitment?.aiRunIdAtCommit).toBe(current.id)
    expect(commitment?.aiRunIdAtCommit).not.toBe(stale.id)

    // A run FK, not a scalar: every member's number at commit time is still recoverable,
    // which is what makes per-model Brier possible.
    const estimates = commitment?.aiRunAtCommit?.estimates ?? []
    expect(estimates).toHaveLength(2)
    expect(estimates.find((e) => e.model === 'x-ai/grok-4.3')?.probability).toBeNull()
    expect(estimates.find((e) => e.model.startsWith('qwen/'))?.probability).toBe(55)

    // The panel must never touch the needle.
    const untouched = await prisma.prediction.findUnique({ where: { id: prediction.id } })
    expect(untouched?.confidence).toBeNull()
    expect(untouched?.aiCiLow).toBeNull()
    expect(untouched?.aiCiHigh).toBeNull()
  })

  it('leaves aiRunIdAtCommit null when the panel has never run', async () => {
    const user = await prisma.user.create({
      data: { email: `norun-${Date.now()}@example.com`, name: 'No Run', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'No panel run yet',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'norun-token-' + Date.now(),
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 40 })
    expect(result.ok).toBe(true)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    // Drops out of the aggregates, exactly as a null brierScore already does.
    expect(commitment?.aiRunIdAtCommit).toBeNull()
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

  // Settlement is notification-only since PR #1020 — a pin is classifier-derived
  // and can misfire, so it never hard-blocks staking. These four tests asserted the
  // pre-#1020 lock and sat stale for a month because CI does not run this suite.
  it('allows a new commitment on a settled forecast (settlement is notification-only)', async () => {
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

    expect(result.ok).toBe(true)
    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment?.cuCommitted).toBe(60)
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

  it('allows updating an existing commitment after settlement (notification-only)', async () => {
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
    expect(result.ok).toBe(true)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment?.cuCommitted).toBe(90)

    // The successful update snapshots the prior stake
    const revisions = await prisma.commitmentRevision.findMany({
      where: { commitmentId: commitment!.id },
    })
    expect(revisions).toHaveLength(1)
    expect(revisions[0].cuCommitted).toBe(40)
  })

  it('writes no revision when the update is blocked (deadline passed)', async () => {
    const user = await prisma.user.create({
      data: { email: 'blocked-update-revision@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Blocked Update Revision Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-blocked-revision-' + Date.now(),
      },
    })

    const created = await createCommitment(user.id, prediction.id, { confidence: 40 })
    expect(created.ok).toBe(true)

    await prisma.prediction.update({
      where: { id: prediction.id },
      data: { resolveByDatetime: new Date(Date.now() - 1000) },
    })

    const result = await updateCommitment(user.id, prediction.id, { confidence: 90 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment?.cuCommitted).toBe(40) // unchanged

    // A blocked update must not fabricate history
    const revisions = await prisma.commitmentRevision.findMany({
      where: { commitmentId: commitment!.id },
    })
    expect(revisions).toHaveLength(0)
  })

  it('snapshots the prior state into commitment_revisions on every update', async () => {
    const user = await prisma.user.create({
      data: { email: 'revision-test@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Revision Test Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-revision-' + Date.now(),
      },
    })

    const created = await createCommitment(user.id, prediction.id, { confidence: 40 })
    expect(created.ok).toBe(true)

    const first = await updateCommitment(user.id, prediction.id, { confidence: -60 })
    expect(first.ok).toBe(true)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment?.cuCommitted).toBe(-60)
    expect(commitment?.binaryChoice).toBe(false)

    // The revision holds the PRE-update state
    let revisions = await prisma.commitmentRevision.findMany({
      where: { commitmentId: commitment!.id },
      orderBy: { supersededAt: 'asc' },
    })
    expect(revisions).toHaveLength(1)
    expect(revisions[0].cuCommitted).toBe(40)
    expect(revisions[0].binaryChoice).toBe(true)
    expect(revisions[0].rsSnapshot).toBe(100)

    const second = await updateCommitment(user.id, prediction.id, { confidence: 90 })
    expect(second.ok).toBe(true)

    revisions = await prisma.commitmentRevision.findMany({
      where: { commitmentId: commitment!.id },
      orderBy: { supersededAt: 'asc' },
    })
    expect(revisions).toHaveLength(2)
    expect(revisions[1].cuCommitted).toBe(-60)
    expect(revisions[1].binaryChoice).toBe(false)
  })

  it('cascades revisions away when the commitment is removed', async () => {
    const user = await prisma.user.create({
      data: { email: 'revision-cascade@example.com', rs: 100 },
    })
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Revision Cascade Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date('2030-01-01'),
        shareToken: 'test-token-revision-cascade-' + Date.now(),
      },
    })

    await createCommitment(user.id, prediction.id, { confidence: 40 })
    await updateCommitment(user.id, prediction.id, { confidence: 80 })

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    const removed = await removeCommitment(user.id, prediction.id)
    expect(removed.ok).toBe(true)

    const revisions = await prisma.commitmentRevision.findMany({
      where: { commitmentId: commitment!.id },
    })
    expect(revisions).toHaveLength(0)
  })

  it('allows removing a commitment after settlement (notification-only)', async () => {
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
    expect(result.ok).toBe(true)

    const commitment = await prisma.commitment.findFirst({
      where: { userId: user.id, predictionId: prediction.id },
    })
    expect(commitment).toBeNull()
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

  it('allows the author staking on a PENDING_APPROVAL forecast that is settled (notification-only)', async () => {
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
    expect(result.ok).toBe(true)
  })

  it('blocks a new commitment when claimDeadline has passed and agrees with resolveByDatetime', async () => {
    const user = await prisma.user.create({
      data: { email: 'impossibility-block@example.com', rs: 100 },
    })
    const now = Date.now()
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Impossibility Pinned Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date(now + 11 * 3600_000), // still in the future
        claimDeadline: new Date(now - 3600_000), // passed 1h ago, within 72h tolerance
        shareToken: 'test-token-impossibility-' + Date.now(),
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 60 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  it('does NOT block a commitment when claimDeadline has passed but diverges from resolveByDatetime', async () => {
    const user = await prisma.user.create({
      data: { email: 'divergent-no-block@example.com', rs: 100 },
    })
    const now = Date.now()
    const prediction = await prisma.prediction.create({
      data: {
        claimText: 'Divergent Deadline Prediction',
        authorId: user.id,
        status: 'ACTIVE',
        outcomeType: 'BINARY',
        resolveByDatetime: new Date(now + 100 * 3600_000), // well beyond tolerance
        claimDeadline: new Date(now - 3600_000),
        shareToken: 'test-token-divergent-' + Date.now(),
      },
    })

    const result = await createCommitment(user.id, prediction.id, { confidence: 60 })
    expect(result.ok).toBe(true)
  })
})
