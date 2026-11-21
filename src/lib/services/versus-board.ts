import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { stakeProbability } from '@/lib/forecast-math'
import { getExpertResolutions } from '@/lib/services/oracle'
import { MARKET_MEMBER, SENTINEL_MODE } from '@/lib/services/ai-panel-score'
import { ORACUL_SOURCE } from '@/lib/services/ai-source'

// People vs AI vs experts (#2266): each group as ONE forecaster per resolved binary forecast,
// compared only on forecasts both (or all) of them called, so nobody wins by facing easier ones.

export type VersusGroup = 'people' | 'oracul' | 'experts' | 'market'

/** Fixed display and pairing order. */
export const VERSUS_GROUPS: VersusGroup[] = ['people', 'oracul', 'experts', 'market']

/** Fewer shared forecasts than this and the strip is too noisy to rank. */
export const STRIP_MIN = 20
/** A pair needs this many shared forecasts to be shown. */
export const PAIR_MIN = 5
/** The market joins only once it covers this many resolved forecasts (Mark, 2026-11-20). */
export const MARKET_MIN = 10

/** Two Briers closer than this are a tie, so float noise never decides a pair. */
const TIE_EPS = 1e-9

/** One resolved forecast, each group's probability of YES on 0–1, or null when it had none. */
export interface VersusForecast {
  id: string
  outcome: 0 | 1
  people: number | null
  oracul: number | null
  market: number | null
}

export interface VersusStripRow {
  group: VersusGroup
  brier: number
}

export interface VersusPair {
  a: VersusGroup
  b: VersusGroup
  n: number
  aCloser: number
  bCloser: number
  ties: number
  aBrier: number
  bBrier: number
}

export interface VersusBoard {
  /** Mean Brier over the forecasts every listed group called, best first. Null below
   *  STRIP_MIN shared forecasts or with fewer than three groups (two is just a pair). */
  strip: { n: number; rows: VersusStripRow[] } | null
  pairs: VersusPair[]
  /** Resolved forecasts each group has a probability on. */
  coverage: Record<VersusGroup, number>
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const brier = (p: number, o: number) => (p - o) ** 2

/**
 * The market's probability recovered from its stored matched-time Brier. Exact for a binary
 * outcome: √Brier is the distance from the outcome. computeMarketScore applied the forecast's
 * polarity before scoring, so the result is already P(the forecast's YES).
 */
export function marketProbability(storedBrier: number, outcome: 0 | 1): number {
  const distance = Math.sqrt(storedBrier)
  return outcome === 1 ? 1 - distance : distance
}

/** Pure: per-forecast probabilities in, strip and head-to-head pairs out. */
export function buildVersusBoard(forecasts: VersusForecast[], experts: Map<string, number> | null): VersusBoard {
  const rows = forecasts.map((f) => ({
    outcome: f.outcome,
    p: { people: f.people, oracul: f.oracul, experts: experts?.get(f.id) ?? null, market: f.market } as Record<
      VersusGroup,
      number | null
    >,
  }))

  const coverage = Object.fromEntries(
    VERSUS_GROUPS.map((g) => [g, rows.filter((r) => r.p[g] != null).length]),
  ) as Record<VersusGroup, number>

  const shown = VERSUS_GROUPS.filter((g) => coverage[g] > 0 && (g !== 'market' || coverage.market >= MARKET_MIN))

  const common = (groups: VersusGroup[]) => rows.filter((r) => groups.every((g) => r.p[g] != null))
  const stripOver = (groups: VersusGroup[]) => {
    const set = common(groups)
    if (groups.length < 3 || set.length < STRIP_MIN) return null
    return {
      n: set.length,
      rows: groups
        .map((group) => ({ group, brier: mean(set.map((r) => brier(r.p[group] as number, r.outcome))) as number }))
        .sort((x, y) => x.brier - y.brier),
    }
  }
  // The market joins the strip only if the common set stays large enough with it; otherwise
  // the strip stays without it and the market shows in the pairs alone.
  const strip = stripOver(shown) ?? stripOver(shown.filter((g) => g !== 'market'))

  const pairs: VersusPair[] = []
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i]
      const b = shown[j]
      const set = common([a, b])
      if (set.length < PAIR_MIN) continue
      let aCloser = 0
      let bCloser = 0
      for (const r of set) {
        const d = brier(r.p[a] as number, r.outcome) - brier(r.p[b] as number, r.outcome)
        if (d < -TIE_EPS) aCloser++
        else if (d > TIE_EPS) bCloser++
      }
      pairs.push({
        a,
        b,
        n: set.length,
        aCloser,
        bCloser,
        ties: set.length - aCloser - bCloser,
        aBrier: mean(set.map((r) => brier(r.p[a] as number, r.outcome))) as number,
        bBrier: mean(set.map((r) => brier(r.p[b] as number, r.outcome))) as number,
      })
    }
  }

  return { strip, pairs, coverage }
}

/**
 * Resolved public binary forecasts (retro simulations excluded), each group's mean
 * probability per forecast over the non-bot scored commitments: People = the stakes,
 * Oracul = its own estimate at those stakes (stakes graded against an LLM fallback or a
 * claim-only guess are left out, daatan#2271), Market = the linked market's price at them.
 */
export async function getVersusForecasts(): Promise<VersusForecast[]> {
  const scored = { brierScore: { not: null }, user: { isBot: false } }
  const predictions = await prisma.prediction.findMany({
    where: {
      status: { in: ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] },
      isPublic: true,
      outcomeType: 'BINARY',
      retroSimulation: { is: null },
    },
    select: {
      id: true,
      status: true,
      commitments: {
        where: scored,
        select: { cuCommitted: true, aiProbabilityAtCommit: true, aiSourceAtCommit: true },
      },
      aiMemberScores: {
        where: { model: MARKET_MEMBER, mode: SENTINEL_MODE, commitment: scored },
        select: { brierScore: true },
      },
    },
  })
  return predictions.map((p) => {
    const outcome = p.status === 'RESOLVED_CORRECT' ? 1 : 0
    return {
      id: p.id,
      outcome,
      people: mean(p.commitments.map((c) => stakeProbability(c.cuCommitted))),
      oracul: mean(
        p.commitments.flatMap((c) =>
          c.aiProbabilityAtCommit == null || c.aiSourceAtCommit !== ORACUL_SOURCE ? [] : [c.aiProbabilityAtCommit],
        ),
      ),
      market: mean(p.aiMemberScores.map((s) => marketProbability(s.brierScore, outcome))),
    }
  })
}

// Same 5-minute TTL and tag as the other boards: rankings only move on resolution events.
const getCachedVersusForecasts = unstable_cache(getVersusForecasts, ['leaderboard-versus-forecasts'], {
  revalidate: 300,
  tags: ['leaderboard'],
})

// Throwing keeps an Oracul failure out of the cache, so the next render retries it.
const getCachedExpertProbabilities = unstable_cache(
  async (): Promise<[string, number][]> => {
    const res = await getExpertResolutions()
    if (!res) throw new Error('experts unavailable')
    return res.resolutions.map((r) => [r.prediction_id, r.experts_prob])
  },
  ['leaderboard-versus-experts'],
  { revalidate: 300, tags: ['leaderboard'] },
)

/** The board as rendered. Without the Oracul it still shows the people/Oracul/market pairs. */
export async function getVersusBoard(): Promise<VersusBoard> {
  const [forecasts, experts] = await Promise.all([
    getCachedVersusForecasts(),
    getCachedExpertProbabilities().catch(() => null),
  ])
  return buildVersusBoard(forecasts, experts && new Map(experts))
}
