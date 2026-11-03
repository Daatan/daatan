import type { Prisma } from '@prisma/client'
import type { TagRatingPreState } from '@/lib/services/tag-ratings'

/**
 * What a resolution overwrites, captured inside the resolve transaction so an admin can
 * revert a mistaken one (daatan#2077). The 2026-11-02 manual revert (daatan#2076) had to
 * rebuild this from `rsChange` and audit rows, and it can't be rebuilt in general: `rs` is
 * clamped at 0 and Glicko-2 has no inverse, so restoring means restoring recorded values.
 *
 * Values come from the rows `resolvePrediction` already loaded, which are the same values
 * its scoring reads and overwrites.
 */
export const RESOLUTION_SNAPSHOT_VERSION = 1

type SnapshotPrediction = {
  status: string
  resolvedAt: Date | null
  resolvedById: string | null
  resolutionOutcome: string | null
  evidenceLinks: Prisma.JsonValue
  resolutionNote: string | null
  resolutionOverrodePin: boolean | null
  awaitingAiResolution: boolean
  awaitingDismissedAt: Date | null
  awaitingDismissedConfidence: number | null
  options: { id: string; isCorrect: boolean | null }[]
}

type SnapshotCommitment = {
  id: string
  userId: string
  rsChange: number | null
  brierScore: number | null
  peerScore: number | null
  aiScore: number | null
  klDivergence: number | null
  eloChange: number | null
  user: {
    id: string
    rs: number
    mu: number
    sigma: number
    volatility: number
    eloRating: number
    totalPredictions: number
    correctPredictions: number
  }
}

export interface ResolutionSnapshotPayload {
  version: number
  prediction: {
    status: string
    resolvedAt: string | null
    resolvedById: string | null
    resolutionOutcome: string | null
    evidenceLinks: Prisma.InputJsonValue | null
    resolutionNote: string | null
    resolutionOverrodePin: boolean | null
    awaitingAiResolution: boolean
    awaitingDismissedAt: string | null
    awaitingDismissedConfidence: number | null
  }
  options: { id: string; isCorrect: boolean | null }[]
  commitments: {
    id: string
    userId: string
    rsChange: number | null
    brierScore: number | null
    peerScore: number | null
    aiScore: number | null
    klDivergence: number | null
    eloChange: number | null
  }[]
  users: {
    id: string
    rs: number
    mu: number
    sigma: number
    volatility: number
    eloRating: number
    totalPredictions: number
    correctPredictions: number
  }[]
  tagRatings: (
    | { userId: string; tagId: string; existed: true; elo: number; mu: number; sigma: number; volatility: number; updatedAt: string }
    | { userId: string; tagId: string; existed: false }
  )[]
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null

export function buildResolutionSnapshotPayload(
  prediction: SnapshotPrediction,
  commitments: SnapshotCommitment[],
  tagRatings: TagRatingPreState[],
): Prisma.InputJsonObject {
  const users = new Map(commitments.map((c) => [c.user.id, c.user]))

  return {
    version: RESOLUTION_SNAPSHOT_VERSION,
    prediction: {
      status: prediction.status,
      resolvedAt: iso(prediction.resolvedAt),
      resolvedById: prediction.resolvedById,
      resolutionOutcome: prediction.resolutionOutcome,
      evidenceLinks: (prediction.evidenceLinks ?? null) as Prisma.InputJsonValue,
      resolutionNote: prediction.resolutionNote,
      resolutionOverrodePin: prediction.resolutionOverrodePin,
      awaitingAiResolution: prediction.awaitingAiResolution,
      awaitingDismissedAt: iso(prediction.awaitingDismissedAt),
      awaitingDismissedConfidence: prediction.awaitingDismissedConfidence,
    },
    options: prediction.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })),
    commitments: commitments.map((c) => ({
      id: c.id,
      userId: c.userId,
      rsChange: c.rsChange,
      brierScore: c.brierScore,
      peerScore: c.peerScore,
      aiScore: c.aiScore,
      klDivergence: c.klDivergence,
      eloChange: c.eloChange,
    })),
    users: [...users.values()].map((u) => ({
      id: u.id,
      rs: u.rs,
      mu: u.mu,
      sigma: u.sigma,
      volatility: u.volatility,
      eloRating: u.eloRating,
      totalPredictions: u.totalPredictions,
      correctPredictions: u.correctPredictions,
    })),
    tagRatings: tagRatings.map((r) =>
      r.existed
        ? { ...r, updatedAt: iso(r.updatedAt) }
        : { userId: r.userId, tagId: r.tagId, existed: false },
    ),
  }
}
