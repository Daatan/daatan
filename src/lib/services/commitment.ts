import { prisma } from '@/lib/prisma'
import type { Prisma, PredictionOption, PredictionStatus } from '@prisma/client'
import { notifyNewCommitment } from '@/lib/services/telegram'
import { createNotification } from '@/lib/services/notification'
import { triggerAiProbabilityEstimate } from '@/lib/services/ai-estimate'
import { createLogger } from '@/lib/logger'
import type { ServiceResult } from '@/lib/types/service'

const log = createLogger('commitment-service')

/** Prediction with options, as needed for commitment validation and notifications. */
export interface CommitmentPrediction {
  id: string
  status: string
  authorId: string
  outcomeType: string
  claimText: string
  slug: string | null
  lockedAt: Date | null
  settled: boolean
  resolveByDatetime: Date
  claimDeadline: Date | null
  options: PredictionOption[]
}

/** Data validated by createCommitmentSchema. */
interface CreateCommitmentData {
  confidence: number   // -100..100 for BINARY, 0..100 for MULTIPLE_CHOICE
  optionId?: string
}

/** Data validated by updateCommitmentSchema. */
interface UpdateCommitmentData {
  confidence?: number
  optionId?: string
}

// ============================================
// Validation helpers
// ============================================

/** Why new/changed commitments are refused even on an ACTIVE prediction. Null = open. */
export type CommitmentLockReason = 'deadline-passed' | 'impossibility-pinned' | null

/** claimDeadline (LLM-parsed) and resolveByDatetime (platform-authoritative) must
 *  agree within this window to trust an impossibility auto-lock — mirrors
 *  DEADLINE_AGREEMENT_TOLERANCE_MS in temporal-clock.ts (duplicated, not
 *  imported, to keep this module's own dependency surface minimal). */
const DEADLINE_AGREEMENT_TOLERANCE_MS = 72 * 3600_000

/**
 * Committing after the resolution deadline is a free-points exploit: rsChange =
 * (0.25 − brier) × 100 has no time discount, so a sure-thing commit yields ~+25
 * RS risk-free. An Oracle settlement pin (prediction.settled) does NOT lock
 * commitments — it's classifier-derived and can misfire on contradictory source
 * evidence, so it's surfaced only as a notification/banner, never a hard block.
 *
 * The second arm — claimDeadline itself has literally passed — auto-locks ONLY
 * when it agrees with resolveByDatetime within tolerance: that's pure calendar
 * arithmetic, no LLM judgment call in the loop. A tau_lead-derived early
 * impossibility (tEff passed but the literal claimDeadline hasn't) does NOT
 * auto-lock — that's an LLM inference about statutory timing, not a fact, and
 * only sends the provisional Telegram note (temporal-clock.ts).
 */
export function getCommitmentLockReason(
  prediction: { settled: boolean; resolveByDatetime: Date; claimDeadline?: Date | null },
  now: Date = new Date(),
): CommitmentLockReason {
  if (prediction.resolveByDatetime <= now) return 'deadline-passed'
  if (
    prediction.claimDeadline &&
    prediction.claimDeadline.getTime() <= now.getTime() &&
    Math.abs(prediction.claimDeadline.getTime() - prediction.resolveByDatetime.getTime()) <= DEADLINE_AGREEMENT_TOLERANCE_MS
  ) {
    return 'impossibility-pinned'
  }
  return null
}

const LOCK_ERRORS: Record<NonNullable<CommitmentLockReason>, string> = {
  'deadline-passed': 'Commitments are closed — the resolution deadline has passed',
  'impossibility-pinned': 'Commitments are closed — the claim deadline has passed',
}

function validateCommitEligibility(
  prediction: CommitmentPrediction,
  userId: string,
): ServiceResult<never> | null {
  if (prediction.status !== 'ACTIVE' && prediction.status !== 'PENDING_APPROVAL') {
    return { ok: false, error: 'Can only commit to active or pending approval predictions', status: 400 }
  }
  if (prediction.status === 'PENDING_APPROVAL' && prediction.authorId !== userId) {
    return { ok: false, error: 'Only the author can stake on a forecast pending approval', status: 403 }
  }
  const lock = getCommitmentLockReason(prediction)
  if (lock) return { ok: false, error: LOCK_ERRORS[lock], status: 409 }
  return null
}

