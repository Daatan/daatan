import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { poolArticleToEnrichedSource } from '@/lib/services/oracle-snapshot'
import { buildElectionMatrix, type ElectionMatrix, type ElectionEventInput, type ElectionSourceInput } from '@/lib/elections/matrix'

/** slugify('Israeli Elections 2026') — the tag that labels an election forecast. */
export const ELECTION_TAG_SLUG = 'israeli-elections-2026'

type OracleSnapshotShape = { mean?: number | null } | null

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
      contextSnapshots: {
        where: { kind: 'evidence', oracleSnapshot: { not: Prisma.DbNull } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { oracleSnapshot: true, externalProbability: true },
      },
    },
    orderBy: { resolveByDatetime: 'asc' },
  })

  // A cell aggregates the author's full usable pool for the event, not just the
  // articles the last Oracle run happened to cite. Stance-less rows (extraction
  // still pending) can't color a cell, so they're filtered at the query.
  const poolRows = await prisma.evidencePoolArticle.findMany({
    where: {
      predictionId: { in: predictions.map((p) => p.id) },
      status: 'COMPLETE',
      excluded: false,
      stance: { not: null },
    },
  })
  const sourcesByPrediction = new Map<string, ElectionSourceInput[]>()
  for (const row of poolRows) {
    const s = poolArticleToEnrichedSource(row, row.author)
    const input: ElectionSourceInput = {
      author: s.author,
      sourceName: s.sourceName,
      url: s.url,
      stance: s.stance,
      certainty: s.certainty,
      claims: s.claims,
      title: s.title,
      personId: s.personId,
    }
    const list = sourcesByPrediction.get(row.predictionId)
    if (list) list.push(input)
    else sourcesByPrediction.set(row.predictionId, [input])
  }

  const eventInputs: ElectionEventInput[] = predictions.map((p) => {
    const snapshot = p.contextSnapshots[0]
    const oracle = (snapshot?.oracleSnapshot as OracleSnapshotShape) ?? null
    return {
      id: p.id,
      slug: p.slug,
      claimText: p.claimText,
      resolveByISO: p.resolveByDatetime.toISOString(),
      status: p.status,
      probabilityYes: snapshot?.externalProbability ?? meanToProbability(oracle?.mean),
      sources: sourcesByPrediction.get(p.id) ?? [],
    }
  })

  return buildElectionMatrix(eventInputs)
}
