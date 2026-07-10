/**
 * Curated set of Israeli authors/commentators tracked on the election-2026 page.
 *
 * These are the fixed ROWS of the top table. They are not Daatan entities — they
 * live in the news-indexer (as Telegram channels / sources), and surface in the app
 * only inside `ContextSnapshot.oracleSnapshot.sources[].author` (joined by URL at
 * capture time). We therefore match a live Oracle source to a curated author by
 * comparing the source's `author`/`sourceName` against the aliases below.
 *
 * Aliases include English, Hebrew, and the Telegram handle so a match survives
 * whichever form the Oracle/news-indexer recorded.
 */
export type CuratedAuthor = {
  /** Stable row key + URL segment for the future per-author page. */
  key: string
  /** Display name (English). */
  name: string
  /** Display name (Hebrew) — the page is Hebrew-first. */
  nameHe: string
  /** Telegram handle (news-indexer channel), when known. */
  handle?: string
  /** Primary language of the channel. */
  lang: 'he' | 'en' | 'ru' | 'ar'
  /** Lower-cased strings any of which, matched against a source's author/sourceName, identifies this author. */
  aliases: string[]
}

export const CURATED_ELECTION_AUTHORS: CuratedAuthor[] = [
  // nameHe is the correct spelling (עמית, with an ayin); 'אמית' below is a known
  // Oracle-side misspelling kept only as a match alias — see elections' sources.ts,
  // which carries the same correction and both aliases.
  { key: 'amit-segal', name: 'Amit Segal', nameHe: 'עמית סגל', handle: 'amitsegal', lang: 'he', aliases: ['amit segal', 'עמית סגל', 'אמית סגל', 'amitsegal'] },
  { key: 'ben-caspit', name: 'Ben Caspit', nameHe: 'בן כספית', handle: 'Ben_Caspit', lang: 'he', aliases: ['ben caspit', 'בן כספית', 'ben_caspit'] },
  { key: 'edy-cohen', name: 'Edy Cohen', nameHe: 'אדי כהן', handle: 'edycohendr', lang: 'he', aliases: ['edy cohen', 'אדי כהן', 'edycohendr'] },
  { key: 'guy-bechor', name: 'Guy Bechor', nameHe: 'גיא בכור', handle: 'MyGPLANET', lang: 'he', aliases: ['guy bechor', 'גיא בכור', 'mygplanet'] },
  { key: 'ksenia-svetlova', name: 'Ksenia Svetlova', nameHe: 'קסניה סבטלובה', handle: 'vostochnysyndrome', lang: 'ru', aliases: ['ksenia svetlova', 'ксения светлова', 'vostochnysyndrome'] },
]

function normalize(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * Resolve a live Oracle source (its `author` and/or `sourceName`) to a curated
 * author key, or null if it isn't one of the tracked commentators. Prefers the
 * `author` field (individual), falls back to `sourceName` (outlet).
 */
export function matchCuratedAuthor(
  source: { author?: string | null; sourceName?: string | null },
  authors: CuratedAuthor[] = CURATED_ELECTION_AUTHORS,
): string | null {
  const candidates = [normalize(source.author), normalize(source.sourceName)].filter(Boolean)
  if (candidates.length === 0) return null
  for (const author of authors) {
    for (const alias of author.aliases) {
      if (candidates.some((c) => c === alias || c.includes(alias))) return author.key
    }
  }
  return null
}