function validateOutcomeChoice(
  prediction: CommitmentPrediction,
  data: CreateCommitmentData,
): ServiceResult<never> | null {
  if (prediction.outcomeType === 'MULTIPLE_CHOICE') {
    if (!data.optionId) {
      return { ok: false, error: 'Must select an option for multiple choice predictions', status: 400 }
    }
    if (!prediction.options.some((o) => o.id === data.optionId)) {
      return { ok: false, error: 'Invalid option', status: 400 }
    }
    if (data.confidence < 0 || data.confidence > 100) {
      return { ok: false, error: 'Confidence must be 0–100 for multiple choice predictions', status: 400 }
    }
  }
  return null
}

/** Derive binaryChoice from confidence sign for BINARY predictions. */
function deriveBinaryChoice(outcomeType: string, confidence: number): boolean | null {
  if (outcomeType !== 'BINARY') return null
  return confidence >= 0
}

// ============================================
// Service functions
// ============================================

/** Include clause for commitment responses (user + option). */
const commitmentInclude = {
  user: {
    select: { id: true, name: true, username: true, image: true },
  },
  option: {
    select: { id: true, text: true },
  },
} satisfies Prisma.CommitmentInclude

type CommitmentRow = Prisma.CommitmentGetPayload<{ include: typeof commitmentInclude }>

const writeCommitmentInTx = async (
  tx: Prisma.TransactionClient,
  predictionId: string,
  prediction: CommitmentPrediction & { confidence: number | null },
  user: { id: string; rs: number },
  userId: string,
  data: CreateCommitmentData,
): Promise<CommitmentRow> => {
  const priorCommitments = await tx.commitment.findMany({
    where: { predictionId },
    select: { cuCommitted: true },
  })
  const isFirstCommitment = priorCommitments.length === 0

  const communityProbabilityAtCommit: number | null =
    priorCommitments.length === 0
      ? null
      : priorCommitments.reduce((sum, c) => {
          const p =
            prediction.outcomeType === 'BINARY'
              ? (c.cuCommitted + 100) / 200
              : c.cuCommitted / 100
          return sum + p
        }, 0) / priorCommitments.length

  const aiProbabilityAtCommit: number | null =
    prediction.confidence != null ? prediction.confidence / 100 : null

  const created = await tx.commitment.create({
    data: {
      userId,
      predictionId,
      optionId: data.optionId,
      binaryChoice: deriveBinaryChoice(prediction.outcomeType, data.confidence),
      cuCommitted: data.confidence,
      rsSnapshot: user.rs,
      communityProbabilityAtCommit,
      aiProbabilityAtCommit,
    },
    include: commitmentInclude,
  })

  if (isFirstCommitment) {
    await tx.prediction.update({
      where: { id: predictionId },
      data: { lockedAt: new Date() },
    })
  }

  return created
}

/** Telegram + in-app notifications after a commitment row exists (e.g. after an outer transaction commits). */
export const emitCreateCommitmentSideEffects = (
  prediction: CommitmentPrediction,
  commitment: CommitmentRow,
  data: CreateCommitmentData,
): void => {
  const choiceLabel = prediction.outcomeType === 'MULTIPLE_CHOICE'
    ? commitment.option?.text ?? 'option'
    : data.confidence >= 0 ? 'Yes' : 'No'

  notifyNewCommitment(prediction, commitment.user, data.confidence, choiceLabel)

  createNotification({
    userId: prediction.authorId,
    type: 'NEW_COMMITMENT',
    title: 'New commitment on your forecast',
    message: `${commitment.user.name || commitment.user.username || 'Someone'} committed with ${data.confidence > 0 ? '+' : ''}${data.confidence} confidence (${choiceLabel}) on "${prediction.claimText.substring(0, 80)}"`,
    link: `/forecasts/${prediction.slug || prediction.id}`,
    predictionId: prediction.id,
    actorId: commitment.userId,
  })
}

export type CreateCommitmentTxOptions = { tx: Prisma.TransactionClient }

/**
 * Create a new commitment on a prediction.
 * Stores confidence (-100..100) in cuCommitted; derives binaryChoice from sign.
 * Pass `{ tx }` to participate in a caller-managed transaction (no nested $transaction); side effects run only after commit via {@link emitCreateCommitmentSideEffects}.
 */
