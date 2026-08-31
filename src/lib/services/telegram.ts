import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { getAppUrl } from '@/lib/branding'
import type { NumberFeedbackField } from '@prisma/client'

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
  method: 'sendMessage' | 'editMessageText' | 'editMessageReplyMarkup',
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
 * `replyMarkup` is optional — only the rating-prompt sender (daatan#1223) uses it
 * today; every other caller ignores the returned message id.
 */
async function sendChannelNotification(
  message: string,
  channel: TelegramChannel = 'noisy',
  replyMarkup?: Record<string, unknown>,
): Promise<{ message_id: number } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = resolveChatId(channel)

  if (!token || !chatId) {
    log.warn({ hasToken: !!token, hasChatId: !!chatId, channel }, 'Telegram not configured')
    return null
  }

  const prefix = envPrefix()
  const prefixed = `[${prefix}] ${message}`

  log.debug({ chatId, prefix, channel }, 'Sending Telegram notification')

  const result = await callTelegramApi(
    token,
    'sendMessage',
    {
      chat_id: chatId,
      text: prefixed,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    },
    { chatId, channel },
  )
  if (result) log.info({ chatId, channel }, 'Telegram notification sent successfully')
  return result
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

/**
 * One condition the evidence pipeline is currently failing (daatan#1478).
 * The pool variants are each a DELTA against the same population's own baseline —
 * see `evidence-health.ts` for why an absolute failure rate can't be alerted on.
 * The `batch_heartbeat_*` pair is the exception: it watches an external liveness
 * signal (the TruthMachine batch loop's atlas commits, retro#556), where absolute
 * staleness IS the condition.
 */
export type EvidenceHealthIssue =
  | { kind: 'source_failure_rate'; source: string; recentPct: number; baselinePct: number; recentRows: number }
  | { kind: 'source_silent'; source: string; baselineRows: number }
  | { kind: 'forecast_no_evidence'; predictionId: string; claimText: string; slug: string | null }
  | { kind: 'overall_failure_rate'; recentPct: number; baselinePct: number }
  | { kind: 'overall_volume_collapse'; recentPerDay: number; baselinePerDay: number }
  // Not a delta: any 402 at all means the shared OpenRouter account is out of
  // credits and every panel member on that route is down (daatan#1504).
  | { kind: 'panel_payment_failure'; count: number; lastSeenAt: Date; lastModel: string }
  // Not a delta either: an external liveness signal — the TruthMachine batch
  // loop's atlas commits (retro#556) — where absolute staleness IS the condition.
  | { kind: 'batch_heartbeat_stale'; hoursSince: number; thresholdHours: number; lastCommitAt: string }
  | { kind: 'batch_heartbeat_unreachable'; detail: string }

/** Keeps a first run (or a genuine pipeline-wide failure) inside Telegram's message limit. */
const EVIDENCE_HEALTH_MAX_LINES = 12

function evidenceHealthLine(i: EvidenceHealthIssue): string {
  switch (i.kind) {
    case 'source_failure_rate':
      return `• <b>${escapeHtml(i.source)}</b>: failures ${i.baselinePct}% → <b>${i.recentPct}%</b> (${i.recentRows} rows)`
    case 'source_silent':
      return `• <b>${escapeHtml(i.source)}</b>: silent — 0 rows this week, ${i.baselineRows} in the baseline`
    case 'forecast_no_evidence': {
      const url = forecastUrl({ id: i.predictionId, claimText: i.claimText, slug: i.slug })
      return `• no usable evidence: <a href="${url}">${escapeHtml(truncate(i.claimText, 90))}</a>`
    }
    case 'overall_failure_rate':
      return `• <b>overall failure share</b>: ${i.baselinePct}% → <b>${i.recentPct}%</b>`
    case 'overall_volume_collapse':
      return `• <b>ingestion volume</b>: ${i.baselinePerDay}/day → <b>${i.recentPerDay}/day</b>`
    case 'panel_payment_failure':
      return (
        `• <b>AI panel</b>: ${i.count} × HTTP 402 from OpenRouter — credits exhausted, ` +
        `all OpenRouter members down (last ${i.lastSeenAt.toISOString().slice(0, 16)}Z, ${escapeHtml(i.lastModel)})`
      )
    case 'batch_heartbeat_stale':
      return (
        `• <b>TruthMachine batch loop</b>: no atlas commit for <b>${i.hoursSince}h</b> ` +
        `(threshold ${i.thresholdHours}h, last ${escapeHtml(i.lastCommitAt)}) — ` +
        `check the batch tree on the Oracle box (retro#556)`
      )
    case 'batch_heartbeat_unreachable':
      return `• <b>TruthMachine batch loop</b>: heartbeat unreadable — ${escapeHtml(i.detail)} (GitHub API problem, not proof the loop is down)`
  }
}

/**
 * The evidence pipeline's counterpart to `notifySearchHealthDigest` — one grouped
 * message per check listing what newly broke, sent only when something did.
 *
 * No `canNotify` cooldown here, deliberately: dedup is the DB-persisted fire/re-arm
 * state in `evidence-health.ts`, and these conditions last for days, so an
 * in-memory cooldown would both re-page after every deploy and swallow a genuinely
 * different digest that happened to land inside the window.
 */
export function notifyEvidenceHealthDigest(report: {
  issues: EvidenceHealthIssue[]
  recentDays: number
  baselineDays: number
  recentRows: number
  recentFailedPct: number | null
  baselineFailedPct: number | null
  suppressed: number
}): void {
  if (isDevEnv()) return
  if (report.issues.length === 0) return

  // A pipeline-wide move is page-worthy; per-source drift and individual empty
  // pools are operational. Same split as the search-health digest. A 402 burst is
  // total panel outage (every OpenRouter member fails together), so it sits on the
  // page-worthy side — still the digest, not a pager (daatan#1504). A dead batch
  // loop joins it too: it ran stale code for six weeks once with nobody noticing
  // (retro#553/#556). An UNREACHABLE heartbeat stays noisy — a GitHub API blip is
  // not a production incident.
  const critical = report.issues.some(
    (i) =>
      i.kind === 'overall_failure_rate' ||
      i.kind === 'overall_volume_collapse' ||
      i.kind === 'panel_payment_failure' ||
      i.kind === 'batch_heartbeat_stale',
  )

  const lines = report.issues.slice(0, EVIDENCE_HEALTH_MAX_LINES).map(evidenceHealthLine)
  const overflow = report.issues.length - lines.length

  const msg = [
    critical ? `🚨 <b>Evidence pipeline degraded</b>` : `⚠️ <b>Evidence pipeline health</b>`,
    `Failed share: <b>${report.recentFailedPct ?? '?'}%</b> over ${report.recentDays}d ` +
      `(${report.recentRows} rows) vs <b>${report.baselineFailedPct ?? '?'}%</b> baseline (${report.baselineDays}d)`,
    ...lines,
    overflow > 0 ? `…and ${overflow} more` : '',
    report.suppressed > 0 ? `(${report.suppressed} already-known condition(s) still open)` : '',
  ].filter(Boolean).join('\n')

  sendChannelNotification(msg, critical ? 'clean' : 'noisy')
}

/** One flagged case from the twice-weekly evidence-second-opinion cron (daatan#1636). */
export type EvidenceSecondOpinionIssue =
  | {
      kind: 'model_disagreement'
      predictionId: string
      claimText: string
      slug: string | null
      articleUrl: string
      articleTitle: string
      cheapPct: number
      expensivePct: number
      publishedPct: number
    }
  | {
      kind: 'source_drift'
      predictionId: string
      claimText: string
      slug: string | null
      source: string
      olderPct: number
      newerPct: number
      olderDate: string
      newerDate: string
    }

const EVIDENCE_SECOND_OPINION_MAX_LINES = 12

function evidenceSecondOpinionLine(i: EvidenceSecondOpinionIssue): string {
  const url = forecastUrl({ id: i.predictionId, claimText: i.claimText, slug: i.slug })
  switch (i.kind) {
    case 'model_disagreement':
      return (
        `• <a href="${url}">${escapeHtml(truncate(i.claimText, 70))}</a>: cheap <b>${i.cheapPct}%</b> vs ` +
        `expensive <b>${i.expensivePct}%</b> (published ${i.publishedPct}%) — ` +
        `<a href="${escapeHtml(i.articleUrl)}">${escapeHtml(truncate(i.articleTitle, 60))}</a>`
      )
    case 'source_drift':
      return (
        `• <a href="${url}">${escapeHtml(truncate(i.claimText, 70))}</a>: ` +
        `<b>${escapeHtml(i.source)}</b> ${i.olderPct}% (${escapeHtml(i.olderDate)}) → ` +
        `<b>${i.newerPct}%</b> (${escapeHtml(i.newerDate)})`
      )
  }
}

/**
 * Twice-weekly "interesting cases" digest (daatan#1636): articles whose extracted
 * stance disagrees between a cheap and an expensive re-read of the SAME article
 * (detector 1), plus same-source stance drift over time (detector 2). Mechanical —
 * no auto-filed issues, a human triages via `/audit` or manually. Always the noisy
 * channel: this is a "worth a look" signal, not a page.
 */
export function notifyEvidenceSecondOpinionDigest(report: {
  issues: EvidenceSecondOpinionIssue[]
  articlesChecked: number
}): void {
  if (isDevEnv()) return
  if (report.issues.length === 0) return

  const lines = report.issues.slice(0, EVIDENCE_SECOND_OPINION_MAX_LINES).map(evidenceSecondOpinionLine)
  const overflow = report.issues.length - lines.length

  const msg = [
    `🔍 <b>Evidence second opinion</b> — ${report.articlesChecked} article(s) re-checked`,
    ...lines,
    overflow > 0 ? `…and ${overflow} more` : '',
  ].filter(Boolean).join('\n')

  sendChannelNotification(msg, 'noisy')
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
  const base = process.env.NEXTAUTH_URL || getAppUrl()
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
 * A news-indexer push landed a new Oracul read. Fires PER SOURCE ARTICLE, to the
 * NOISY channel — not to be confused with news-indexer's own hourly "N new
 * articles per source" digest, which is a separate repo/mechanism entirely
 * (news-indexer/src/news_indexer/worker/digest.py + notifier.py). ONE fresh
 * message per push: the probability move leads, then the triggering article
 * (link + short extract), every per-article number in a monospace table, the
 * forecast link — and the 1-5 rating buttons (daatan#1223) attached when the
 * trigger's evidence-pool row is known, which let a channel member RATE these
 * numbers (docs/TELEGRAM_NOTIFICATIONS.md#manual-number-rating-feedback-daatan1223,
 * public explainer at /help/rating-numbers). Deliberately freshly sent, not
 * edited in place: an edit never resurfaces in the channel feed, and a rating
 * tap must map 1:1 to exactly the numbers shown (which is why this function
 * also persists the ArticleRatingPrompt row the webhook resolves taps against).
 *
 * Only called for a push that actually changed something: a re-delivered push
 * that dedups to nothing (see context.ts's `saveNewsIndexerMatch`) is the
 * caller's job to skip, not this function's — see news-indexer/context/
 * route.ts's `wasStored`.
 */
/** Heading the article-match panel puts above the shadow-lane rows (daatan#1661): every row
 *  under it is captured and shown but NOT read by the Oracul's estimate. Exported for tests. */
export const SHADOW_MARKER = '<i>not in estimate:</i>'

/** The `reader_confidence` panel row (retro#681), or null when the claim carries none.
 *  The trap is appended rather than given its own row because it is only ever meaningful
 *  beside the level — "medium" alone is noise, "medium/numeric_comparison" says which
 *  reading the extractor thought it might have got wrong. */
export function readerRow(
  rc: { level?: string | null; trap?: string | null } | null | undefined,
): [string, string] | null {
  if (!rc?.level) return null
  return ['reader', rc.trap ? `${rc.level} (${rc.trap})` : rc.level]
}

/** The `quantity` panel row (retro#683), or null when the claim reports no figure — which
 *  is most claims.
 *
 *  Rendered VERBATIM. Two rules the renderer must not break:
 *   - `=` prints as a bare figure. "= 214 daily departures" reads like an assertion about
 *     the question; "214 daily departures" is what the article said.
 *   - value and unit are never recombined. The extractor legitimately returns the same
 *     figure as `452 / "thousand active US Army personnel"` and `452000 / "active US Army
 *     personnel"` — both obey the field description, and normalising either way would
 *     print a number the article never wrote. */
export function quantityRow(
  q:
    | { value: number; unit: string; comparator: string; value_hi?: number | null; as_of?: string | null }
    | null
    | undefined,
): [string, string] | null {
  if (!q || typeof q.value !== 'number' || !q.unit) return null
  const asOf = q.as_of ? ` @ ${q.as_of}` : ''
  if (q.comparator === 'between') {
    // A range without its upper bound is not a range; fall back to the lower bound alone
    // rather than print "between 1.8 and undefined".
    return q.value_hi == null
      ? ['quantity', `${q.value} ${q.unit}${asOf}`]
      : ['quantity', `${q.value}–${q.value_hi} ${q.unit}${asOf}`]
  }
  const op = q.comparator && q.comparator !== '=' ? `${q.comparator} ` : ''
  return ['quantity', `${op}${q.value} ${q.unit}${asOf}`]
}

/** The `grounds` panel row (retro#763), or null when the claim carries none.
 *  Rendered as the kind, spelled out, then the basis phrase after a middle dot:
 *  "authority asserted · the ministry's 12 March statement". The kind alone is a
 *  category a rater can check at a glance; the basis is the half that says whether
 *  two articles are repeating ONE reason, which is the field's whole purpose. */
export function groundsRow(
  g: { kind?: string | null; basis?: string | null } | null | undefined,
): [string, string] | null {
  if (!g?.kind) return null
  const kind = g.kind.replace(/_/g, ' ')
  return ['grounds', g.basis ? `${kind} · ${g.basis}` : kind]
}

export async function notifyNewsArticleMatched(
  prediction: { id: string; claimText: string; slug?: string | null },
  article: {
    title: string
    url: string
    source: string | null
    extract?: string | null
    stance?: number | null
    certainty?: number | null
    relevance?: number | null
    authorLean?: number | null
    authorLeanCertainty?: number | null
    factSignal?: number | null
    evidenceClass?: string | null
    credibilityWeight?: number | null
    consensusView?: string | null
    reportKind?: string | null
    readerConfidence?: { level?: string | null; trap?: string | null } | null
    quantity?: {
      value: number
      unit: string
      comparator: string
      value_hi?: number | null
      as_of?: string | null
    } | null
    grounds?: { kind?: string | null; basis?: string | null } | null
  },
  match: { similarity: number; articleCount?: number; poolSize?: number | null; usableSize?: number | null },
  estimate: { probability: number; previous: number | null; ciLow: number | null; ciHigh: number | null },
  rating?: { evidencePoolArticleId: string; contextSnapshotId: string | null } | null,
): Promise<void> {
  if (isDevEnv()) return

  const { probability, previous, ciLow, ciHigh } = estimate

  // Evidence-volume context lives in the header, next to the move it explains: how many
  // articles this push carried, and — when the estimate came from the pool path — how many
  // articles the whole evidence pool aggregates. One weak article barely moving a 22-article
  // pool is expected behavior, and this is what makes that legible.
  //
  // The pool count is quoted as "usable of pooled" (daatan#1475): 46% of all pool rows are
  // FAILED, so the raw number overstates real evidence by roughly 2× — a forecast that reads
  // as 150-article-strong can have almost nothing behind its number. Falls back to the bare
  // count only when a caller supplies no usable figure.
  const articleCount = match.articleCount ?? 1
  const volumeLabel =
    match.poolSize != null
      ? match.usableSize != null
        ? ` · ${articleCount} new / ${match.usableSize} of ${match.poolSize} usable in pool`
        : ` · ${articleCount} new / ${match.poolSize} in pool`
      : articleCount > 1
        ? ` · ${articleCount} articles`
        : ''
  const headerLine =
    previous === null
      ? `🗞️ <b>Oracle ${probability}%</b> · first estimate${volumeLabel}`
      : previous === probability
        ? `🗞️ <b>Oracle ${probability}%</b> · unchanged${volumeLabel}`
        : `🗞️ <b>Oracle ${previous}% → ${probability}%</b>  (${probability > previous ? '+' : ''}${probability - previous})${volumeLabel}`

  const sourceLabel = article.source ? ` — ${escapeHtml(article.source)}` : ''
  const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`
  const cert = (v: number | null | undefined) => (v != null ? ` (cert ${v.toFixed(2)})` : '')

  // Every number this push produced, one per row, null-omitted rather than printed as "null"
  // (an older Oracul response, or a daatan prod that predates a given passthrough, must
  // degrade to a shorter panel). The panel is split in two (daatan#1661): the rows the
  // Oracul's aggregation actually reads, then — under a "not in estimate" marker — the
  // shadow-lane fields it captures but does not read yet. That split is the ONE place the
  // live/shadow boundary is spelled out for readers; when Oracle 1.5 graduates a field, move
  // its row from `shadowRows` to `liveRows` and update /help/rating-numbers + docs/ — nothing
  // else in the renderer knows which is which.
  //
  //   stance      [-1,1] — which way the article argues; signed, so -0.72 reads as "argues NO".
  //                        The extractor's certainty about that reading rides along.
  //   relevance   [0,1]  — the Oracul's claim-aware judgment; its SQUARE weights the article
  //                        in aggregation, so 0.5 counts a quarter as much as 1.0.
  //   range              — omitted when under 2 points wide (display noise) or when a bound is
  //                        missing (older snapshots predate ciLow/ciHigh).
  //   author_lean/fact_signal/credibility/class/consensus/report_kind/reader/quantity —
  //                        judgment-lane and elicited shadow fields (Signal Lanes, retro#686,
  //                        #681, #683): nothing in the Oracul's own aggregation reads them, so
  //                        this panel is the only place they're visible at all.
  //                        `credibilityWeight` is pre-filtered to null at the caller while the
  //                        credibility cutover flag is OFF (1.0 is a neutral default, not a
  //                        judgment).
  //   reader      shows the extractor's confidence in its own READING (retro#681) — as against
  //                        the `certainty` riding on `stance`, which is the SOURCE's. The trap,
  //                        when set, is the informative half and is what makes the row worth a
  //                        line: "low/negation" says the panel's own numbers are suspect.
  //   quantity    the figure the claim reports and the relation the ARTICLE asserts about it
  //                        (retro#683) — NOT whether it clears the question's bar, which retro
  //                        decides in code. Rendered verbatim, never normalised: the same figure
  //                        comes back as `452 thousand active US Army personnel` and as `452000
  //                        active US Army personnel`, and folding either way would invent a
  //                        precision the article did not give.
  //   grounds     what the quoted claim's position RESTS ON (retro#763): the kind of reason
  //                        (a milestone, a statement, a poll figure, an inference, a precedent,
  //                        the writer's own view) and the phrase naming it. The one shadow row
  //                        that is readable by construction — it is the answer to "why does
  //                        this article think so?" — and the basis phrase is what lets a rater
  //                        see that two articles are repeating one ministry statement.
  //
  // The embedding cosine (`match.similarity`) is deliberately NOT a row any more: it is why
  // news-indexer pushed, not evidence about the claim, and under Funnel v2 the judge's
  // `relevance` is the gate. It stays persisted on the rating prompt (`snapshotSimilarity`).
  const liveRows: Array<[string, string] | null> = [
    article.stance != null ? ['stance', `${signed(article.stance)}${cert(article.certainty)}`] : null,
    article.relevance != null ? ['relevance', article.relevance.toFixed(2)] : null,
    ciLow !== null && ciHigh !== null && ciHigh - ciLow >= 2 ? ['range', `${ciLow}–${ciHigh}%`] : null,
  ]
  const shadowRows: Array<[string, string] | null> = [
    article.authorLean != null
      ? ['author_lean', `${signed(article.authorLean)}${cert(article.authorLeanCertainty)}`]
      : null,
    article.factSignal != null ? ['fact_signal', signed(article.factSignal)] : null,
    article.credibilityWeight != null ? ['credibility', article.credibilityWeight.toFixed(2)] : null,
    article.evidenceClass ? ['class', article.evidenceClass] : null,
    article.consensusView ? ['consensus', article.consensusView] : null,
    article.reportKind ? ['report_kind', article.reportKind] : null,
    readerRow(article.readerConfidence),
    quantityRow(article.quantity),
    groundsRow(article.grounds),
  ]
  const renderRows = (rows: Array<[string, string] | null>) =>
    rows
      .filter((r): r is [string, string] => r !== null)
      .map(([label, value]) => `<b>${label}</b>  ${escapeHtml(value)}`)
  // A Telegram blockquote, not <pre>: the quote bar visually groups the numbers into a
  // panel without the monospace code chrome ("copy code") clients hang on pre blocks.
  const live = renderRows(liveRows)
  const shadow = renderRows(shadowRows)
  const panel = [...live, ...(shadow.length ? [SHADOW_MARKER, ...shadow] : [])].join('\n')

  // A short quote of what was actually judged: the Oracul's extracted claim when it produced
  // one (that's the text the numbers scored), the raw article snippet otherwise.
  const extractLine = article.extract ? `<i>«${truncate(article.extract, 200)}»</i>` : null

  const msg = [
    headerLine,
    '',
    `📰 <a href="${escapeHtml(article.url)}">${truncate(article.title, 100)}</a>${sourceLabel}`,
    ...(extractLine ? [extractLine] : []),
    ...(panel ? ['', `<blockquote>${panel}</blockquote>`] : []),
    '',
    `🎯 <a href="${forecastUrl(prediction)}">${truncate(prediction.claimText, 120)}</a>`,
  ].join('\n')

  const sent = await sendChannelNotification(msg, 'noisy', rating ? buildRatingButtons() : undefined)
  if (!sent || !rating) return

  const chatId = resolveChatId('noisy')
  if (!chatId) return // unreachable if sendChannelNotification succeeded — keeps types honest

  await prisma.articleRatingPrompt
    .create({
      data: {
        evidencePoolArticleId: rating.evidencePoolArticleId,
        predictionId: prediction.id,
        contextSnapshotId: rating.contextSnapshotId,
        snapshotSimilarity: match.similarity,
        messageChatId: chatId,
        messageId: sent.message_id,
      },
    })
    .catch((err) => log.error({ err, predictionId: prediction.id }, 'Failed to persist rating prompt'))
}

/**
 * 1-5 rating button row (daatan#1223) shared by the article-match send above and the
 * tally-count refresh below. `counts`, when given, is a 5-element array (index 0 = how
 * many raters picked "1", ... index 4 = "5") appended to each button's label.
 *
 * `callback_data` deliberately carries no ids ("nf:r:<1-5>" only): a `callback_query`
 * update always includes the message it came from (`callback_query.message.chat.id` /
 * `.message_id`), so the webhook (src/app/api/telegram/rollback/route.ts) looks up the
 * persisted `ArticleRatingPrompt` row by that message identity instead — the same reason
 * `notifyNewsArticleMatched` persists the row keyed on `messageChatId`/`messageId`
 * right after send.
 *
 * The trailing `[?]` row (daatan#1313) is a `url` button, not `callback_data` — it opens
 * the explainer page client-side with no webhook round trip, and needs no `nf:` handler.
 */
const RATING_KEYCAPS: Record<number, string> = { 1: '1️⃣', 2: '2️⃣', 3: '3️⃣', 4: '4️⃣', 5: '5️⃣' }

function buildRatingButtons(counts?: number[]) {
  const base = process.env.NEXTAUTH_URL || getAppUrl()
  return {
    inline_keyboard: [
      [1, 2, 3, 4, 5].map((n) => ({
        text: `${RATING_KEYCAPS[n]}${counts?.[n - 1] ? ` ·${counts[n - 1]}` : ''}`,
        callback_data: `nf:r:${n}`,
      })),
      [{ text: '❓ What do these numbers mean?', url: `${base}/help/rating-numbers` }],
    ],
  }
}

/**
 * The AI estimate crossed the high-confidence threshold (≥80%) from below.
 * Fired by every path that writes a new confidence value (news-indexer pushes,
 * user-triggered "analyze context", admin backfill) — the crossing check lives
 * in `context.ts`, so a forecast hovering at 82 doesn't re-alert on each push.
 * `settled` marks the Oracul's settlement detection: enough sources reported
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
/**
 * A latched forecast whose published number has walked away from the value its
 * settlement pin published (daatan#1490). Clean channel: it is a decision, not a
 * reading — either the number is wrong and the forecast should be resolved, or the
 * pin was wrong and the latch should be cleared. Nothing else releases the latch;
 * the admin one-click is the only path back.
 */
export function notifySettledDrift(
  prediction: { id: string; claimText: string; slug?: string | null },
  pin: number,
  current: number,
): void {
  if (isDevEnv()) return

  const delta = Math.round(current - pin)
  const msg = [
    `⚖️ <b>Settled forecast has drifted from its pin</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `Pinned at ${Math.round(pin)}%, now ${Math.round(current)}% (${delta > 0 ? '+' : ''}${delta}pt). Flagged back into Awaiting Resolution — resolve it, or clear the settled latch if the pin was a false positive.`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

/**
 * The mirror of `notifySettledDrift` (daatan#1498): the evidence says settled, the
 * latch does not. Pages once per open condition — the sweep re-arms it when the
 * evidence stops asserting settlement.
 */
export function notifyUnlatchedPin(
  prediction: { id: string; claimText: string; slug?: string | null },
  probability: number | null,
  assertedAt: Date,
): void {
  if (isDevEnv()) return

  const shown = probability !== null ? `${Math.round(probability)}%` : 'no number'
  const when = assertedAt.toISOString().slice(0, 16).replace('T', ' ')
  const msg = [
    `⚠️ <b>Settlement asserted without a latch</b>`,
    `"${truncate(prediction.claimText, 120)}"`,
    `The latest evidence run (${when}Z) reports the outcome as settled at ${shown}, but the forecast's settled latch is not set — so it carries no settled badge and the drift sweep, which selects on the latch, cannot see it. Flagged back into Awaiting Resolution: resolve it, or treat the assertion as the false positive it usually is.`,
    `<a href="${forecastUrl(prediction)}">View forecast →</a>`,
  ].join('\n')

  sendChannelNotification(msg, 'clean')
}

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
 * A linked prediction market's implied probability and our Oracul estimate
 * disagree by more than the divergence threshold — worth a human look
 * (mispriced market, stale Oracul estimate, or a real edge).
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
  /** Candidates the clock declined to glide because their anchor asserts settlement
   *  while the latch is false (daatan#1498). A data-integrity count, not activity —
   *  so it gets its own line rather than being folded into the counters above. */
  unlatchedPins?: number
}): void {
  if (isDevEnv()) return

  const msg = [
    `🕐 <b>Requote summary</b>`,
    `Glided: ${s.glided} · Pinned: ${s.pinned} · Max Δ: ${s.maxDeltaPts}pt${s.divergences ? ` · Divergences: ${s.divergences}` : ''}`,
    ...(s.unlatchedPins ? [`⚠️ Settlement pins without a latch: ${s.unlatchedPins} — skipped, not glided (#1498)`] : []),
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

// ============================================
// MANUAL NUMBER-RATING FEEDBACK (daatan#1223)
// Outbound helpers the Telegram webhook (src/app/api/telegram/rollback/route.ts)
// calls in response to callback_query updates. notifyNewsArticleMatched above
// sends the initial 1-5 button row; everything below reacts to taps on it.
// ============================================

/** Display labels for NumberFeedbackField — toggle button text in the drilldown DM,
 *  and the plain-text confirmation once a rater taps Done. */
const FEEDBACK_FIELD_LABELS: Record<NumberFeedbackField, string> = {
  STANCE: 'Stance',
  RELEVANCE: 'Relevance',
  SIMILARITY: 'Similarity',
  PROBABILITY: 'Probability',
  AUTHOR_LEAN: 'Author Lean',
  FACT_SIGNAL: 'Fact Signal',
  EVIDENCE_CLASS: 'Evidence Class',
  CREDIBILITY: 'Credibility',
  OTHER: 'Other',
}

// SIMILARITY is intentionally absent (daatan#1661): the `match` row it referred to is no
// longer shown, so a rater can't flag it. The enum value and its label stay — existing
// feedback rows carry it and the admin dashboard still renders them.
const FEEDBACK_FIELD_ORDER: NumberFeedbackField[] = [
  'STANCE',
  'RELEVANCE',
  'PROBABILITY',
  'AUTHOR_LEAN',
  'FACT_SIGNAL',
  'EVIDENCE_CLASS',
  'CREDIBILITY',
  'OTHER',
]

function buildDrilldownKeyboard(flaggedFields: NumberFeedbackField[]) {
  const flagged = new Set(flaggedFields)
  const fieldButtons = FEEDBACK_FIELD_ORDER.map((field) => ({
    text: `${flagged.has(field) ? '✅ ' : ''}${FEEDBACK_FIELD_LABELS[field]}`,
    callback_data: `nf:t:${field}`,
  }))
  // Two per row keeps the keyboard compact on a phone screen.
  const rows: { text: string; callback_data: string }[][] = []
  for (let i = 0; i < fieldButtons.length; i += 2) rows.push(fieldButtons.slice(i, i + 2))
  rows.push([{ text: '✅ Done', callback_data: 'nf:d' }])
  return { inline_keyboard: rows }
}

/**
 * Must be called within ~30s of a tap or the tapped button shows a stuck loading
 * spinner in the Telegram client. `text` becomes a small toast when given.
 */
export async function answerTelegramCallback(callbackQueryId: string, text?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  try {
    await fetch(`${TELEGRAM_API}${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    })
  } catch (err) {
    log.error({ err, callbackQueryId }, 'Failed to answer Telegram callback query')
  }
}

/**
 * Refresh the rating-prompt message's buttons to show current tally counts.
 * `counts` is a 5-element array, index 0 = how many raters picked "1" .. index 4 = "5".
 */
export async function updateRatingPromptButtons(
  chatId: string,
  messageId: number,
  counts: number[],
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await callTelegramApi(
    token,
    'editMessageReplyMarkup',
    { chat_id: chatId, message_id: messageId, reply_markup: buildRatingButtons(counts) },
    { chatId, messageId },
  )
}

/**
 * Send the private drilldown DM — sent only when a rater picks a low rating (see
 * LOW_RATING_THRESHOLD in the webhook), lets them flag which specific number was wrong
 * via a toggle keyboard, plus a Done button.
 * `raterTelegramId` doubles as the DM's chat id: Telegram private chats use the
 * user's own id once they've started a conversation with the bot.
 */
export async function sendRatingDrilldownDm(input: {
  raterTelegramId: string
  article: { title: string; url: string; source: string | null }
  flaggedFields: NumberFeedbackField[]
}): Promise<{ message_id: number } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null

  const sourceLabel = input.article.source ? ` — ${escapeHtml(input.article.source)}` : ''
  const text = [
    'Which number was wrong?',
    `<a href="${escapeHtml(input.article.url)}">${truncate(input.article.title, 100)}</a>${sourceLabel}`,
  ].join('\n')

  return callTelegramApi(
    token,
    'sendMessage',
    {
      chat_id: input.raterTelegramId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: buildDrilldownKeyboard(input.flaggedFields),
    },
    { raterTelegramId: input.raterTelegramId },
  )
}

/** Refresh the drilldown DM's toggle checkmarks after a field tap. */
export async function updateDrilldownButtons(
  chatId: string,
  messageId: number,
  flaggedFields: NumberFeedbackField[],
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await callTelegramApi(
    token,
    'editMessageReplyMarkup',
    { chat_id: chatId, message_id: messageId, reply_markup: buildDrilldownKeyboard(flaggedFields) },
    { chatId, messageId },
  )
}

/** Collapse the drilldown DM to a plain confirmation once the rater taps Done. */
export async function finalizeRatingDrilldown(
  chatId: string,
  messageId: number,
  rating: number,
  flaggedFields: NumberFeedbackField[],
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  const fieldsText =
    flaggedFields.length > 0 ? flaggedFields.map((f) => FEEDBACK_FIELD_LABELS[f]).join(', ') : 'none'
  await callTelegramApi(
    token,
    'editMessageText',
    {
      chat_id: chatId,
      message_id: messageId,
      text: `Recorded: ${rating}/5 — ${fieldsText}`,
      reply_markup: { inline_keyboard: [] },
    },
    { chatId, messageId },
  )
}
