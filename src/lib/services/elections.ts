import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { EnrichedOracleSource } from '@/lib/services/oracle-snapshot'
import { buildElectionMatrix, type ElectionMatrix, type ElectionEventInput } from '@/lib/elections/matrix'

/** slugify('Israeli Elections 2026') — the tag that labels an election forecast. */
export const ELECTION_TAG_SLUG = 'israeli-elections-2026'

type OracleSnapshotShape = { mean?: number | null; sources?: EnrichedOracleSource[] } | null

/** Aggregate Oracle mean stance in [-1,1] → probability of YES in [0,100]. */
function meanToProbability(mean: number | null | undefined): number | null {
  if (typeof mean !== 'number' || !Number.isFinite(mean)) return null
  return Math.round(((mean + 1) / 2) * 100)
}

/**
 * Load the election-2026 top-table matrix: forecasts tagged "Israeli Elections 2026"
 * as columns, the curated Israeli authors as rows, each cell drawn from the forecast's
 * latest evidence-bearing Oracle snapshot. Fully live off the app DB.
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

  const eventInputs: ElectionEventInput[] = predictions.map((p) => {
    const snapshot = p.contextSnapshots[0]
    const oracle = (snapshot?.oracleSnapshot as OracleSnapshotShape) ?? null
    const sources = (oracle?.sources ?? []).map((s) => ({
      author: s.author ?? null,
      sourceName: s.sourceName ?? null,
      url: s.url,
      stance: s.stance ?? null,
      certainty: s.certainty ?? null,
      claims: s.claims ?? [],
      title: s.title ?? null,
    }))
    return {
      id: p.id,
      slug: p.slug,
      claimText: p.claimText,
      resolveByISO: p.resolveByDatetime.toISOString(),
      status: p.status,
      probabilityYes: snapshot?.externalProbability ?? meanToProbability(oracle?.mean),
      sources,
    }
  })

  return buildElectionMatrix(eventInputs)
}
