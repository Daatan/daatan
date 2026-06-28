import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getForecastForResearch } from '@/lib/services/forecast'
import { oracleSearch, type SearchResult } from '@/lib/services/oracleSearch'
import { searchArticlesMultilingual } from '@/lib/utils/multilingualSearch'
import { llmService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { queryGenerationSchema, researchSchema } from '@/lib/llm/schemas'
import { extractKeyTerms, dedup, hasRelevantResults } from './helpers'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { aiFeaturesEnabled } from '@/lib/capabilities'

const RESEARCH_LIMIT = 10
const RESEARCH_WINDOW = 60 * 60_000 // 1 hour

export const POST = withAuth(async (request: NextRequest, user, { params }) => {
    if (!aiFeaturesEnabled()) {
        return apiError('AI features are not enabled on this instance', 404)
    }

    const rl = checkRateLimit(`research:${user.id}`, RESEARCH_LIMIT, RESEARCH_WINDOW)
    if (!rl.allowed) return rateLimitResponse(rl.resetAt)
    try {
        const routeStart = Date.now()
        const prediction = await getForecastForResearch(params.id)

        if (!prediction) return apiError('Prediction not found', 404)

        const forecastStart = prediction.publishedAt || prediction.createdAt
        const forecastEnd = prediction.resolveByDatetime
        const now = new Date()
        const searchDateTo = forecastEnd < now ? forecastEnd : now
        const forecastStartStr = forecastStart.toISOString().split('T')[0]
        const forecastEndStr = forecastEnd.toISOString().split('T')[0]

        // Build a simplified query by stripping stopwords so we get tighter matches
        // even when the raw claim text uses future-tense phrasing that news won't use.
        const simplifiedQuery = extractKeyTerms(prediction.claimText, forecastEnd)

        const searchStart = Date.now()

        // 1. Try oracle first (shares provider fallback chain + quota with oracle forecasts).
        //    If oracle returns ≥ 3 results, skip the 3-way local parallel search.
        const oracleResults = await oracleSearch(prediction.claimText, 12, {
            dateFrom: forecastStart,
            dateTo: searchDateTo,
        }, { source: 'research', userId: user.id, predictionId: prediction.id })

        let results: SearchResult[]
        if (oracleResults && oracleResults.length >= 3) {
            results = oracleResults
        } else {
            // Fallback: three parallel local searches
            //    a) Date-scoped with raw claim text
            //    b) Broad (no date) with raw claim text — catches older or wider coverage
            //    c) Date-scoped with simplified key-term query — targets the actual topic
            const researchMeta = { source: 'research' as const, userId: user.id }
            const [dated, broad, simplified] = await Promise.all([
                searchArticlesMultilingual(prediction.claimText, 6, { dateFrom: forecastStart, dateTo: searchDateTo }, researchMeta)
                    .catch(() => [] as SearchResult[]),
                searchArticlesMultilingual(prediction.claimText, 4, undefined, researchMeta)
                    .catch(() => [] as SearchResult[]),
                searchArticlesMultilingual(simplifiedQuery, 6, { dateFrom: forecastStart, dateTo: searchDateTo }, researchMeta)
                    .catch(() => [] as SearchResult[]),
            ])
            results = dedup([...simplified, ...dated, ...broad])
        }

        results = results.slice(0, 12)

        // Extract meaningful nouns from the claim to check result relevance
        const claimNouns = prediction.claimText
            .split(/\s+/)
            .filter(w => w.length > 4 && /^[A-Z]/.test(w))   // rough heuristic: capitalised words
            .map(w => w.replace(/[^\w]/g, ''))

        // 2. Fallback: if results are few OR none mention the claim's key entities,
        //    ask the LLM to generate better-targeted search queries.
        const needsFallback = results.length < 3 || !hasRelevantResults(results, claimNouns)
        if (needsFallback) {
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
                const fallbackResults = await Promise.all(
                    queries.slice(0, 3).map(q =>
                        searchArticlesMultilingual(q, 5, { dateFrom: forecastStart, dateTo: searchDateTo }, { source: 'research', userId: user.id })
                            .catch(() => [] as SearchResult[])
                    )
                )
                results = dedup([...results, ...fallbackResults.flat()]).slice(0, 12)
            } catch {
                // fallback search failed — continue with what we have
            }
        }

        const context = results.length > 0
            ? results.map(r =>
                `Title: ${r.title}\nSource: ${r.source}${r.publishedDate ? ` (${r.publishedDate})` : ''}\nSnippet: ${r.snippet}\nURL: ${r.url}`
              ).join('\n\n')
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
            context: context
                ? `News Context (${results.length} articles found for the forecast period):\n${context}`
                : 'Note: Automated news search returned no results. Rely on your training knowledge for the forecast period.'
        })

        const response = await llmService.generateContent({
            prompt,
            schema: researchSchema,
            temperature: 0
        })

        const llmMs = Date.now() - llmStart
        const findings = JSON.parse(response.text)
        return NextResponse.json({ ...findings, timings: { searchMs, llmMs, totalMs: Date.now() - routeStart } })
    } catch (err) {
        return handleRouteError(err, 'Failed to perform AI research')
    }
}, { roles: ['RESOLVER', 'ADMIN'] })
