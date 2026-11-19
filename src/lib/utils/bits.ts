/**
 * Bits vs a coin flip on a source-board row (daatan#2259): retro's `log2(P(outcome)/0.5)` summed
 * over the row's scored resolutions. Higher is better; a row without a value sorts last in either
 * direction. Pure, so the client board and the API sort the same way.
 */
export function compareBits(a: { bits?: number | null }, b: { bits?: number | null }, dir: 'asc' | 'desc' = 'desc'): number {
  const aHas = a.bits != null
  const bHas = b.bits != null
  if (!aHas || !bHas) return aHas === bHas ? 0 : aHas ? -1 : 1
  const cmp = (b.bits as number) - (a.bits as number)
  return dir === 'asc' ? -cmp : cmp
}

/** `+0.85` / `-2.32` / `0.00`; an em dash when the board doesn't carry bits yet. */
export const formatBits = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`
