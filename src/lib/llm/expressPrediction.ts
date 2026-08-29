import { SchemaType, type Schema } from '@google/generative-ai'
import { getPromptTemplate, fillPrompt } from './bedrock-prompts'
import { llmService } from './index'
import { oracleSearch, type SearchResult } from '../services/oracleSearch'
import { type OracleCallMeta } from '../services/oracleClient'
import { buildSearchQuery } from './searchQuery'
import { NON_LATIN } from '../utils/multilingualSearch'
import { DEFAULT_MAX_ARTICLES } from '../services/oracle'
import { fetchUrlContent } from '../utils/scraper'
import { hashUrl } from '../utils/hash'
import { createLogger } from '@/lib/logger'
import { STANDARD_TAGS } from '@/lib/constants'
import { checkContent } from '../services/moderation'
import { localizeForecastForAuthor, type LocalizedForecast } from '../services/translation'
import { getProviderForUrl, resolveMarketByUrl, getLatestMarketPrice, PROVIDER_LABEL } from '../services/external-markets'

const log = createLogger('express-prediction')

export interface NoArticlesFoundDetails {
  searchedFor: string
  isUrl: boolean
  isNonLatin: boolean
}

export class NoArticlesFoundError extends Error {
  details: NoArticlesFoundDetails
  constructor(details: NoArticlesFoundDetails) {
    super('NO_ARTICLES_FOUND')
    this.name = 'NoArticlesFoundError'
    this.details = details
  }
}

export const expressPredictionSchema: Schema = {
  description: "Structured prediction generated from user's casual input",
  type: SchemaType.OBJECT,
  properties: {
    claimText: {
      type: SchemaType.STRING,
      description: "Clear, testable prediction statement",
    },
    resolveByDatetime: {
      type: SchemaType.STRING,
      description: "ISO 8601 datetime when prediction should be resolved",
    },
    detailsText: {
      type: SchemaType.STRING,
      description: "2-3 sentence neutral summary of the current situation. Base it on the articles ONLY when they are actually about this claim's topic. If the articles are not relevant to the claim, briefly frame the claim itself instead — never state that the articles lack information.",
    },
    tags: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "List of relevant tags (1-3)",
    },
    resolutionRules: {
      type: SchemaType.STRING,
      description: "Specific criteria for resolution",
    },
    outcomeType: {
      type: SchemaType.STRING,
      description: "BINARY for yes/no predictions, MULTIPLE_CHOICE when multiple distinct outcomes are possible (e.g. 'who will win', 'which team')",
    },
    options: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "For MULTIPLE_CHOICE only: 2-10 distinct outcome options. Empty array for BINARY.",
    },
    probabilitySuggestion: {
      type: SchemaType.NUMBER,
      description: "AI's suggested probability (0-100) based on current context",
    },
    probabilityReasoning: {
      type: SchemaType.STRING,
      description: "One sentence explanation for the probability suggestion",
    },
    relevantArticleIndices: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.NUMBER },
      description: "1-based indices of the [Article N] entries above that are genuinely about this claim's topic. Empty array if none of the articles are relevant.",
    },
  },
  required: ["claimText", "resolveByDatetime", "detailsText", "tags", "resolutionRules", "outcomeType", "options", "probabilitySuggestion", "probabilityReasoning", "relevantArticleIndices"],
}

export const guessChancesSchema: Schema = {
  description: "Suggested probability and reasoning for a forecast",
  type: SchemaType.OBJECT,
  properties: {
    probability: {
      type: SchemaType.NUMBER,
      nullable: true,
      description: "Suggested probability (0 to 100), or null if the forecast is too vague or underspecified to estimate",
    },
    reasoning: {
      type: SchemaType.STRING,
      description: "Brief explanation for the suggested probability, or for why one cannot be given",
    },
  },
  required: ["probability", "reasoning"],
}

/** A market linked via a pasted Polymarket/Kalshi URL — the express-flow counterpart
 *  to the wizard's step-1 import, surfaced to the client for display + re-use in the
 *  interactive "Guess Chances" call (see guess/route.ts). */
