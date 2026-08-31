/**
 * Bot voting: for each open binary forecast the bot hasn't voted on, ask the
 * LLM (optionally informed by the Oracul's P(YES) estimate) whether and how to
 * vote, then stake.
 */
import { prisma } from '@/lib/prisma'
import { createBotLLMService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { getOracleProbability, BOT_FORECAST_TIMEOUT_MS } from '@/lib/services/oracle'
import { createCommitment } from '@/lib/services/commitment'
import { voteDecisionSchema } from '@/lib/llm/schemas'
import { type BotWithUser, log, callLLMWithTimeout, logBotAction, randomInt } from './shared'

// Per-run cap on Oracul consultations during voting. Each getOracleProbability
// call hits the Oracul's /forecast endpoint (article search + analysis), which
// runs sequentially here, so cap × timeout bounds the Oracul time per bot run.
// We use the longer BOT_FORECAST_TIMEOUT_MS (20s) to let slow-but-valid calls
// finish instead of aborting at 12s, and lower the cap to keep the product
// (cap × timeout = 60s) within the run's cron budget. Remaining candidates vote
// on the LLM's judgement alone.
const MAX_ORACLE_CONSULTS_PER_VOTE_RUN = 3

export async function runVoting(
  bot: BotWithUser,
  llm: ReturnType<typeof createBotLLMService>,
  dryRun: boolean,
  maxVotes: number,
): Promise<number> {
  const tagFilter = bot.tagFilter as string[]

  // Fetch open forecasts the bot hasn't voted on yet.
  // If tagFilter is set, restrict to forecasts that have at least one matching tag.
  const candidates = await prisma.prediction.findMany({
    where: {
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      authorId: { not: bot.userId },
      commitments: { none: { userId: bot.userId } },
      ...(tagFilter.length > 0 && {
        tags: { some: { slug: { in: tagFilter } } },
      }),
    },
    select: { id: true, claimText: true, detailsText: true, outcomeType: true, claimDirection: true, claimDeadline: true, resolutionRules: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  if (candidates.length === 0) return 0

  // Build vote bias hint (omit when neutral)
  const biasHint =
    bot.voteBias !== 50
      ? `\nYour current disposition is ${bot.voteBias}/100 toward YES (0 = strongly lean NO, 50 = neutral, 100 = strongly lean YES).`
      : ''

  let voted = 0
  let oracleConsults = 0

  for (const forecast of candidates.slice(0, Math.min(maxVotes, candidates.length))) {
    if (voted >= maxVotes) break

    try {
      const voteTemplate = await getPromptTemplate('bot-vote-decision')
      let votePrompt = fillPrompt(voteTemplate, {
        personaPrompt: bot.personaPrompt,
        votePrompt: bot.votePrompt,
        claimText: forecast.claimText,
        detailsText: forecast.detailsText ?? 'No additional details provided',
        biasHint,
      })

      // ── Oracul signal ──────────────────────────────────────────────────
      // Consult the TruthMachine Oracle for an external P(YES) estimate and
      // surface it to the LLM. Appended in code rather than via a {{oracleHint}}
      // template placeholder so it works regardless of whether the template is
      // served from Bedrock or the local fallback. getOracleProbability never
      // throws and returns null when the Oracul is unconfigured/unavailable, so
      // this is fail-open: no signal → unchanged behaviour.
      if (oracleConsults < MAX_ORACLE_CONSULTS_PER_VOTE_RUN) {
        oracleConsults++
        // Strip the 🤖 author prefix; it's noise in the Oracul's search query.
        const oracleQuestion = forecast.claimText.replace(/^🤖\s*/, '')
        const oracleProbability = await getOracleProbability(
          oracleQuestion,
          { source: 'bot-voting', userId: bot.userId, predictionId: forecast.id },
          { timeoutMs: BOT_FORECAST_TIMEOUT_MS, claimDirection: forecast.claimDirection, claimDeadline: forecast.claimDeadline, resolutionRules: forecast.resolutionRules },
        )
        if (oracleProbability !== null) {
          const pct = Math.round(oracleProbability * 100)
          votePrompt += `\n\nAn external forecasting Oracle estimates the probability that this resolves YES at ${pct}%. Weigh this signal alongside your own judgement.`
          log.debug({ botId: bot.id, forecastId: forecast.id, oraclePct: pct }, 'Oracle signal added to vote prompt')
        }
      }

      let response
      try {
        response = await callLLMWithTimeout(llm, { prompt: votePrompt, temperature: 0.5, schema: voteDecisionSchema })
      } catch (voteErr) {
        log.warn({ botId: bot.id, forecastId: forecast.id, err: voteErr }, 'Vote decision timed out, skipping')
        continue // Skip this forecast on timeout
      }

      let decision: { shouldVote: boolean; binaryChoice: boolean; reason?: string }
      try {
        const text = response.text.trim()
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        decision = JSON.parse(jsonMatch ? jsonMatch[0] : text)
      } catch (parseErr) {
        log.warn(
          { botId: bot.id, forecastId: forecast.id, err: parseErr, responseLength: response.text.length },
          'Vote decision unparseable, skipping',
        )
        continue
      }

      // Validate decision structure
      if (typeof decision.shouldVote !== 'boolean') {
        log.warn({ botId: bot.id, forecastId: forecast.id, decision }, 'Invalid shouldVote type, skipping')
        continue
      }

      if (!decision.shouldVote) continue

      if (typeof decision.binaryChoice !== 'boolean') {
        log.warn({ botId: bot.id, forecastId: forecast.id, decision }, 'Invalid binaryChoice type, defaulting to true')
        decision.binaryChoice = true
      }

      const generatedText = JSON.stringify(decision, null, 2)

      const stakeAmount = randomInt(bot.stakeMin, bot.stakeMax)

      if (dryRun) {
        await logBotAction(bot.id, 'VOTED', { forecastTitle: forecast.claimText }, generatedText, null, true, forecast.id)
        voted++
        continue
      }

      const result = await createCommitment(bot.userId, forecast.id, {
        confidence: decision.binaryChoice ? stakeAmount : -stakeAmount,
      })

      if (result.ok) {
        await logBotAction(bot.id, 'VOTED', { forecastTitle: forecast.claimText }, generatedText, null, false, forecast.id)
        voted++
      } else {
        log.warn({ botId: bot.id, forecastId: forecast.id, error: result.error }, 'Vote failed')
      }
    } catch (err) {
      log.error({ err, botId: bot.id, forecastId: forecast.id }, 'Vote error')
    }
  }

  return voted
}
