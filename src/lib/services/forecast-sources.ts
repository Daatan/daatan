import { env } from '@/env'
import { createLogger } from '@/lib/logger'
import { canonicalKey } from '@/lib/utils/canonical-url'

const log = createLogger('forecast-sources')

/**
 * A publication that fed the Oracul for a forecast — one delivered article
 * (a news-indexer `forecast_match`), shown on the forecast page like a
 * forecaster with its own stance on the claim.
 */
export type ContributingSource = {
  url: string
  title: string | null
  source: string | null
  author: string | null
  publishedAt: string | null
  similarity: number | null
  /** [-1, 1] — negative favours NO, positive favours YES. */
  stance: number | null
  /** [0, 1] — how confident this source is. */
  certainty: number | null
  claim: string | null
  /** Oracul's per-article probability, 0–100. */
  oracleProbability: number | null
  /** YES | NO | ANNULLED once the forecast resolves, else null. */
  outcome: string | null
  /** Which stream surfaced this source. 'both' = analysed AND indexed. */
  origin?: 'oracle' | 'indexer' | 'both'
  /** This source reported the outcome as already decided — it supports the Oracul's
   *  settlement pin (#1250). Only oracle-origin rows carry it; null = unknown. */
  settled?: boolean | null
  /** Resolved outlet identity (news-indexer outlet.name), for linking to /sources/[name] —
   *  distinct from `source`, which is a raw display string and not a stable identity. Null
   *  when the by-url identity lookup has no match (unresolved byline, or an oracle-only
   *  source that was never enriched against news-indexer's identity index). */
  outletName: string | null
  /** Resolved author identity (news-indexer person.name), paired with `outletName` for
   *  linking to /authors/[author]/[outlet]. Same provenance/nullability as `outletName`. */
  personName: string | null
  /** True when the (personName, outletName) pair has a scored row on the author-shadow
   *  leaderboard — the same criterion /authors/[author]/[outlet] checks before notFound()
   *  — so a rendered author link cannot 404. Unset/false → the byline renders unlinked. */
  authorLinkable?: boolean
}

/**
 * The publications news-indexer recorded as contributing to a forecast's AI
 * estimate. Best-effort: returns [] when news-indexer is unconfigured or
 * unreachable — the panel is supplementary, never a reason to fail the page.
 */
export async function getContributingSources(forecastId: string): Promise<ContributingSource[]> {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) return []

  try {
    const resp = await fetch(
      `${env.NEWS_INDEXER_URL}/forecast-sources/${encodeURIComponent(forecastId)}`,
      {
        headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY },
        signal: AbortSignal.timeout(4000),
        next: { revalidate: 60 },
      },
    )
    if (!resp.ok) {
      log.warn({ forecastId, status: resp.status }, 'news-indexer forecast-sources non-OK')
      return []
    }
    const rows = (await resp.json()) as ContributingSource[]
    const metaByUrl = await getArticleMetaByUrl(rows.map((r) => r.url))
    return await markLinkableAuthors(
      rows.map((r) => ({
        ...r,
        origin: 'indexer' as const,
        outletName: metaByUrl.get(r.url)?.outletName ?? null,
        personName: metaByUrl.get(r.url)?.personName ?? null,
        settled: r.settled ?? null,
      })),
    )
  } catch (err) {
    log.warn({ err, forecastId }, 'Failed to fetch contributing sources')
    return []
  }
}

/**
 * Flag rows whose (personName, outletName) pair has a scored row on the author-shadow
 * leaderboard — the exact existence criterion /authors/[author]/[outlet] applies before
 * notFound() — so the panel only links bylines whose profile page actually resolves.
 * One batched board fetch covers the whole roster (the board IS the row set that page
 * searches), skipped entirely when no row carries a resolved identity pair — the common
 * case while the board is sparse (#1213). Fails open: an unreachable Oracul returns an
 * empty board, so every flag stays unset and bylines just render unlinked.
 */
async function markLinkableAuthors(rows: ContributingSource[]): Promise<ContributingSource[]> {
  if (!rows.some((r) => r.personName && r.outletName)) return rows
  const { getSourceLeaderboard } = await import('@/lib/services/sourceLeaderboard')
  const { authorRows } = await getSourceLeaderboard('authors', 'skillConservative')
  const scored = new Set(authorRows.map((r) => `${r.author}\u0000${r.outletName}`))
  return rows.map((r) =>
    r.personName && r.outletName && scored.has(`${r.personName}\u0000${r.outletName}`)
      ? { ...r, authorLinkable: true }
      : r,
  )
}

