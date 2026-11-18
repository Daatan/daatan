/**
 * Grouping a week of pool claims into candidate events (daatan#2217).
 *
 * A pool claim is written relative to the forecast it was matched to ("Spot Bitcoin ETFs
 * have seen seven straight sessions of outflows, a sign of weakening demand for a $100k
 * rally"). Two reports of one event matched to two different forecasts then differ only in
 * that tail, and the tail is what the embedding sees first. {@link eventText} cuts it.
 */

/**
 * Where a claim stops describing the event and starts relating it to its forecast. Ported
 * verbatim from the 2026-11-16 simulation that the 0.88 threshold below was calibrated on, so
 * the two stay comparable — including its one known slip, which cuts "X is a weak precursor to
 * Y" down to "X is". The cut text is only embedded for clustering; the judge reads whole claims.
 */
const RELATIVE_TAIL =
  /,?\s+(which|a weak|a strong|a sign|a signal|a step|a precursor|a necessary|signalling|signaling|suggesting|making|so |lowering|raising|reducing|weakening|pointing|though|but the article|indicating|in a move that)\b.*$/i

/**
 * Two retro claims at or above this cosine (gemini-embedding-2) ask about the same event: the
 * bar for folding one run's candidates together and for skipping an event a forecast already
 * asks. Measured 2026-11-17 on 22 judged claims: rewordings of one event scored 0.97–1.00 and a
 * looser paraphrase ("receive the mandate" against "task … with forming") 0.92–0.94, while
 * distinct events of one saga reached 0.92 and a judged event against the live forecast it was
 * a precursor of reached 0.936 (0.87, the create-form warning bar, would have dropped 13 of the
 * 22). Set above every distinct pair: a missed merge costs one extra draft to reject, a false
 * one silently loses an event.
 */
export const SAME_EVENT_MIN_SCORE = 0.95

/** The claim with its forecast-relative tail cut off. */
export function eventText(claim: string): string {
  return claim.replace(RELATIVE_TAIL, '').trim().replace(/[.,;]+$/, '')
}

/**
 * Average-linkage agglomerative clustering on cosine similarity. Merges the most similar
 * pair until no pair of clusters averages `threshold` or more. Vectors need not be
 * normalised. O(n²) memory; n is ~1,200 for a week of pool claims.
 *
 * Calibrated 2026-11-17 on the 1,060 events of the 2026-11-16 simulation, embedded with
 * gemini-embedding-2 (768 d): 0.88 gave the closest match to the hand-reviewed Titan-256
 * clustering at 0.75 (mean best-Jaccard 0.52 over its 59 multi-source clusters, against
 * 0.26 at 0.80). gemini's pairwise similarity runs high (median 0.67, 90th percentile 0.86),
 * so a threshold tuned on another embedding does not carry over.
 */
export function averageLinkage(vectors: number[][], threshold: number): number[][] {
  const n = vectors.length
  if (n === 0) return []
  const dim = vectors[0].length
  const unit = vectors.map((v) => {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  })

  const sim = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dot = 0
      const a = unit[i]
      const b = unit[j]
      for (let k = 0; k < dim; k++) dot += a[k] * b[k]
      sim[i * n + j] = dot
      sim[j * n + i] = dot
    }
  }

  const alive = new Uint8Array(n).fill(1)
  const size = new Float64Array(n).fill(1)
  const members: number[][] = Array.from({ length: n }, (_, i) => [i])
  // Best partner per live row, so each merge rescans only the rows it touched.
  const best = new Int32Array(n).fill(-1)
  const bestSim = new Float64Array(n).fill(-Infinity)
  const rescan = (i: number) => {
    best[i] = -1
    bestSim[i] = -Infinity
    for (let j = 0; j < n; j++) {
      if (j === i || !alive[j]) continue
      const s = sim[i * n + j]
      if (s > bestSim[i]) { bestSim[i] = s; best[i] = j }
    }
  }
  for (let i = 0; i < n; i++) rescan(i)

  for (;;) {
    let a = -1
    for (let i = 0; i < n; i++) if (alive[i] && best[i] >= 0 && (a < 0 || bestSim[i] > bestSim[a])) a = i
    if (a < 0 || bestSim[a] < threshold) break
    const b = best[a]
    // Lance–Williams update for average linkage.
    for (let k = 0; k < n; k++) {
      if (!alive[k] || k === a || k === b) continue
      const s = (size[a] * sim[a * n + k] + size[b] * sim[b * n + k]) / (size[a] + size[b])
      sim[a * n + k] = s
      sim[k * n + a] = s
    }
    size[a] += size[b]
    members[a].push(...members[b])
    alive[b] = 0
    for (let k = 0; k < n; k++) {
      if (!alive[k]) continue
      if (k === a || best[k] === a || best[k] === b) rescan(k)
      else if (sim[k * n + a] > bestSim[k]) { bestSim[k] = sim[k * n + a]; best[k] = a }
    }
  }

  return members.filter((_, i) => alive[i])
}
