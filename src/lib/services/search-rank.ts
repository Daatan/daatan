// Relevance order for /forecasts?q= (daatan#1878). The DB filter (substring ∪ trigram ∪
// translations ∪ tags) decides what matches; this decides the order. Very short queries
// (≤3 chars) keep only whole-word and tag hits, dropping pure substring ones ("AI" inside
// "against", "Ukraine") that only add noise. Longer queries never lose a row the DB matched.

export interface SearchCandidate {
  id: string
  claimText: string
  createdAt: Date
  tags: { name: string }[]
  translations: { translatedText: string }[]
}

// At or below this length a substring is almost never what the user meant.
export const SHORT_QUERY_MAX_LEN = 3

const SCORE = {
  claimWord: 100,
  translationWord: 90,
  claimPrefix: 80,
  translationPrefix: 70,
  tagExact: 60,
  tagWord: 50,
  substring: 20,
  fuzzy: 10,
  other: 1,
} as const

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function rankSearchMatches(
  rawQuery: string,
  candidates: SearchCandidate[],
  fuzzyIds: string[] = [],
): string[] {
  const query = rawQuery.trim()
  if (!query) return candidates.map(c => c.id)
  const q = escapeRegExp(query)
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${q}($|[^\\p{L}\\p{N}])`, 'iu')
  const prefix = new RegExp(`(^|[^\\p{L}\\p{N}])${q}`, 'iu')
  const lower = query.toLowerCase()
  const isShort = [...query].length <= SHORT_QUERY_MAX_LEN
  const fuzzyRank = new Map(fuzzyIds.map((id, i) => [id, i]))

  const score = (c: SearchCandidate): number => {
    const translations = c.translations.map(t => t.translatedText)
    const tagNames = c.tags.map(t => t.name)
    if (word.test(c.claimText)) return SCORE.claimWord
    if (translations.some(t => word.test(t))) return SCORE.translationWord
    if (tagNames.some(n => n.toLowerCase() === lower)) return SCORE.tagExact
    if (tagNames.some(n => word.test(n))) return SCORE.tagWord
    if (isShort) return 0
    if (prefix.test(c.claimText)) return SCORE.claimPrefix
    if (translations.some(t => prefix.test(t))) return SCORE.translationPrefix
    const all = [c.claimText, ...translations, ...tagNames]
    if (all.some(s => s.toLowerCase().includes(lower))) return SCORE.substring
    const fr = fuzzyRank.get(c.id)
    // word_similarity order from the DB, kept below every literal match.
    if (fr !== undefined) return SCORE.fuzzy - fr / (fuzzyIds.length + 1)
    // The DB matched it some other way (a trigram-matched tag): keep it, last.
    return SCORE.other
  }

  return candidates
    .map(c => ({ c, s: score(c) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || b.c.createdAt.getTime() - a.c.createdAt.getTime())
    .map(({ c }) => c.id)
}
