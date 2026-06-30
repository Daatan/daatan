import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { apiError, handleRouteError } from '@/lib/api-error'
import { withAuth, type RouteContext } from '@/lib/api-middleware'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { llmService } from '@/lib/llm'
import { oracleSearch, type SearchResult } from '@/lib/services/oracleSearch'
import { guessChances } from '@/lib/llm/expressPrediction'
import { buildSearchQuery } from '@/lib/llm/searchQuery'
import { getOracleForecast, recordOracleFallback, DEFAULT_MAX_ARTICLES } from '@/lib/services/oracle'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import { enrichOracleSources } from '@/lib/services/oracle-snapshot'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { aiResearchEnabled } from '@/lib/capabilities'
import {
  getContextTimeline,
  getForecastForContextUpdate,
  countUserContextUpdates,
  saveContextUpdate,
  listContextSnapshots,
} from '@/lib/services/context'

const log = createLogger('forecast-context')

/** Per-forecast cooldown between context updates (hours). */
const CONTEXT_UPDATE_COOLDOWN_HOURS = 1

export const dynamic = 'force-dynamic'

/** Raw Next.js 15 context where params is a Promise. Used for direct exports. */
type RawRouteContext = {
    params: Promise<{ id: string }>
}

// GET — public endpoint returning context timeline (direct export, must use Promise params)
export async function GET(request: NextRequest, { params }: RawRouteContext) {
    try {
        const { id } = await params
        const prediction = await getContextTimeline(id)

        if (!prediction) {
            return apiError('Prediction not found', 404)
        }

        return NextResponse.json({
            currentContext: prediction.detailsText,
            contextUpdatedAt: prediction.contextUpdatedAt,
            snapshots: prediction.contextSnapshots,
        })
    } catch (error) {
        return handleRouteError(error, 'Failed to fetch context timeline')
    }
}

