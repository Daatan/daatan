import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('calibration')

/**
 * Freeze one resolved binary's published probabilities as a calibration record
 * (daatan#1233).
 *
 * Why a stored row rather than a query: every number here is *overwritten* as
 * the forecast lives. The glide requotes daily, so "what did we say 7 days
 * before this resolved" is only answerable while the snapshot history still
 * exists and only by a lateral join nobody re-runs. The consequence was that
 * system calibration had been measured exactly once (2026-08-01: Brier 0.298
 * over 17 scorable pairs — worse than always answering 50%).
 *
 * What is deliberately NOT stored: Brier, log score, calibration bins. All of
 * them follow from `pFinal` + `outcome`, and a derived column that can disagree
 * with its inputs is the defect this codebase keeps finding elsewhere.
 */

const HORIZON_DAYS = { p7d: 7, p30d: 30 } as const

type SnapshotRow = {
  externalProbability: number | null
  createdAt: Date
  kind: string
  origin: string | null
  oracleSnapshot: Prisma.JsonValue
}

/** The Oracul's interval and pin state, if this snapshot carried one.
 *
 * `oracleSnapshot.mean/ciLow/ciHigh` are probability PERCENT (0–100), not the
 * Oracul's raw [-1,1] stance — the conversion happens before storage. Reading
 * them as stance is a mistake this repo has made before. */
function oracleFields(snapshot: Prisma.JsonValue) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const o = snapshot as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    ciLow: num(o.ciLow),
    ciHigh: num(o.ciHigh),
    settledAtFinal: typeof o.settled === 'boolean' ? o.settled : null,
  }
}

/**
 * The last snapshot at or before `at` that published a probability.
 *
 * Clock rows are INCLUDED on purpose. The glide's requote is what the page
 * actually displayed, and scoring the system means scoring what it said, not
 * what its last piece of evidence said. `pFinalKind`/`pFinalOrigin` are stored
 * precisely so a later fit can separate the two.
 */
function lastPublishedAtOrBefore(snapshots: SnapshotRow[], at: Date): SnapshotRow | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i]
    if (s.createdAt <= at && s.externalProbability !== null) return s
  }
  return null
}

export interface CalibrationInputs {
  predictionId: string
  outcome: 'correct' | 'wrong'
  resolvedAt: Date
  snapshots: SnapshotRow[]
}

/** Pure: the record's shape, given a forecast's snapshot history. Exported for
 * tests and for the backfill, which builds the same row from history rather
 * than duplicating the selection rules. */
export function buildCalibrationRecord(input: CalibrationInputs) {
  const { snapshots, resolvedAt } = input
  const ordered = [...snapshots].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const final = lastPublishedAtOrBefore(ordered, resolvedAt)
  const horizons = Object.fromEntries(
    Object.entries(HORIZON_DAYS).map(([key, days]) => {
      const at = new Date(resolvedAt.getTime() - days * 24 * 60 * 60 * 1000)
      return [key, lastPublishedAtOrBefore(ordered, at)]
    }),
  ) as Record<keyof typeof HORIZON_DAYS, SnapshotRow | null>

  return {
    predictionId: input.predictionId,
    outcome: input.outcome,
    resolvedAt,
    pFinal: final?.externalProbability ?? null,
    pFinalAt: final?.createdAt ?? null,
    pFinalKind: final?.kind ?? null,
    pFinalOrigin: final?.origin ?? null,
    ...oracleFields(final?.oracleSnapshot ?? null),
    p7d: horizons.p7d?.externalProbability ?? null,
    p7dAt: horizons.p7d?.createdAt ?? null,
    p30d: horizons.p30d?.externalProbability ?? null,
    p30dAt: horizons.p30d?.createdAt ?? null,
    clockSnapshots: ordered.filter((s) => s.kind === 'clock').length,
    evidenceSnapshots: ordered.filter((s) => s.kind !== 'clock').length,
  }
}

/**
 * Write (or refresh) the calibration record for a resolved binary.
 *
 * Never throws: the caller runs this after the resolution transaction has
 * already committed, and a missing research row must not surface as a failed
 * resolution to the user. Failures are logged and swallowed; the backfill can
 * always reconstruct a gap from snapshot history.
 */
export async function recordCalibration(
  input: {
    predictionId: string
    outcome: 'correct' | 'wrong'
    resolvedAt: Date
    // daatan#1234 check #3: true when THIS resolution knowingly overrode a
    // contradicting settlement pin / extreme AI confidence (prediction-resolution.ts's
    // pinContradiction gate). Applied only on create, below — a later re-resolution
    // must not retroactively flip a dispute flag that already reflects history.
    disputed?: boolean
    disputeNote?: string
  },
  client: PrismaClient | typeof prisma = prisma,
): Promise<void> {
  try {
    const snapshots = await client.contextSnapshot.findMany({
      where: { predictionId: input.predictionId, insufficientData: false },
      orderBy: { createdAt: 'asc' },
      select: {
        externalProbability: true, createdAt: true, kind: true, origin: true, oracleSnapshot: true,
      },
    })
    const data = buildCalibrationRecord({ ...input, snapshots })
    await client.calibrationRecord.upsert({
      where: { predictionId: input.predictionId },
      create: { ...data, ...(input.disputed ? { disputed: true, disputeNote: input.disputeNote ?? null } : {}) },
      // Re-resolution (a corrected outcome) should update the record, not fail
      // on the unique key. `disputed`/`disputeNote` are left alone here — once
      // set at creation, only a future manual admin action should change them.
      update: data,
    })
    log.info(
      { predictionId: input.predictionId, outcome: input.outcome, pFinal: data.pFinal, kind: data.pFinalKind },
      'Calibration record written',
    )
  } catch (err) {
    log.error({ err, predictionId: input.predictionId }, 'Failed to write calibration record')
  }
}
