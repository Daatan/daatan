import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

const log = createLogger('telegram')

const TELEGRAM_API = 'https://api.telegram.org/bot'

/**
 * Telegram routing channels.
 * - `clean`: prod-only high-signal feed (new versions, forecasts, users, votes,
 *   resolutions, comments, and page-worthy alarms).
 * - `noisy`: everything else, plus all non-production traffic (staging/next,
 *   bots, indexer, operational errors, health digests).
 */
export type TelegramChannel = 'clean' | 'noisy'

function currentEnv(): string {
  return process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || 'staging'
}

function envPrefix(): string {
  const env = currentEnv()
  return env === 'production' ? 'prod' : env === 'next' ? 'next' : 'staging'
}

function isDevEnv(): boolean {
  return currentEnv() === 'development'
}

/**
 * Pick the destination chat id for a channel. The `clean` channel only applies
 * in production and only when its id is provisioned; otherwise we fall back to
 * the `noisy` channel so an un-provisioned clean channel never drops messages.
 */
function resolveChatId(channel: TelegramChannel): string | undefined {
  if (channel === 'clean' && currentEnv() === 'production' && process.env.TELEGRAM_CLEAN_CHAT_ID) {
    return process.env.TELEGRAM_CLEAN_CHAT_ID
  }
  return process.env.TELEGRAM_CHAT_ID
}

/**
 * POST to a Telegram Bot API method. Never throws — returns null on any
 * failure (non-2xx, `ok: false` body, or a network error), logging the
 * reason. Shared by the send and edit paths below.
 */
async function callTelegramApi(
  token: string,
  method: 'sendMessage' | 'editMessageText',
  body: Record<string, unknown>,
  logContext: Record<string, unknown>,
): Promise<{ message_id: number } | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const payload = (await res.json().catch(() => null)) as
      | { ok: true; result: { message_id: number } }
      | { ok: false; description?: string }
      | null

    if (!res.ok || !payload?.ok) {
      log.error(
        { status: res.status, description: payload && !payload.ok ? payload.description : undefined, ...logContext },
        `Telegram ${method} failed`,
      )
      return null
    }
    return payload.result
  } catch (err) {
    log.error({ err, ...logContext }, `Failed to call Telegram ${method}`)
    return null
  }
}

/**
 * Send a message to one of the configured Telegram channels.
 * Fire-and-forget: never throws, logs errors. Defaults to the noisy channel.
 */
async function sendChannelNotification(
  message: string,
  channel: TelegramChannel = 'noisy',
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = resolveChatId(channel)

  if (!token || !chatId) {
    log.warn({ hasToken: !!token, hasChatId: !!chatId, channel }, 'Telegram not configured')
    return
  }

  const prefix = envPrefix()
  const prefixed = `[${prefix}] ${message}`

  log.debug({ chatId, prefix, channel }, 'Sending Telegram notification')

  const result = await callTelegramApi(
    token,
    'sendMessage',
    { chat_id: chatId, text: prefixed, parse_mode: 'HTML', disable_web_page_preview: true },
    { chatId, channel },
  )
  if (result) log.info({ chatId, channel }, 'Telegram notification sent successfully')
}

/**
 * Send a forecast's running Telegram notification, editing the previously
 * sent message in place when one exists (daatan#1215) instead of spamming a
 * new one on every article match. Falls back to a fresh send — and adopts
 * its message id going forward — when the edit fails (message outside
 * Telegram's ~48h edit window, deleted, or any other API error).
 */
