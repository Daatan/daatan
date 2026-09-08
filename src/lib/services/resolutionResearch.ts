import { getPoolArticlesForResearch } from '@/lib/services/evidence-pool'
import { oracleSearch, type SearchResult } from '@/lib/services/oracleSearch'
import type { OracleCallSource } from '@/lib/services/oracleClient'
import { searchArticlesMultilingual } from '@/lib/utils/multilingualSearch'
import { llmService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { queryGenerationSchema, researchSchema } from '@/lib/llm/schemas'

// Resolution research runs after the fact: confirmation coverage (hands-ons,
// day-after reports) often lands just past the deadline, so search a few days
// beyond it (daatan#1467).
const SEARCH_GRACE_MS = 3 * 24 * 60 * 60_000
const PRIMARY_RESULTS_CAP = 10
// Reserved slots for the pre-creation (born-true) leg: with a flat
// append-then-cap the deadline legs filled the cap and at most one
// pre-creation snippet survived (daatan#1515) — the assistant never saw the
// evidence the #1511 leg was built to find.
const PRE_CREATION_RESULTS_CAP = 5
const TOTAL_RESULTS_CAP = 20
// The verdict call runs on the strongest Gemini tier: resolution research is
// low-volume (rate-limited per user) and is exactly the multi-source
// rules-reasoning task where the pro tier beats flash. Query generation stays
// on the chain default. Non-Google fallback legs ignore the override.
const RESEARCH_VERDICT_MODEL = 'gemini-2.5-pro'
const POOL_CONTEXT_LIMIT = 12

/**
 * Strip common English stopwords and future-tense helpers from a claim to get
 * a tighter keyword query. E.g. "The Israeli Shekel will strengthen against the
 * US Dollar by the end of February 24, 2026" → "Israeli Shekel strengthen US
 * Dollar February 2026"
 */
export function extractKeyTerms(claimText: string, resolveByDatetime: Date): string {
  const stopwords = new Set([
    'the', 'a', 'an', 'will', 'would', 'should', 'could', 'may', 'might',
    'by', 'against', 'of', 'end', 'to', 'in', 'on', 'at', 'and', 'or',
    'be', 'is', 'are', 'was', 'were', 'that', 'this', 'it', 'its',
    'have', 'has', 'had', 'do', 'does', 'did', 'not', 'for', 'with',
    'from', 'up', 'about', 'into', 'than', 'then', 'so', 'if', 'as',
  ])
  const year = resolveByDatetime.getFullYear()
  const terms = claimText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w.toLowerCase()))
    .join(' ')
  // Append year only if not already present in the terms
  return terms.includes(String(year)) ? terms : `${terms} ${year}`
}

