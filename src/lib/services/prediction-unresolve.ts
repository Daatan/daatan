import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { notifySearchEngines } from '@/lib/services/indexnow'
import { RESOLUTION_SNAPSHOT_VERSION, type ResolutionSnapshotPayload } from '@/lib/services/resolution-snapshot'
import { deadlineEndsAt } from '@/lib/utils/date'

const log = createLogger('prediction-unresolve')

const RESOLVED_STATUSES = ['RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE']
const SCORED_OUTCOMES = ['correct', 'wrong']

function refuse(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode })
}

const toDate = (iso: string | null) => (iso ? new Date(iso) : null)

/**
 * Revert a mistaken resolution from its snapshot (daatan#2077). The forecast can then be
 * resolved again normally. Notifications already sent are kept. The caller undoes what was
 * pushed to retro and news-indexer.
 *
 * Restores recorded values rather than subtracting: `rs` is clamped at 0 and Glicko-2 has no
 * inverse. That overwrites anything else written to these ratings since, so it refuses when
 * a later scored resolution touched the same users. Reverting those first unblocks it.
 *
 * A void or unresolvable resolution leaves ratings unchanged, so reverting one leaves them
 * alone too. Restoring its snapshot would bring back whatever an already-reverted earlier
 * resolution had written, since those are the values it recorded. For the same reason it
 * neither blocks a revert nor needs the later-resolution check.
 */
export async function unresolvePrediction(predictionId: string, actorId: string, reason: string) {
  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { id: true, status: true, resolvedAt: true, resolveByDatetime: true, isPublic: true, slug: true, outcomeType: true },
  })
  if (!prediction) throw refuse('Prediction not found', 404)
  if (!RESOLVED_STATUSES.includes(prediction.status)) throw refuse('Prediction is not resolved', 400)

  const snapshot = await prisma.resolutionSnapshot.findFirst({
    where: { predictionId, revertedAt: null },
    orderBy: { resolvedAt: 'desc' },
  })
  // A status set through the admin override writes no snapshot and no resolvedAt from here,
  // and resolutions from before snapshots existed have none at all.
  if (!snapshot || snapshot.resolvedAt.getTime() !== prediction.resolvedAt?.getTime()) {
    throw refuse('No snapshot of this resolution exists, so it has to be reverted by hand', 409)
  }
  const payload = snapshot.payload as unknown as ResolutionSnapshotPayload
  if (payload.version !== RESOLUTION_SNAPSHOT_VERSION) {
    throw refuse(`Unsupported resolution snapshot version ${payload.version}`, 409)
  }
  const isScored = SCORED_OUTCOMES.includes(snapshot.outcome)
  const now = new Date()
  const status = deadlineEndsAt(prediction.resolveByDatetime) <= now ? 'PENDING' : 'ACTIVE'

  const restored = await prisma.$transaction(async (tx) => {
    if (isScored) {
      // Snapshots rather than commitments: "Forget History" (daatan#1701) detaches
      // commitments from their users, and the later resolution would go unseen.
      const later = await tx.resolutionSnapshot.findFirst({
        where: {
          predictionId: { not: predictionId },
          revertedAt: null,
          resolvedAt: { gt: snapshot.resolvedAt },
          outcome: { in: SCORED_OUTCOMES },
          affectedUserIds: { hasSome: snapshot.affectedUserIds },
        },
        orderBy: { resolvedAt: 'desc' },
        select: { predictionId: true },
      })
      if (later) {
        throw refuse(`A later resolution (forecast ${later.predictionId}) touched the same users. Revert it first`, 409)
      }
    }

    const commitmentIds = payload.commitments.map((c) => c.id)
    const stillAttached = await tx.commitment.count({ where: { id: { in: commitmentIds }, userId: { not: null } } })
    const usersLeft = await tx.user.count({ where: { id: { in: payload.users.map((u) => u.id) } } })
    if (stillAttached !== commitmentIds.length || usersLeft !== payload.users.length) {
      throw refuse('A participant has since removed their history or account, so this has to be reverted by hand', 409)
    }

    // Conditional, so a double submit reverts once.
    const claimed = await tx.resolutionSnapshot.updateMany({
      where: { id: snapshot.id, revertedAt: null },
      data: { revertedAt: now, revertedById: actorId, revertReason: reason },
    })
    if (claimed.count !== 1) throw refuse('This resolution was already reverted', 409)

    if (isScored) {
      for (const { id, ...values } of payload.users) {
        await tx.user.update({ where: { id }, data: values })
      }
      for (const row of payload.tagRatings) {
        const key = { userId: row.userId, tagId: row.tagId }
        if (row.existed) {
          const { elo, mu, sigma, volatility, updatedAt } = row
          await tx.userTagRating.update({
            where: { userId_tagId: key },
            data: { elo, mu, sigma, volatility, updatedAt: new Date(updatedAt) },
          })
        } else {
          await tx.userTagRating.deleteMany({ where: key })
        }
      }
    }

    for (const { id, userId: _userId, ...scores } of payload.commitments) {
      await tx.commitment.update({ where: { id }, data: scores })
    }
    for (const { id, isCorrect } of payload.options) {
      await tx.predictionOption.update({ where: { id }, data: { isCorrect } })
    }
    await tx.aiMemberScore.deleteMany({ where: { predictionId } })
    await tx.calibrationRecord.deleteMany({ where: { predictionId } })

    const before = payload.prediction
    return tx.prediction.update({
      where: { id: predictionId },
      data: {
        // From the deadline, not the snapshot: it may have passed since.
        status,
        resolvedAt: toDate(before.resolvedAt),
        resolvedById: before.resolvedById,
        resolutionOutcome: before.resolutionOutcome,
        evidenceLinks: before.evidenceLinks ?? Prisma.DbNull,
        resolutionNote: before.resolutionNote,
        resolutionOverrodePin: before.resolutionOverrodePin,
        awaitingAiResolution: before.awaitingAiResolution,
        awaitingDismissedAt: toDate(before.awaitingDismissedAt),
        awaitingDismissedConfidence: before.awaitingDismissedConfidence,
      },
    })
  }, { timeout: 60_000 })

  log.info({ predictionId, actorId, reason, outcome: snapshot.outcome, status }, 'Resolution reverted')

  if (prediction.isPublic) notifySearchEngines(prediction.slug ?? prediction.id)

  return { prediction: restored, revertedOutcome: snapshot.outcome, outcomeType: prediction.outcomeType }
}
