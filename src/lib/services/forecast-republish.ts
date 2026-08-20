import { prisma } from '@/lib/prisma'
import { countUsableEvidence } from '@/lib/services/evidence-pool'
import { resolvePooledEstimate } from '@/lib/services/pooled-estimate'
import { recordEstimate } from '@/lib/services/context'
import { stanceToPercent, stanceStdToPercent } from '@/lib/services/oracle-snapshot'
import { createLogger } from '@/lib/logger'

const log = createLogger('forecast-republish')

/**
 * The sentinel handed to resolvePooledEstimate as the "single run". This path has no
 * single run — nothing was searched, nothing was extracted — so any fallback onto it
 * would publish a fabricated number. The resolver's `estimateSource` tells us which
 * branch it took; anything but 'pool' is reported as a failure and never written.
 */
const NO_SINGLE_RUN = { mean: 0, std: 0, ciLow: 0, ciHigh: 0, settled: false, articlesUsed: 0 }

export interface RepublishForecast {
  predictionId: string
  claimText: string | null
  status: 'ok' | 'unchanged' | 'failed'
  /** Why a forecast failed: `not_found`, `not_active`, `empty_pool`, `pool_unreadable`,
   *  the pool's own insufficiency reason (e.g. `all_articles_off_topic`), or `error`. */
  reason: string | null
  poolSize: number | null
  usableSize: number | null
  /** Published probability before/after, 0–100. In dry-run `confidenceAfter` is the
   *  number an apply WOULD publish — computed, not written. */
  confidenceBefore: number | null
  confidenceAfter: number | null
}

export interface RepublishResult {
  mode: 'dry-run' | 'apply'
  ok: number
  unchanged: number
  failed: number
  forecasts: RepublishForecast[]
}

/**
 * Re-publish forecasts' estimates from the evidence pool they ALREADY have
 * (daatan#1508): aggregate the persisted pool via the same `resolvePooledEstimate`
 * the news-indexer push path trusts, then write through `recordEstimate` under the
 * `republish` origin. No search, no extractor, no LLM — one compute-only
 * `/pool/aggregate` call per forecast.
 *
 * Defaults to dry-run, which computes every would-be number and writes nothing —
 * no estimate, no snapshot, no notification. Per-forecast failures (unknown id,
 * inactive forecast, empty pool, unreadable Oracle, off-topic pool) are reported
 * in the result and never abort the batch.
 *
 * The `republish` origin's `canSettle: false` means an apply can never latch
 * `Prediction.settled` — if the pool genuinely settles, the ordinary push path
 * will pin it (see ORIGIN_POLICY in context.ts).
 */
export async function republishForecasts(predictionIds: string[], apply: boolean): Promise<RepublishResult> {
  const preds = await prisma.prediction.findMany({
    where: { id: { in: predictionIds } },
    select: {
      id: true,
      status: true,
      claimText: true,
      claimDirection: true,
      claimDeadline: true,
      createdAt: true,
      claimArchetype: true,
      confidence: true,
    },
  })
  const predById = new Map(preds.map((p) => [p.id, p]))

  const result: RepublishResult = { mode: apply ? 'apply' : 'dry-run', ok: 0, unchanged: 0, failed: 0, forecasts: [] }
  const report = (f: RepublishForecast) => {
    result[f.status === 'failed' ? 'failed' : f.status === 'unchanged' ? 'unchanged' : 'ok']++
    result.forecasts.push(f)
  }

  for (const id of predictionIds) {
    const p = predById.get(id)
    const base: RepublishForecast = {
      predictionId: id,
      claimText: p?.claimText ?? null,
      status: 'failed',
      reason: null,
      poolSize: null,
      usableSize: null,
      confidenceBefore: p?.confidence ?? null,
      confidenceAfter: null,
    }
    if (!p) {
      report({ ...base, reason: 'not_found' })
      continue
    }
    if (p.status !== 'ACTIVE') {
      // Same guard every other estimate writer applies (cf. runOracleReask): a fresh
      // AI estimate on a resolved/expired forecast would rewrite history.
      report({ ...base, reason: 'not_active' })
      continue
    }

    try {
      // Distinguish "nothing usable pooled" from "the Oracle was unreachable" up
      // front — resolvePooledEstimate collapses both into its fallback branch.
      const usable = await countUsableEvidence(p.id)
      if (usable === 0) {
        report({ ...base, reason: 'empty_pool', usableSize: 0 })
        continue
      }

      const resolved = await resolvePooledEstimate(
        p.id,
        NO_SINGLE_RUN,
        [],
        p.claimDirection ?? null,
        p.claimDeadline ?? null,
        new Map(),
        p.createdAt ?? null,
        p.claimArchetype ?? null,
        p.claimText,
      )
      base.poolSize = resolved.poolSize
      base.usableSize = resolved.usableSize

      if (resolved.estimateSource !== 'pool') {
        // 'single-run' = the pool could not be read (this path has no real single run
        // to fall back on); 'pool-insufficient' = the aggregate found no usable signal.
        // Neither writes: an operator tool re-publishes real aggregates or nothing.
        report({ ...base, reason: resolved.insufficientData ? (resolved.reason ?? 'insufficient') : 'pool_unreadable' })
        continue
      }

      const probability = stanceToPercent(resolved.mean)
      const ciLow = stanceToPercent(resolved.ciLow)
      const ciHigh = stanceToPercent(resolved.ciHigh)
      base.confidenceAfter = probability
      base.status = probability === p.confidence ? 'unchanged' : 'ok'

      if (apply) {
        await recordEstimate({
          predictionId: p.id,
          origin: 'republish',
          probability,
          ciLow,
          ciHigh,
          // Inert under the republish policy's canSettle: false — recorded on the
          // snapshot payload only, never latched onto the prediction.
          settled: resolved.settled,
          externalReasoning: 'TruthMachine Oracle (admin re-publish from pool)',
          oracleSnapshot: {
            mean: probability,
            std: stanceStdToPercent(resolved.std),
            ciLow,
            ciHigh,
            articlesUsed: resolved.articlesUsed,
            settled: resolved.settled,
            sources: resolved.snapshotSources,
          },
        })
      }
      report(base)
    } catch (err) {
      log.warn({ predictionId: p.id, err }, 'forecast-republish.failed')
      report({ ...base, status: 'failed', reason: 'error' })
    }
  }

  log.info(
    { mode: result.mode, ok: result.ok, unchanged: result.unchanged, failed: result.failed },
    'forecast-republish.done',
  )
  return result
}