export function dedup(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return items.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

/**
 * Compose the final research result list from the three search legs, reserving
 * slots per leg so no leg starves another (daatan#1515): a flat
 * append-then-cap let the deadline-window legs fill the whole cap, leaving the
 * born-true pre-creation leg (daatan#1511) at most one surviving snippet.
 *
 * Priority order: primary, then pre-creation (capped at `caps.preCreation`),
 * then deadline-targeted filling the remainder up to `caps.total`. The primary
 * leg already covers the deadline window, so when the total cap bites it bites
 * the leg with the most redundancy. Pre-creation results duplicating a primary
 * URL don't consume a reserved slot.
 */
export function composeResearchResults(
  primary: SearchResult[],
  preCreation: SearchResult[],
  deadlineTargeted: SearchResult[],
  caps: { preCreation: number; total: number },
): SearchResult[] {
  const primaryUrls = new Set(primary.map(r => r.url))
  const reservedPre = dedup(preCreation)
    .filter(r => !primaryUrls.has(r.url))
    .slice(0, caps.preCreation)
  return dedup([...primary, ...reservedPre, ...deadlineTargeted]).slice(0, caps.total)
}

/** Minimal shape `runResolutionResearch` needs — matches `getForecastForResearch`'s return. */
export interface ResolutionResearchPrediction {
  id: string
  claimText: string
  outcomeType: string
  resolutionRules: string | null
  publishedAt: Date | null
  createdAt: Date
  resolveByDatetime: Date
  options: { id: string; text: string }[]
}

export interface ResolutionResearchResult {
  outcome: 'correct' | 'wrong' | 'void' | 'unresolvable'
  correctOptionId?: string
  reasoning: string
  evidenceLinks: string[]
  timings: { searchMs: number; llmMs: number; totalMs: number }
}

/**
 * Run the AI resolution-research leg for a forecast: search news for the
 * claim window PLUS a leg strictly before the claim's creation date (the
 * born-true detector, daatan#1511/#1515), then ask an LLM to judge the
 * outcome. Originally only reachable from a resolver's manual "AI Research"
 * button (`[id]/research/route.ts`); reused as-is at creation time to catch
 * claims that were already true/false the moment they were created
 * (daatan#1747, retro#776 — the Chess.com 500k-users incident).
 *
 * `meta.source` tags the search-provider call logs so creation-time and
 * resolver-triggered runs are distinguishable in cost/usage tracking.
 */
export async function runResolutionResearch(
  prediction: ResolutionResearchPrediction,
  meta: { userId: string; source?: OracleCallSource },
): Promise<ResolutionResearchResult> {
  const source = meta.source ?? 'research'
  const routeStart = Date.now()
  const forecastStart = prediction.publishedAt || prediction.createdAt
  const forecastEnd = prediction.resolveByDatetime
  const now = new Date()
  const graceEnd = new Date(forecastEnd.getTime() + SEARCH_GRACE_MS)
  const searchDateTo = graceEnd < now ? graceEnd : now
  const forecastStartStr = forecastStart.toISOString().split('T')[0]
  const forecastEndStr = forecastEnd.toISOString().split('T')[0]

  // Build a simplified query by stripping stopwords so we get tighter matches
  // even when the raw claim text uses future-tense phrasing that news won't use.
  const simplifiedQuery = extractKeyTerms(prediction.claimText, forecastEnd)

  const searchStart = Date.now()

  // 1. Try oracle first (shares provider fallback chain + quota with oracle forecasts).
  //    If oracle returns ≥ 3 results, skip the 3-way local parallel search.
  //    No dateFrom: the claim window has no lower bound unless the claim text
  //    states one — flooring searches at the creation date hid a resolving event
  //    that happened six days before the claim existed (daatan#1511, Brent $100).
  const oracleResults = await oracleSearch(prediction.claimText, 12, {
    dateTo: searchDateTo,
  }, { source, userId: meta.userId, predictionId: prediction.id })

  let results: SearchResult[]
  if (oracleResults && oracleResults.length >= 3) {
    results = oracleResults
  } else {
    // Fallback: three parallel local searches
    //    a) Deadline-capped with raw claim text
    //    b) Broad (no date) with raw claim text — catches older or wider coverage
    //    c) Deadline-capped with simplified key-term query — targets the actual topic
    const researchMeta = { source, userId: meta.userId }
    const [dated, broad, simplified] = await Promise.all([
      searchArticlesMultilingual(prediction.claimText, 6, { dateTo: searchDateTo }, researchMeta)
        .catch(() => [] as SearchResult[]),
      searchArticlesMultilingual(prediction.claimText, 4, undefined, researchMeta)
        .catch(() => [] as SearchResult[]),
      searchArticlesMultilingual(simplifiedQuery, 6, { dateTo: searchDateTo }, researchMeta)
        .catch(() => [] as SearchResult[]),
    ])
    results = dedup([...simplified, ...dated, ...broad])
  }

  results = results.slice(0, PRIMARY_RESULTS_CAP)

  // 2. Always run LLM-generated targeted queries on top of the raw-claim
  //    searches. Raw-claim searches tend to surface generic roundups whose
  //    snippets omit the specific entity, and an LLM judging from those can
  //    mistake absence of mention for absence of the event (daatan#1467).
  //    Composition reserves slots per leg — see composeResearchResults.
  try {
    const template = await getPromptTemplate('research-query-generation')
    const prompt = fillPrompt(template, {
      claimText: prediction.claimText,
      forecastStartStr,
      forecastEndStr,
    })

    const qRes = await llmService.generateContent({
      prompt,
      schema: queryGenerationSchema,
      temperature: 0,
    })
    const { queries } = JSON.parse(qRes.text) as { queries: string[] }
    // Each targeted query runs twice: once over the whole window up to the
    // deadline, and once strictly BEFORE the claim's creation date. The
    // pre-creation leg is the born-true detector (daatan#1511): the first-in-
    // chain news-indexer only holds recent articles, so a strictly historical
    // window filters its hits to zero (retro#559) and the query falls through
    // to the SERP providers that can actually search that far back.
    const targetedMeta = { source, userId: meta.userId }
    const perQuery = await Promise.all(
      queries.slice(0, 3).map(q => Promise.all([
        searchArticlesMultilingual(q, 5, { dateTo: searchDateTo }, targetedMeta)
          .catch(() => [] as SearchResult[]),
        searchArticlesMultilingual(q, 3, { dateTo: forecastStart }, targetedMeta)
          .catch(() => [] as SearchResult[]),
      ]))
    )
    // Compose with reserved slots per leg (daatan#1515) instead of a
    // flat append-then-cap that starved the pre-creation leg.
    results = composeResearchResults(
      results,
      perQuery.flatMap(([, pre]) => pre),
      perQuery.flatMap(([deadline]) => deadline),
      { preCreation: PRE_CREATION_RESULTS_CAP, total: TOTAL_RESULTS_CAP },
    )
  } catch {
    // targeted search failed — continue with what we have
  }

  const context = results.length > 0
    ? results.map(r =>
        `Title: ${r.title}\nSource: ${r.source}${r.publishedDate ? ` (${r.publishedDate})` : ''}\nSnippet: ${r.snippet}\nURL: ${r.url}`
      ).join('\n\n')
    : ''

  // The Oracul's own evidence pool: stance-scored evidence extracted for
  // exactly this claim, including any settlement assertions — the
  // resolution assistant previously never saw it and judged from fresh
  // search snippets alone.
  const poolRows = await getPoolArticlesForResearch(prediction.id, POOL_CONTEXT_LIMIT)
    .catch(() => [])
  const poolContext = poolRows.length > 0
    ? `Curated evidence pool (${poolRows.length} highest-weight articles extracted for this exact claim; stance is in [-1, 1], +1 = supports the claim):\n`
      + poolRows.map(r =>
          `- ${r.publishedDate ?? 'undated'} | ${r.source ?? 'unknown source'} | "${r.title ?? r.url}" | stance ${r.stance}`
          + (r.evidenceClass ? ` | ${r.evidenceClass}` : '')
          + (r.settled ? ` | SETTLEMENT ASSERTED${r.settlementEventDate ? ` on ${r.settlementEventDate}` : ''}` : '')
          + ` | ${r.url}`
        ).join('\n')
    : ''

  // Include options in the prompt if MULTIPLE_CHOICE
  const optionsContext = prediction.outcomeType === 'MULTIPLE_CHOICE'
    ? `\nThis is a MULTIPLE CHOICE prediction. The available options are:\n${prediction.options.map(o => `- ID: ${o.id}, Text: "${o.text}"`).join('\n')}\nIf the outcome is 'correct', you MUST identify which specific option ID is the winner.`
    : ''

  const searchMs = Date.now() - searchStart

  // 3. Ask LLM to evaluate
  const llmStart = Date.now()
  const template = await getPromptTemplate('resolution-research')
  const prompt = fillPrompt(template, {
    claimText: prediction.claimText,
    outcomeType: prediction.outcomeType,
    optionsContext,
    resolutionRules: prediction.resolutionRules || 'Determine outcome based on publicly available information for the relevant period.',
    forecastStartStr,
    forecastEndStr,
    currentDate: now.toISOString().split('T')[0],
    context: [
      poolContext,
      context
        ? `News Context (${results.length} articles found for the forecast period):\n${context}`
        : '',
    ].filter(Boolean).join('\n\n')
      || 'Note: Automated news search returned no results. Rely on your training knowledge for the forecast period.'
  })

  const response = await llmService.generateContent({
    prompt,
    schema: researchSchema,
    temperature: 0,
    model: RESEARCH_VERDICT_MODEL,
  })

  const llmMs = Date.now() - llmStart
  const findings = JSON.parse(response.text) as Omit<ResolutionResearchResult, 'timings'>
  return { ...findings, timings: { searchMs, llmMs, totalMs: Date.now() - routeStart } }
}
