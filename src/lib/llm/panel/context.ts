/**
 * Article retrieval for the panel's grounded-indexer members (docs/LASSO.md §9a).
 *
 * The grounded twins answer the same claim as their ungrounded siblings PLUS the top
 * news-indexer snippets matched to it. Retrieval happens once per forecast per run and
 * the result is frozen onto the run (`AiEstimateRun.contextSnapshot`), so a completion
 * pass hours later re-asks against the exact same articles — the determinism the
 * date-gate and the chart's step-function carry-forward both rest on.
 */

import { createHash } from 'crypto'
import { env } from '@/env'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai-panel-context')

/** One /search hit, verbatim from news-indexer. `snippet` is the article's first two
 *  sentences (≤400 chars) — the index stores no fuller summary, and that's enough:
 *  five snippets ≈ 700 tokens, cheap for every member. */
export type PanelContextArticle = {
  title: string
  url: string
  snippet: string
  source: string
  /** YYYY-MM-DD, or '' when the index has no date for the article. */
  publishedDate: string
}

/** What gets frozen onto `AiEstimateRun.contextSnapshot`. A type alias, not an
 *  interface, so it is assignable to Prisma's JSON types without a cast chain. */
export type PanelContextSnapshot = {
  query: string
  retrievedAt: string
  articles: PanelContextArticle[]
}

export const PANEL_CONTEXT_LIMIT = 5

/**
 * Grounding runs only when explicitly configured: a scope tag names which forecasts get
 * grounded twins, and the news-indexer connection must exist to retrieve for them.
 * Unset anywhere (prod today) → the panel is exactly the ungrounded feature.
 */
export function groundedPanelTag(): string | null {
  if (!env.AI_PANEL_GROUNDED_TAG || !env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) return null
  return env.AI_PANEL_GROUNDED_TAG
}

/**
 * Identity of a retrieved article set, folded into the run's input hash for grounded
 * forecasts. Over the articles only — `retrievedAt` is provenance, not input, and
 * hashing it would make the completion pass's recomputed hash miss its own run.
 */
export function contextFingerprint(snapshot: PanelContextSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot.articles)).digest('hex').slice(0, 16)
}

/**
 * Top matches for a claim from news-indexer's semantic `/search`.
 *
 * Empty `articles` is a REAL state, not a failure: the index has nothing relevant
 * (its min-hits gate returns [] below threshold), and the grounded members still run —
 * "no matching news" is exactly the day their answer should equal their prior.
 * `null` means retrieval itself failed (down, timeout, non-OK); the caller degrades
 * that forecast to ungrounded-only for this tick and the next tick retries.
 *
 * Deliberately calls news-indexer directly instead of going through `oracleSearch()`
 * (daatan#1421) — the grounded panel needs a frozen, single-source result set (this
 * index only) so a completion pass hours later can re-ask against the exact same
 * articles (see the file header above and docs/LASSO.md §9a); `oracleSearch()`'s
 * multi-provider fallback chain has no such determinism guarantee. Same category of
 * intentional bypass as `panel/client.ts`'s direct provider calls (retro#493).
 */
export async function retrievePanelContext(
  claimText: string,
  now: Date,
): Promise<PanelContextSnapshot | null> {
  try {
    const resp = await fetch(
      `${env.NEWS_INDEXER_URL}/search?q=${encodeURIComponent(claimText)}&limit=${PANEL_CONTEXT_LIMIT}`,
      {
        headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY ?? '' },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      },
    )
    if (!resp.ok) {
      log.warn({ status: resp.status }, 'news-indexer /search non-OK — grounded members skip this tick')
      return null
    }
    const hits = (await resp.json()) as {
      title: string
      url: string
      snippet: string
      source: string
      published_date: string
    }[]
    return {
      query: claimText,
      retrievedAt: now.toISOString(),
      articles: hits.map((h) => ({
        title: h.title,
        url: h.url,
        snippet: h.snippet,
        source: h.source,
        publishedDate: h.published_date,
      })),
    }
  } catch (err) {
    log.warn({ err }, 'news-indexer /search failed — grounded members skip this tick')
    return null
  }
}

/** The {{articlesBlock}} prompt variable. Snippets are third-party text — the template
 *  wraps this block in an ignore-instructions guard, so keep it data-only here. */
export function formatArticlesBlock(articles: PanelContextArticle[]): string {
  if (articles.length === 0) return '(no matching articles in the news index)'
  return articles
    .map((a, i) => `${i + 1}. [${a.source || 'unknown'}${a.publishedDate ? `, ${a.publishedDate}` : ''}] ${a.title}\n   ${a.snippet}`)
    .join('\n')
}
