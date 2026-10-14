import type { Snapshot } from '@/components/forecasts/ContextTimeline'

/**
 * Project server-fetched context snapshots down to what `ContextTimeline` /
 * `ForecastDetailClient` actually read before they cross the server→client boundary (daatan#1871).
 *
 * `oracleSnapshot` as persisted carries every source's per-claim shadow layer (`claimsDetail`,
 * `eventActors`, `antecedentText`, …) — on a busy forecast that was ~1.4 MB of inline RSC
 * payload. The client reads `mean/std/ciLow/ciHigh/articlesUsed/settled` from every snapshot and
 * `sources[]` only from the latest one (`settlingSourceNames`, the badge), so older snapshots
 * drop `sources` entirely. The client-side fetch (`/api/forecasts/[id]/context`) is unchanged.
 */
export function slimContextSnapshots(snapshots: Snapshot[]): Snapshot[] {
  return snapshots.map((snap, i) => {
    const o = snap.oracleSnapshot
    if (!o) return snap
    return {
      ...snap,
      oracleSnapshot: {
        mean: o.mean,
        std: o.std,
        ciLow: o.ciLow,
        ciHigh: o.ciHigh,
        articlesUsed: o.articlesUsed,
        ...(o.settled !== undefined ? { settled: o.settled } : {}),
        sources:
          i === 0
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
      },
    }
  })
}
