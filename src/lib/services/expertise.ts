import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// Glicko-2 algorithm constants
const SCALE = 173.7178   // converts Glicko-1 ↔ Glicko-2 scale
const TAU = 0.5          // system volatility constant (controls how quickly ratings change)
const EPSILON = 1e-6     // Illinois algorithm convergence tolerance

// Reference opponent representing the social consensus / random baseline
const REF_MU_G2 = 0         // (1500 - 1500) / SCALE
const REF_PHI_G2 = 350 / SCALE  // ≈ 2.0145

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))
}

function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)))
}

/**
 * Compute one Glicko-2 rating update for a single game outcome.
 *
 * All inputs/outputs are in Glicko-1 scale (mu ≈ 1500, phi ≈ 350).
 * score is a continuous outcome in [0, 1]: 1 = perfect, 0 = worst.
 */
export function glicko2Update(
  mu: number,
  phi: number,
  volatility: number,
  score: number,
): { mu: number; phi: number; volatility: number } {
  const muG2 = (mu - 1500) / SCALE
  const phiG2 = phi / SCALE

  const gRef = g(REF_PHI_G2)
  const eRef = E(muG2, REF_MU_G2, REF_PHI_G2)

  // Estimated variance of outcome
  const v = 1 / (gRef * gRef * eRef * (1 - eRef))

  // Improvement over expected
  const delta = v * gRef * (score - eRef)

  // New volatility via Illinois algorithm
  const a = Math.log(volatility * volatility)
  const f = (x: number) => {
    const ex = Math.exp(x)
    const d2 = phiG2 * phiG2 + v + ex
    return (ex * (delta * delta - phiG2 * phiG2 - v - ex)) / (2 * d2 * d2) - (x - a) / (TAU * TAU)
  }

  let A = a
  let B: number
  if (delta * delta > phiG2 * phiG2 + v) {
    B = Math.log(delta * delta - phiG2 * phiG2 - v)
  } else {
    let k = 1
    while (f(a - k * TAU) < 0) k++
    B = a - k * TAU
  }

  let fA = f(A)
  let fB = f(B)
  for (let i = 0; i < 100 && Math.abs(B - A) > EPSILON; i++) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA /= 2
    }
    B = C
    fB = fC
  }

  const newVolatility = Math.exp(A / 2)
  const phiStar = Math.sqrt(phiG2 * phiG2 + newVolatility * newVolatility)
  const newPhiG2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const newMuG2 = muG2 + newPhiG2 * newPhiG2 * gRef * (score - eRef)

  return {
    mu: newMuG2 * SCALE + 1500,
    phi: newPhiG2 * SCALE,
    volatility: newVolatility,
  }
}

/**
 * Replay full Glicko-2 history from stored brierScore values, optionally filtered
 * to a single tag slug. Analogous to replayEloHistory in elo.ts.
 *
 * All participants start at defaults (mu=1500, sigma=350, volatility=0.06).
 * Commitments are processed in resolvedAt order so earlier matches influence later ones.
 *
 * Returns a map of userId → { mu, sigma } (Glicko-1 scale).
 */
export async function replayGlicko2History(tagSlug?: string): Promise<Map<string, { mu: number; sigma: number; volatility: number; count: number }>> {
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
      prediction: { select: { resolvedAt: true } },
    },
    orderBy: { prediction: { resolvedAt: 'asc' } },
  })

  const ratings = new Map<string, { mu: number; sigma: number; volatility: number }>()
  const counts = new Map<string, number>()

  // userId is never actually null here (filtered in the query above) — the `!`
  // just satisfies the schema's now-nullable Commitment.userId type.
  for (const row of rows) {
    const userId = row.userId!
    const prev = ratings.get(userId) ?? { mu: 1500, sigma: 350, volatility: 0.06 }
    const updated = glicko2Update(prev.mu, prev.sigma, prev.volatility, 1 - row.brierScore!)
    ratings.set(userId, { mu: updated.mu, sigma: updated.phi, volatility: updated.volatility })
    counts.set(userId, (counts.get(userId) ?? 0) + 1)
  }

  return new Map([...ratings].map(([id, r]) => [id, { mu: r.mu, sigma: r.sigma, volatility: r.volatility, count: counts.get(id) ?? 0 }]))
}

export interface GlickoDataPoint {
  date: string   // ISO date of resolution
  mu: number
  sigma: number
}

/**
 * Replay Glicko-2 history for a single user and return the time series of
 * (mu, sigma) after each resolved prediction. Optionally filtered by tag.
 * Returns an empty array if the user has no resolved predictions.
 */
export async function getGlickoHistory(
  userId: string,
  tagSlug?: string,
): Promise<GlickoDataPoint[]> {
  const rows = await prisma.commitment.findMany({
    where: {
      userId,
      brierScore: { not: null },
      prediction: {
        status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
        resolvedAt: { not: null },
        ...(tagSlug ? { tags: { some: { slug: tagSlug } } } : {}),
      },
    },
    select: {
      brierScore: true,
      prediction: { select: { resolvedAt: true } },
    },
    orderBy: { prediction: { resolvedAt: 'asc' } },
  })

  const points: GlickoDataPoint[] = []
  let mu = 1500, sigma = 350, volatility = 0.06

  for (const row of rows) {
    const updated = glicko2Update(mu, sigma, volatility, 1 - row.brierScore!)
    mu = updated.mu
    sigma = updated.phi
    volatility = updated.volatility
    points.push({
      date: row.prediction.resolvedAt!.toISOString().slice(0, 10),
      mu: Math.round(mu),
      sigma: Math.round(sigma),
    })
  }

  return points
}

interface GlickoUserData {
  mu: number
  sigma: number      // this is the RD (phi) in Glicko-1 scale
  volatility: number
  totalPredictions: number
  correctPredictions: number
}

/**
 * Apply a Glicko-2 update inside an existing Prisma transaction.
 * brierScore = (p − outcome)² in [0, 1]; isCorrect = outcome was correct.
 */
export function applyGlicko2Update(
  tx: Prisma.TransactionClient,
  userId: string,
  user: GlickoUserData,
  brierScore: number,
  isCorrect: boolean,
) {
  const score = 1 - brierScore  // map brier → glicko outcome: 0=worst, 1=perfect
  const updated = glicko2Update(user.mu, user.sigma, user.volatility, score)

  return tx.user.update({
    where: { id: userId },
    data: {
      mu: updated.mu,
      sigma: updated.phi,
      volatility: updated.volatility,
      totalPredictions: { increment: 1 },
      ...(isCorrect && { correctPredictions: { increment: 1 } }),
    },
  })
}
