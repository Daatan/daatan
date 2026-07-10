import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import type { EnrichedOracleSource } from '@/lib/services/oracle-snapshot'
import type { EvidencePoolArticle } from '@prisma/client'

/**
 * Foundation layer for the per-forecast evidence pool (retro
 * docs/ORACLE_VARIABLES.md §6 part 2). Nothing reads this table to compute an
 * estimate yet — analyze/news-indexer/backfill only shadow-write their
 * per-source signals here, in addition to their existing writes, so real
 * data accumulates ahead of the future recompute-over-pool cutover.
 * `excluded` (see getPoolArticles/setArticleExcluded below) is settable by an
 * admin today but not yet enforced by any computation for the same reason —
 * it's ready for the cutover, not a component of it.
 */
export type PoolOrigin = 'analyze' | 'news-indexer' | 'backfill'

/**
 * Upsert one batch of extracted sources into a forecast's evidence pool, keyed
 * by (predictionId, urlHash) — same URL-normalization as NewsAnchor, so
 * http/https and trailing-slash variants of the same story collapse to one
 * row. The row IS the extraction cache: re-discovering an already-pooled
 * article updates its signal in place rather than accumulating duplicates.
 * Never touches `excluded` — an admin's exclusion decision on an article
 * survives every later re-discovery.
 */
export async function addArticlesToPool(
  predictionId: string,
  sources: EnrichedOracleSource[],
  origin: PoolOrigin,
): Promise<void> {
  await Promise.all(
    sources.map((s) =>
      prisma.evidencePoolArticle.upsert({
        where: { predictionId_urlHash: { predictionId, urlHash: hashUrl(s.url) } },
        create: {
          predictionId,
          url: s.url,
          urlHash: hashUrl(s.url),
          title: s.title,
          source: s.sourceName,
          publishedDate: s.publishedAt,
          stance: s.stance,
          certainty: s.certainty,
          credibilityWeight: s.credibilityWeight,
          claims: s.claims,
          settled: s.settled,
          quantitativeEstimate: s.quantitativeEstimate,
          evidenceWeight: s.evidenceWeight,
          relevanceScore: s.relevanceScore,
          origin,
        },
        update: {
          url: s.url,
          title: s.title,
          source: s.sourceName,
          publishedDate: s.publishedAt,
          stance: s.stance,
          certainty: s.certainty,
          credibilityWeight: s.credibilityWeight,
          claims: s.claims,
          settled: s.settled,
          quantitativeEstimate: s.quantitativeEstimate,
          evidenceWeight: s.evidenceWeight,
          relevanceScore: s.relevanceScore,
          origin,
        },
      }),
    ),
  )
}

/** List a forecast's pooled articles, most recently added first. Admin visibility only. */
export async function getPoolArticles(predictionId: string): Promise<EvidencePoolArticle[]> {
  return prisma.evidencePoolArticle.findMany({
    where: { predictionId },
    orderBy: { addedAt: 'desc' },
  })
}

/**
 * Admin override: exclude (or re-include) one pooled article. Scoped by
 * predictionId so an admin on one forecast's page can't touch another
 * forecast's row via a guessed articleId. Returns null on no match (caller
 * maps to 404) rather than throwing, matching addArticlesToPool's own
 * error-shape convention of staying silent on ordinary not-found paths.
 */
export async function setArticleExcluded(
  predictionId: string,
  articleId: string,
  excluded: boolean,
): Promise<EvidencePoolArticle | null> {
  const existing = await prisma.evidencePoolArticle.findFirst({
    where: { id: articleId, predictionId },
  })
  if (!existing) return null
  return prisma.evidencePoolArticle.update({
    where: { id: articleId },
    data: { excluded },
  })
}
