import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CURRENT_VERSION_ONLY } from '@/lib/services/evidence-pool'
import { buildElectionMatrix, type ElectionMatrix, type ElectionEventInput, type ElectionSourceInput } from '@/lib/elections/matrix'

/** slugify('Israeli Elections 2026') — the tag that labels an election forecast. */
export const ELECTION_TAG_SLUG = 'israeli-elections-2026'

/** One row of `latestEvidenceByPrediction`: the newest evidence snapshot per forecast,
 *  projected down to the two numbers the matrix reads. */
type LatestEvidenceRow = { predictionId: string; externalProbability: number | null; mean: number | null }

/**
 * `oracleSnapshot.mean` is probability percent 0–100 on every stored row
 * (uniform since the 2026-07-08 normalization — see docs/DATABASE.md). The
 * clamp only guards data restored from a pre-normalization backup.
 */
export function meanToProbability(mean: number | null | undefined): number | null {
  if (typeof mean !== 'number' || !Number.isFinite(mean)) return null
  return Math.min(100, Math.max(0, Math.round(mean)))
}

/**
 * Load the election-2026 top-table matrix: forecasts tagged "Israeli Elections 2026"
 * as columns, the curated Israeli authors as rows, each cell drawn from the forecast's
 * usable evidence pool — the typed, current-state article set, identity-resolved via
 * person_id where news-indexer knows the author (Phase 2.3). `probabilityYes` still
 * comes from the latest snapshot: the pool has no aggregate. Fully live off the app DB.
 */
export async function getElectionMatrix(): Promise<ElectionMatrix> {
  const predictions = await prisma.prediction.findMany({
    where: {
      isPublic: true,
      tags: { some: { slug: ELECTION_TAG_SLUG } },
    },
    select: {
      id: true,
      slug: true,
      claimText: true,
      resolveByDatetime: true,
      status: true,
    },
    orderBy: { resolveByDatetime: 'asc' },
  })
  const latestByPrediction = await latestEvidenceByPrediction(predictions.map((p) => p.id))

  // A cell aggregates the author's full usable pool for the event, not just the
  // articles the last Oracul run happened to cite. Stance-less rows (extraction
  // still pending) can't color a cell, so they're filtered at the query.
  const poolRows = await prisma.evidencePoolArticle.findMany({
    where: {
      predictionId: { in: predictions.map((p) => p.id) },
      status: 'COMPLETE',
      excluded: false,
      stance: { not: null },
      // "Full usable pool" means the CURRENT reading of each article, not every
      // reading ever taken of it. Without this, 946 of the 1,858 rows this
      // aggregated on prod were superseded duplicates — 50.9% (daatan#1699).
      ...CURRENT_VERSION_ONLY,
    },
    // Only the fields a matrix cell reads. The full row carries the extractor's
    // claims/reasoning text, which is dead weight across ~900 rows per render.
    select: {
      predictionId: true,
      author: true,
      source: true,
      url: true,
      stance: true,
      certainty: true,
      claims: true,
      title: true,
      personId: true,
    },
  })
  const sourcesByPrediction = new Map<string, ElectionSourceInput[]>()
  for (const row of poolRows) {
    const input: ElectionSourceInput = {
      author: row.author,
      sourceName: row.source,
      url: row.url,
      stance: row.stance,
      certainty: row.certainty,
      claims: Array.isArray(row.claims) ? row.claims.filter((c): c is string => typeof c === 'string') : [],
      title: row.title,
      personId: row.personId,
    }
    const list = sourcesByPrediction.get(row.predictionId)
    if (list) list.push(input)
    else sourcesByPrediction.set(row.predictionId, [input])
  }

  const eventInputs: ElectionEventInput[] = predictions.map((p) => {
    const latest = latestByPrediction.get(p.id)
    return {
      id: p.id,
      slug: p.slug,
      claimText: p.claimText,
      resolveByISO: p.resolveByDatetime.toISOString(),
      status: p.status,
      probabilityYes: latest?.externalProbability ?? meanToProbability(latest?.mean),
      sources: sourcesByPrediction.get(p.id) ?? [],
    }
  })

  return buildElectionMatrix(eventInputs)
}

/**
 * Newest `kind='evidence'` snapshot per forecast, as two numbers. A nested Prisma
 * `contextSnapshots: { take: 1 }` emits no LIMIT (Prisma 7 fetches every matching row and
 * trims in memory), which on prod meant reading ~1,700 rows / ~315 MB of `oracle_snapshot`
 * per render to use 12 of them — the same shape that OOM'd elections (elections#186).
 * The inner DISTINCT ON picks the winning ids without touching the JSON column; the outer
 * join reads `oracle_mean`, the trigger-maintained scalar mirror of `oracle_snapshot.mean`
 * (migration 20260905000000), so the JSON column is never detoasted here at all.
 */
async function latestEvidenceByPrediction(ids: string[]): Promise<Map<string, LatestEvidenceRow>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.$queryRaw<LatestEvidenceRow[]>`
    SELECT s."predictionId",
           s.external_probability AS "externalProbability",
           s.oracle_mean AS mean
    FROM (
      SELECT DISTINCT ON ("predictionId") id
      FROM context_snapshots
      WHERE "predictionId" IN (${Prisma.join(ids)})
        AND kind = 'evidence'
        AND oracle_snapshot IS NOT NULL
      ORDER BY "predictionId", "createdAt" DESC
    ) latest
    JOIN context_snapshots s ON s.id = latest.id`
  return new Map(rows.map((r) => [r.predictionId, r]))
}
