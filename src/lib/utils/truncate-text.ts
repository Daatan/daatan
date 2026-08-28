const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/

export type SentenceTruncation = {
  /** The (possibly full) text to display when collapsed. */
  preview: string
  /** True when `preview` is shorter than the input — i.e. there's more to reveal. */
  isTruncated: boolean
}

/**
 * Truncate `text` to roughly `maxChars`, but never mid-word and never mid-sentence:
 * it accumulates whole sentences up to the limit, always keeping at least the
 * first one even if that alone exceeds `maxChars` (a short cap can't outrank
 * having a complete, meaningful sentence in the collapsed preview).
 */
export function truncateAtSentence(text: string, maxChars: number): SentenceTruncation {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return { preview: trimmed, isTruncated: false }

  const sentences = trimmed.split(SENTENCE_BOUNDARY)
  let preview = ''
  for (const sentence of sentences) {
    const candidate = preview ? `${preview} ${sentence}` : sentence
    if (candidate.length > maxChars && preview) break
    preview = candidate
    if (candidate.length >= maxChars) break
  }
  return { preview, isTruncated: preview.length < trimmed.length }
}
