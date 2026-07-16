/**
 * Curated set of Israeli authors/commentators tracked on the election-2026 page.
 *
 * These are the fixed ROWS of the top table. They are not Daatan entities — they
 * live in the news-indexer (as Telegram channels / sources), and surface in the app
 * as `evidence_pool_articles` rows (author / person_id, Phase 2.1) and inside
 * `ContextSnapshot.oracleSnapshot.sources[]`. A source resolves to a curated author
 * by `personId` when news-indexer resolved the identity, else by comparing its
 * `author`/`sourceName` against the aliases below.
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
  /** news-indexer `person.id` (UUID) — the cross-platform identity resolved at Telegram
   *  ingest, carried on `evidence_pool_articles.person_id`. Only channel-ingested
   *  commentators have one; byline-only authors (Segal — his channel is deliberately
   *  disabled) resolve by alias until news-indexer resolves web bylines too. */
  personId?: string
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
  { key: 'ben-caspit', name: 'Ben Caspit', nameHe: 'בן כספית', handle: 'Ben_Caspit', personId: '6b9ee26f-b1be-4ad4-be60-0a747a2caf07', lang: 'he', aliases: ['ben caspit', 'בן כספית', 'ben_caspit'] },
  { key: 'edy-cohen', name: 'Edy Cohen', nameHe: 'אדי כהן', handle: 'edycohendr', personId: 'ad40ee2d-4459-4088-93c2-6a27f8b73713', lang: 'he', aliases: ['edy cohen', 'אדי כהן', 'edycohendr'] },
  { key: 'guy-bechor', name: 'Guy Bechor', nameHe: 'גיא בכור', handle: 'MyGPLANET', personId: '1e1b9e4f-16c8-4455-8256-04149250646f', lang: 'he', aliases: ['guy bechor', 'גיא בכור', 'mygplanet'] },
  { key: 'ksenia-svetlova', name: 'Ksenia Svetlova', nameHe: 'קסניה סבטלובה', handle: 'vostochnysyndrome', personId: '8c4e08cd-e94b-4407-be73-fead515e4e4d', lang: 'ru', aliases: ['ksenia svetlova', 'ксения светлова', 'vostochnysyndrome'] },
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
  source: { author?: string | null; sourceName?: string | null; personId?: string | null },
  authors: CuratedAuthor[] = CURATED_ELECTION_AUTHORS,
): string | null {
  // news-indexer's resolved person id (on evidence-pool rows, Phase 2.3) is an exact
  // identity, so it beats alias matching. An id we don't curate falls through to the
  // aliases rather than blocking them — the fast path is an upgrade, not a gate.
  if (source.personId) {
    const byId = authors.find((a) => a.personId === source.personId)
    if (byId) return byId.key
  }
  const candidates = [normalize(source.author), normalize(source.sourceName)].filter(Boolean)
  if (candidates.length === 0) return null
  for (const author of authors) {
    for (const alias of author.aliases) {
      if (candidates.some((c) => c === alias || c.includes(alias))) return author.key
    }
  }
  return null
}
