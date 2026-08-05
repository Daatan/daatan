import { llmService } from './index'
import { createLogger } from '@/lib/logger'

const log = createLogger('search-query')

/**
 * Max time to wait for LLM keyword extraction before falling back to the cleaned claim.
 *
 * Raised from 2s (daatan#1225): 2 of 4 prod analyze runs over 7 days blew the old budget —
 * one measured Gemini call took 3.8s — and the fallback is not a cheap degradation. It
 * searches on the raw claim *sentence*, which retrieves generically (7 off-topic Putin
 * articles for an illness claim), so the Oracle then correctly abstains and the whole
 * analyze run publishes "Insufficient evidence". A few seconds here costs little — the
 * search phase runs before the LLM summary and the route streams — while the fallback
 * costs the run.
 *
 * Still a timeout, not a removal: a hung provider must never block search. The budget is
 * a guess at the right order of magnitude, which is why the latency of every extraction
 * is now logged (`elapsedMs` below) — tune this against that distribution rather than by
 * raising it again.
 */
const QUERY_TIMEOUT_MS = 5_000

/**
 * Strip a leading emoji prefix (e.g. the "🤖 " on bot forecasts) and take the
 * segment before a title separator. Mirrors the cleanup the context route used
 * inline; safe to use as a standalone fallback query.
 */
export function cleanClaimForSearch(claim: string): string {
  return claim
    .split(/\s+[|—–]\s+/)[0]
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/gu, '')
    .trim()
}

const EXTRACTION_PROMPT = `Turn this forecast claim into a concise web-search query that retrieves news coverage of the underlying topic.
- Keep the key named entities and the core subject.
- Drop filler, hedging, probability wording, and specific dates.
- Output 3-8 words only. No quotes, no punctuation, no explanation.

Claim: "{claim}"

Search query:`

/**
 * Turn a full-sentence forecast claim into a focused search query via a fast
 * LLM call. Sentence-style claims retrieve poorly; key entities/topic do better.
 *
 * Resilient by design: the extraction races a {@link QUERY_TIMEOUT_MS} timeout
 * and any failure/empty/slow result falls back to the cleaned claim, so a flaky
 * or slow model never blocks (or degrades) search.
 */
export async function buildSearchQuery(claim: string): Promise<string> {
  const cleaned = cleanClaimForSearch(claim)
  if (cleaned.length === 0) return claim.trim()

  const extraction = (async (): Promise<string> => {
    const prompt = EXTRACTION_PROMPT.replace('{claim}', () => cleaned)
    const res = await llmService.generateContent({ prompt, temperature: 0 })
    return res.text.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim()
  })()

  const startedAt = Date.now()
  try {
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), QUERY_TIMEOUT_MS))
    const result = await Promise.race([extraction, timeout])
    if (result && result.length >= 2) {
      log.info({ query: result, elapsedMs: Date.now() - startedAt }, 'search-query: extracted')
      return result
    }
    // `elapsedMs` at (or just past) the budget means a timeout; well under it means the
    // model returned something empty/too short. Those are different failures with
    // different fixes, and the old log line could not tell them apart.
    log.warn(
      { elapsedMs: Date.now() - startedAt, budgetMs: QUERY_TIMEOUT_MS },
      'search-query: extraction empty or timed out — using cleaned claim',
    )
    return cleaned
  } catch (err) {
    log.warn({ err, elapsedMs: Date.now() - startedAt }, 'search-query: extraction failed — using cleaned claim')
    return cleaned
  }
}
