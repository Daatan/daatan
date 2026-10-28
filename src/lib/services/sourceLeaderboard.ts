import { getAuthorShadowLeaderboard, type OracleAuthorShadowEntry } from '@/lib/services/oracle'

export type SourceLeaderboardView = 'authors' | 'outlets'
export type SourceSortBy = 'skillConservative' | 'brierScore'

export interface AuthorLeaderboardRow {
  id: string
  author: string
  outletName: string
  skillConservative: number
  brierScore: number
  predictions: number
  articles: number
  /** A newsroom/agency byline ("JPOST EDITORIAL", "Reuters", the outlet's own name), not a
   *  person: listed with a desk badge and left out of the outlet's people count (#1904 item 3). */
  isDesk?: boolean
}

export interface OutletLeaderboardRow {
  id: string
  outletName: string
  skillConservative: number
  brierScore: number
  authorCount: number
  predictions: number
  articles: number
}

export interface SourceLeaderboardResult {
  view: SourceLeaderboardView
  sortBy: SourceSortBy
  authorRows: AuthorLeaderboardRow[]
  outletRows: OutletLeaderboardRow[]
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Domains that are the same outlet under two hostnames. The board is keyed by the raw
 * `outlet_name` string, so without this ynet.co.il and ynetnews.com (daatan#1875) are ranked
 * as two thin outlets instead of one. Keyed on the variant, valued with the canonical name
 * (the one carrying more resolved predictions at the time of writing).
 */
const OUTLET_ALIASES: Record<string, string> = {
  'ynetnews.com': 'ynet.co.il',
  'aljazeera.com': 'aljazeera.net',
  'yahoo.com': 'finance.yahoo.com',
  'bbc.co.uk': 'bbc.com',
}

export function canonicalOutlet(name: string): string
export function canonicalOutlet(name: string | null): string | null
export function canonicalOutlet(name: string | null): string | null {
  return name === null ? null : (OUTLET_ALIASES[name] ?? name)
}

/** retro's scorer files bylineless predictions under this author string, per outlet. It is the
 *  outlet's own unattributed bucket — real predictions, but not a person. */
export const NO_BYLINE = '(no byline)'

/**
 * Cross-language spellings of one person (normalised form → canonical key). Display layer
 * only: retro's board is keyed by the raw byline string, and re-keying it is a scoring change
 * (#1904). Add a pair when an outlet page shows the same person twice; transliterating
 * automatically is unreliable, so this stays an explicit list.
 */
const AUTHOR_ALIASES: Record<string, string> = {
  'איתמר אייכנר': 'itamar eichner',
  'ליאור בן ארי': 'lior ben ari',
}

/** Identity of a byline: case, periods, quotes/geresh and spacing don't make a second person. */
export function authorKey(name: string): string {
  const k = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.\u05f3\u05f4"'`\u2018\u2019\u201c\u201d]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return AUTHOR_ALIASES[k] ?? k
}
const isPlaceholderAuthor = (name: string) => name.trim().toLowerCase() === NO_BYLINE

/**
 * Bylines that are an outlet's own name in another script ("الجزيرة نت" = Al Jazeera Net, filed
 * under aljazeera.net), so the exact `author === outlet_name` check misses them. Explicit — an
 * outlet's name can't be derived from its domain. Add a normalised byline when an authors board
 * shows an outlet as a person.
 */
const INSTITUTIONAL_BYLINES = new Set(['الجزيرة نت', 'חדשות סרוגים'])

/** Wire services and newsroom credits that byline a piece on their own. */
const DESK_BYLINES = new Set([
  'news agencies', 'news agency', 'staff', 'reuters', 'ap', 'associated press', 'afp', 'jta', 'tps',
  'bloomberg', 'al jazeera', 'סוכנויות הידיעות', 'מערכת',
])
const DESK_PATTERN = /\b(editorial|editors|desk|staff|newsroom|agencies|wire)\b|מערכת|סוכנויות/i

/**
 * A byline that names a newsroom or agency rather than a person (#1904 item 3, Mark 2026-10-27:
 * keep it on the authors board with a desk badge). Not a person, so `bylinePeople` returns none.
 */
export function isDeskByline(author: string): boolean {
  const pieces = splitByline(author.trim())
  return pieces.length > 0 && pieces.every(isDeskPiece)
}

function isDeskPiece(piece: string): boolean {
  const k = authorKey(piece)
  return INSTITUTIONAL_BYLINES.has(k) || DESK_BYLINES.has(k) || DESK_PATTERN.test(piece)
}

function splitByline(raw: string): string[] {
  let parts = raw.split(/\s*[;&]\s*|\s+and\s+/i)
  if (parts.length === 1 && raw.includes(',')) {
    const byComma = raw.split(/\s*,\s*/)
    if (byComma.length > 1 && byComma.every(p => wordCount(p) >= 2)) parts = byComma
  }
  return parts.map(p => p.trim()).filter(Boolean)
}

function toAuthorRow(e: OracleAuthorShadowEntry): AuthorLeaderboardRow {
  return {
    id: e.id,
    author: e.author,
    outletName: e.outlet_name,
    skillConservative: round3(e.skill_conservative),
    brierScore: round3(e.brier_score),
    predictions: e.predictions,
    articles: e.articles,
    isDesk: isDeskByline(e.author),
  }
}

/**
 * Roll authors up to their outlet. Retro's author-shadow board is keyed by (author,
 * outlet_name) as plain strings — no outlet_id join exists or is needed for this: every
 * author row already carries outlet_name, so grouping is all it takes.
 *
 * Both metrics are weighted by each author's `predictions` count so one prolific author
 * doesn't get diluted by several single-prediction bylines at the same outlet (and vice
 * versa) — same intent as the predictions-count gating already used elsewhere on this board.
 */
export function aggregateByOutlet(entries: OracleAuthorShadowEntry[]): OutletLeaderboardRow[] {
  const groups = new Map<string, OracleAuthorShadowEntry[]>()
  for (const e of entries) {
    // Un-attributed ledger rows (null/blank outlet_name, see #1835) aren't an outlet.
    if (!e.outlet_name?.trim()) continue
    const key = canonicalOutlet(e.outlet_name)
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }

  const rows: OutletLeaderboardRow[] = []
  for (const [outletName, group] of groups) {
    // A blogger / Telegram channel the pipeline keyed by its own byline (outlet_name === author,
    // e.g. "Guy Bechor") is a person, not a media outlet. They stay on the authors view.
    if (group.some(e => e.author.trim().toLowerCase() === outletName.trim().toLowerCase())) continue
    const totalPredictions = group.reduce((sum, e) => sum + e.predictions, 0)
    const totalArticles = group.reduce((sum, e) => sum + e.articles, 0)
    const weighted = (pick: (e: OracleAuthorShadowEntry) => number) =>
      totalPredictions > 0
        ? group.reduce((sum, e) => sum + pick(e) * e.predictions, 0) / totalPredictions
        : group.reduce((sum, e) => sum + pick(e), 0) / group.length

    rows.push({
      id: outletName,
      outletName,
      skillConservative: round3(weighted(e => e.skill_conservative)),
      brierScore: round3(weighted(e => e.brier_score)),
      // People, not ledger rows: joint bylines name several, the bylineless bucket none, and one
      // author can have a row per outlet alias or spelling.
      authorCount: new Set(group.flatMap(e => bylinePeople(e.author)).map(authorKey)).size,
      predictions: totalPredictions,
      articles: totalArticles,
    })
  }
  return rows
}

/**
 * Tokens that show up inside joint bylines but aren't authors: agencies, a publisher credit,
 * datelines. Only applied to the pieces of a *split* byline; a solo agency/newsroom byline is a
 * desk row instead (`isDeskByline`).
 */
const NON_PERSON_TOKENS = new Set([
  'news agencies', 'news agency', 'staff', 'the motley fool', 'motley fool',
  'new york', 'ניו יורק', 'washington', 'london', 'tel aviv',
])

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/**
 * The people named by one byline string. Retro scores a joint byline ("A; B; News Agencies")
 * as one author; here it becomes its individuals. Splits on `;`, `&`, ` and `, and on commas
 * only when every piece is a full name (so "Smith, John" stays whole). Pieces that are
 * agencies/datelines are dropped. The bylineless bucket and a desk byline name nobody.
 */
export function bylinePeople(author: string): string[] {
  const raw = author.trim()
  if (!raw || isPlaceholderAuthor(raw) || isDeskByline(raw)) return []
  const parts = splitByline(raw)
  if (parts.length === 1) return [raw]
  return parts.filter(p => !NON_PERSON_TOKENS.has(authorKey(p)) && !isDeskPiece(p))
}

/** Joint-byline rows → one row per named person. Each person gets the row's Brier and
 *  prediction count in full (credit model chosen for #1904; Brier is a per-prediction mean). */
function expandJointBylines(rows: AuthorLeaderboardRow[]): AuthorLeaderboardRow[] {
  return rows.flatMap(r => {
    if (r.isDesk) return [r]
    const people = bylinePeople(r.author)
    if (people.length === 1 && people[0] === r.author.trim()) return [r]
    return people.map((author, i) => ({ ...r, id: `${r.id}#${i}`, author }))
  })
}

/**
 * One row per (person, canonical outlet): same-person rows (spelling variants, outlet aliases,
 * a person's solo byline plus the joint ones) merged prediction-weighted, the way
 * `aggregateByOutlet` rolls authors up. The merged row keeps the spelling and outlet it has the
 * most predictions under, so the author-page link still resolves.
 */
function mergeAuthorRows(rows: AuthorLeaderboardRow[]): AuthorLeaderboardRow[] {
  const groups = new Map<string, AuthorLeaderboardRow[]>()
  for (const r of rows) {
    const key = `${canonicalOutlet(r.outletName)}\u0000${authorKey(r.author)}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const merged: AuthorLeaderboardRow[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0])
      continue
    }
    const preds = group.reduce((sum, r) => sum + r.predictions, 0)
    const weighted = (pick: (r: AuthorLeaderboardRow) => number) =>
      preds > 0
        ? group.reduce((sum, r) => sum + pick(r) * r.predictions, 0) / preds
        : group.reduce((sum, r) => sum + pick(r), 0) / group.length
    const lead = group.reduce((a, b) => (b.predictions > a.predictions ? b : a))
    merged.push({
      ...lead,
      skillConservative: round3(weighted(r => r.skillConservative)),
      brierScore: round3(weighted(r => r.brierScore)),
      predictions: preds,
      articles: group.reduce((sum, r) => sum + r.articles, 0),
    })
  }
  return merged
}

/** The people behind one outlet's track record (aliases included), most predictions first. */
export function authorsOfOutlet(rows: AuthorLeaderboardRow[], outletName: string): AuthorLeaderboardRow[] {
  const target = canonicalOutlet(outletName)
  return mergeAuthorRows(expandJointBylines(rows.filter(r => canonicalOutlet(r.outletName) === target))).sort(
    (a, b) => b.predictions - a.predictions || b.skillConservative - a.skillConservative,
  )
}

/** skillConservative is higher-is-better; brierScore is lower-is-better. */
function sortRows<T extends { skillConservative: number; brierScore: number }>(
  rows: T[],
  sortBy: SourceSortBy,
): T[] {
  return [...rows].sort((a, b) =>
    sortBy === 'brierScore' ? a.brierScore - b.brierScore : b.skillConservative - a.skillConservative,
  )
}

/**
 * Source leaderboard — bloggers/outlets measured on their `author_lean` shadow-scoring
 * track record (daatan#1195), the parallel counterpart to the user leaderboard. Backed by
 * retro's `GET /leaderboard/author-shadow` (retro PR #315). Shadow scoring: informational
 * track record only, never feeds the live forecast.
 *
 * `minPredictions` defaults to 0 (no filtering) because this function also backs single-row
 * lookups — `/sources/[name]`, `/authors/[author]/[outlet]`, and the byline-linkability check
 * in forecast-sources.ts — that must keep seeing every scored row regardless of sample size.
 * Only the public `/leaderboard/sources` board (daatan#1587) passes a non-zero value. `tag` (a
 * Daatan tag slug, daatan#1917) scores only that topic's resolutions, via retro's `?tag=`. Outlets
 * are filtered on their aggregate `predictions` count (summed across authors), not by dropping
 * low-sample authors before aggregation.
 *
 * Fails open — returns empty rows (never throws) when the Oracul is unconfigured or
 * unreachable, matching every other Oracul-backed service in this file.
 */
export async function getSourceLeaderboard(
  view: SourceLeaderboardView = 'authors',
  sortBy: SourceSortBy = 'skillConservative',
  minPredictions = 0,
  tag?: string,
): Promise<SourceLeaderboardResult> {
  const data = await getAuthorShadowLeaderboard(undefined, tag)
  const entries = data?.authors ?? []

  const authorRows = sortRows(mergeAuthorRows(expandJointBylines(entries.map(toAuthorRow))), sortBy)
    .filter(r => r.predictions >= minPredictions)
  const outletRows = sortRows(aggregateByOutlet(entries), sortBy).filter(r => r.predictions >= minPredictions)

  return { view, sortBy, authorRows, outletRows }
}

/**
 * Author-shadow rows for a single outlet — backs the admin outlet detail page
 * (`/admin/sources/[name]`). Reuses the full-board fetch and filters by `outlet_name`
 * in-memory; the board already carries it on every row, so no separate Oracul endpoint is
 * needed. Fails open to `[]`, same as `getSourceLeaderboard`.
 */
export async function getAuthorShadowRowsForOutlet(outletName: string): Promise<AuthorLeaderboardRow[]> {
  const data = await getAuthorShadowLeaderboard({ source: 'admin-outlet-detail' })
  const entries = (data?.authors ?? []).filter(e => canonicalOutlet(e.outlet_name) === canonicalOutlet(outletName))
  return sortRows(entries.map(toAuthorRow), 'skillConservative')
}
