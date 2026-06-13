/**
 * Bot runner service.
 *
 * Called by /api/bots/run on a schedule (GitHub Actions every 5 minutes).
 * For each active bot that is "due", it:
 * 1. Fetches RSS feeds configured for the bot
 * 2. Detects hot topics (appearing in multiple sources)
 * 3. Deduplicates against existing forecast titles (LLM-based)
 * 4. Generates and posts a new forecast (with 🤖 in title)
 * 5. Stakes on the forecast immediately (or defers if requireApprovalForForecasts)
 * 6. Optionally votes on existing ACTIVE forecasts (informed by the Oracle's
 *    P(YES) estimate when the Oracle is configured and reachable)
 * 7. Logs all actions to BotRunLog
 *
 * The per-stage logic lives in sibling modules: forecastCreate (news-anchored),
 * sourceless (LLM-only fallback), voting, and stake (shared create+stake). This
 * file is orchestration only.
 */

import { prisma } from '@/lib/prisma'
import { createBotLLMService } from '@/lib/llm'
import { fetchRssFeeds, detectHotTopics, type HotTopic } from '@/lib/services/bots/rss'
import { fetchOracleSources, MAX_ORACLE_SOURCES_PER_RUN } from '@/lib/services/bots/oracleSource'
import { type BotWithUser, log, countTodayActions, countThisHourActions, logBotAction } from './shared'
import { processTopic } from './forecastCreate'
import { processSourcelessForecast } from './sourceless'
import { runVoting } from './voting'

// ─── Metrics for Observability ──────────────────────────────────────────────

interface RunMetrics {
  startedAt: number
  rssFeatchDurationMs?: number
  hotTopicsDetectionMs?: number
  totalProcessingMs?: number
  databaseQueryMs?: number
  llmCallsMs?: number
}

function startMetrics(): RunMetrics {
  return { startedAt: Date.now() }
}

function endMetrics(metrics: RunMetrics): RunMetrics {
  metrics.totalProcessingMs = Date.now() - metrics.startedAt
  return metrics
}

export interface BotRunSummary {
  botId: string
  botName: string
  forecastsCreated: number
  votes: number
  skipped: number
  errors: number
  dryRun: boolean
  gatedByActiveHours: boolean
  hotTopics?: HotTopic[]
  fetchedCount?: number
  sampleItems?: string[]
}


/**
 * Run all bots that are due (based on lastRunAt + intervalMinutes).
 */
export async function runDueBots(dryRun = false): Promise<BotRunSummary[]> {
  const now = new Date()

  const bots = await prisma.botConfig.findMany({
    where: { isActive: true },
    include: { user: true },
  })

  const summaries: BotRunSummary[] = []

  for (const bot of bots) {
    // Check if the bot is due
    if (bot.lastRunAt) {
      const nextRunAt = new Date(bot.lastRunAt.getTime() + bot.intervalMinutes * 60 * 1000)
      if (nextRunAt > now) {
        log.debug({ botId: bot.id, nextRunAt }, 'Bot not due yet, skipping')
        continue
      }
    }

    const summary = await runBot(bot, dryRun, false)
    summaries.push(summary)

    // Only update lastRunAt if the bot actually ran (not gated out by active hours).
    if (!dryRun && !summary.gatedByActiveHours) {
      await prisma.botConfig.update({
        where: { id: bot.id },
        data: { lastRunAt: now },
      })
    }
  }

  return summaries
}

/**
 * Run a specific bot by ID (for "Run now" admin action).
 */
