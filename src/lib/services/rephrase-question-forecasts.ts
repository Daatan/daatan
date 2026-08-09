/**
 * One-off backfill: rewrite the question-form claims on existing forecasts into
 * the statement form the product uses everywhere else ("Will X happen?" → "X
 * happens.").
 *
 * The rewrites are a fixed, hand-authored table rather than an LLM call: these
 * are live forecasts carrying commitments, so the exact wording is a reviewed
 * decision and the run has to be reproducible. Each entry pins the claim text we
 * reviewed (`from`), and a row whose text has drifted since is left untouched and
 * reported as `mismatch` instead of being overwritten.
 *
 * Slugs are deliberately NOT regenerated. `slug` is an independent column — no
 * read path derives it from `claimText` — so leaving it alone keeps every inbound
 * URL working without needing a PredictionSlugAlias 308 hop. The slugs stay in
 * their original question form; that is invisible to users and intentional.
 *
 * Two things must move with the claim text, or they silently go stale:
 *   - the claim embedding, which backs the forecast↔article match gate;
 *   - the locale translations, which are cached against a hash of the English
 *     source (see prediction_translations.sourceHash).
 */

import { prisma } from '@/lib/prisma'
import { embedAndStoreForecast } from '@/lib/services/embedding'
import { translatePredictionToAllLocales } from '@/lib/services/translation'
import { createLogger } from '@/lib/logger'

const log = createLogger('rephrase-question-forecasts')

export type Rephrasing = { id: string; from: string; to: string }

/**
 * The reviewed rewrites. Only the grammatical mood changes — every claim keeps
 * the same subject, threshold and deadline, so nothing that resolves a forecast
 * is affected.
 *
 * Note on `cmrd8tkok000901qeyw7wc6s3`: its deadline wording ("till end of
 * summer") is vague and doesn't cleanly match its resolveByDatetime. That is a
 * separate judgement call about what resolves it, so the rewrite preserves the
 * vagueness rather than quietly sharpening it into a date.
 */
export const REPHRASINGS: Rephrasing[] = [
  {
    id: 'cmsh5oj2w00d001qp02doigmj',
    from: 'Will a federal bill explicitly preempting state AI laws be enacted by the U.S. Congress by August 31, 2026?',
    to: 'A federal bill explicitly preempting state AI laws is enacted by the U.S. Congress by August 31, 2026.',
  },
  {
    id: 'cmrd8tkok000901qeyw7wc6s3',
    from: 'Will rockets or drones be launched directly from Israel to Iran, or from Iran to Israel, till end of summer',
    to: 'Rockets or drones are launched directly from Israel to Iran, or from Iran to Israel, by the end of summer 2026.',
  },
  {
    id: 'cmsaxif6106jb01qn4gn5ktj2',
    from: 'Will the U.S. unemployment rate for August 2026 come in at 4.2% or higher?',
    to: 'The U.S. unemployment rate for August 2026 comes in at 4.2% or higher.',
  },
  {
    id: 'cmsaxmgng06kp01qn4kc2gc8e',
    from: 'Will the United States grant Ukraine a license to produce Patriot missile systems by October 31, 2026?',
    to: 'The United States grants Ukraine a license to produce Patriot missile systems by October 31, 2026.',
  },
  {
    id: 'cmltdeo5300029pc55oitzq78',
    from: "Will significant new destruction by Sudan's Rapid Support Forces (RSF) in El Fasher be reported by credible international organizations or major news outlets by December 31, 2026?",
    to: "Significant new destruction by Sudan's Rapid Support Forces (RSF) in El Fasher is reported by credible international organizations or major news outlets by December 31, 2026.",
  },
  {
    id: 'cmoua3uem000801o8epwa0uei',
    from: 'Will diplomatic relations between Israel and Turkey be officially restored to ambassadorial level by December 31, 2026?',
    to: 'Diplomatic relations between Israel and Turkey are officially restored to ambassadorial level by December 31, 2026.',
  },
  {
    id: 'cmrktr3qt00rc01qun2mpperc',
    from: 'Will the Ukrainian army take back, at least temporarily, a part of occupied Crimea by December 31, 2026?',
    to: 'The Ukrainian army takes back, at least temporarily, a part of occupied Crimea by December 31, 2026.',
  },
]

/** Per-forecast outcome. `already` and `missing` make re-runs safe no-ops. */
export type RephraseOutcome = 'rephrased' | 'already' | 'mismatch' | 'missing'

export type RephraseReport = {
  dryRun: boolean
  counts: Record<RephraseOutcome, number>
  rows: { id: string; outcome: RephraseOutcome; claimText: string }[]
}

/**
 * Apply one reviewed rewrite. Idempotent: a forecast already carrying the target
 * text reports `already` and is not rewritten, re-embedded or re-translated.
 */
export async function rephraseOne(r: Rephrasing, dryRun: boolean): Promise<RephraseOutcome> {
  const p = await prisma.prediction.findUnique({ where: { id: r.id }, select: { claimText: true } })
  if (!p) return 'missing'
  if (p.claimText === r.to) return 'already'
  if (p.claimText !== r.from) {
    log.warn({ predictionId: r.id, current: p.claimText }, 'claim drifted since review — left untouched')
    return 'mismatch'
  }
  if (dryRun) return 'rephrased'

  await prisma.prediction.update({ where: { id: r.id }, data: { claimText: r.to } })

  // Best-effort and deliberately outside the write: a failure here leaves a
  // correctly-rewritten claim with a stale embedding/translation, which the
  // existing backfills already know how to repair. Failing the rewrite instead
  // would be worse.
  await embedAndStoreForecast(r.id, r.to).catch((err) =>
    log.error({ err, predictionId: r.id }, 're-embed failed after rephrase'),
  )
  await translatePredictionToAllLocales(r.id).catch((err) =>
    log.error({ err, predictionId: r.id }, 'locale refill failed after rephrase'),
  )
  return 'rephrased'
}

/** Run the whole reviewed table. `dryRun` reports what would change, writing nothing. */
export async function rephraseQuestionForecasts(dryRun = false): Promise<RephraseReport> {
  const counts: Record<RephraseOutcome, number> = { rephrased: 0, already: 0, mismatch: 0, missing: 0 }
  const rows: RephraseReport['rows'] = []

  for (const r of REPHRASINGS) {
    const outcome = await rephraseOne(r, dryRun)
    counts[outcome]++
    rows.push({ id: r.id, outcome, claimText: r.to })
  }

  log.info({ dryRun, ...counts }, 'rephrase-question-forecasts.done')
  return { dryRun, counts, rows }
}
