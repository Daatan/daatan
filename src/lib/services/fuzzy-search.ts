import { prisma } from '@/lib/prisma'

// pg_trgm similarity is on a 0-1 scale; 0.3 is Postgres's own default
// threshold for the `%` operator and a reasonable typo-tolerance floor.
const SIMILARITY_THRESHOLD = 0.3
const MAX_MATCHES = 50

export interface FuzzyMatches {
  predictionIds: string[]
  tagNames: string[]
}

export async function findFuzzyMatches(query: string): Promise<FuzzyMatches> {
  const [predictions, tags] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM predictions
      WHERE similarity("claimText", ${query}) > ${SIMILARITY_THRESHOLD}
      ORDER BY similarity("claimText", ${query}) DESC
      LIMIT ${MAX_MATCHES}
    `,
    prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM tags
      WHERE similarity(name, ${query}) > ${SIMILARITY_THRESHOLD}
    `,
  ])

  return {
    predictionIds: predictions.map((p) => p.id),
    tagNames: tags.map((t) => t.name),
  }
}