export async function createCommitment(
  userId: string,
  predictionId: string,
  data: CreateCommitmentData,
  options?: CreateCommitmentTxOptions,
): Promise<ServiceResult<CommitmentRow>> {
  const db = options?.tx ?? prisma

  const [prediction, user] = await Promise.all([
    db.prediction.findUnique({
      where: { id: predictionId },
      include: {
        options: true,
        // confidence needed for aiProbabilityAtCommit snapshot; the latest
        // snapshot's insufficientData tells us whether the Oracle abstained, so we
        // don't manufacture an LLM estimate to grade an abstained forecast against.
        // Excludes kind='clock' rows — a clock tick carries no insufficientData
        // signal of its own and would mask the real latest abstention state.
        contextSnapshots: {
          where: { kind: { not: 'clock' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { insufficientData: true },
        },
      },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { id: true, rs: true },
    }),
  ])

  if (!prediction) return { ok: false, error: 'Prediction not found', status: 404 }
  if (!user) return { ok: false, error: 'User not found', status: 404 }

  const eligibilityError = validateCommitEligibility(prediction, userId)
  if (eligibilityError) return eligibilityError

  const existing = await db.commitment.findUnique({
    where: { userId_predictionId: { userId, predictionId } },
  })
  if (existing) return { ok: false, error: 'Already committed to this prediction', status: 400 }

  const outcomeError = validateOutcomeChoice(prediction, data)
  if (outcomeError) return outcomeError

  let commitment: CommitmentRow
  if (options?.tx) {
    commitment = await writeCommitmentInTx(options.tx, predictionId, prediction, user, userId, data)
  } else {
    commitment = await prisma.$transaction((tx) =>
      writeCommitmentInTx(tx, predictionId, prediction, user, userId, data),
    )
    emitCreateCommitmentSideEffects(prediction, commitment, data)

    const abstained = prediction.contextSnapshots?.[0]?.insufficientData ?? false
    if (commitment.aiProbabilityAtCommit == null && !abstained) {
      // confidence was null at commit. That's either "not analysed yet" (ask the
      // LLM for a base-rate estimate to grade against) or "the Oracle abstained —
      // insufficient evidence". For the latter (abstained) we must NOT manufacture
      // a number: the UI honestly shows no AI estimate, so grading the user's
      // aiScore against an LLM guess would defeat the abstention. Leaving
      // aiProbabilityAtCommit null makes aiScore simply skipped at resolution.
      void triggerAiProbabilityEstimate(commitment.id, prediction.claimText)
    }
  }

  return { ok: true, data: commitment, status: 201 }
}

/**
 * Remove a commitment. No penalty — confidence-based system has no CU to burn.
 */
export async function removeCommitment(
  userId: string,
  predictionId: string,
): Promise<ServiceResult<{ success: true }>> {
  const commitment = await prisma.commitment.findUnique({
    where: { userId_predictionId: { userId, predictionId } },
    include: { prediction: { select: { status: true, settled: true, resolveByDatetime: true, claimDeadline: true } } },
  })

  if (!commitment) return { ok: false, error: 'Commitment not found', status: 404 }
  if (commitment.prediction.status !== 'ACTIVE') {
    return { ok: false, error: 'Cannot remove commitment from non-active predictions', status: 400 }
  }
  // Deleting a losing commitment after the outcome is known dodges the loss —
  // the same exploit as late committing, in reverse.
  const removeLock = getCommitmentLockReason(commitment.prediction)
  if (removeLock) return { ok: false, error: LOCK_ERRORS[removeLock], status: 409 }

  await prisma.commitment.delete({ where: { id: commitment.id } })

  log.info({ userId, predictionId }, 'Commitment removed')

  return { ok: true, data: { success: true }, status: 200 }
}

/**
 * Update an existing commitment's confidence or option.
 * No penalty — can change freely while prediction is active.
 */
export async function updateCommitment(
  userId: string,
  predictionId: string,
  data: UpdateCommitmentData,
): Promise<ServiceResult<Prisma.CommitmentGetPayload<{ include: typeof commitmentInclude }>>> {
  const [commitment, user] = await Promise.all([
    prisma.commitment.findUnique({
      where: { userId_predictionId: { userId, predictionId } },
      include: { prediction: { include: { options: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, rs: true },
    }),
  ])

  if (!commitment) return { ok: false, error: 'Commitment not found', status: 404 }
  if (!user) return { ok: false, error: 'User not found', status: 404 }

  if (commitment.prediction.status !== 'ACTIVE') {
    return { ok: false, error: 'Can only update commitments on active predictions', status: 400 }
  }
  const updateLock = getCommitmentLockReason(commitment.prediction)
  if (updateLock) return { ok: false, error: LOCK_ERRORS[updateLock], status: 409 }

  if (data.optionId !== undefined) {
    const optionExists = commitment.prediction.options.some((o) => o.id === data.optionId)
    if (!optionExists) return { ok: false, error: 'Invalid option', status: 400 }
  }

  const newConfidence = data.confidence ?? commitment.cuCommitted

  const updated = await prisma.commitment.update({
    where: { id: commitment.id },
    data: {
      cuCommitted: newConfidence,
      binaryChoice: data.confidence !== undefined
        ? deriveBinaryChoice(commitment.prediction.outcomeType, newConfidence)
        : commitment.binaryChoice,
      optionId: data.optionId ?? commitment.optionId,
      rsSnapshot: user.rs,
    },
    include: commitmentInclude,
  })

  return { ok: true, data: updated, status: 200 }
}

export async function getRecentActivity(limit: number) {
  return prisma.commitment.findMany({
    where: {
      user: { isPublic: true },
      prediction: { isPublic: true },
    },
    include: {
      user: { select: { id: true, name: true, username: true, image: true, rs: true } },
      prediction: { select: { id: true, slug: true, claimText: true, status: true, outcomeType: true } },
      option: { select: { id: true, text: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export interface ListUserCommitmentsQuery {
  userId: string
  predictionId?: string
  status?: string
  page: number
  limit: number
}

export async function listUserCommitments({ userId, predictionId, status, page, limit }: ListUserCommitmentsQuery) {
  const where: Prisma.CommitmentWhereInput = {
    userId,
    ...(predictionId && { predictionId }),
    ...(status && { prediction: { status: status as PredictionStatus } }),
  }

  const [commitments, total] = await Promise.all([
    prisma.commitment.findMany({
      where,
      include: {
        prediction: {
          select: { id: true, claimText: true, status: true, resolveByDatetime: true, outcomeType: true },
        },
        option: { select: { id: true, text: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.commitment.count({ where }),
  ])

  return { commitments, total }
}

/** Fetch a commitment's confidence and outcomeType for the Brier ΔRS preview. */
export async function getCommitmentForPreview(userId: string, predictionId: string) {
  return prisma.commitment.findUnique({
    where: { userId_predictionId: { userId, predictionId } },
    select: {
      cuCommitted: true,
      optionId: true,
      prediction: { select: { outcomeType: true } },
    },
  })
}

/** Aggregate commitment stats for a user across all their predictions. */
export async function getCommitmentStats(userId: string) {
  const commitments = await prisma.commitment.findMany({
    where: { userId },
    include: {
      prediction: { select: { status: true } },
    },
  })

  const total = commitments.length
  const totalRsChange = commitments.reduce((sum, c) => sum + (c.rsChange ?? 0), 0)

  const resolved = commitments.filter(
    (c) => c.prediction.status === 'RESOLVED_CORRECT' || c.prediction.status === 'RESOLVED_WRONG',
  )
  // "Correct" mirrors the resolution engine's own definition (prediction-resolution.ts):
  // brierScore < 0.25 means the forecast beat a coin flip toward the true outcome.
  // Void commitments never get a brierScore, so they drop out of the accuracy base.
  const scored = resolved.filter((c) => c.brierScore != null)
  const correct = scored.filter((c) => c.brierScore! < 0.25)
  const wrong = scored.filter((c) => c.brierScore! >= 0.25)
  const pending = commitments.filter(
    (c) => c.prediction.status === 'ACTIVE' || c.prediction.status === 'PENDING',
  )

  const accuracy = scored.length > 0 ? Math.round((correct.length / scored.length) * 100) : null
  const avgBrierScore =
    scored.length > 0
      ? Math.round((scored.reduce((sum, c) => sum + c.brierScore!, 0) / scored.length) * 1000) / 1000
      : null

  return {
    total,
    resolved: resolved.length,
    correct: correct.length,
    wrong: wrong.length,
    pending: pending.length,
    accuracy,
    totalRsChange: Math.round(totalRsChange * 100) / 100,
    avgBrierScore,
    brierCount: scored.length,
  }
}
