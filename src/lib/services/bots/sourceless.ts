/**
 * Fallback path: generate a forecast from the bot's knowledge alone, with no
 * news anchor. Mirrors the manual "Create prediction without a URL" checkbox.
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
import { normalizeTitleForDedup } from '../translation'
import { createAndStake } from './stake'

export async function processSourcelessForecast(
  bot: BotWithUser,
  llm: ReturnType<typeof createBotLLMService>,
  dryRun: boolean,
  existingTitles: string[],
): Promise<'created' | 'skipped' | 'error'> {
  const logTopic = '(LLM-generated, no sources)'
  try {
    const tagFilter = bot.tagFilter as string[]
    const safeTags = tagFilter.map(t => t.replace(/[^a-z0-9_-]/g, '').trim()).filter(Boolean)
    const tagConstraint =
      safeTags.length > 0
        ? `\nConstraint: assign one of these tag slugs to this forecast: ${safeTags.join(', ')}. If the topic does not fit any of these tags, set "skip": true in the JSON.`
        : `\nIf this topic does not match your area of expertise or persona, set "skip": true in the JSON instead of generating a forecast.`

    const now = new Date()
    const forecastTemplate = await getPromptTemplate('bot-sourceless-forecast-generation')
    const forecastPrompt = fillPrompt(forecastTemplate, {
      personaPrompt: bot.personaPrompt,
      forecastPrompt: bot.forecastPrompt,
      todayDate: now.toISOString().split('T')[0],
      tagConstraint,
    })

    let response
    try {
      response = await callLLMWithTimeout(llm, { prompt: forecastPrompt, temperature: 0.7, schema: forecastBatchSchema })
    } catch (genErr) {
      const isTimeout = genErr instanceof Error && genErr.message.includes('timeout')
      log.error({ botId: bot.id, err: genErr, errorType: isTimeout ? 'timeout' : 'other' }, 'Sourceless forecast generation failed')
      await logBotAction(bot.id, 'ERROR', { reason: isTimeout ? 'generation_timeout' : 'generation_error' }, null, String(genErr), dryRun)
      return 'error'
    }

    const rawText = response.text.trim()

    // Check skip signal
    if (rawText.includes('"skip"') && rawText.includes('true')) {
      try {
        const skipCheck = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] ?? rawText)
        if (skipCheck?.skip === true) {
          log.info({ botId: bot.id, tagFilter }, 'Sourceless forecast out of scope, skipping')
          await logBotAction(bot.id, 'SKIPPED', {}, null, `topic out of scope for tag filter '${tagFilter}'`, dryRun)
          return 'skipped'
        }
      } catch { /* not a skip signal */ }
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
      forecast = { ...raw, tags: (raw.tags ?? []).filter((t: unknown): t is string => typeof t === 'string' && t.length > 0) }
    } catch (err) {
      log.warn({ botId: bot.id, err, raw: response.text }, 'Failed to parse sourceless LLM forecast JSON')
      await logBotAction(bot.id, 'ERROR', { reason: 'JSON parse failed', raw: response.text }, null, 'JSON parse failed', dryRun)
      return 'error'
    }

    if (!forecast.claimText || forecast.claimText.length < 10) {
      await logBotAction(bot.id, 'ERROR', {}, null, 'Invalid claimText', dryRun)
      return 'error'
    }
    if (!forecast.claimText.startsWith('🤖')) {
      forecast.claimText = `🤖 ${forecast.claimText}`
    }

    // Dedup check against existing forecasts using the generated claim. A
    // confident local keyword-overlap match skips the LLM round-trip. Translate
    // non-English claims to English first so they compare against the
    // English-canonical existing titles rather than sharing no keywords.
    const dedupTitle = await normalizeTitleForDedup(forecast.claimText)
    if (isLocalDuplicate(dedupTitle, existingTitles)) {
      log.info({ botId: bot.id }, 'Sourceless forecast duplicates existing forecast (local dedup), skipping')
      await logBotAction(bot.id, 'SKIPPED', { title: forecast.claimText }, null, 'duplicate (sourceless path, local dedup)', dryRun)
      return 'skipped'
    }
    const dedupTemplate = await getPromptTemplate('dedupe-check')
    const dedupPrompt = fillPrompt(dedupTemplate, { topicTitle: dedupTitle, existingTitles: existingTitles.join('\n- ') })
    let dedupResult
    try {
      dedupResult = await callLLMWithTimeout(llm, { prompt: dedupPrompt, temperature: 0 })
    } catch {
      dedupResult = { text: 'no' } // fail open
    }
    if (dedupResult.text.trim().toLowerCase().startsWith('yes')) {
      log.info({ botId: bot.id }, 'Sourceless forecast duplicates existing forecast, skipping')
      await logBotAction(bot.id, 'SKIPPED', { title: forecast.claimText }, null, 'duplicate (sourceless path)', dryRun)
      return 'skipped'
    }

    // Resolve date range check
    const resolveByCheck = new Date(forecast.resolveByDatetime)
    if (!isNaN(resolveByCheck.getTime())) {
      const days = (resolveByCheck.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      if (days < MIN_RESOLVE_DAYS || days > MAX_RESOLVE_DAYS) {
        await logBotAction(bot.id, 'SKIPPED', { dateOutOfRange: true, daysOut: Math.round(days) }, null, `resolveByDatetime ${days.toFixed(0)} days out`, dryRun)
        return 'skipped'
      }
    }

    // Quality gate
    try {
      const qualityTemplate = await getPromptTemplate('forecast-quality-validation')
      const qualityPrompt = fillPrompt(qualityTemplate, {
        claimText: forecast.claimText,
        detailsText: forecast.detailsText || 'None',
        resolveByDatetime: forecast.resolveByDatetime,
        resolutionRules: forecast.resolutionRules || 'None',
        topicTitle: forecast.claimText,
      })
      let qualityResult
      try {
        qualityResult = await callLLMWithTimeout(llm, { prompt: qualityPrompt, temperature: 0 })
      } catch {
        qualityResult = { text: '{"pass": true}' } // fail open
      }
      const qText = qualityResult.text.trim()
      const qMatch = qText.match(/\{[\s\S]*\}/)
      const qualityCheck = JSON.parse(qMatch ? qMatch[0] : qText)
      if (!qualityCheck.pass) {
        await logBotAction(bot.id, 'SKIPPED', { qualityReason: qualityCheck.reason }, null, qualityCheck.reason || 'quality gate failed', dryRun)
        return 'skipped'
      }
    } catch { /* fail open on parse error */ }

    const generatedText = JSON.stringify(forecast, null, 2)

    if (dryRun) {
      log.info({ botId: bot.id, forecast }, 'DRY RUN: Would create sourceless forecast')
      await logBotAction(bot.id, 'CREATED_FORECAST', { title: logTopic }, generatedText, null, true)
      return 'created'
    }

    const resolveBy = new Date(forecast.resolveByDatetime)
    if (isNaN(resolveBy.getTime()) || resolveBy <= new Date()) {
      await logBotAction(bot.id, 'ERROR', {}, null, 'Invalid or past resolveByDatetime', dryRun)
      return 'error'
    }
    const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    if (resolveBy > maxDate) resolveBy.setTime(maxDate.getTime())

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
              return { where: { slug: tagSlug }, create: { name: tagName, slug: tagSlug } }
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
      log.error({ err: stakeErr, botId: bot.id }, 'Sourceless forecast create+stake transaction failed')
      await logBotAction(bot.id, 'ERROR', {}, null, String(stakeErr), dryRun)
      return 'error'
    }

    await logBotAction(bot.id, 'CREATED_FORECAST', { title: logTopic, sourceless: true }, generatedText, null, false, prediction.id)
    log.info({ botId: bot.id, predictionId: prediction.id, stakeAmount }, 'Bot created sourceless forecast')
    return 'created'
  } catch (err) {
    log.error({ err, botId: bot.id }, 'Failed to process sourceless forecast')
    await logBotAction(bot.id, 'ERROR', {}, null, String(err), dryRun)
    return 'error'
  }
}
