import { prisma } from '@/lib/prisma'
import { ensurePunditTagRatingsSeeded } from '@/lib/services/tag-ratings'

export interface PunditLeaderboardEntry {
  personId: string
  personName: string | null
  elo: number
  mu: number
  sigma: number
  glickoRank: number // mu - 3*sigma, same ranking convention as the user leaderboard
  totalPredictions: number
  correctPredictions: number
  accuracy: number | null
}

export interface PunditLeaderboard {
  entries: PunditLeaderboardEntry[]
  minResolved: number
  belowMinimum: number // tracked pundits with some data, but not enough to qualify yet
  activePredictions: number // tag predictions still unresolved — explains a thin/empty board
}

/**
 * Pundit accuracy leaderboard for a tag (e.g. israeli-elections-2026), reading
 * from PunditTagRating (lazily seeded via ensurePunditTagRatingsSeeded on first
 * call for a tag). Distinct from getLeaderboard (user-facing, Commitment-based)
 * and from getSourceLeaderboard (retro's global author-shadow board, string-keyed
 * by (author, outlet) rather than personId, not tag-scoped) — see
 * docs/DATABASE.md if reconciling the three.
 */
export async function getPunditLeaderboard(tagSlug: string, minResolved = 3): Promise<PunditLeaderboard> {
  const tag = await prisma.tag.findUnique({ where: { slug: tagSlug }, select: { id: true } })
  if (!tag) {
    return { entries: [], minResolved, belowMinimum: 0, activePredictions: 0 }
  }

  await ensurePunditTagRatingsSeeded(tag.id, tagSlug)

  const [rows, activePredictions] = await Promise.all([
    prisma.punditTagRating.findMany({ where: { tagId: tag.id } }),
    prisma.prediction.count({
      where: { tags: { some: { slug: tagSlug } }, status: { in: ['ACTIVE', 'PENDING'] } },
    }),
  ])

  const entries: PunditLeaderboardEntry[] = rows
    .filter(r => r.totalPredictions >= minResolved)
    .map(r => ({
      personId: r.personId,
      personName: r.personName,
      elo: r.elo,
      mu: r.mu,
      sigma: r.sigma,
      glickoRank: r.mu - 3 * r.sigma,
      totalPredictions: r.totalPredictions,
      correctPredictions: r.correctPredictions,
      accuracy: r.totalPredictions > 0 ? r.correctPredictions / r.totalPredictions : null,
    }))
    .sort((a, b) => b.glickoRank - a.glickoRank)

  return {
    entries,
    minResolved,
    belowMinimum: rows.length - entries.length,
    activePredictions,
  }
}