export async function runBotById(botId: string, dryRun = false): Promise<BotRunSummary> {
  const bot = await prisma.botConfig.findUnique({
    where: { id: botId },
    include: { user: true },
  })

  if (!bot) throw new Error(`Bot not found: ${botId}`)

  const summary = await runBot(bot, dryRun, true)

  if (!dryRun && !summary.gatedByActiveHours) {
    await prisma.botConfig.update({
      where: { id: bot.id },
      data: { lastRunAt: new Date() },
    })
  }

  return summary
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function runBot(bot: BotWithUser, dryRun: boolean, isManual: boolean = false): Promise<BotRunSummary> {
  const summary: BotRunSummary = {
    botId: bot.id,
    botName: bot.user.name ?? bot.id,
    forecastsCreated: 0,
    votes: 0,
    skipped: 0,
    errors: 0,
    dryRun,
    gatedByActiveHours: false,
  }

  // ── Active hours gate ────────────────────────────────────────────────────
  // Skip (without updating lastRunAt) when outside the configured UTC window.
  // Overnight ranges are supported: start=22, end=6 → active 10pm–6am UTC.
  if (!isManual && bot.activeHoursStart != null && bot.activeHoursEnd != null) {
    const hour = new Date().getUTCHours()
    const inWindow =
      bot.activeHoursStart <= bot.activeHoursEnd
        ? hour >= bot.activeHoursStart && hour < bot.activeHoursEnd
        : hour >= bot.activeHoursStart || hour < bot.activeHoursEnd
    if (!inWindow) {
      log.debug(
        { botId: bot.id, hour, activeHoursStart: bot.activeHoursStart, activeHoursEnd: bot.activeHoursEnd },
        'Bot outside active window, skipping without updating lastRunAt',
      )
      summary.gatedByActiveHours = true
      return summary
    }
  }

  log.info({ botId: bot.id, dryRun }, 'Running bot')

  try {
    const llm = createBotLLMService(bot.modelPreference)

    // ── Forecast creation ────────────────────────────────────────────────
    if (bot.canCreateForecasts) {
      const allSources = bot.newsSources as string[]
      // `oracle: <query>` entries route through the paid Oracle /search; everything
      // else (RSS URLs and `Search:` Google News queries) goes through fetchRssFeeds.
      const isOracle = (s: string) => s.trim().toLowerCase().startsWith('oracle:')
      const oracleQueries = allSources
        .filter(isOracle)
        .map((s) => s.trim().slice('oracle:'.length).trim())
        .filter(Boolean)
      const feedUrls = allSources.filter((s) => !isOracle(s))

      const initialForecastCount = await countTodayActions(bot.id, 'CREATED_FORECAST')
      if ((feedUrls.length > 0 || oracleQueries.length > 0) && initialForecastCount < bot.maxForecastsPerDay) {
        const metrics = startMetrics()

        // Cap paid Oracle searches per run; extras are ignored until the next run.
        const cappedOracleQueries = oracleQueries.slice(0, MAX_ORACLE_SOURCES_PER_RUN)
        if (oracleQueries.length > cappedOracleQueries.length) {
          log.info(
            { botId: bot.id, configured: oracleQueries.length, cap: MAX_ORACLE_SOURCES_PER_RUN },
            'Capping oracle: source queries for this run',
          )
        }

        const rssFetchStart = Date.now()
        const [rssItems, oracleItems] = await Promise.all([
          fetchRssFeeds(feedUrls),
          fetchOracleSources(cappedOracleQueries, {
            windowHours: bot.hotnessWindowHours,
            meta: { source: 'bot-sourcing', userId: bot.userId },
          }),
        ])
        const items = [...rssItems, ...oracleItems]
        metrics.rssFeatchDurationMs = Date.now() - rssFetchStart

        summary.fetchedCount = items.length
        summary.sampleItems = items.slice(0, 5).map(i => i.title)

        const hotTopicsStart = Date.now()
        let hotTopics = detectHotTopics(items, bot.hotnessMinSources, bot.hotnessWindowHours)
        // Fallback rung: if nothing cleared the multi-source bar, retry at
        // minSources=1 so we still anchor on real news before dropping to
        // LLM-only sourceless generation.
        if (hotTopics.length === 0 && bot.hotnessMinSources > 1) {
          hotTopics = detectHotTopics(items, 1, bot.hotnessWindowHours)
          if (hotTopics.length > 0) {
            log.info({ botId: bot.id, count: hotTopics.length }, 'No multi-source topics; using single-source fallback rung')
          }
        }
        metrics.hotTopicsDetectionMs = Date.now() - hotTopicsStart
        summary.hotTopics = hotTopics

        log.info({
          botId: bot.id,
          hotCount: hotTopics.length,
          minSources: bot.hotnessMinSources,
          windowHours: bot.hotnessWindowHours,
          fetchedCount: items.length
        }, 'Hot topics detection result')

        // Fetch recent forecasts ONCE before processing topics (avoid N+1 queries)
        // Only fetch predictions that are ACTIVE or in approval workflows
        const recentForecasts = await prisma.prediction.findMany({
          where: { status: { in: ['ACTIVE', 'PENDING_APPROVAL', 'PENDING'] } },
          select: { claimText: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
        const existingTitles = recentForecasts.map(f => f.claimText)

        for (const topic of hotTopics) {
          // Rate limit check (note: subject to TOCTOU if multiple instances run simultaneously)
          // We check before creation but another instance could create between check and our creation
          // This is acceptable: occasional overage is better than blocking all creation

          const todayForecastCount = await countTodayActions(bot.id, 'CREATED_FORECAST')
          if (todayForecastCount >= bot.maxForecastsPerDay) {
            log.info({ botId: bot.id, count: todayForecastCount, limit: bot.maxForecastsPerDay }, 'Daily forecast limit reached')
            break
          }

          // Hourly rate limiting: check if maxForecastsPerHour limit is reached
          if (bot.maxForecastsPerHour > 0) {
            const hourlyForecastCount = await countThisHourActions(bot.id, 'CREATED_FORECAST')
            if (hourlyForecastCount >= bot.maxForecastsPerHour) {
              log.info({ botId: bot.id, count: hourlyForecastCount, limit: bot.maxForecastsPerHour }, 'Hourly forecast limit reached')
              break
            }
          }

          const created = await processTopic(bot, topic.title, topic.items.map(i => i.url), llm, dryRun, existingTitles)
          if (created === 'created') {
            summary.forecastsCreated++

            // Post-check: verify we didn't exceed limits due to race condition
            if (!dryRun) {
              const finalTodayCount = await countTodayActions(bot.id, 'CREATED_FORECAST')
              const finalHourlyCount = bot.maxForecastsPerHour > 0 ? await countThisHourActions(bot.id, 'CREATED_FORECAST') : 0

              if (finalTodayCount > bot.maxForecastsPerDay) {
                log.warn(
                  { botId: bot.id, count: finalTodayCount, limit: bot.maxForecastsPerDay },
                  'Daily forecast limit exceeded (TOCTOU race: concurrent instances)',
                )
              }

              if (bot.maxForecastsPerHour > 0 && finalHourlyCount > bot.maxForecastsPerHour) {
                log.warn(
                  { botId: bot.id, count: finalHourlyCount, limit: bot.maxForecastsPerHour },
                  'Hourly forecast limit exceeded (TOCTOU race: concurrent instances)',
                )
              }
            }
          } else if (created === 'skipped') summary.skipped++
          else summary.errors++
        }

        if (hotTopics.length === 0) {
          log.info({ botId: bot.id, fetchedCount: items.length }, 'No hot topics detected — falling back to LLM-only forecast generation')
          const created = await processSourcelessForecast(bot, llm, dryRun, existingTitles)
          if (created === 'created') summary.forecastsCreated++
          else if (created === 'skipped') summary.skipped++
          else summary.errors++
        }

        // Log performance metrics
        endMetrics(metrics)
        log.debug(
          {
            botId: bot.id,
            rssFetchMs: metrics.rssFeatchDurationMs,
            hotTopicsMs: metrics.hotTopicsDetectionMs,
            totalMs: metrics.totalProcessingMs,
            topicsProcessed: summary.forecastsCreated + summary.skipped + summary.errors,
          },
          'Forecast creation batch completed (performance metrics)',
        )
      } else if (feedUrls.length === 0 && oracleQueries.length === 0) {
        log.warn({ botId: bot.id }, 'No news sources configured')
      }
    }

    // ── Voting ────────────────────────────────────────────────────────────
    if (bot.canVote) {
      const todayVoteCount = await countTodayActions(bot.id, 'VOTED')
      const voteSlotsLeft = bot.maxVotesPerDay - todayVoteCount

      if (voteSlotsLeft > 0) {
        const voted = await runVoting(bot, llm, dryRun, voteSlotsLeft)
        summary.votes += voted
      }
    }
  } catch (err) {
    log.error({ err, botId: bot.id }, 'Bot run failed')
    await logBotAction(bot.id, 'ERROR', null, null, String(err), dryRun)
    summary.errors++
  }

  return summary
}
