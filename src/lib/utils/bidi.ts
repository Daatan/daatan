/**
 * Wraps text in Unicode first-strong isolates (FSI … PDI) so it keeps its own
 * direction inside a sentence of the other direction, e.g. an English market
 * question or date inside Hebrew (daatan#2327). Works in plain strings, so it also
 * covers `title` attributes, where `<bdi>` can't go.
 */
export function bidiIsolate(text: string): string {
  return `⁨${text}⁩`
}
