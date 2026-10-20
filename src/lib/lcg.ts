/** Deterministic pseudo-random sequence in [0, 1) (Park–Miller LCG, seed 7), so SVG jitter is stable across renders. */
export function lcgSequence(count: number): number[] {
  let seed = 7
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    seed = (seed * 16807) % 2147483647
    out.push(seed / 2147483647)
  }
  return out
}
