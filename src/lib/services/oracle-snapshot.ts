import type { OracleSource } from '@/lib/services/oracle'
import type { SearchResult } from '@/lib/services/oracleSearch'
import type { ContributingSource } from '@/lib/services/forecast-sources'

/**
 * Map an aggregated Oracle stance/CI bound in [-1, 1] to a probability percent
 * in [0, 100]. Shared by every call site that builds a `ContextSnapshot.oracleSnapshot`
 * (news-indexer push, user-triggered analyze, backfill) so `mean`/`ciLow`/`ciHigh`
 * always land on the same scale inside that JSON blob — a prior split where only
 * ciLow/ciHigh went through this conversion and `mean` was stored raw made the
 * snapshot look self-contradictory (e.g. mean=0.60 next to ciLow=54/ciHigh=99).
 */
export function stanceToPercent(v: number): number {
  return Math.round(((v + 1) / 2) * 100)
}

/** Scale a stance-space standard deviation onto the same percent scale as {@link stanceToPercent}
 *  (that map's slope is 50, so a spread scales by 50 with no offset). */
export function stanceStdToPercent(v: number): number {
  return Math.round(v * 50)
}

/**
 * One Oracle-analysed source as persisted in `ContextSnapshot.oracleSnapshot.sources`.
 * The Oracle returns stance/certainty/credibility/claims but no title/date/author;
 * those are joined on at capture time — title/date from the input articles, author
 * from news-indexer (which the Oracle response omits).
 */
export type EnrichedOracleSource = {
  sourceId: string
  sourceName: string | null
  url: string
  stance: number | null
  certainty: number | null
  credibilityWeight: number | null
  claims: string[]
  title: string | null
  publishedAt: string | null
  author: string | null
  settled: boolean | null
  quantitativeEstimate: number | null
  evidenceWeight: number | null
  relevanceScore: number | null
}

/**
 * Enrich the Oracle's per-source output with title + publishedDate (joined from the
 * input articles by URL, in-memory) and author (from the news-indexer by-URL lookup).
 * Pure — no I/O. Shared by the analyze route and the backfill script.
 */
export function enrichOracleSources(
  sources: OracleSource[],
  searchResults: SearchResult[],
  authorByUrl: Map<string, string | null>,
): EnrichedOracleSource[] {
  const articleByUrl = new Map(searchResults.map((r) => [r.url, r]))
  return sources.map((s) => {
    const article = articleByUrl.get(s.url)
    return {
      sourceId: s.source_id,
      sourceName: s.source_name,
      url: s.url,
      stance: s.stance,
      certainty: s.certainty,
      credibilityWeight: s.credibility_weight,
      claims: s.claims,
      title: article?.title ?? null,
      publishedAt: article?.publishedDate ?? null,
      author: authorByUrl.get(s.url) ?? null,
      settled: s.settled ?? null,
      quantitativeEstimate: s.quantitative_estimate ?? null,
      evidenceWeight: s.evidence_weight ?? null,
      relevanceScore: s.relevance_score ?? null,
    }
  })
}

/** Narrow an untyped value to a finite number, else null. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Narrow an untyped value to a non-empty string, else null. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Read `ContextSnapshot.oracleSnapshot` (untyped Json) and map its `sources` array
 * to `ContributingSource[]` tagged `origin: 'oracle'`. Defensive: any non-array,
 * missing-url, or malformed entry is skipped — never trust the blob's shape.
 */
export function oracleSnapshotToContributingSources(oracleSnapshot: unknown): ContributingSource[] {
  if (!oracleSnapshot || typeof oracleSnapshot !== 'object') return []
  const raw = (oracleSnapshot as { sources?: unknown }).sources
  if (!Array.isArray(raw)) return []

  const out: ContributingSource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const url = str(e.url)
    if (!url) continue
    const claims = Array.isArray(e.claims) ? e.claims.filter((c): c is string => typeof c === 'string') : []
    out.push({
      url,
      title: str(e.title),
      source: str(e.sourceName),
      author: str(e.author),
      publishedAt: str(e.publishedAt),
      similarity: null,
      stance: num(e.stance),
      certainty: num(e.certainty),
      claim: claims[0] ?? null,
      oracleProbability: null,
      outcome: null,
      origin: 'oracle',
    })
  }
  return out
}
