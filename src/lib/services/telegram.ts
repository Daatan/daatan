import { createLogger } from '@/lib/logger'

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

  try {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: prefixed,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      log.error({ status: res.status, body, chatId, channel }, 'Telegram API error')
    } else {
      log.info({ chatId, channel }, 'Telegram notification sent successfully')
    }
  } catch (err) {
    log.error({ err, chatId, channel }, 'Failed to send Telegram notification')
  }
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
    `Route: <code>${route}</code>`,
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
    `⚠️ <b>Search credits low: ${provider}</b>`,
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
      ? `• <b>${i.provider}</b>: exhausted`
      : `• <b>${i.provider}</b>: ${i.credits ?? '?'} credits left`,
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

function userName(user: UserInfo): string {
  return user.name || user.username || 'Someone'
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + '...' : text
}

function forecastUrl(prediction: ForecastInfo): string {
  const base = process.env.NEXTAUTH_URL || 'https://daatan.com'
  return `${base}/forecasts/${prediction.slug || prediction.id}`
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
    `${userName(user)} committed ${cuCommitted} CU (${choice}) on:`,
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
    `Email: <code>${user.email}</code>`,
    user.name ? `Name: <b>${user.name}</b>` : '',
    `Provider: <code>${user.provider || 'credentials'}</code>`,
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
    `Route: <code>${pathname}</code>`,
    `Message: <code>${message}</code>`,
    user ? `User: <code>${user.email || user.id}</code>` : 'User: <i>Anonymous</i>',
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

export function notifyResourceNotFound(pathname: string, details?: string): void {
  if (isDevEnv()) return
  const key = `404:${pathname}`
  if (!canNotify(key)) return

  const msg = [
    `🔗 <b>Dead Link / Not Found</b>`,
    `Route: <code>${pathname}</code>`,
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
    `Provider: <b>${provider}</b>`,
    model ? `Model: <code>${model}</code>` : '',
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
    `Prediction: <code>${predictionId}</code>`,
    `Language: <b>${language}</b> · Field: <code>${field}</code>`,
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
    `Instance: <code>${instanceId}</code>`,
    `Usage: <b style="color: red">${usage}</b> (Threshold: ${threshold})`,
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
    `Instance: <code>${instanceId}</code>`,
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
    `Instance: <code>${instanceId}</code>`,
    `Load avg: <b>${load1} (1m) / ${load5} (5m)</b>`,
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
    `📊 <b>Daily summary</b> — v${stats.version}`,
    `🆕 New users: <b>${stats.newUsers}</b>`,
    `📢 Forecasts published: <b>${stats.published}</b>`,
    `🎯 New commitments: <b>${stats.commitments}</b>`,
    `⚖️ Resolved: <b>${stats.resolutions}</b>`,
    searchLine,
    `<i>Last 24h · sent from the server (EC2 app process).</i>`,
  ].join('\n')

  sendChannelNotification(msg)
}

export function notifyNewsArticleMatched(
  prediction: { id: string; claimText: string; slug?: string | null },
  article: { title: string; url: string; source: string | null },
  similarity: number,
  probability: number | null,
  articleCount = 1,
  previousProbability: number | null = null,
): void {
  if (isDevEnv()) return

  const sourceLabel = article.source ? ` · ${article.source}` : ''
  const simPct = Math.round(similarity * 100)
  // Distinguish a fresh estimate from an update to an existing one, so repeat
  // notifications for the same forecast read as new information, not duplicates.
  const changeLabel =
    previousProbability === null
      ? ' (first estimate)'
      : previousProbability === probability
        ? ' (unchanged)'
        : ` (was ${previousProbability}%)`
  const probLine = probability !== null ? ` · Oracle: <b>${probability}%</b>${changeLabel}` : ''
  // When the estimate aggregates several articles, note how many backed it.
  const evidenceLine = articleCount > 1 ? `\nBased on <b>${articleCount}</b> articles` : ''

  const msg = [
    `🗞️ <b>News match</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `<a href="${article.url}">${truncate(article.title, 100)}</a>`,
    `Similarity: <b>${simPct}%</b>${sourceLabel}${probLine}${evidenceLine}`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg)
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
    `Reason: <code>${reason}</code>`,
    `<b>Manual investigation required — backup may be corrupt.</b>`,
  ].join('\n')
  sendChannelNotification(msg, 'clean')
}
