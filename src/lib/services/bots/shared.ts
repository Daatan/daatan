/**
 * Shared infrastructure for the bot runner modules: the logger, the
 * BotWithUser type, the timeout/retry LLM wrapper, run-log writes, the stake
 * RNG, and the resolve-window constants.
 */
import { prisma } from '@/lib/prisma'
import { createBotLLMService } from '@/lib/llm'
import { createLogger } from '@/lib/logger'
import { BotAction } from '@prisma/client'
import type { Schema } from '@google/generative-ai'

export const log = createLogger('bot-runner')

export type BotWithUser = Awaited<ReturnType<typeof prisma.botConfig.findMany>>[number] & {
  user: { id: string; name: string | null }
}

// ─── LLM call timeout & retry ──────────────────────────────────────────────

const LLM_CALL_TIMEOUT_MS = 10000 // 10 second timeout per LLM call
const LLM_RETRY_ATTEMPTS = 2 // Total of 2 attempts (1 initial + 1 retry)
const LLM_RETRY_DELAY_MS = 1000 // 1 second delay before retry

// Deterministic resolveByDatetime range. Done in code, not in the LLM quality
// gate prompt — the LLM has no concept of "today" and was rejecting valid
// future dates as "too far in the future" using its training cutoff as now.
export const MIN_RESOLVE_DAYS = 14
export const MAX_RESOLVE_DAYS = 365

interface LLMCallOptions {
  prompt: string
  temperature?: number
  schema?: Schema
  timeoutMs?: number
  maxAttempts?: number
}

/**
 * Call LLM with timeout and retry logic.
 * Throws on timeout or after max retries, allowing caller to decide handling.
 */
export async function callLLMWithTimeout(
  llm: ReturnType<typeof createBotLLMService>,
  options: LLMCallOptions,
): Promise<{ text: string }> {
  const { prompt, temperature = 0, schema, timeoutMs = LLM_CALL_TIMEOUT_MS, maxAttempts = LLM_RETRY_ATTEMPTS } = options

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timeoutId: NodeJS.Timeout | undefined
    try {
      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const result = await Promise.race([
        llm.generateContent({ prompt, temperature, schema, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`LLM call timeout after ${timeoutMs}ms`))
          })
        }),
      ])

      clearTimeout(timeoutId)
      return result
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId)
      const isTimeout = err instanceof Error && err.message.includes('timeout')
      const isLastAttempt = attempt === maxAttempts

      if (isTimeout) {
        log.warn({ attempt, maxAttempts, timeoutMs }, `LLM call timeout (attempt ${attempt}/${maxAttempts})`)
        if (isLastAttempt) throw err
        await new Promise(resolve => setTimeout(resolve, LLM_RETRY_DELAY_MS))
        continue
      }

      // Non-timeout errors: fail immediately
      throw err
    }
  }

  throw new Error(`LLM call failed after ${maxAttempts} attempts`)
}

// ─── Run-log + helpers ─────────────────────────────────────────────────────

export async function logBotAction(
  botId: string,
  action: BotAction,
  triggerNews: object | null,
  generatedText: string | null,
  error: string | null,
  isDryRun: boolean,
  forecastId?: string,
): Promise<void> {
  try {
    await prisma.botRunLog.create({
      data: {
        botId,
        action,
        triggerNews: triggerNews ?? undefined,
        generatedText,
        forecastId,
        isDryRun,
        error,
      },
    })
  } catch (err) {
    log.error({ err }, 'Failed to write bot run log')
  }
}

export async function countTodayActions(botId: string, action: BotAction): Promise<number> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  return prisma.botRunLog.count({
    where: {
      botId,
      action,
      isDryRun: false,
      runAt: { gte: startOfDay },
    },
  })
}

export async function countThisHourActions(botId: string, action: BotAction): Promise<number> {
  const startOfHour = new Date()
  startOfHour.setMinutes(0, 0, 0)

  return prisma.botRunLog.count({
    where: {
      botId,
      action,
      isDryRun: false,
      runAt: { gte: startOfHour },
    },
  })
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ─── Resolve-date validation ────────────────────────────────────────────────

/**
 * Validate a generated resolveByDatetime just before creating the prediction:
 * reject unparseable dates and dates already in the past. Distinct from the
 * MIN/MAX_RESOLVE_DAYS window check above (which runs earlier, before the LLM
 * quality gate, to save a wasted LLM call) — this is the final DB-write-time
 * guard. Logs and writes the ERROR run-log entry itself so both call sites
 * get identical diagnostics; `triggerNews` lets each caller pass its own
 * run-log payload shape (forecastCreate has a topic title, sourceless does not).
 */
export async function validateResolveByDate(
  bot: BotWithUser,
  topicLabel: string,
  triggerNews: object | null,
  rawResolveByDatetime: string,
  dryRun: boolean,
): Promise<{ ok: true; resolveBy: Date } | { ok: false }> {
  const resolveBy = new Date(rawResolveByDatetime)
  if (isNaN(resolveBy.getTime())) {
    log.warn({ botId: bot.id, topic: topicLabel, provided: rawResolveByDatetime }, 'Invalid resolveByDatetime format')
    await logBotAction(bot.id, 'ERROR', triggerNews, null, 'Invalid date format', dryRun)
    return { ok: false }
  }
  if (resolveBy <= new Date()) {
    log.warn({ botId: bot.id, topic: topicLabel, provided: resolveBy.toISOString() }, 'resolveByDatetime is in the past')
    await logBotAction(bot.id, 'ERROR', triggerNews, null, 'Past resolution date', dryRun)
    return { ok: false }
  }
  return { ok: true, resolveBy }
}