export interface LinkedMarketInfo {
  provider: string
  providerLabel: string
  question: string
  url: string
  /** Cached YES price (0-100), or null if no snapshot exists yet. */
  probability: number | null
}

export interface ExpressPredictionResult {
  claimText: string
  resolveByDatetime: string
  detailsText: string
  tags: string[]
  resolutionRules: string
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE'
  options: string[] // Non-empty for MULTIPLE_CHOICE
  probabilitySuggestion: number
  probabilityReasoning: string
  newsAnchor: {
    url: string
    urlHash: string
    title: string
    snippet: string
    source?: string
    publishedAt?: Date
  } | null
  additionalLinks: Array<{
    url: string
    title: string
  }>
  externalMarketId: string | null
  market: LinkedMarketInfo | null
  // Future years the model asserted (in the claim or resolution date) that appear
  // nowhere in the user's input or the source articles — the signature of a
  // hallucinated scheduled-event date (#1086). The review screen warns on these.
  ungroundedYears: string[]
  // Author-facing text translated into the language the user typed in (non-Latin input
  // only), for the create preview. The English fields above stay canonical. Null/absent
  // for English input or on translation failure.
  localized?: LocalizedForecast | null
}

/** Shape of the JSON object returned by the LLM (matches expressPredictionSchema). */
interface ParsedPrediction {
  claimText: string
  resolveByDatetime: string
  detailsText: string
  tags: string[]
  resolutionRules: string
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE'
  options: string[]
  probabilitySuggestion: number
  probabilityReasoning: string
  // Required in the schema, but optional here: an absent value means "no judgment"
  // (fall back to retrieval order) vs an explicit [] meaning "none relevant".
  relevantArticleIndices?: number[]
}

// Prompt rule 3a's default horizon for relative-timing claims ("will A happen
// before B"). Shared by getFiveYearsFromNow (which feeds it into the prompt)
// and findUngroundedYears (which must not flag it as a hallucination).
const RELATIVE_TIMING_HORIZON_YEARS = 5

/**
 * Future years asserted in the claim or resolution date that appear nowhere in
 * the grounding text (user input + article snippets the model was shown). Such
 * a year came from the model's parametric memory, not from the sources — the
 * failure mode of #1086, where a Knesset-elections claim shipped with an
 * invented 2027 deadline.
 *
 * Past and current years are context, not guesses, and the two documented
 * defaults are deliberate: end of the current year (rule 3) and the
 * relative-timing horizon (rule 3a). Only what's left is suspect.
 */
export function findUngroundedYears(
  claimText: string,
  resolveByDatetime: string,
  groundingText: string,
  now: Date,
): string[] {
  const currentYear = now.getFullYear()
  const candidates = new Set<string>()
  for (const m of claimText.matchAll(/\b(2\d{3})\b/g)) candidates.add(m[1])
  const resolveYear = resolveByDatetime.match(/^(\d{4})-/)
  if (resolveYear) candidates.add(resolveYear[1])
  return [...candidates]
    .filter(y => {
      const year = Number(y)
      if (year <= currentYear || year === currentYear + RELATIVE_TIMING_HORIZON_YEARS) return false
      return !groundingText.includes(y)
    })
    .sort()
}

export function getFiveYearsFromNow(now: Date) {
  const d = new Date(now.getFullYear() + RELATIVE_TIMING_HORIZON_YEARS, now.getMonth(), now.getDate())
  return {
    iso: d.toISOString().split('T')[0] + 'T23:59:59Z',
    human: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  }
}

