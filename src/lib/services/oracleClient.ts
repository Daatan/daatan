import { env } from '@/env'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import type { OracleCallType, OracleCallStatus } from '@prisma/client'

const log = createLogger('oracle-log')

export interface OracleConfig {
  baseUrl: string
  key: string
}

/** Daatan workflow that triggered an Oracle call. */
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
  | 'other'

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
}

const PRUNE_DAYS = 30

/**
 * Record one Oracle call (any type, success or failure) for the admin usage
 * stats. Fire-and-forget: never throws — callers invoke as `void logOracleCall(...)`.
 * Also prunes rows older than {@link PRUNE_DAYS} on each write.
 *
 * Returns the created row's id (or null on failure) so a caller that later
 * takes the LLM fallback can attribute it via {@link recordOracleFallback}.
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
 * Mark a logged Oracle call as having fallen back to the LLM, recording the
 * probability the fallback produced. Fire-and-forget: never throws. No-op when
 * `id` is null (the original log write failed).
 */
export async function recordOracleFallback(id: string | null, fallbackProbability: number | null): Promise<void> {
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
 * Normalized Oracle base URL when `ORACLE_URL` is set; `null` otherwise.
 * No API key required — for the unauthenticated endpoints (`/health`,
 * `/fetch-url`).
 */
export function getOracleBaseUrl(): string | null {
  return env.ORACLE_URL ? stripTrailingSlash(env.ORACLE_URL) : null
}

/**
 * Normalized base URL + API key, or `null` when either is missing. Use for the
 * authenticated endpoints; pass the result to {@link oracleFetch}.
 */
export function getOracleConfig(): OracleConfig | null {
  const url = env.ORACLE_URL
  const key = env.ORACLE_API_KEY
  if (!url || !key) return null
  return { baseUrl: stripTrailingSlash(url), key }
}

/**
 * `fetch()` against an authenticated Oracle endpoint: applies the `x-api-key`
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