async function sendOrEditForecastNotification(
  predictionId: string,
  message: string,
  channel: TelegramChannel = 'noisy',
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = resolveChatId(channel)

  if (!token || !chatId) {
    log.warn({ hasToken: !!token, hasChatId: !!chatId, channel }, 'Telegram not configured')
    return
  }

  const prefixed = `[${envPrefix()}] ${message}`
  const existing = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { telegramMessageId: true, telegramChatId: true },
  })

  if (existing?.telegramMessageId != null && existing.telegramChatId != null) {
    const edited = await callTelegramApi(
      token,
      'editMessageText',
      {
        chat_id: existing.telegramChatId,
        message_id: existing.telegramMessageId,
        text: prefixed,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { predictionId, chatId: existing.telegramChatId, messageId: existing.telegramMessageId, channel },
    )
    if (edited) {
      log.info({ predictionId }, 'Telegram notification edited in place')
      return
    }
    log.warn({ predictionId }, 'telegram_edit_failed_fallback_sent')
  }

  const sent = await callTelegramApi(
    token,
    'sendMessage',
    { chat_id: chatId, text: prefixed, parse_mode: 'HTML', disable_web_page_preview: true },
    { predictionId, chatId, channel },
  )
  if (!sent) return

  log.info({ predictionId, chatId, channel }, 'Telegram notification sent successfully')
  await prisma.prediction
    .update({ where: { id: predictionId }, data: { telegramMessageId: sent.message_id, telegramChatId: chatId } })
    .catch((err) => log.error({ err, predictionId }, 'Failed to persist Telegram message id'))
}

// ============================================
// Error notifications (rate-limited)
// ============================================

const errorCooldowns = new Map<string, number>()
const ERROR_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes — avoid flooding the channel

function canNotify(key: string): boolean {
  const last = errorCooldowns.get(key)
  if (last && Date.now() - last < ERROR_COOLDOWN_MS) return false
  errorCooldowns.set(key, Date.now())
  return true
}

export function notifyServerError(route: string, error: Error): void {
  if (isDevEnv()) return
  const key = `server-error:${route}:${error.constructor.name}`
  if (!canNotify(key)) return

  const msg = [
    `🚨 <b>Server Error</b>`,
    `Route: <code>${escapeHtml(route)}</code>`,
    `Error: <code>${truncate(error.message, 200)}</code>`,
  ].join('\n')

  sendChannelNotification(msg)
}

