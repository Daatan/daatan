import { env } from '@/env'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { getAwsSecret } from '@/lib/aws/secrets'
import type { OracleCallType, OracleCallStatus } from '@prisma/client'

const log = createLogger('oracle-log')

export interface OracleConfig {
  baseUrl: string
  key: string
}

/** Daatan workflow that triggered an Oracul call. */
export type OracleCallSource =
  | 'context-update'
  | 'research'
  | 'bot-voting'
  | 'bot-sourcing'
  | 'express-guess'
  | 'express-creation'
  | 'multilingual-search'
  | 'ibi-search'
  | 'ibi-llm'
  | 'ibi-fetch-url'
  | 'health-cron'
  | 'leaderboard'
  | 'source-leaderboard'
  | 'admin-outlet-detail'
  | 'news-indexer'
  | 'evidence-second-opinion'
  | 'other'

/** LLM token usage as the Oracul reports it (`token_usage` on /forecast,
 *  /relevance and /llm responses). Nullable/omitted when unknown. */
export interface OracleTokenUsage {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  cache_read_tokens?: number | null
  cache_write_tokens?: number | null
}

export interface OracleCallMeta {
  source: OracleCallSource
  /** User/bot that triggered the call; null for system/cron. */
  userId?: string | null
  /** Forecast the call relates to, when known; null for express drafting/cron. */
  predictionId?: string | null
}

interface LogOracleCallInput {
  callType: OracleCallType
  status: OracleCallStatus
  meta: OracleCallMeta
  durationMs: number
  httpStatus?: number | null
  searchEngine?: string | null
  provider?: string | null
  providerChain?: string[]
  query?: string | null
  resultCount?: number | null
  /** Why the call failed / came back empty; null on success. */
  failureReason?: string | null
  /** The response's `token_usage` object, when the Oracul reported one
   *  (FORECAST and LLM calls only — retro doesn't report usage for SEARCH etc.). */
  tokenUsage?: OracleTokenUsage | null
}

const PRUNE_DAYS = 30

/**
 * Record one Oracul call (any type, success or failure) for the admin usage
 * stats. Fire-and-forget: never throws — callers invoke as `void logOracleCall(...)`.
 * Also prunes rows older than {@link PRUNE_DAYS} on each write.
 *
 * Returns the created row's id (or null on failure) so a caller that later
 * takes the LLM fallback can attribute it via {@link recordOraculFallback}.
 */
export async function logOracleCall(input: LogOracleCallInput): Promise<string | null> {
  try {
    const cutoff = new Date(Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000)
    const [created] = await prisma.$transaction([
      prisma.oracleCallLog.create({
        data: {
          callType: input.callType,
          status: input.status,
          source: input.meta.source,
          userId: input.meta.userId ?? null,
          predictionId: input.meta.predictionId ?? null,
          durationMs: input.durationMs,
          httpStatus: input.httpStatus ?? null,
          searchEngine: input.searchEngine ?? null,
          provider: input.provider ?? null,
          providerChain: input.providerChain ?? [],
          query: input.query ?? null,
          resultCount: input.resultCount ?? null,
          failureReason: input.failureReason ?? null,
          promptTokens: input.tokenUsage?.prompt_tokens ?? null,
          completionTokens: input.tokenUsage?.completion_tokens ?? null,
          totalTokens: input.tokenUsage?.total_tokens ?? null,
          cacheReadTokens: input.tokenUsage?.cache_read_tokens ?? null,
          cacheWriteTokens: input.tokenUsage?.cache_write_tokens ?? null,
        },
        select: { id: true },
      }),
      prisma.oracleCallLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ])
    return created.id
  } catch (err) {
    log.warn({ err }, 'failed to write oracle call log')
    return null
  }
}

/**
 * Mark a logged Oracul call as having fallen back to the LLM, recording the
 * probability the fallback produced. Fire-and-forget: never throws. No-op when
 * `id` is null (the original log write failed).
 */
export async function recordOraculFallback(id: string | null, fallbackProbability: number | null): Promise<void> {
  if (!id) return
  try {
    await prisma.oracleCallLog.update({
      where: { id },
      data: { fellBackToLlm: true, fallbackProbability: fallbackProbability ?? null },
    })
  } catch (err) {
    log.warn({ err }, 'failed to record oracle fallback')
  }
}

/** Strip a single trailing slash so `${baseUrl}${path}` never doubles up. */
const stripTrailingSlash = (url: string): string => url.replace(/\/$/, '')

/**
 * Normalized Oracul base URL when `ORACLE_URL` is set; `null` otherwise.
 * No API key required — for the unauthenticated endpoints (`/health`,
 * `/fetch-url`).
 */
export function getOracleBaseUrl(): string | null {
  return env.ORACLE_URL ? stripTrailingSlash(env.ORACLE_URL) : null
}

/**
 * The Oracul's `x-api-key`, shared with retro's `oracle-api.service` off one SSM
 * parameter (`/daatan/shared/secrets/ORACLE_API_KEY`) so the two sides can't drift —
 * see docs/SECRETS.md. `env.ORACLE_API_KEY` stays as the local-dev/self-host fallback.
 */
export function getOracleApiKey(): string {
  return getAwsSecret('ORACLE_API_KEY') || env.ORACLE_API_KEY || ''
}

/**
 * Normalized base URL + API key, or `null` when either is missing. Use for the
 * authenticated endpoints; pass the result to {@link oracleFetch}.
 */
export function getOracleConfig(): OracleConfig | null {
  const url = env.ORACLE_URL
  const key = getOracleApiKey()
  if (!url || !key) return null
  return { baseUrl: stripTrailingSlash(url), key }
}

/**
 * `fetch()` against an authenticated Oracul endpoint: applies the `x-api-key`
 * header and an abort timeout. Callers own the response handling — services
 * fail open (return `null`), proxy routes pass the status through.
 */
export function oracleFetch(
  cfg: OracleConfig,
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const { timeoutMs, headers, ...rest } = init
  return fetch(`${cfg.baseUrl}${path}`, {
    ...rest,
    headers: { 'x-api-key': cfg.key, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  })
}
