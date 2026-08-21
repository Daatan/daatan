import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError, handleRouteError } from '@/lib/api-error'
import { getForecastForResearch } from '@/lib/services/forecast'
import { getPoolArticlesForResearch } from '@/lib/services/evidence-pool'
import { oracleSearch, type SearchResult } from '@/lib/services/oracleSearch'
import { searchArticlesMultilingual } from '@/lib/utils/multilingualSearch'
import { llmService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { queryGenerationSchema, researchSchema } from '@/lib/llm/schemas'
import { extractKeyTerms, dedup, composeResearchResults } from './helpers'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { aiResearchEnabled } from '@/lib/capabilities'

const RESEARCH_LIMIT = 10
const RESEARCH_WINDOW = 60 * 60_000 // 1 hour
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

export const POST = withAuth(async (request: NextRequest, user, { params }) => {
    if (!aiResearchEnabled()) {
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
        }, { source: 'research', userId: user.id, predictionId: prediction.id })

        let results: SearchResult[]
        if (oracleResults && oracleResults.length >= 3) {
            results = oracleResults
        } else {
            // Fallback: three parallel local searches
            //    a) Deadline-capped with raw claim text
            //    b) Broad (no date) with raw claim text — catches older or wider coverage
            //    c) Deadline-capped with simplified key-term query — targets the actual topic
            const researchMeta = { source: 'research' as const, userId: user.id }
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
            const targetedMeta = { source: 'research' as const, userId: user.id }
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

        // The Oracle's own evidence pool: stance-scored evidence extracted for
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
        const findings = JSON.parse(response.text)
        return NextResponse.json({ ...findings, timings: { searchMs, llmMs, totalMs: Date.now() - routeStart } })
    } catch (err) {
        return handleRouteError(err, 'Failed to perform AI research')
    }
}, { roles: ['RESOLVER', 'ADMIN'] })