export function notifyAllSearchProvidersFailed(query?: string): void {
  if (isDevEnv()) return
  if (!canNotify('search-all-providers-failed')) return

  const msg = [
    `⚠️ <b>All search providers failed</b>`,
    query ? `Query: <code>${truncate(query, 100)}</code>` : '',
    `Check Serper and SerpAPI credits — express forecast generation is degraded`,
  ].filter(Boolean).join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyOracleSearchUnavailable(query?: string): void {
  if (isDevEnv()) return
  if (!canNotify('oracle-search-unavailable')) return

  const msg = [
    `⚠️ <b>Oracle /search unavailable</b>`,
    query ? `Query: <code>${truncate(query, 100)}</code>` : '',
    `Falling back to local search providers`,
  ].filter(Boolean).join('\n')

  sendChannelNotification(msg)
}

export function notifySearchCreditsLow(provider: string, remaining: number): void {
  if (isDevEnv()) return
  if (!canNotify(`search-credits-low:${provider}`)) return

  const msg = [
    `⚠️ <b>Search credits low: ${escapeHtml(provider)}</b>`,
    `Remaining: <b>${remaining}</b>`,
    `Top up to avoid express forecast generation degradation`,
  ].join('\n')

  sendChannelNotification(msg)
}

export interface SearchHealthIssue {
  provider: string
  kind: 'exhausted' | 'low'
  credits?: number
}

/**
 * One grouped message for search-provider health, replacing the previous
 * per-provider flood (one alert per low/exhausted provider). Critical when no
 * usable providers remain.
 */
export function notifySearchHealthDigest(report: {
  issues: SearchHealthIssue[]
  overall: string
  usableCount: number
}): void {
  if (isDevEnv()) return
  if (report.issues.length === 0 && report.overall !== 'unhealthy') return
  if (!canNotify('search-health-digest')) return

  const critical = report.overall === 'unhealthy' || report.usableCount === 0
  const header = critical
    ? `🚨 <b>All search providers failed</b>`
    : `⚠️ <b>Search provider health</b>`

  const lines = report.issues.map((i) =>
    i.kind === 'exhausted'
      ? `• <b>${escapeHtml(i.provider)}</b>: exhausted`
      : `• <b>${escapeHtml(i.provider)}</b>: ${i.credits ?? '?'} credits left`,
  )

  const msg = [
    header,
    `Usable providers: <b>${report.usableCount}</b>`,
    ...lines,
    critical ? `Express forecast generation is degraded — top up / investigate.` : '',
  ].filter(Boolean).join('\n')

  // A critical digest (no usable providers) is a page-worthy alarm → clean;
  // routine low-credit digests stay on the noisy channel.
  sendChannelNotification(msg, critical ? 'clean' : 'noisy')
}

// ============================================
// Event-specific notification helpers
// ============================================

interface ForecastInfo {
  id: string
  claimText: string
  slug?: string | null
}

interface UserInfo {
  name: string | null
  username: string | null
}

/**
 * Escape the characters Telegram's `parse_mode: 'HTML'` treats specially.
 * Every message this file sends goes through this mode, so any dynamic value
 * reaching the message — a claim, a comment, a headline, a URL, an error
 * string — needs this or a stray `<`, `>`, or `&` (an "AT&T" headline, a
 * `?a=1&b=2` tracking URL, a user typing "<3") breaks Telegram's parser and
 * the whole message silently fails to send. `&` must be replaced first, or
 * escaping `<`/`>`/`"` afterward would double-escape the `&` those introduce.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function userName(user: UserInfo): string {
  return escapeHtml(user.name || user.username || 'Someone')
}

/**
 * Truncate raw text to `max` chars, then escape — in that order. Escaping
 * first would count entity-expanded characters (`&` → `&amp;`, 5 chars)
 * against the truncation limit and could cut an entity in half.
 */
function truncate(text: string, max: number): string {
  const t = text.length > max ? text.substring(0, max) + '...' : text
  return escapeHtml(t)
}

function forecastUrl(prediction: ForecastInfo): string {
  const base = process.env.NEXTAUTH_URL || 'https://daatan.com'
  return escapeHtml(`${base}/forecasts/${prediction.slug || prediction.id}`)
}

export function notifyForecastPublished(prediction: ForecastInfo, author: UserInfo): void {
  const msg = [
    `📢 <b>New forecast published</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `by ${userName(author)}`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyNewCommitment(
  prediction: ForecastInfo,
  user: UserInfo,
  cuCommitted: number,
  choice: string,
): void {
  const msg = [
    `🎯 <b>New commitment</b>`,
    `${userName(user)} committed ${cuCommitted} CU (${escapeHtml(choice)}) on:`,
    `"${truncate(prediction.claimText, 120)}"`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyNewComment(
  prediction: ForecastInfo,
  author: UserInfo,
  text: string,
): void {
  const msg = [
    `💬 <b>New comment</b>`,
    `${userName(author)} on "${truncate(prediction.claimText, 80)}":`,
    `"${truncate(text, 150)}"`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyForecastResolved(
  prediction: ForecastInfo,
  outcome: string,
  commitmentCount: number,
): void {
  const outcomeLabel = outcome.toUpperCase()
  const msg = [
    `⚖️ <b>Forecast resolved: ${outcomeLabel}</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `${commitmentCount} commitment${commitmentCount !== 1 ? 's' : ''} processed`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyBotForecastApproved(
  prediction: ForecastInfo,
  botAuthor: UserInfo,
  approver: UserInfo,
): void {
  const msg = [
    `✅ <b>Bot forecast approved</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Bot: ${userName(botAuthor)} → approved by ${userName(approver)}`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg)
}

export function notifyBotForecastRejected(
  prediction: ForecastInfo,
  botAuthor: UserInfo,
  rejector: UserInfo,
): void {
  const msg = [
    `❌ <b>Bot forecast rejected</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Bot: ${userName(botAuthor)} → rejected by ${userName(rejector)}`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg)
}

export function notifyNewUserRegistered(user: {
  email: string
  name?: string | null
  provider?: string
}): void {
  const msg = [
    `🆕 <b>New user registered</b>`,
    `Email: <code>${escapeHtml(user.email)}</code>`,
    user.name ? `Name: <b>${escapeHtml(user.name)}</b>` : '',
    `Provider: <code>${escapeHtml(user.provider || 'credentials')}</code>`,
  ].filter(Boolean).join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifySecurityError(
  pathname: string,
  status: number,
  message: string,
  user?: { id: string; email?: string | null }
): void {
  if (isDevEnv()) return
  // Avoid flooding the channel with common security probes
  const key = `security-error:${pathname}:${status}`
  if (!canNotify(key)) return

  const msg = [
    `🛡️ <b>Security Event</b>`,
    `Status: <b>${status}</b>`,
    `Route: <code>${escapeHtml(pathname)}</code>`,
    `Message: <code>${escapeHtml(message)}</code>`,
    user ? `User: <code>${escapeHtml(user.email || user.id)}</code>` : 'User: <i>Anonymous</i>',
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyResourceNotFound(pathname: string, details?: string): void {
  if (isDevEnv()) return
  const key = `404:${pathname}`
  if (!canNotify(key)) return

  const msg = [
    `🔗 <b>Dead Link / Not Found</b>`,
    `Route: <code>${escapeHtml(pathname)}</code>`,
    details ? `Details: <code>${truncate(details, 100)}</code>` : '',
  ].filter(Boolean).join('\n')

  sendChannelNotification(msg)
}

export function notifyLlmError(
  provider: string,
  error: string,
  model?: string
): void {
  if (isDevEnv()) return
  const key = `llm-error:${provider}`
  if (!canNotify(key)) return

  const msg = [
    `🤖 <b>LLM Provider Error</b>`,
    `Provider: <b>${escapeHtml(provider)}</b>`,
    model ? `Model: <code>${escapeHtml(model)}</code>` : '',
    `Error: <code>${truncate(error, 200)}</code>`,
  ].filter(Boolean).join('\n')

  sendChannelNotification(msg)
}

export function notifyTranslationFailed(
  predictionId: string,
  language: string,
  field: string,
  error: unknown,
): void {
  if (isDevEnv()) return
  const key = `translation-failed:${language}`
  if (!canNotify(key)) return

  const errMsg = error instanceof Error ? error.message : String(error)
  const msg = [
    `🌐 <b>Translation failed</b>`,
    `Prediction: <code>${escapeHtml(predictionId)}</code>`,
    `Language: <b>${escapeHtml(language)}</b> · Field: <code>${escapeHtml(field)}</code>`,
    `Error: <code>${truncate(errMsg, 200)}</code>`,
  ].join('\n')

  sendChannelNotification(msg)
}

export function notifyDiskSpaceLow(
  instanceId: string,
  usage: string,
  threshold: string
): void {
  if (isDevEnv()) return
  const key = `disk-low:${instanceId}`
  if (!canNotify(key)) return

  const msg = [
    `💾 <b>Critical: Disk Space Low</b>`,
    `Instance: <code>${escapeHtml(instanceId)}</code>`,
    `Usage: <b style="color: red">${escapeHtml(usage)}</b> (Threshold: ${escapeHtml(threshold)})`,
    `Immediate action required to avoid deployment failures.`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyMemoryPressure(
  instanceId: string,
  usedMb: number,
  totalMb: number,
  usagePct: number
): void {
  if (isDevEnv()) return
  const key = `memory-pressure:${instanceId}`
  if (!canNotify(key)) return

  const msg = [
    `🧠 <b>Critical: Memory Pressure</b>`,
    `Instance: <code>${escapeHtml(instanceId)}</code>`,
    `Memory: <b>${usedMb} MB / ${totalMb} MB (${usagePct}%)</b>`,
    `High memory usage may cause OOM kills or severe slowdowns.`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyHighLoad(
  instanceId: string,
  load1: string,
  load5: string,
  cpuCores: number
): void {
  if (isDevEnv()) return
  const key = `high-load:${instanceId}`
  if (!canNotify(key)) return

  const msg = [
    `🔥 <b>Critical: High CPU Load</b>`,
    `Instance: <code>${escapeHtml(instanceId)}</code>`,
    `Load avg: <b>${escapeHtml(load1)} (1m) / ${escapeHtml(load5)} (5m)</b>`,
    `CPU cores: ${cpuCores} — sustained load above ${cpuCores * 2}x normal.`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyOracleForecastUnavailable(): void {
  if (isDevEnv()) return
  if (!canNotify('oracle-forecast-unavailable')) return

  const msg = [
    `🚨 <b>Oracle /forecast unavailable</b>`,
    `The TruthMachine Oracle is unreachable or failing health checks.`,
    `Forecast context analysis is falling back to LLM-only estimates.`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyOracleForecastRecovered(): void {
  if (isDevEnv()) return
  if (!canNotify('oracle-forecast-recovered')) return

  const msg = `✅ <b>Oracle /forecast recovered</b> — health check passing again.`
  sendChannelNotification(msg, 'clean')
}

/**
 * One daily rollup of activity + provider health, replacing the bare heartbeat.
 * Still proves the server is alive (it's emitted by the app process), but the
 * single message carries the day's numbers instead of just "alive".
 */
export function notifyDailySummary(stats: {
  version: string
  newUsers: number
  published: number
  commitments: number
  resolutions: number
  search: { usable: number; total: number } | null
}): void {
  if (isDevEnv()) return

  const searchLine = stats.search
    ? `🔎 Search providers: <b>${stats.search.usable}/${stats.search.total}</b> usable`
    : `🔎 Search providers: <i>unknown</i>`

  const msg = [
    `📊 <b>Daily summary</b> — v${escapeHtml(stats.version)}`,
    `🆕 New users: <b>${stats.newUsers}</b>`,
    `📢 Forecasts published: <b>${stats.published}</b>`,
    `🎯 New commitments: <b>${stats.commitments}</b>`,
    `⚖️ Resolved: <b>${stats.resolutions}</b>`,
    searchLine,
    `<i>Last 24h · sent from the server (EC2 app process).</i>`,
  ].join('\n')

  sendChannelNotification(msg)
}

/**
 * A news-indexer push landed a new Oracle read. Leads with the probability
 * move — that's the news; the level and its confidence band are supporting
 * detail, and similarity/article-count drop to a footer. Only called for a
 * push that actually changed something: a re-delivered push that dedups to
 * nothing (see context.ts's `saveNewsIndexerMatch`) is the caller's job to
 * skip, not this function's — see news-indexer/context/route.ts's `wasStored`.
 */
export async function notifyNewsArticleMatched(
  prediction: { id: string; claimText: string; slug?: string | null },
  article: {
    title: string
    url: string
    source: string | null
    stance?: number | null
    relevance?: number | null
    authorLean?: number | null
    authorLeanCertainty?: number | null
    factSignal?: number | null
    evidenceClass?: string | null
    credibilityWeight?: number | null
  },
  match: { similarity: number; articleCount?: number },
  estimate: { probability: number; previous: number | null; ciLow: number | null; ciHigh: number | null },
): Promise<void> {
  if (isDevEnv()) return

  const { probability, previous, ciLow, ciHigh } = estimate
  const headerLine =
    previous === null
      ? `🗞️ <b>Oracle ${probability}%</b> · first estimate`
      : previous === probability
        ? `🗞️ <b>Oracle ${probability}%</b> · unchanged`
        : `🗞️ <b>Oracle ${previous}% → ${probability}%</b>  (${probability > previous ? '+' : ''}${probability - previous})`

  // A confidence band under 2 points wide is display noise, not signal — and a
  // missing bound (older snapshots predate ciLow/ciHigh) omits the line entirely
  // rather than rendering a broken range.
  const rangeLine =
    ciLow !== null && ciHigh !== null && ciHigh - ciLow >= 2 ? `\n     range ${ciLow}–${ciHigh}%` : ''

  const sourceLabel = article.source ? ` — ${escapeHtml(article.source)}` : ''
  const articleCount = match.articleCount ?? 1
  const countLabel = articleCount > 1 ? `${articleCount} articles · ` : ''
  const simPct = Math.round(match.similarity * 100)

  // What this ONE article actually said, and how much it counted — without these the message
  // reports that the estimate moved but never why, so a reader can't tell a decisive on-topic
  // article from a marginal one that happened to trip the gate.
  //   stance    [-1,1] — which way it argues. Rendered signed: -0.72 reads as "argues NO".
  //   relevance [0,1]  — the Oracle's claim-aware judgment of whether it bears on the claim at
  //                      all; its SQUARE weights the article in aggregation, so 0.5 counts a
  //                      quarter as much as 1.0. This is the number that explains a match.
  //   match %          — embedding cosine. Deliberately last: it's the weakest of the three,
  //                      and the one we've proven misranks (news-indexer#124).
  // Each is omitted when unknown: an older Oracle response, or a daatan prod that predates the
  // relevance passthrough, must degrade to today's message rather than print "null".
  const signals = [
    article.stance != null ? `stance ${article.stance > 0 ? '+' : ''}${article.stance.toFixed(2)}` : null,
    article.relevance != null ? `relevance ${article.relevance.toFixed(2)}` : null,
    `match ${simPct}%`,
  ].filter(Boolean)

  // Judgment-lane signals (Signal Lanes): un-fused from `stance`, shadow-only — nothing in the
  // Oracle's own aggregation reads them yet, so this line is the only place they're visible at
  // all. Same omit-when-unknown rule as `signals` above; `credibilityWeight` is pre-filtered to
  // null at the caller while the credibility cutover flag is OFF, since 1.0 is a neutral default
  // rather than a real judgment.
  const judgmentSignals = [
    article.authorLean != null
      ? `author_lean ${article.authorLean > 0 ? '+' : ''}${article.authorLean.toFixed(2)}${
          article.authorLeanCertainty != null ? ` (cert ${article.authorLeanCertainty.toFixed(2)})` : ''
        }`
      : null,
    article.factSignal != null
      ? `fact_signal ${article.factSignal > 0 ? '+' : ''}${article.factSignal.toFixed(2)}`
      : null,
    article.credibilityWeight != null ? `credibility ${article.credibilityWeight.toFixed(2)}` : null,
    article.evidenceClass ?? null,
  ].filter(Boolean)

  const msg = [
    `${headerLine}${rangeLine}`,
    `"${truncate(prediction.claimText, 120)}"`,
    '',
    `📰 <a href="${escapeHtml(article.url)}">${truncate(article.title, 100)}</a>${sourceLabel}`,
    `     ${countLabel}${signals.join(' · ')}`,
    ...(judgmentSignals.length > 0 ? [`     🔎 ${judgmentSignals.join(' · ')}`] : []),
    '',
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  await sendOrEditForecastNotification(prediction.id, msg)
}

/**
 * The AI estimate crossed the high-confidence threshold (≥80%) from below.
 * Fired by every path that writes a new confidence value (news-indexer pushes,
 * user-triggered "analyze context", admin backfill) — the crossing check lives
 * in `context.ts`, so a forecast hovering at 82 doesn't re-alert on each push.
 * `settled` marks the Oracle's settlement detection: enough sources reported
 * the outcome as an accomplished fact, so the forecast is a resolution candidate.
 */
export function notifyHighConfidence(
  prediction: { id: string; claimText: string; slug?: string | null },
  probability: number,
  previous: number | null,
  settled = false,
): void {
  if (isDevEnv()) return

  const fromLine = previous !== null ? ` (from ${previous}%)` : ''
  const settledLine = settled
    ? '\n✅ Oracle reports the outcome as <b>settled</b> — consider resolving'
    : ''

  const msg = [
    `📈 <b>High AI confidence</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `AI estimate: <b>${probability}%</b>${fromLine}${settledLine}`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

/**
 * The requote cron's daily glide moved the literal claim deadline into the
 * past with no settlement detected. Fired at the LITERAL claimDeadline, never
 * at the tau_lead-adjusted effective horizon — that horizon is a pricing
 * concept, and prompting a human to resolve early on the strength of an LLM
 * lead-time inference would be wrong. Single-shot (deduped in temporal-clock.ts).
 */
export function notifyDeadlinePassedQuietly(
  prediction: { id: string; claimText: string; slug?: string | null },
  direction: 'arrival' | 'survival',
  deadline: Date,
): void {
  if (isDevEnv()) return

  const verb = direction === 'arrival' ? 'NO' : 'YES'
  const msg = [
    `⏰ <b>Deadline passed quietly</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Claim deadline ${deadline.toISOString().slice(0, 10)} has passed with no settlement reported — consider resolving <b>${verb}</b>.`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

/**
 * A forecast is stuck PENDING past its claim deadline with no automated path
 * to resolution (#1185): the alert above only ever fires on ACTIVE
 * candidates, and the AI resolution panel only picks up the probability-band
 * flag — a PENDING pred outside that band is invisible to both. Single-shot
 * (deduped via deadlinePassedAlertAt in temporal-clock.ts).
 */
export function notifyPendingPastDeadline(
  prediction: { id: string; claimText: string; slug?: string | null },
  deadline: Date,
): void {
  if (isDevEnv()) return

  const msg = [
    `🚨 <b>Stuck PENDING past deadline</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Deadline ${deadline.toISOString().slice(0, 10)} has passed but nothing will auto-resolve this forecast — resolve it via the admin UI.`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

/**
 * The glide reached its tau_lead-adjusted horizon before the literal claim
 * deadline (a statutory/lead-time inference from the classifier LLM, not a
 * plain calendar fact) — a lower-key note, NOT the resolve-now alert above.
 */
export function notifyProvisionalImpossibility(
  prediction: { id: string; claimText: string; slug?: string | null },
  effectiveHorizon: Date,
  claimDeadline: Date,
  tauLeadDays: number,
): void {
  if (isDevEnv()) return

  const msg = [
    `🕰 <b>Provisional impossibility</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Impossible per lead-time analysis (τ_lead=${tauLeadDays}d, effective horizon ${effectiveHorizon.toISOString().slice(0, 10)}, claim deadline ${claimDeadline.toISOString().slice(0, 10)}). Verify the reasoning; early resolution optional.`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'noisy')
}

/**
 * claimDeadline (LLM-parsed from claim text) and resolveByDatetime (platform-
 * authoritative) disagree beyond tolerance — the glide is still running
 * (toward the later, safer date) but the hard pin is suppressed pending review.
 */
export function notifyDeadlineDivergence(
  prediction: { id: string; claimText: string; slug?: string | null },
  claimDeadline: Date,
  resolveByDatetime: Date,
): void {
  if (isDevEnv()) return

  const days = Math.round(Math.abs(claimDeadline.getTime() - resolveByDatetime.getTime()) / 86_400_000)
  const msg = [
    `⚠️ <b>Deadline disagreement</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Classifier deadline ${claimDeadline.toISOString().slice(0, 10)} vs resolveBy ${resolveByDatetime.toISOString().slice(0, 10)} (${days}d apart). Gliding toward the later date; hard pin suppressed. Review the classification.`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'noisy')
}

/**
 * A linked prediction market's implied probability and our Oracle estimate
 * disagree by more than the divergence threshold — worth a human look
 * (mispriced market, stale Oracle estimate, or a real edge).
 */
export function notifyMarketDivergence(
  prediction: { id: string; claimText: string; slug?: string | null },
  marketProbability: number,
  oracleProbability: number,
  gapPts: number,
): void {
  if (isDevEnv()) return

  const msg = [
    `📊 <b>Market ⇄ Oracle divergence</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Market ${marketProbability}% vs Oracle ${oracleProbability}% (Δ ${gapPts}pt).`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'noisy')
}

/** Daily fleet digest for the requote cron — only sent when something moved. */
export function notifyRequoteSummary(s: {
  glided: number
  pinned: number
  maxDeltaPts: number
  divergences: number
}): void {
  if (isDevEnv()) return

  const msg = [
    `🕐 <b>Requote summary</b>`,
    `Glided: ${s.glided} · Pinned: ${s.pinned} · Max Δ: ${s.maxDeltaPts}pt${s.divergences ? ` · Divergences: ${s.divergences}` : ''}`,
  ].join('\n')

  sendChannelNotification(msg, 'noisy')
}

export function notifyBackupVerificationFailed(reason: string): void {
  if (isDevEnv()) return
  const msg = [
    `🚨 <b>Backup Verification FAILED</b>`,
    `The latest backup was uploaded but could not be restored successfully.`,
    `Reason: <code>${escapeHtml(reason)}</code>`,
    `<b>Manual investigation required — backup may be corrupt.</b>`,
  ].join('\n')
  sendChannelNotification(msg, 'clean')
}
