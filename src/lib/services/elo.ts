import { prisma } from '@/lib/prisma'

const K = 32

interface EloInput {
  userId: string
  brierScore: number
  eloRating: number
}

/**
 * Compute pairwise ELO deltas for all users who committed to the same prediction.
 * Lower brierScore = better outcome = wins the matchup.
 * Returns a map of userId → total ELO delta from all pairings.
 */
export function calculateEloUpdates(commitments: EloInput[]): Map<string, number> {
  const deltas = new Map<string, number>()

  for (let i = 0; i < commitments.length; i++) {
    for (let j = i + 1; j < commitments.length; j++) {
      const a = commitments[i]
      const b = commitments[j]

      const expectedA = 1 / (1 + 10 ** ((b.eloRating - a.eloRating) / 400))
      const actualA =
        a.brierScore < b.brierScore ? 1 : a.brierScore > b.brierScore ? 0 : 0.5

      const delta = Math.round(K * (actualA - expectedA))

      deltas.set(a.userId, (deltas.get(a.userId) ?? 0) + delta)
      deltas.set(b.userId, (deltas.get(b.userId) ?? 0) - delta)
    }
  }

  return deltas
}

/**
 * Replay full ELO history from stored brierScore values, optionally filtered
 * to a single tag slug.
 *
 * All participants start at 1500. Predictions are processed in resolvedAt order
 * so earlier matches influence later ones (same as live incremental updates).
 *
 * Returns a map of userId → final ELO rating.
 */
export async function replayEloHistory(tagSlug?: string): Promise<Map<string, number>> {
  // Fetch every resolved commitment that has a brierScore, grouped by prediction.
  // We need predictionId + resolvedAt for chronological ordering.
  const rows = await prisma.commitment.findMany({
    where: {
      userId: { not: null },
      brierScore: { not: null },
      prediction: {
        status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
        resolvedAt: { not: null },
        ...(tagSlug ? { tags: { some: { slug: tagSlug } } } : {}),
      },
    },
    select: {
      userId: true,
      brierScore: true,
      prediction: { select: { id: true, resolvedAt: true } },
    },
    orderBy: { prediction: { resolvedAt: 'asc' } },
  })

  // Group by predictionId, preserving order. A row's userId/brierScore are
  // never actually null here (filtered in the query above) — the `!` just
  // satisfies the schema's now-nullable Commitment.userId type.
  const byPrediction = new Map<string, { userId: string; brierScore: number }[]>()
  for (const row of rows) {
    const id = row.prediction.id
    if (!byPrediction.has(id)) byPrediction.set(id, [])
    byPrediction.get(id)!.push({ userId: row.userId!, brierScore: row.brierScore! })
  }

  // Replay in chronological order — all start at 1500
  const ratings = new Map<string, number>()
  const getElo = (userId: string) => ratings.get(userId) ?? 1500

  for (const commitments of byPrediction.values()) {
    if (commitments.length < 2) continue

    const inputs: EloInput[] = commitments.map(c => ({
      userId: c.userId,
      brierScore: c.brierScore,
      eloRating: getElo(c.userId),
    }))

    const deltas = calculateEloUpdates(inputs)
    for (const [userId, delta] of deltas) {
      ratings.set(userId, getElo(userId) + delta)
    }
  }

  return ratings
}
