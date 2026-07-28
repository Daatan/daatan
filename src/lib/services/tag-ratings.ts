import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { calculateEloUpdates, replayEloHistory } from '@/lib/services/elo'
import { glicko2Update, replayGlicko2History } from '@/lib/services/expertise'
import { replayPunditEloHistory, replayPunditGlickoHistory } from '@/lib/services/pundit-rating'

// Seed per-tag ratings from full history replay if the tag has no stored rows.
// No-ops if at least one row already exists for the tag.
// Double-invocation is safe: createMany with skipDuplicates is idempotent.
export async function ensureTagRatingsSeeded(tagId: string, tagSlug: string): Promise<void> {
  const count = await prisma.userTagRating.count({ where: { tagId } })
  if (count > 0) return

  const [eloMap, glickoMap] = await Promise.all([
    replayEloHistory(tagSlug),
    replayGlicko2History(tagSlug),
  ])

  const userIds = new Set([...eloMap.keys(), ...glickoMap.keys()])
  if (userIds.size === 0) return

  const now = new Date()
  await prisma.userTagRating.createMany({
    data: [...userIds].map(userId => ({
      userId,
      tagId,
      elo: eloMap.get(userId) ?? 1500,
      mu: glickoMap.get(userId)?.mu ?? 1500,
      sigma: glickoMap.get(userId)?.sigma ?? 350,
      volatility: glickoMap.get(userId)?.volatility ?? 0.06,
      updatedAt: now,
    })),
    skipDuplicates: true,
  })
}

// Seed pundit per-tag ratings from full evidence-pool replay if the tag has no
// stored rows. Unlike ensureTagRatingsSeeded, there's no incremental update
// path (pundits don't commit, so there's no resolution transaction to hook
// into) — this replay-on-first-read is the only way pundit ratings get
// computed. No-ops if at least one row already exists for the tag; to force a
// recompute (e.g. after a reference-set or scoring change), delete the tag's
// rows first.
export async function ensurePunditTagRatingsSeeded(tagId: string, tagSlug: string): Promise<void> {
  const count = await prisma.punditTagRating.count({ where: { tagId } })
  if (count > 0) return

  const [eloMap, glickoMap] = await Promise.all([
    replayPunditEloHistory(tagSlug),
    replayPunditGlickoHistory(tagSlug),
  ])

  const personIds = new Set([...eloMap.keys(), ...glickoMap.keys()])
  if (personIds.size === 0) return

  const now = new Date()
  await prisma.punditTagRating.createMany({
    data: [...personIds].map(personId => ({
      personId,
      personName: glickoMap.get(personId)?.personName ?? null,
      tagId,
      elo: eloMap.get(personId) ?? 1500,
      mu: glickoMap.get(personId)?.mu ?? 1500,
      sigma: glickoMap.get(personId)?.sigma ?? 350,
      volatility: glickoMap.get(personId)?.volatility ?? 0.06,
      totalPredictions: glickoMap.get(personId)?.totalPredictions ?? 0,
      correctPredictions: glickoMap.get(personId)?.correctPredictions ?? 0,
      updatedAt: now,
    })),
    skipDuplicates: true,
  })
}

interface CommitmentResult {
  userId: string
  brierScore: number
}

// Update per-tag ELO and Glicko-2 ratings inside an existing transaction.
// Called at resolution for each non-void prediction.
// Uses per-tag ratings as the baseline (not global), so per-tag ELO evolves
// independently from global ELO. Falls back to 1500/350/0.06 for new users.
export async function updateTagRatingsInTx(
  tx: Prisma.TransactionClient,
  tags: { id: string }[],
  commitments: CommitmentResult[],
): Promise<void> {
  if (tags.length === 0 || commitments.length === 0) return

  const userIds = commitments.map(c => c.userId)
  const tagIds = tags.map(t => t.id)

  // Load all existing per-tag rows in one batch
  const existing = await tx.userTagRating.findMany({
    where: { userId: { in: userIds }, tagId: { in: tagIds } },
    select: { userId: true, tagId: true, elo: true, mu: true, sigma: true, volatility: true },
  })

  const byKey = new Map(existing.map(r => [`${r.userId}:${r.tagId}`, r]))
  const getRow = (userId: string, tagId: string) =>
    byKey.get(`${userId}:${tagId}`) ?? { elo: 1500, mu: 1500, sigma: 350, volatility: 0.06 }

  const now = new Date()

  for (const tag of tags) {
    // ELO: pairwise using per-tag ratings; requires ≥2 committers
    const eloDeltas =
      commitments.length >= 2
        ? calculateEloUpdates(
            commitments.map(c => ({
              userId: c.userId,
              brierScore: c.brierScore,
              eloRating: getRow(c.userId, tag.id).elo,
            })),
          )
        : new Map<string, number>()

    for (const c of commitments) {
      const current = getRow(c.userId, tag.id)
      const eloDelta = eloDeltas.get(c.userId) ?? 0
      const glicko = glicko2Update(current.mu, current.sigma, current.volatility, 1 - c.brierScore)

      await tx.userTagRating.upsert({
        where: { userId_tagId: { userId: c.userId, tagId: tag.id } },
        create: {
          userId: c.userId,
          tagId: tag.id,
          elo: 1500 + eloDelta,
          mu: glicko.mu,
          sigma: glicko.phi,
          volatility: glicko.volatility,
          updatedAt: now,
        },
        update: {
          elo: current.elo + eloDelta,
          mu: glicko.mu,
          sigma: glicko.phi,
          volatility: glicko.volatility,
          updatedAt: now,
        },
      })
    }
  }
}
