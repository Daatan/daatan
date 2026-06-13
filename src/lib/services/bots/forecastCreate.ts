/**
 * News-anchored forecast creation: dedup against existing forecasts, generate
 * from a hot topic, run the deterministic date check + LLM quality gate, apply
 * rejection tracking, then create + stake via createAndStake.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { createBotLLMService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { slugify, generateUniqueSlug } from '@/lib/utils/slugify'
import { forecastBatchSchema } from '@/lib/llm/schemas'
import {
  type BotWithUser,
  log,
  callLLMWithTimeout,
  logBotAction,
  MIN_RESOLVE_DAYS,
  MAX_RESOLVE_DAYS,
} from './shared'
import { isLocalDuplicate } from './dedup'
import { createAndStake } from './stake'

export async function processTopic(
  bot: BotWithUser,
  topicTitle: string,
  sourceUrls: string[],
  llm: ReturnType<typeof createBotLLMService>,
  dryRun: boolean,
  existingTitles: string[],
): Promise<'created' | 'skipped' | 'error'> {
  try {
    // Local pre-dedup: a confident keyword-overlap match skips the LLM dedup
    // round-trip entirely. Borderline cases fall through to the LLM check below.
    if (isLocalDuplicate(topicTitle, existingTitles)) {
      log.info({ botId: bot.id, topic: topicTitle }, 'Topic already covered (local dedup), skipping')
      await logBotAction(bot.id, 'SKIPPED', { title: topicTitle, urls: sourceUrls }, null, 'topic already covered (local dedup)', dryRun)
      return 'skipped'
    }

    // Dedup check: use cached existing titles to avoid N+1 query
    const dedupTemplate = await getPromptTemplate('dedupe-check')
    const dedupPrompt = fillPrompt(dedupTemplate, {
      topicTitle,
      existingTitles: existingTitles.join('\n- '),
    })

    let dedupResult
    try {
      dedupResult = await callLLMWithTimeout(llm, { prompt: dedupPrompt, temperature: 0 })
    } catch (dedupErr) {
      const isTimeout = dedupErr instanceof Error && dedupErr.message.includes('timeout')
      log.warn(
        { botId: bot.id, topic: topicTitle, err: dedupErr, errorType: isTimeout ? 'timeout' : 'unknown' },
        'Dedup check failed, treating as unique topic (fail-open strategy)',
      )
      // Treat timeout/failure as "not duplicate" to allow forecast creation (fail open)
      dedupResult = { text: 'no' }
    }

    const alreadyExists = dedupResult.text.trim().toLowerCase().startsWith('yes')

    if (alreadyExists) {
      log.info({ botId: bot.id, topic: topicTitle }, 'Topic already covered, skipping')
      await logBotAction(bot.id, 'SKIPPED', { title: topicTitle, urls: sourceUrls }, null, 'topic already covered (dedup)', dryRun)
      return 'skipped'
    }

    // Build tag constraint for prompt injection when tagFilter is set.
    // Sanitize each tag to slug-safe chars only to prevent prompt injection.
    const tagFilter = bot.tagFilter as string[]
    const safeTags = tagFilter.map(t => t.replace(/[^a-z0-9_-]/g, '').trim()).filter(Boolean)
    const tagConstraint =
      safeTags.length > 0
        ? `\nConstraint: assign one of these tag slugs to this forecast: ${safeTags.join(', ')}. If the news topic does not fit any of these tags, set "skip": true in the JSON.`
        : `\nIf this news topic does not match your area of expertise or persona, set "skip": true in the JSON instead of generating a forecast.`

    // Generate a forecast from this topic
    const now = new Date()
    const forecastTemplate = await getPromptTemplate('bot-forecast-generation')
    const forecastPrompt = fillPrompt(forecastTemplate, {
      personaPrompt: bot.personaPrompt,
      forecastPrompt: bot.forecastPrompt,
      topicTitle,
      sourceUrls: sourceUrls.slice(0, 3).join(', '),
      todayDate: now.toISOString().split('T')[0],
      tagConstraint,
    })

    let response
    try {
      response = await callLLMWithTimeout(llm, { prompt: forecastPrompt, temperature: 0.7, schema: forecastBatchSchema })
    } catch (genErr) {
      const isTimeout = genErr instanceof Error && genErr.message.includes('timeout')
      log.error(
        { botId: bot.id, topic: topicTitle, err: genErr, errorType: isTimeout ? 'timeout' : 'other' },
        `Forecast generation failed (core operation - cannot proceed): ${isTimeout ? 'timeout' : 'error'}`,
      )
      await logBotAction(bot.id, 'ERROR', { title: topicTitle, reason: isTimeout ? 'generation_timeout' : 'generation_error' }, null, String(genErr), dryRun)
      return 'error'
    }

    // Check for skip signal before full parse (LLM can set skip:true when topic is out of scope)
    const rawText = response.text.trim()
    if (rawText.includes('"skip"') && rawText.includes('true')) {
      try {
        const skipCheck = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] ?? rawText)
        if (skipCheck?.skip === true) {
          log.info({ botId: bot.id, topic: topicTitle, tagFilter }, 'Topic out of scope, skipping')
          await logBotAction(bot.id, 'SKIPPED', { title: topicTitle, urls: sourceUrls }, null, `topic out of scope for tag filter '${tagFilter}'`, dryRun)
          return 'skipped'
        }
      } catch {
        // not a skip signal, continue to full parse
      }
    }

    let forecast: {
      claimText: string
      detailsText?: string
      outcomeType: string
      resolveByDatetime: string
      resolutionRules?: string
      tags?: string[]
    }

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      const raw = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)
      // Sanitize tags at the LLM boundary — nulls in arrays crash slugify downstream
      forecast = {
        ...raw,
        tags: (raw.tags ?? []).filter((t: unknown): t is string => typeof t === 'string' && t.length > 0),
      }
    } catch (err) {
      log.warn({ botId: bot.id, topic: topicTitle, err, raw: response.text }, 'Failed to parse LLM forecast JSON')
      await logBotAction(bot.id, 'ERROR', { title: topicTitle, reason: 'JSON parse failed', raw: response.text }, null, 'JSON parse failed', dryRun)
      return 'error'
    }

    // Validate minimum content
    if (!forecast.claimText || forecast.claimText.length < 10) {
      await logBotAction(bot.id, 'ERROR', { title: topicTitle }, null, 'Invalid claimText', dryRun)
      return 'error'
    }

    // Ensure 🤖 prefix
    if (!forecast.claimText.startsWith('🤖')) {
      forecast.claimText = `🤖 ${forecast.claimText}`
    }

    // ── Deterministic resolveByDatetime check (done in code, not LLM) ───
    // Catches LLM-generated dates outside our acceptable window before we
    // burn another LLM call on the quality gate.
    const resolveByCheck = new Date(forecast.resolveByDatetime)
    if (!isNaN(resolveByCheck.getTime())) {
      const days = (resolveByCheck.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      if (days < MIN_RESOLVE_DAYS || days > MAX_RESOLVE_DAYS) {
        const reason = `resolveByDatetime ${forecast.resolveByDatetime} is ${days.toFixed(0)} days out (need ${MIN_RESOLVE_DAYS}-${MAX_RESOLVE_DAYS})`
        log.info({ botId: bot.id, topic: topicTitle, reason }, 'Forecast date out of range')
        await logBotAction(bot.id, 'SKIPPED', { title: topicTitle, urls: sourceUrls, dateOutOfRange: true, daysOut: Math.round(days) }, null, reason, dryRun)
        return 'skipped'
      }
    }

    // ── Quality gate ─────────────────────────────────────────────────────
    // Ask LLM to validate forecast quality before saving
    const qualityTemplate = await getPromptTemplate('forecast-quality-validation')
    const qualityPrompt = fillPrompt(qualityTemplate, {
      claimText: forecast.claimText,
      detailsText: forecast.detailsText || 'None',
      resolveByDatetime: forecast.resolveByDatetime,
      resolutionRules: forecast.resolutionRules || 'None',
      topicTitle,
    })

    try {
      let qualityResult
      try {
        qualityResult = await callLLMWithTimeout(llm, { prompt: qualityPrompt, temperature: 0 })
      } catch (qualityTimeoutErr) {
        const isTimeout = qualityTimeoutErr instanceof Error && qualityTimeoutErr.message.includes('timeout')
        log.warn(
          { botId: bot.id, topic: topicTitle, err: qualityTimeoutErr, errorType: isTimeout ? 'timeout' : 'other' },
          'Quality gate failed, allowing forecast through (fail-open strategy)',
        )
        // On any failure: allow forecast through (fail open, lower priority check)
        qualityResult = { text: '{"pass": true}' }
      }

      const qText = qualityResult.text.trim()
      const qMatch = qText.match(/\{[\s\S]*\}/)
      const qualityCheck = JSON.parse(qMatch ? qMatch[0] : qText)

      if (!qualityCheck.pass) {
        const reason = qualityCheck.reason || 'quality gate failed'
        log.info({ botId: bot.id, topic: topicTitle, reason }, 'Forecast failed quality gate')
        await logBotAction(bot.id, 'SKIPPED', { title: topicTitle, urls: sourceUrls, qualityReason: reason }, null, reason, dryRun)
        return 'skipped'
      }
    } catch (parseErr) {
      log.warn({ botId: bot.id, topic: topicTitle, err: parseErr, errorType: 'parse' }, 'Quality gate response unparseable, allowing forecast (fail-open)')
      // On parse failure, allow the forecast through (fail open) to avoid blocking all forecasts
    }

    const generatedText = JSON.stringify(forecast, null, 2)

    if (dryRun) {
      log.info({ botId: bot.id, forecast }, 'DRY RUN: Would create forecast')
      await logBotAction(bot.id, 'CREATED_FORECAST', { title: topicTitle, urls: sourceUrls }, generatedText, null, true)
      return 'created'
    }

    // Create the prediction in the DB
    const resolveBy = new Date(forecast.resolveByDatetime)
    if (isNaN(resolveBy.getTime())) {
      log.warn({ botId: bot.id, topic: topicTitle, provided: forecast.resolveByDatetime }, 'Invalid resolveByDatetime format')
      await logBotAction(bot.id, 'ERROR', { title: topicTitle }, null, 'Invalid date format', dryRun)
      return 'error'
    }
    if (resolveBy <= new Date()) {
      log.warn({ botId: bot.id, topic: topicTitle, provided: resolveBy.toISOString() }, 'resolveByDatetime is in the past')
      await logBotAction(bot.id, 'ERROR', { title: topicTitle }, null, 'Past resolution date', dryRun)
      return 'error'
    }
    // Cap at 1 year from now
    const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    if (resolveBy > maxDate) {
      resolveBy.setTime(maxDate.getTime())
    }

    // ── Rejection tracking: check if topic was previously rejected ──────────
    // Prevents bot from suggesting similar topics that admins have rejected
    if (bot.enableRejectionTracking) {
      const rejectedTopics = await prisma.botRejectedTopic.findMany({
        where: { botId: bot.id },
        select: { keywords: true, description: true },
        orderBy: { rejectedAt: 'desc' },
        take: 20, // Check most recent rejections
      })

      if (rejectedTopics.length > 0) {
        // Simple keyword-based similarity check (lightweight, no LLM)
        const claimLower = forecast.claimText.toLowerCase()
        const detailsLower = (forecast.detailsText || '').toLowerCase()
        const combinedText = `${claimLower} ${detailsLower}`

        for (const rejected of rejectedTopics) {
          // Check if any rejected keywords appear in the new forecast
          const keywordMatches = (rejected.keywords || []).filter(kw =>
            combinedText.includes(kw.toLowerCase()),
          )

          // If 50% or more of keywords match, consider it a similar topic
          if (rejected.keywords && rejected.keywords.length > 0) {
            const matchPercentage = (keywordMatches.length / rejected.keywords.length) * 100
            if (matchPercentage >= 50) {
              log.info(
                { botId: bot.id, topic: topicTitle, rejectedDescription: rejected.description, matchPercentage },
                'Forecast matches rejected topic, skipping (rejection tracking)',
              )
              await logBotAction(
                bot.id,
                'SKIPPED',
                { title: topicTitle, urls: sourceUrls, rejectionMatch: rejected.description },
                null,
                null,
                dryRun,
              )
              return 'skipped'
            }
          }
        }
      }
    }

    const baseSlug = slugify(forecast.claimText)
    const existingSlugs = await prisma.prediction.findMany({
      where: { slug: { startsWith: baseSlug } },
      select: { slug: true },
    }).then(rows => rows.map(r => r.slug).filter((s): s is string => s !== null))
    const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs)

    const predictionCreateData = {
      authorId: bot.userId,
      claimText: forecast.claimText.slice(0, 499),
      slug: uniqueSlug,
      detailsText: forecast.detailsText,
      outcomeType: 'BINARY' as const,
      outcomePayload: { type: 'BINARY' as const },
      resolutionRules: forecast.resolutionRules,
      resolveByDatetime: resolveBy,
      source: 'bot' as const,
      status: 'DRAFT' as const,
      shareToken: crypto.randomBytes(8).toString('hex'),
      tags: forecast.tags?.length
        ? {
          connectOrCreate: forecast.tags
            .filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
            .slice(0, 5)
            .map((tagName: string) => {
              const tagSlug = slugify(tagName)
              return {
                where: { slug: tagSlug },
                create: { name: tagName, slug: tagSlug },
              }
            }),
        }
        : undefined,
    }

    let prediction: { id: string }
    let stakeAmount: number | null
    try {
      const result = await createAndStake(bot, predictionCreateData)
      prediction = result.prediction
      stakeAmount = result.stakeAmount
    } catch (stakeErr) {
      log.error(
        { err: stakeErr, botId: bot.id, topic: topicTitle },
        'Forecast create+stake transaction failed',
      )
      await logBotAction(bot.id, 'ERROR', { title: topicTitle }, null, String(stakeErr), dryRun)
      return 'error'
    }

    await logBotAction(bot.id, 'CREATED_FORECAST', { title: topicTitle, urls: sourceUrls }, generatedText, null, false, prediction.id)

    if (stakeAmount !== null) {
      log.info({ botId: bot.id, predictionId: prediction.id, stakeAmount }, 'Bot created forecast and staked')
    } else {
      log.info({ botId: bot.id, predictionId: prediction.id }, 'Bot created forecast (approval required, staking deferred)')
    }
    return 'created'
  } catch (err) {
    log.error({ err, botId: bot.id, topic: topicTitle }, 'Failed to process topic')
    await logBotAction(bot.id, 'ERROR', { title: topicTitle }, null, String(err), dryRun)
    return 'error'
  }
}
