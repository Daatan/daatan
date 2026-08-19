import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_MAX_ARTICLES } from '@/lib/services/oracle'
import { USABLE_POOL_ROW_WHERE } from '@/lib/services/evidence-pool'
import { refreshOracleSnapshot, type SuppliedArticle } from '@/lib/services/oracle-backfill'
import { createLogger } from '@/lib/logger'

const log = createLogger('pool-remediate')

/**
 * The over-extraction signature A6 remediates: a row the pool already counts as
 * usable, asserting a near-maximal stance at near-maximal certainty. Those are the
 * readings the retro#549 fact/stance sign-error guard and the extractor prompt fix
 * changed the most, and the only ones whose repair moves a published estimate.
 */
export const REMEDIATE_MIN_ABS_STANCE = 0.7
export const REMEDIATE_MIN_CERTAINTY = 0.7

/**
 * Google's search-redirect wrapper: there is no article behind the URL, so a
 * re-extraction sees exactly the text it saw last time and can only return noise
 * (the same reason `t.me` rows were argued about — but those DO carry their whole
 * content in the snippet, so they were kept in scope; these carry none).
 */
const NON_ARTICLE_URL_FRAGMENT = 'google.com/goto'

/** The A6 target set, as a Prisma filter. Current-version, usable, strong-and-certain. */
export function remediableWhere(): Prisma.EvidencePoolArticleWhereInput {
  return {
    ...USABLE_POOL_ROW_WHERE,
    title: { not: null },
    certainty: { gte: REMEDIATE_MIN_CERTAINTY },
    OR: [{ stance: { gte: REMEDIATE_MIN_ABS_STANCE } }, { stance: { lte: -REMEDIATE_MIN_ABS_STANCE } }],
    NOT: { url: { contains: NON_ARTICLE_URL_FRAGMENT } },
  }
}

export interface RemediationForecast {
  predictionId: string
  claimText: string
  /** Rows matching {@link remediableWhere} — what this run re-extracts. */
  targetRows: number
  /** Oracle calls: one per DEFAULT_MAX_ARTICLES-row batch. */
  batches: number
  /** Usable pool size before/after — the gauge for rows the gatekeeper drops on re-extraction. */
  poolBefore: number
  poolAfter: number | null
  /** Published probability before/after, 0–100. The number the preview predicted. */
  confidenceBefore: number | null
  confidenceAfter: number | null
  ok: number
  /** Batches the claim gate refused. Non-zero means a contentHash null did not take —
   *  the mechanism failed, not the extraction. */
  unchanged: number
  noOracle: number
  insufficient: number
  failed: number
}

export interface RemediationResult {
  mode: 'dry-run' | 'apply'
  forecasts: RemediationForecast[]
}

/**
 * Re-extract a forecast's strongest evidence rows against the current extractor, and
 * let the whole-pool aggregate re-publish the estimate — the backward half of the
 * estimation-quality plan's Track A (daatan#1493), after the forward fixes landed in
 * retro#549 and #553.
 *
 * Nulling `contentHash` first is the load-bearing step, not a convenience: with the
 * stored hash in place `claimArticleForExtraction` takes its same-content arm and
 * re-claims the row IN PLACE, overwriting the reading being remediated. With it null
 * the row goes down the supersede-and-insert arm instead, so every prior reading
 * survives as a superseded version and the whole run is reversible (drop the new
 * head, clear `supersededAt` on its `supersedesId` parent — in that order).
 *
 * Defaults to dry-run. Nothing here searches: the roster is the forecast's own pool,
 * so the comparison against the read-only preview is like-for-like.
 */
export async function remediatePool(predictionIds: string[], apply: boolean): Promise<RemediationResult> {
  const target = remediableWhere()
  const preds = await prisma.prediction.findMany({
    where: { id: { in: predictionIds } },
    select: {
      id: true,
      claimText: true,
      claimDirection: true,
      claimDeadline: true,
      createdAt: true,
      claimArchetype: true,
      resolutionRules: true,
      confidence: true,
    },
  })

  const forecasts: RemediationForecast[] = []
  for (const p of preds) {
    const rows = await prisma.evidencePoolArticle.findMany({
      where: { ...target, predictionId: p.id },
      orderBy: { addedAt: 'asc' },
      select: { id: true, url: true, title: true, snippet: true, source: true, publishedDate: true },
    })
    const f: RemediationForecast = {
      predictionId: p.id,
      claimText: p.claimText,
      targetRows: rows.length,
      batches: Math.ceil(rows.length / DEFAULT_MAX_ARTICLES),
      poolBefore: await prisma.evidencePoolArticle.count({ where: { predictionId: p.id, ...USABLE_POOL_ROW_WHERE } }),
      poolAfter: null,
      confidenceBefore: p.confidence,
      confidenceAfter: null,
      ok: 0,
      unchanged: 0,
      noOracle: 0,
      insufficient: 0,
      failed: 0,
    }
    forecasts.push(f)
    if (!apply || rows.length === 0) continue

    for (let i = 0; i < rows.length; i += DEFAULT_MAX_ARTICLES) {
      const chunk = rows.slice(i, i + DEFAULT_MAX_ARTICLES)
      // Per batch rather than all up front: an aborted run then leaves the rows it
      // never reached with their hashes intact, so the next organic push of those
      // URLs still de-duplicates instead of versioning on unchanged content.
      await prisma.evidencePoolArticle.updateMany({
        where: { id: { in: chunk.map((r) => r.id) } },
        data: { contentHash: null },
      })
      const articles: SuppliedArticle[] = chunk.flatMap((r) =>
        r.title
          ? [{ url: r.url, title: r.title, snippet: r.snippet ?? '', source: r.source ?? undefined, publishedDate: r.publishedDate ?? undefined }]
          : [],
      )
      try {
        const r = await refreshOracleSnapshot(p, { articles, origin: 'remediate', reask: true })
        if (r.status === 'ok') f.ok++
        else if (r.status === 'unchanged') f.unchanged++
        else if (r.status === 'insufficient') f.insufficient++
        else f.noOracle++
      } catch (err) {
        f.failed++
        log.warn({ predictionId: p.id, batch: i / DEFAULT_MAX_ARTICLES, err }, 'pool-remediate.batch_failed')
      }
    }

    f.poolAfter = await prisma.evidencePoolArticle.count({ where: { predictionId: p.id, ...USABLE_POOL_ROW_WHERE } })
    f.confidenceAfter =
      (await prisma.prediction.findUnique({ where: { id: p.id }, select: { confidence: true } }))?.confidence ?? null
  }

  log.info({ mode: apply ? 'apply' : 'dry-run', forecasts }, 'pool-remediate.done')
  return { mode: apply ? 'apply' : 'dry-run', forecasts }
}
