/**
 * Time-axis zoom for the expanded "Probability over time" chart (daatan#2300).
 *
 * A port of elections' `src/lib/elections/combined-chart.ts` zoom section (the
 * `CombinedSourcesChart` presets + drag-brush): same names, same semantics, so the two
 * charts zoom the same way. Ported, not imported, because the repos share no package — the
 * elections helpers are typed against its own `CombinedPoint`/`CombinedSeries`. Change both
 * together.
 */

const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

/** Below this the axis labels collide and a stray click-drag reads as a zoom to nothing. */
export const MIN_ZOOM_MS = 6 * HOUR_MS

/** Preset windows offered above the chart, longest last. Only those shorter than the data's
 *  own span are worth showing — a "30 days" button on 8 days of evidence is a no-op. */
export const ZOOM_PRESET_DAYS = [7, 30] as const

/**
 * The domain a brush selection between `a` and `b` should zoom to: ordered, clamped to the
 * data's full span, and rejected (null) when it is too narrow to be a deliberate selection —
 * which is also what makes a plain click on the plot fall through to "no zoom".
 */
export function zoomTo(full: [number, number], a: number, b: number): [number, number] | null {
  const [fMin, fMax] = full
  const lo = Math.max(fMin, Math.min(a, b))
  const hi = Math.min(fMax, Math.max(a, b))
  if (hi - lo < MIN_ZOOM_MS) return null
  return [lo, hi]
}

/** The last `days` of the data's span, anchored to the data's own right edge, not to now: a
 *  forecast the Oracul has gone quiet on would otherwise open on an empty window. */
export function presetDomain(full: [number, number], days: number): [number, number] {
  const [fMin, fMax] = full
  return [Math.max(fMin, fMax - days * DAY_MS), fMax]
}

/** Whether `days` is a meaningful window for this data — i.e. narrower than what it already shows. */
export function presetApplies(full: [number, number], days: number): boolean {
  return full[1] - full[0] > days * DAY_MS + MIN_ZOOM_MS
}

/** `count` evenly spaced timestamps strictly between tMin and tMax, for axis labels beyond the
 *  two endpoints. Empty when the domain collapses to a point (or is inverted). */
export function tickTimestamps(tMin: number, tMax: number, count: number): number[] {
  if (tMax <= tMin) return []
  return Array.from({ length: count }, (_, i) => tMin + ((i + 1) / (count + 1)) * (tMax - tMin))
}