/** Article metadata returned by news-indexer's by-URL lookup. */
type ArticleMeta = {
  url: string
  requestedUrl: string
  author: string | null
  publishedAt: string | null
  /** Where news-indexer resolved `publishedAt` from — `page` | `feed` | `pushed` | `archive`,
   *  null when unknown (news-indexer#426 / daatan#1679 item 2). Optional: an older
   *  news-indexer omits it entirely, which reads the same as null. */
  publishedAtSource?: string | null
  title: string | null
  source: string | null
  // Resolved cross-platform identity (news-indexer person). Present since the by-url identity
  // change; null for uncurated bylines and against an older news-indexer. See MATCHING_ARCHITECTURE.md.
  personId?: string | null
  personName?: string | null
  // Resolved outlet identity (news-indexer outlet). Same provenance/nullability as personId/personName.
  outletId?: string | null
  outletName?: string | null
}

/**
 * Author (and date/title) for a batch of article URLs, from news-indexer's
 * `/articles/by-url`. The map is keyed by the URL as passed in (`requestedUrl`).
 * Best-effort: returns an empty map when news-indexer is unconfigured or
 * unreachable — used to enrich the Oracul's sources, which it must never block.
 */
export async function getArticleMetaByUrl(urls: string[]): Promise<Map<string, ArticleMeta>> {
  const out = new Map<string, ArticleMeta>()
  if (urls.length === 0 || !env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) return out

  try {
    const resp = await fetch(`${env.NEWS_INDEXER_URL}/articles/by-url`, {
      method: 'POST',
      headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
      signal: AbortSignal.timeout(4000),
    })
    if (!resp.ok) {
      log.warn({ status: resp.status }, 'news-indexer articles/by-url non-OK')
      return out
    }
    for (const m of (await resp.json()) as ArticleMeta[]) out.set(m.requestedUrl, m)
  } catch (err) {
    log.warn({ err }, 'Failed to fetch article metadata by URL')
  }
  return out
}

/**
 * The merged source-voter roster for a forecast: the Oracul's analysed sources
 * (from the latest ContextSnapshot) plus news-indexer's matched articles, deduped
 * by canonical URL. On overlap the Oracul's stance/certainty win, display fields
 * are unioned, and the origin becomes 'both'. Both reads are best-effort.
 */
export async function getForecastVoters(forecastId: string): Promise<ContributingSource[]> {
  const { getLatestOracleSnapshot } = await import('@/lib/services/context')
  const { oracleSnapshotToContributingSources } = await import('@/lib/services/oracle-snapshot')

  const [snapshot, indexer] = await Promise.all([
    getLatestOracleSnapshot(forecastId),
    getContributingSources(forecastId),
  ])
  const oracle = oracleSnapshotToContributingSources(snapshot?.oracleSnapshot)

  const merged = new Map<string, ContributingSource>()
  // Oracul first — it wins stance/certainty on overlap.
  for (const s of oracle) merged.set(canonicalKey(s.url), s)
  for (const s of indexer) {
    const key = canonicalKey(s.url)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, s)
      continue
    }
    merged.set(key, {
      ...existing,
      title: existing.title ?? s.title,
      source: existing.source ?? s.source,
      author: existing.author ?? s.author,
      publishedAt: existing.publishedAt ?? s.publishedAt,
      similarity: existing.similarity ?? s.similarity,
      oracleProbability: existing.oracleProbability ?? s.oracleProbability,
      outcome: existing.outcome ?? s.outcome,
      outletName: existing.outletName ?? s.outletName,
      // The identity pair and its linkability travel together: oracle-origin rows carry
      // neither (see oracleSnapshotToContributingSources), so the flag computed on the
      // indexer row always matches the pair that survives this merge.
      personName: existing.personName ?? s.personName,
      authorLinkable: existing.authorLinkable || s.authorLinkable,
      settled: existing.settled ?? s.settled ?? null,
      origin: 'both',
    })
  }
  return [...merged.values()]
}
