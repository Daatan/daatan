/** "Takes a side" counts on an authors-board row (daatan#2231): of `sideTotal` forecasts the
 *  byline wrote about, `sideTaken` had the author's own directional forecast extracted. */
export interface SideCounts {
  sideTaken?: number | null
  sideTotal?: number | null
}

const hasSide = (r: SideCounts): r is { sideTaken: number; sideTotal: number } =>
  r.sideTaken != null && r.sideTotal != null && r.sideTotal > 0

/**
 * X/Y order: rate first, ties by Y (the larger sample ranks higher), rows without a value last
 * in either direction. Pure, so the client board and the API sort the same way. Rates are
 * compared by cross-multiplying, so 1/3 and 2/6 tie exactly.
 */
export function compareSideRate(a: SideCounts, b: SideCounts, dir: 'asc' | 'desc' = 'desc'): number {
  const aHas = hasSide(a)
  const bHas = hasSide(b)
  if (!aHas || !bHas) return aHas === bHas ? 0 : aHas ? -1 : 1
  const byRate = b.sideTaken * a.sideTotal - a.sideTaken * b.sideTotal
  const cmp = byRate || b.sideTotal - a.sideTotal
  return dir === 'asc' ? -cmp : cmp
}
