/**
 * Local (no-LLM) near-duplicate check for bot forecasts.
 *
 * Before spending an LLM round-trip on the dedup gate, compare a candidate title
 * against recent forecast titles by keyword-set Jaccard similarity. A confident
 * overlap skips the forecast outright; anything below the threshold falls through
 * to the existing LLM dedup check, so borderline cases keep their semantic check.
 *
 * Keyword extraction is shared with hot-topic clustering (rss.ts) so "same story"
 * means the same thing in both places.
 */
import { extractKeywords } from './rss'

/** Keyword-set Jaccard at or above this counts as a duplicate without the LLM. */
export const LOCAL_DEDUP_THRESHOLD = 0.6

/**
 * Returns true if `title` is a near-duplicate of any entry in `existingTitles`,
 * measured by keyword-set Jaccard similarity ≥ `threshold`. Titles with no
 * significant keywords never match.
 */
export function isLocalDuplicate(
  title: string,
  existingTitles: string[],
  threshold: number = LOCAL_DEDUP_THRESHOLD,
): boolean {
  const target = new Set(extractKeywords(title))
  if (target.size === 0) return false

  for (const existing of existingTitles) {
    const other = extractKeywords(existing)
    if (other.length === 0) continue

    let intersection = 0
    for (const kw of other) {
      if (target.has(kw)) intersection++
    }
    const union = target.size + other.length - intersection
    if (union > 0 && intersection / union >= threshold) return true
  }

  return false
}