export async function generateExpressPrediction(
  userInput: string,
  onProgress?: (stage: string, data?: Record<string, unknown>) => void,
  skipSources?: boolean,
  meta: OracleCallMeta = { source: 'express-creation' }
): Promise<ExpressPredictionResult> {
  // Proactive content moderation — only for free-text input. A bare URL is the
  // intended input for the article-import path, but the LLM moderator
  // intermittently mis-flags it as "spam" (a non-deterministic false positive —
  // the same URL passes on retry). The generated claim is still moderated at
  // forecast-create time (checkContent in POST /api/forecasts), so skipping the
  // raw-URL check here is safe.
  const isUrlInput = /^https?:\/\/[^\s]+$/i.test(userInput.trim())
  if (!isUrlInput) {
    onProgress?.('checking', { message: 'Checking content…' })
    const moderation = await checkContent(userInput, 'forecast')
    if (moderation.isOffensive) {
      throw new Error(`OFFENSIVE_INPUT: ${moderation.reason}`)
    }
  }

  // Source-free path: skip web search entirely
  if (skipSources) {
    onProgress?.('analyzing', { message: 'AI is drafting your forecast…' })

    const now = new Date()
    const currentYear = now.getFullYear()
    const endOfYear = `${currentYear}-12-31T23:59:59Z`
    const endOfYearHuman = `December 31, ${currentYear}`
    const { iso: fiveYearsFromNow, human: fiveYearsFromNowHuman } = getFiveYearsFromNow(now)

    const articlesText = `[User Input]\n${userInput}`
    const template = await getPromptTemplate('express-prediction')
    const prompt = fillPrompt(template, {
      userInput,
      articlesText,
      endOfYear,
      endOfYearHuman,
      fiveYearsFromNow,
      fiveYearsFromNowHuman,
      currentYear,
      currentDate: now.toISOString().split('T')[0],
      STANDARD_TAGS: STANDARD_TAGS.join(', '),
    })

    let prediction: ParsedPrediction
    try {
      const result = await llmService.generateContent({
        prompt,
        schema: expressPredictionSchema,
        temperature: 0.2,
      })
      prediction = JSON.parse(result.text)
      prediction.claimText = humanizeISODates(prediction.claimText)
      onProgress?.('prediction_formed', {
        message: 'Forecast drafted — finalising…',
        preview: {
          claim: prediction.claimText,
          resolveBy: prediction.resolveByDatetime,
          outcomeType: prediction.outcomeType,
          options: prediction.options || [],
        },
      })
    } catch (error) {
      log.error({ err: error }, 'Failed to generate source-free express prediction')
      throw error
    }

    const validOutcomeTypes = ['BINARY', 'MULTIPLE_CHOICE'] as const
    if (!validOutcomeTypes.includes(prediction.outcomeType as typeof validOutcomeTypes[number])) {
      prediction.outcomeType = 'BINARY'
      prediction.options = []
    }
    if (prediction.outcomeType === 'MULTIPLE_CHOICE') {
      prediction.options = (prediction.options || []).filter(o => o.trim())
      if (prediction.options.length < 2) {
        prediction.outcomeType = 'BINARY'
        prediction.options = []
      }
    } else {
      prediction.options = []
    }

    onProgress?.('finalizing', { message: 'Almost done — preparing your forecast for review…' })

    const localized = await localizeForecastForAuthor(
      { claimText: prediction.claimText, detailsText: prediction.detailsText, resolutionRules: prediction.resolutionRules, options: prediction.options },
      userInput,
    )
    const ungroundedYears = findUngroundedYears(
      prediction.claimText,
      prediction.resolveByDatetime,
      `${userInput}\n${articlesText}`,
      now,
    )
    return { ...prediction, newsAnchor: null, additionalLinks: [], externalMarketId: null, market: null, ungroundedYears, localized }
  }

  // Honor a source URL pasted anywhere in the input, not only when the entire
  // input is a bare URL. When the user supplies a link (even alongside their own
  // framing text), that link IS the forecast's news anchor by definition — we
  // never let a search-engine result silently replace it.
  const detectedUrl = extractFirstUrl(userInput)
  const marketProvider = detectedUrl ? getProviderForUrl(detectedUrl) : null

  let searchResults: SearchResult[]
  let primaryArticle: SearchResult | null = null
  let externalMarketId: string | null = null
  let market: LinkedMarketInfo | null = null
  let marketPriorLine: string | null = null

  if (detectedUrl && marketProvider) {
    // A Polymarket/Kalshi URL: the market itself (not its webpage) is the anchor —
    // link it and feed its live price into the prompt as an explicit prior,
    // alongside ordinary news search on the market's question (never in place of it).
    const url = detectedUrl
    const contextText = userInput.replace(url, '').trim()
    const providerLabel = PROVIDER_LABEL[marketProvider.id] ?? marketProvider.id
    onProgress?.('searching', { message: `Loading ${providerLabel} market...` })

    const resolved = await resolveMarketByUrl(url)
    if (resolved) {
      externalMarketId = resolved.id
      const probability = await getLatestMarketPrice(resolved.id)
      market = {
        provider: resolved.provider,
        providerLabel,
        question: resolved.question,
        url: resolved.url,
        probability,
      }
      if (probability !== null) {
        marketPriorLine = `${providerLabel} currently prices this at ${probability}% likely (YES).`
      }

      onProgress?.('searching', { message: `Finding news context for: "${resolved.question}"` })
      let related: SearchResult[]
      try {
        related = (await oracleSearch(resolved.question, DEFAULT_MAX_ARTICLES, undefined, meta)) ?? []
      } catch {
        related = []
      }
      searchResults = related.slice(0, DEFAULT_MAX_ARTICLES)
      // primaryArticle stays null — the market is the anchor, not a news article.
    } else {
      // Resolution failed (market closed/unlisted/API hiccup) — fall back to
      // treating it like any other pasted link, same as the non-market branch below.
      log.warn({ url }, 'Market URL detected but could not be resolved; treating as a plain link')
      const domain = extractDomainFromUrl(url)
      primaryArticle = { title: domain, url, snippet: contextText, source: domain }
      const relatedQuery = contextText ? await buildSearchQuery(contextText) : url
      let related: SearchResult[]
      try {
        related = (await oracleSearch(relatedQuery, DEFAULT_MAX_ARTICLES, undefined, meta)) ?? []
      } catch {
        related = []
      }
      related = related.filter(r => r.url !== url)
      searchResults = [primaryArticle, ...related.slice(0, 4)]
    }
  } else if (detectedUrl) {
    const url = detectedUrl
    // Whatever the user typed besides the URL is their own claim/framing text.
    const contextText = userInput.replace(url, '').trim()
    const domain = extractDomainFromUrl(url)
    onProgress?.('searching', { message: 'Fetching article content...' })

    let articleContent: string
    try {
      articleContent = await fetchUrlContent(url)
    } catch {
      log.warn({ url }, 'Failed to fetch URL content; keeping it as the anchor and searching for related articles')
      articleContent = ''
    }

    // Query used to find *related* articles (extra links/context) — never to pick
    // the anchor, which is always the user's URL.
    let relatedQuery: string

    if (articleContent) {
      // Extract topic from article content using LLM
      onProgress?.('searching', { message: 'Reading article and extracting topic...' })

      let topic: string
      try {
        const template = await getPromptTemplate('topic-extraction')
        const prompt = fillPrompt(template, { articleContent: articleContent.substring(0, 3000) })
        const extractResult = await llmService.generateContent({
          prompt,
          temperature: 0,
        })
        topic = extractResult.text.trim().replace(/^["']|["']$/g, '')
      } catch (error) {
        log.warn({ err: error }, 'Failed to extract topic from article, using URL as search')
        topic = contextText || url
      }

      log.info({ url, topic }, 'Extracted topic from URL')

      // Build primary article from fetched content.
      // Extract title: first meaningful line from content (before any long text)
      const titleMatch = articleContent.match(/^(.{10,120}?)(?:\s{2,}|\.\s)/)
      primaryArticle = {
        title: titleMatch ? titleMatch[1] : topic,
        url,
        snippet: articleContent.substring(0, 500),
        source: domain,
      }
      relatedQuery = topic
    } else {
      // Scrape failed (paywall, bot-protection, non-HTTPS, JS-only page). Still
      // honor the user's URL as the anchor — build it from the domain plus the
      // user's own text — so the link is never dropped for a search result.
      primaryArticle = {
        title: domain,
        url,
        snippet: contextText,
        source: domain,
      }
      relatedQuery = contextText ? await buildSearchQuery(contextText) : url
    }

    // Best-effort related articles for additional links / LLM context. Empty is
    // fine — the user's own article already anchors the forecast, so unlike the
    // text-only flow below we never throw NoArticlesFoundError here.
    onProgress?.('searching', { message: `Finding related articles for: "${relatedQuery}"` })
    let related: SearchResult[]
    try {
      related = (await oracleSearch(relatedQuery, DEFAULT_MAX_ARTICLES, undefined, meta)) ?? []
    } catch {
      related = []
    }

    // Remove the original URL from related results if it appeared, then prepend
    // the primary article so it is always index 0 / the anchor.
    related = related.filter(r => r.url !== url)
    searchResults = [primaryArticle, ...related.slice(0, 4)]
  } else {
    // Normal text flow: extract a focused query from the claim, then search.
    // Sentence-style claims retrieve poorly; key entities/topic do much better.
    const searchQuery = await buildSearchQuery(userInput)
    onProgress?.('searching', { message: 'Searching for relevant articles...' })
    searchResults = (await oracleSearch(searchQuery, DEFAULT_MAX_ARTICLES, undefined, meta)) ?? []

    if (searchResults.length === 0) {
      throw new NoArticlesFoundError({
        searchedFor: searchQuery,
        isUrl: false,
        isNonLatin: NON_LATIN.test(userInput),
      })
    }
  }

  // Build source summary like "CNN×2, Bloomberg, BBC"
  const sourceCounts = new Map<string, number>()
  for (const r of searchResults) {
    const name = r.source || 'Unknown'
    sourceCounts.set(name, (sourceCounts.get(name) || 0) + 1)
  }
  const sourceSummary = Array.from(sourceCounts.entries())
    .map(([name, count]) => count > 1 ? `${name}×${count}` : name)
    .join(', ')

  onProgress?.('found_articles', {
    count: searchResults.length,
    sources: sourceSummary,
    message: `Found ${searchResults.length} sources (${sourceSummary})`
  })

  // Step 2: Prepare articles for LLM
  const marketPriorBlock = marketPriorLine
    ? `[Market Prior]\n${marketPriorLine} Treat this as one signal among the sources below, not a substitute for reading them.\n\n`
    : ''

  const articlesText = marketPriorBlock + searchResults
    .map((article, i) => {
      // For the primary fetched article, include more content
      const snippet = (article === primaryArticle && article.snippet.length > 200)
        ? article.snippet
        : article.snippet
      return `
[Article ${i + 1}]
Title: ${article.title}
Source: ${article.source || 'Unknown'}
Published: ${article.publishedDate || 'Unknown'}
Snippet: ${snippet}
URL: ${article.url}
`
    })
    .join('\n')

  onProgress?.('analyzing', {
    message: `AI is reading ${searchResults.length} article${searchResults.length !== 1 ? 's' : ''} and drafting your forecast…`,
    articleCount: searchResults.length,
  })

  // Step 3: Generate prediction with LLM
  const now = new Date()
  const currentYear = now.getFullYear()
  const endOfYear = `${currentYear}-12-31T23:59:59Z`
  const endOfYearHuman = `December 31, ${currentYear}`
  const { iso: fiveYearsFromNow, human: fiveYearsFromNowHuman } = getFiveYearsFromNow(now)

  const template = await getPromptTemplate('express-prediction')
  const prompt = fillPrompt(template, {
    userInput,
    articlesText,
    endOfYear,
    endOfYearHuman,
    fiveYearsFromNow,
    fiveYearsFromNowHuman,
    currentYear,
    currentDate: now.toISOString().split('T')[0],
    STANDARD_TAGS: STANDARD_TAGS.join(', '),
  })

  let prediction: ParsedPrediction
  try {
    const result = await llmService.generateContent({
      prompt,
      schema: expressPredictionSchema,
      temperature: 0.2, // Slightly creative but structured
    })
    prediction = JSON.parse(result.text)

    // Post-process: replace any ISO timestamps that leaked into claimText
    prediction.claimText = humanizeISODates(prediction.claimText)
  } catch (error) {
    log.error({ err: error }, 'Failed to generate express prediction')
    throw error
  }

  // Normalize outcomeType — fall back to BINARY for unrecognized values
  const validOutcomeTypes = ['BINARY', 'MULTIPLE_CHOICE'] as const
  if (!validOutcomeTypes.includes(prediction.outcomeType as typeof validOutcomeTypes[number])) {
    prediction.outcomeType = 'BINARY'
    prediction.options = []
  }

  // Ensure MULTIPLE_CHOICE has at least 2 options, otherwise fall back to BINARY
  if (prediction.outcomeType === 'MULTIPLE_CHOICE') {
    prediction.options = (prediction.options || []).filter(o => o.trim())
    if (prediction.options.length < 2) {
      prediction.outcomeType = 'BINARY'
      prediction.options = []
    }
  } else {
    prediction.options = []
  }

  onProgress?.('prediction_formed', {
    message: 'Forecast drafted — attaching sources…',
    preview: {
      claim: prediction.claimText,
      resolveBy: prediction.resolveByDatetime,
      outcomeType: prediction.outcomeType,
      options: prediction.options,
    }
  })

  // Step 4: Relevance gate — only keep articles the model judged on-topic for the
  // claim, so an irrelevant top search result never gets bound as the news anchor.
  // An absent judgment means "no opinion" → trust retrieval order (prior behavior);
  // an explicit empty list means "none are relevant" → create the forecast source-free.
  const hasRelevanceJudgment = Array.isArray(prediction.relevantArticleIndices)
  const relevantIdx = new Set(
    (prediction.relevantArticleIndices ?? [])
      .map(i => i - 1) // 1-based ([Article N]) → 0-based
      .filter(i => i >= 0 && i < searchResults.length),
  )

  let anchorArticle: SearchResult | null
  let linkPool: SearchResult[]
  if (primaryArticle) {
    // URL flow: the user's own article is the anchor by definition.
    anchorArticle = primaryArticle
    linkPool = searchResults.filter(
      (a, i) => a !== primaryArticle && (!hasRelevanceJudgment || relevantIdx.has(i)),
    )
  } else if (market) {
    // Market flow: the linked market is the anchor (surfaced via `market`, not
    // `newsAnchor`) — every search result is supporting context, never the anchor.
    anchorArticle = null
    linkPool = searchResults.filter((_, i) => !hasRelevanceJudgment || relevantIdx.has(i))
  } else if (!hasRelevanceJudgment) {
    // No judgment available — fall back to prior behavior (most relevant = first result).
    anchorArticle = searchResults[0] ?? null
    linkPool = searchResults.slice(1)
  } else {
    const relevantArticles = searchResults.filter((_, i) => relevantIdx.has(i))
    anchorArticle = relevantArticles[0] ?? null
    linkPool = relevantArticles.slice(1)
    if (anchorArticle === null) {
      log.info(
        { searchResultCount: searchResults.length },
        'express: no relevant articles — creating forecast source-free (no anchor)',
      )
      // The draft summary was written from articles we just judged irrelevant; it
      // tends to be a meta "the articles don't contain info" sentence. Drop it
      // deterministically rather than ship a description that contradicts the
      // (now null) news anchor — the claim stands on its own.
      prediction.detailsText = ''
    }
  }

  // Step 5: Prepare additional links (relevant articles only)
  const additionalLinks = linkPool.slice(0, 3).map(article => ({
    url: article.url,
    title: article.title
  }))

  onProgress?.('finalizing', { message: 'Almost done — preparing your forecast for review…' })

  const localized = await localizeForecastForAuthor(
    { claimText: prediction.claimText, detailsText: prediction.detailsText, resolutionRules: prediction.resolutionRules, options: prediction.options },
    userInput,
  )

  return {
    ...prediction,
    newsAnchor: anchorArticle
      ? {
        url: anchorArticle.url,
        urlHash: hashUrl(anchorArticle.url),
        title: anchorArticle.title,
        snippet: anchorArticle.snippet,
        source: anchorArticle.source,
        publishedAt: anchorArticle.publishedDate ? new Date(anchorArticle.publishedDate) : undefined
      }
      : null,
    additionalLinks,
    externalMarketId,
    market,
    ungroundedYears: findUngroundedYears(
      prediction.claimText,
      prediction.resolveByDatetime,
      `${userInput}\n${articlesText}`,
      now,
    ),
    localized,
  }
}

/**
 * Specifically guess the chances of a prediction based on provided sources.
 *
 * `probability` is null when the model judges the claim too vague to estimate
 * (#1657) — the same abstain contract both panel prompts already offer. A forced
 * number on an unanswerable claim is noise presented to a drafter as a suggestion;
 * `reasoning` then says what is missing, which is the more useful answer.
 */
export async function guessChances(
  claimText: string,
  detailsText: string,
  articles: Array<{ title: string; source: string; snippet: string }>,
  marketProbability?: number | null,
): Promise<{ probability: number | null; reasoning: string }> {
  // Explicit prior alongside the articles, never in place of them — same
  // "one signal among the sources" framing generateExpressPrediction uses.
  const marketPriorBlock = marketProbability != null
    ? `[Market Prior]\nA linked prediction market currently prices this at ${marketProbability}% likely (YES). Treat this as one signal among the sources below, not a substitute for reading them.\n\n`
    : ''

  const articlesText = marketPriorBlock + articles
    .map((article, i) => `
[Article ${i + 1}]
Title: ${article.title}
Source: ${article.source}
Snippet: ${article.snippet}
`).join('\n')

  const template = await getPromptTemplate('guess-chances')
  const prompt = fillPrompt(template, {
    claimText,
    detailsText,
    articlesText,
  })

  try {
    const result = await llmService.generateContent({
      prompt,
      schema: guessChancesSchema,
      temperature: 0,
    })
    return JSON.parse(result.text)
  } catch (error) {
    log.error({ err: error }, 'Failed to guess chances')
    throw error
  }
}

/**
 * Extract the first http(s) URL appearing anywhere in a string, or null.
 * Lets a source link pasted alongside free text ("<claim> https://site/article")
 * still be honored as the forecast's news anchor. Trailing sentence punctuation
 * and closing brackets/quotes that commonly abut a URL in prose are trimmed.
 */
export function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s<>"'`)\]}]+/i)
  if (!match) return null
  return match[0].replace(/[.,;:!?]+$/, '')
}

export function extractDomainFromUrl(url: string): string {
  try {
    const domain = new URL(url).hostname
    return domain.replace('www.', '')
  } catch {
    return 'Unknown'
  }
}

/**
 * Replace ISO 8601 timestamps (e.g. "2026-12-31T23:59:59Z") in a string
 * with a human-readable format like "December 31, 2026".
 * Uses the date portion of the ISO string directly to avoid timezone shifts.
 */
export function humanizeISODates(text: string): string {
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  // Matches ISO 8601 date-time strings like 2026-12-31T23:59:59Z or 2026-12-31T23:59:59.000Z
  return text.replace(
    /(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g,
    (_match, year: string, month: string, day: string) => {
      const monthIndex = parseInt(month, 10) - 1
      if (monthIndex < 0 || monthIndex > 11) return _match
      return `${MONTHS[monthIndex]} ${parseInt(day, 10)}, ${year}`
    }
  )
}