// POST — protected endpoint (wrapped by withAuth, params already awaited)
export const POST = withAuth(async (request: NextRequest, user, { params }: RouteContext) => {
    try {
        // Context analysis needs web search + Oracle + LLM — gated on aiResearch
        // (an LLM-only self-host hides this). Read-only GET timeline stays available.
        if (!aiResearchEnabled()) {
            return apiError('AI features are not enabled on this instance', 404)
        }

        const { id } = params
        const prediction = await getForecastForContextUpdate(id)

        if (!prediction) {
            return apiError('Prediction not found', 404)
        }

        // Any logged-in user can trigger a context analysis

        if (prediction.status !== 'ACTIVE') {
            return apiError('Context can only be updated for active predictions', 400)
        }

        // Rate Limiting: per-forecast cooldown
        if (prediction.contextUpdatedAt) {
            const now = new Date()
            const timeDiffHours = (now.getTime() - new Date(prediction.contextUpdatedAt).getTime()) / (1000 * 60 * 60)
            if (timeDiffHours < CONTEXT_UPDATE_COOLDOWN_HOURS) {
                const label = CONTEXT_UPDATE_COOLDOWN_HOURS === 1
                    ? 'an hour'
                    : `${CONTEXT_UPDATE_COOLDOWN_HOURS} hours`
                return apiError(`Context was updated recently. Please wait ${label} between updates.`, 429)
            }
        }

        // Rate Limiting: max 10 context updates per user per day across all forecasts
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const dailyUserCount = await countUserContextUpdates(user.id, cutoff)
        if (dailyUserCount >= 10) {
            return apiError('Daily context update limit reached (10 per day). Please try again tomorrow.', 429)
        }

        // 1. Search for recent articles.
        // Use the forecast's own claim as the search basis; the newsAnchor is the article
        // that triggered the forecast, not the topic itself — using its title returns wrong results.
        // buildSearchQuery extracts focused keywords from the claim (sentence-style claims
        // retrieve poorly) and strips any leading emoji, with a timeout fallback to the claim.
        const rawQuery = prediction.claimText || prediction.newsAnchor?.title || ''
        const searchQuery = await buildSearchQuery(rawQuery)
        let searchResults: SearchResult[]
        const t0 = Date.now()
        try {
            searchResults = (await oracleSearch(searchQuery, DEFAULT_MAX_ARTICLES, undefined, { source: 'context-update', userId: user.id, predictionId: prediction.id })) ?? []
        } catch (err) {
            log.warn(
                { predictionId: prediction.id, searchQuery, err },
                'context.search_failed',
            )
            return apiError('No recent articles found for this forecast. Try again later.', 503)
        }
        const searchMs = Date.now() - t0

        log.info(
            {
                predictionId: prediction.id,
                searchQuery,
                resultCount: searchResults.length,
                resultDomains: searchResults.map((r) => {
                    try { return new URL(r.url).hostname } catch { return r.url }
                }),
            },
            'context.search_done',
        )

        if (searchResults.length === 0) {
            return apiError('No recent articles found for this forecast. Try again later.', 503)
        }

        // Build sources array
        const sources = searchResults.map((article: SearchResult) => ({
            title: article.title,
            url: article.url,
            source: article.source || null,
            publishedDate: article.publishedDate || null,
        }))

        const articlesText = searchResults
            .map((article: SearchResult, i: number) => {
                return `[Article ${i + 1}]\nTitle: ${article.title}\nSource: ${article.source || 'Unknown'}\nPublished: ${article.publishedDate || 'Unknown'}\nSnippet: ${article.snippet}\n`
            })
            .join('\n')

        // 2. Query LLM to summarize new context
        const currentYear = new Date().getFullYear()
        const template = await getPromptTemplate('update-context')
        const changeInstruction = prediction.detailsText
            ? `\nPrevious context summary:\n"${prediction.detailsText}"\n\nFocus on what has CHANGED since the previous summary. Highlight new developments.\n`
            : ''
        const prompt = fillPrompt(template, {
            claimText: prediction.claimText,
            articlesText,
            currentYear,
            changeInstruction,
        })

        // 3. AI probability + LLM summary — run concurrently (both need only searchResults)
        // llmMs and oracleMs are both measured from t1 (same start), not sequentially.
        const t1 = Date.now()
        const ESTIMATION_TIMEOUT_MS = 15_000

        type EstimationResult = {
            externalProbability: number | null
            externalReasoning: string | null
            predictionCiLow: number | null
            predictionCiHigh: number | null
            oracleSnapshotData: Prisma.InputJsonValue | null
            insufficientData?: boolean
        }

        // Oracle estimation starts immediately; LLM runs concurrently below
        const estimationWork: Promise<EstimationResult> = (async () => {
            const { forecast: oracleForecast, logId: oracleLogId, insufficientData } = await getOracleForecast(prediction.claimText, {
                articles: searchResults.map(r => ({
                    url: r.url,
                    title: r.title,
                    snippet: r.snippet,
                    source: r.source,
                    publishedDate: r.publishedDate,
                })),
            }, { source: 'context-update', userId: user.id, predictionId: prediction.id })
            // The Oracle abstained — the evidence doesn't bear on the claim. Record
            // the abstention and do NOT fall back to an LLM guess, which would just
            // re-introduce an ungrounded number from the same off-topic articles.
            if (insufficientData) {
                log.info(
                    { predictionId: prediction.id, path: 'abstain' },
                    'context.ai_estimate',
                )
                return {
                    externalProbability: null,
                    externalReasoning: 'Insufficient evidence — recent coverage does not bear on this claim',
                    predictionCiLow: null,
                    predictionCiHigh: null,
                    oracleSnapshotData: null,
                    insufficientData: true,
                }
            }
            if (oracleForecast !== null) {
                const toPercent = (v: number) => Math.round(((v + 1) / 2) * 100)
                const prob = toPercent(oracleForecast.mean)
                const ciLow = toPercent(oracleForecast.ci_low)
                const ciHigh = toPercent(oracleForecast.ci_high)
                // Attach authors to the Oracle's sources (it omits them); best-effort,
                // never blocks the estimate. Title/date come from the input articles below.
                const articleMeta = await getArticleMetaByUrl(oracleForecast.sources.map(s => s.url))
                const authorByUrl = new Map(
                    [...articleMeta.entries()].map(([url, m]) => [url, m.author]),
                )
                log.info(
                    {
                        predictionId: prediction.id,
                        path: 'oracle',
                        probability: prob,
                        articlesUsed: oracleForecast.articles_used,
                        sourceCount: oracleForecast.sources.length,
                    },
                    'context.ai_estimate',
                )
                return {
                    externalProbability: prob,
                    externalReasoning: 'TruthMachine Oracle (calibrated multi-source estimate)',
                    predictionCiLow: ciLow,
                    predictionCiHigh: ciHigh,
                    oracleSnapshotData: {
                        mean: oracleForecast.mean,
                        std: oracleForecast.std,
                        ciLow,
                        ciHigh,
                        articlesUsed: oracleForecast.articles_used,
                        sources: enrichOracleSources(oracleForecast.sources, searchResults, authorByUrl),
                    },
                }
            }

            const articlesMapped = searchResults.map((r: SearchResult) => ({
                title: r.title,
                source: r.source || 'Unknown',
                snippet: r.snippet,
            }))
            try {
                const chances = await guessChances(
                    prediction.claimText,
                    prediction.detailsText ?? '',
                    articlesMapped
                )
                void recordOracleFallback(oracleLogId, chances.probability)
                log.info(
                    {
                        predictionId: prediction.id,
                        path: 'llm_fallback',
                        probability: chances.probability,
                        reason: 'oracle_returned_null',
                    },
                    'context.ai_estimate',
                )
                return {
                    externalProbability: chances.probability,
                    externalReasoning: chances.reasoning,
                    predictionCiLow: null,
                    predictionCiHigh: null,
                    oracleSnapshotData: null,
                }
            } catch (err) {
                log.warn(
                    { predictionId: prediction.id, err, path: 'llm_fallback' },
                    'context.ai_estimate_failed',
                )
                return {
                    externalProbability: null,
                    externalReasoning: null,
                    predictionCiLow: null,
                    predictionCiHigh: null,
                    oracleSnapshotData: null,
                }
            }
        })()

        const estimationRace = Promise.race([
            estimationWork,
            new Promise<null>(resolve => setTimeout(() => resolve(null), ESTIMATION_TIMEOUT_MS)),
        ])

        // Stream the response so the client sees the summary as soon as the LLM
        // finishes, without waiting for the oracle to complete. X-Accel-Buffering: no
        // disables nginx proxy buffering for this response so events arrive in real-time.
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
            async start(controller) {
                const send = (obj: object) =>
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
                try {
                    // LLM runs concurrently with oracle (estimationRace already started above)
                    const result = await llmService.generateContent({ prompt, temperature: 0.2 })
                    const newContextSummary = result.text.trim()
                    const llmMs = Date.now() - t1
                    const now = new Date()

                    // Push summary to client immediately — oracle may still be running
                    send({ type: 'summary', newContext: newContextSummary, contextUpdatedAt: now })

                    // Await oracle (partially or fully done since it ran concurrently)
                    const estimationResult = await estimationRace
                    // Both llmMs and oracleMs measured from t1 (concurrent, not sequential)
                    const oracleMs = Date.now() - t1

                    let externalProbability: number | null = null
                    let externalReasoning: string | null = null
                    let predictionCiLow: number | null = null
                    let predictionCiHigh: number | null = null
                    let oracleSnapshotData: Prisma.InputJsonValue | null = null
                    let insufficientData = false

                    if (estimationResult === null) {
                        log.warn(
                            { predictionId: prediction.id, timeoutMs: ESTIMATION_TIMEOUT_MS },
                            'context.ai_estimate_timeout',
                        )
                    } else {
                        externalProbability = estimationResult.externalProbability
                        externalReasoning = estimationResult.externalReasoning
                        predictionCiLow = estimationResult.predictionCiLow
                        predictionCiHigh = estimationResult.predictionCiHigh
                        oracleSnapshotData = estimationResult.oracleSnapshotData
                        insufficientData = estimationResult.insufficientData ?? false
                    }

                    const totalMs = Date.now() - t0

                    log.info(
                        { predictionId: prediction.id, searchMs, llmMs, oracleMs, totalMs },
                        'context.timings',
                    )
                    prisma.contextTiming.create({ data: { searchMs, llmMs, oracleMs, totalMs } }).catch(() => {})

                    // 4. Persist snapshot + update prediction
                    const snapshot = await saveContextUpdate({
                        predictionId: prediction.id,
                        summary: newContextSummary,
                        sources,
                        externalProbability,
                        externalReasoning,
                        oracleSnapshot: oracleSnapshotData,
                        confidence: externalProbability,
                        aiCiLow: predictionCiLow,
                        aiCiHigh: predictionCiHigh,
                        insufficientData,
                        now,
                    })

                    const snapshots = await listContextSnapshots(prediction.id)

                    send({
                        type: 'done',
                        success: true,
                        snapshot,
                        timeline: snapshots,
                        timings: { searchMs, llmMs, oracleMs, totalMs },
                    })
                } catch (err) {
                    log.error({ predictionId: prediction.id, err }, 'context.stream_error')
                    send({ type: 'error', message: 'Analysis failed. Please try again.' })
                } finally {
                    controller.close()
                }
            },
        })

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            },
        })

    } catch (error) {
        return handleRouteError(error, 'Failed to update prediction context')
    }
})
