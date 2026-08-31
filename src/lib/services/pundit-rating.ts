import { prisma } from '@/lib/prisma'
import { CURRENT_VERSION_ONLY } from '@/lib/services/evidence-pool'
import { calculateEloUpdates } from '@/lib/services/elo'
import { glicko2Update } from '@/lib/services/expertise'

const DEFAULT_ELO = 1500
const DEFAULT_MU = 1500
const DEFAULT_SIGMA = 350
const DEFAULT_VOLATILITY = 0.06

// Same mapping prediction-resolution.ts uses for a user's binary confidence
// (p = (confidence + 100) / 200): stance is already normalized to [-1, 1], the
// same scale confidence/100 would be, so the formula is identical.
export function stanceToProbability(stance: number): number {
  return (stance + 1) / 2
}

export function computePunditBrierScore(stance: number, outcomeNumeric: number): number {
  const p = stanceToProbability(stance)
  return (p - outcomeNumeric) ** 2
}

interface PunditResolution {
  personId: string
  personName: string | null
  brierScore: number
}

// One row per (predictionId, personId): a pundit's evidence-pool stance is
// averaged across every article of theirs pooled against that prediction,
// rather than taking one arbitrarily (most-recent or highest-credibility) —
// simplest defensible aggregation, consistent with how evidence generally
// contributes as a weighted signal elsewhere in this pipeline.
async function loadResolvedPunditStances(tagSlug: string): Promise<Map<string, PunditResolution[]>> {
  const rows = await prisma.evidencePoolArticle.findMany({
    where: {
      personId: { not: null },
      stance: { not: null },
      status: 'COMPLETE',
      excluded: false,
      // A superseded row is a replaced reading: averaging it in alongside its
      // replacement skews the pundit's stance toward what the OLD extraction
      // said, and with it their Brier score (daatan#1699).
      ...CURRENT_VERSION_ONLY,
      prediction: {
        outcomeType: 'BINARY',
        status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
        resolvedAt: { not: null },
        tags: { some: { slug: tagSlug } },
      },
    },
    select: {
      predictionId: true,
      personId: true,
      personName: true,
      stance: true,
      prediction: { select: { status: true, resolvedAt: true } },
    },
    orderBy: { prediction: { resolvedAt: 'asc' } },
  })

  // Group by (predictionId, personId), preserving first-seen order for the
  // outer per-prediction grouping (chronological, via the orderBy above).
  const byPrediction = new Map<string, Map<string, { personName: string | null; stances: number[] }>>()
  const outcomeByPrediction = new Map<string, number>()
  const predictionOrder: string[] = []
  for (const row of rows) {
    if (!byPrediction.has(row.predictionId)) {
      byPrediction.set(row.predictionId, new Map())
      outcomeByPrediction.set(row.predictionId, row.prediction.status === 'RESOLVED_CORRECT' ? 1 : 0)
      predictionOrder.push(row.predictionId)
    }
    const byPerson = byPrediction.get(row.predictionId)!
    const entry = byPerson.get(row.personId!) ?? { personName: row.personName, stances: [] }
    entry.stances.push(row.stance!)
    byPerson.set(row.personId!, entry)
  }

  const result = new Map<string, PunditResolution[]>()
  for (const predictionId of predictionOrder) {
    const byPerson = byPrediction.get(predictionId)!
    const outcomeNumeric = outcomeByPrediction.get(predictionId)!
    const resolutions: PunditResolution[] = [...byPerson.entries()].map(([personId, { personName, stances }]) => {
      const avgStance = stances.reduce((a, b) => a + b, 0) / stances.length
      return { personId, personName, brierScore: computePunditBrierScore(avgStance, outcomeNumeric) }
    })
    result.set(predictionId, resolutions)
  }
  return result
}

/**
 * Replay full pundit ELO history from evidence-pool stance, for predictions
 * tagged tagSlug. Mirrors replayEloHistory (elo.ts) exactly — same
 * calculateEloUpdates pairwise math, same "≥2 participants per prediction"
 * requirement — just sourced from EvidencePoolArticle.personId/stance instead
 * of Commitment.userId/brierScore.
 */
export async function replayPunditEloHistory(tagSlug: string): Promise<Map<string, number>> {
  const byPrediction = await loadResolvedPunditStances(tagSlug)

  const ratings = new Map<string, number>()
  const getElo = (personId: string) => ratings.get(personId) ?? DEFAULT_ELO

  for (const resolutions of byPrediction.values()) {
    if (resolutions.length < 2) continue

    const deltas = calculateEloUpdates(
      resolutions.map(r => ({ userId: r.personId, brierScore: r.brierScore, eloRating: getElo(r.personId) })),
    )
    for (const [personId, delta] of deltas) {
      ratings.set(personId, getElo(personId) + delta)
    }
  }

  return ratings
}

export interface PunditGlickoRating {
  mu: number
  sigma: number
  volatility: number
  personName: string | null
  totalPredictions: number
  correctPredictions: number
}

/**
 * Replay full pundit Glicko-2 history from evidence-pool stance, for
 * predictions tagged tagSlug. Mirrors replayGlicko2History (expertise.ts)
 * exactly — same glicko2Update math — sourced from EvidencePoolArticle
 * instead of Commitment.
 */
export async function replayPunditGlickoHistory(tagSlug: string): Promise<Map<string, PunditGlickoRating>> {
  const byPrediction = await loadResolvedPunditStances(tagSlug)

  const ratings = new Map<string, PunditGlickoRating>()
  for (const resolutions of byPrediction.values()) {
    for (const r of resolutions) {
      const prev = ratings.get(r.personId) ?? {
        mu: DEFAULT_MU, sigma: DEFAULT_SIGMA, volatility: DEFAULT_VOLATILITY,
        personName: r.personName, totalPredictions: 0, correctPredictions: 0,
      }
      const updated = glicko2Update(prev.mu, prev.sigma, prev.volatility, 1 - r.brierScore)
      ratings.set(r.personId, {
        mu: updated.mu,
        sigma: updated.phi,
        volatility: updated.volatility,
        personName: r.personName ?? prev.personName,
        totalPredictions: prev.totalPredictions + 1,
        correctPredictions: prev.correctPredictions + (r.brierScore < 0.25 ? 1 : 0),
      })
    }
  }

  return ratings
}
