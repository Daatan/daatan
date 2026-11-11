import type { Snapshot } from '@/components/forecasts/ContextTimeline'

type OracleSnapshot = NonNullable<Snapshot['oracleSnapshot']>

/**
 * The part of a persisted `oracleSnapshot` the client reads (daatan#1871, daatan#2152).
 *
 * As persisted it carries every source's per-claim shadow layer (`claimsDetail`, `eventActors`,
 * `antecedentText`, model/prompt provenance, …) — on the Knesset Speaker forecast that was
 * 7 MB across 24 heavy timeline rows. The client reads `mean/std/ciLow/ciHigh/articlesUsed/settled`
 * from every snapshot and `sources[]` only from the latest one (`settlingSourceNames`, the badge),
 * so older snapshots drop `sources` entirely. Server-side readers (`settledAlertFacts`,
 * `forecast-sources`) query the DB directly and never see this projection.
 */
function slimOracleSnapshot(o: OracleSnapshot, keepSources: boolean): OracleSnapshot {
  return {
    mean: o.mean,
    std: o.std,
    ciLow: o.ciLow,
    ciHigh: o.ciHigh,
    articlesUsed: o.articlesUsed,
    ...(o.settled !== undefined ? { settled: o.settled } : {}),
    sources: keepSources
      ? (o.sources ?? []).map((s) => ({
          sourceId: s.sourceId,
          sourceName: s.sourceName,
          url: s.url,
          stance: s.stance,
          certainty: s.certainty,
          credibilityWeight: s.credibilityWeight,
          claims: s.claims,
          ...(s.settled !== undefined ? { settled: s.settled } : {}),
        }))
      : [],
  }
}

/**
 * Project server-fetched context snapshots (newest first) down to what `ContextTimeline` /
 * `ForecastDetailClient` actually read before they cross the server→client boundary.
 */
export function slimContextSnapshots(snapshots: Snapshot[]): Snapshot[] {
  return snapshots.map((snap, i) => {
    const o = snap.oracleSnapshot
    if (!o) return snap
    return { ...snap, oracleSnapshot: slimOracleSnapshot(o, i === 0) }
  })
}

/**
 * The same projection for raw `ContextSnapshot` rows (newest first) returned by
 * `GET`/`POST /api/forecasts/[id]/context` (daatan#2152). Scalar columns pass through
 * unchanged; `sourcesSummary` (a per-source mirror no client reads) is dropped.
 */
export function slimTimelineRows<T extends { oracleSnapshot: unknown; sourcesSummary?: unknown }>(
  rows: T[],
): Array<Omit<T, 'oracleSnapshot' | 'sourcesSummary'> & { oracleSnapshot: OracleSnapshot | null }> {
  return rows.map((row, i) => {
    const { oracleSnapshot, sourcesSummary: _sourcesSummary, ...rest } = row
    return {
      ...rest,
      oracleSnapshot: oracleSnapshot ? slimOracleSnapshot(oracleSnapshot as OracleSnapshot, i === 0) : null,
    }
  })
}
