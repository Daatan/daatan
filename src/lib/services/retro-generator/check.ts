import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { llmService } from '@/lib/llm'
import { retroEventCheckSchema } from '@/lib/llm/schemas'
import { forStage } from '@/lib/llm/stageModels'
import { createLogger } from '@/lib/logger'
import type { NewsBeforeArticle } from '@/lib/services/news-indexer'

const log = createLogger('retro-event-check')

/**
 * Forecasts shown to the check as possible duplicates of the event. The cosine only finds
 * candidates: on 2026-11-18 same-event pairs sat at 0.889–0.934 and different-event pairs at
 * 0.910–0.913 (daatan#2229), so no threshold separates them and the check decides.
 */
export const NEAR_FORECAST_MIN_SCORE = 0.85
export const MAX_NEAR_FORECASTS = 5
const MAX_EXCERPT_CHARS = 400
/**
 * One call with up to 15 articles, fallback included. On prod (2026-11-18) 23 of 24 Vertex calls
 * took 12.3 s median, 16.2 s p90 and 23.5 s at most; the 24th timed out at 30 s and the Oracul
 * fallback answered it in 5 s.
 */
export const CHECK_TIMEOUT_MS = 35_000
/**
 * The Google leg's own limit, below its 30 s default so that the fallback, which now stops at
 * {@link CHECK_TIMEOUT_MS} too, keeps about twice the 5 s it took (daatan#2229).
 */
export const CHECK_GOOGLE_TIMEOUT_MS = 25_000

export interface NearForecast {
  id: string
  claimText: string
  createdAt: Date
  status: string
  retro: boolean
  score: number
}

/**
 * The forecasts closest to the claim, in any status: a resolved one asked it already, and a
 * rejected retro draft was already looked at.
 */
export async function findNearForecasts(vector: number[], minScore: number, limit = MAX_NEAR_FORECASTS): Promise<NearForecast[]> {
  const v = Prisma.raw(`'[${vector.join(',')}]'::vector`)
  return prisma.$queryRaw<NearForecast[]>(Prisma.sql`
    SELECT p.id, p."claimText", p."createdAt", p.status::text AS status,
           EXISTS (SELECT 1 FROM retro_simulations r WHERE r.prediction_id = p.id) AS retro,
           (1 - (p.embedding <=> ${v}))::float AS score
    FROM predictions p
    WHERE p.embedding IS NOT NULL AND (1 - (p.embedding <=> ${v})) >= ${minScore}
    ORDER BY p.embedding <=> ${v}
    LIMIT ${limit}
  `)
}

export interface EventCheckInput {
  /** The judge's past-tense summary: hindsight, shown to the check only. */
  eventSummary: string
  claimText: string
  asOf: Date
  articles: NewsBeforeArticle[]
  near: NearForecast[]
}

export interface ArticleVerdict {
  url: string
  onTopic: boolean
  reportsEvent: boolean
}

export type EventCheck =
  | { ok: true; verdicts: ArticleVerdict[]; sameEventAs: NearForecast | null; reason: string; modelNote?: string }
  | { ok: false; reason: 'event_check_failed' | 'event_check_incomplete'; detail?: string }

function excerpt(a: NewsBeforeArticle): string {
  const raw = a.snippet?.trim() || a.text?.trim() || ''
  return raw.replace(/\s+/g, ' ').slice(0, MAX_EXCERPT_CHARS)
}

function articleLine(a: NewsBeforeArticle, i: number): string {
  const head = `[${i + 1}] ${a.published_at.slice(0, 10)} · ${a.source ?? 'unknown outlet'} — ${a.title}`
  const body = excerpt(a)
  return body ? `${head}\n    ${body}` : head
}

function forecastLine(f: NearForecast, i: number): string {
  return `[${i + 1}] asked ${new Date(f.createdAt).toISOString().slice(0, 10)}: ${f.claimText}`
}

export async function buildEventCheckPrompt(input: EventCheckInput): Promise<string> {
  return fillPrompt(await getPromptTemplate('retro-event-check'), {
    asOf: input.asOf.toISOString().slice(0, 10),
    eventSummary: input.eventSummary,
    claim: input.claimText,
    articles: input.articles.map(articleLine).join('\n'),
    forecasts: input.near.map(forecastLine).join('\n') || '(none)',
  })
}

/**
 * Validate a check answer against what it was shown. Pure, so the gate is testable without a
 * model. Every article must get a verdict: one left out could be the one that reports the event.
 */
export function validateEventCheck(raw: Record<string, unknown>, articles: Array<{ url: string }>, near: NearForecast[]): EventCheck {
  const byNumber = new Map<number, { onTopic: boolean; reportsEvent: boolean }>()
  for (const item of Array.isArray(raw.articles) ? raw.articles : []) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const n = Number(o.n)
    if (!Number.isInteger(n) || n < 1 || n > articles.length || byNumber.has(n)) continue
    byNumber.set(n, { onTopic: o.onTopic === true, reportsEvent: o.reportsEvent === true })
  }
  if (byNumber.size < articles.length) {
    return { ok: false, reason: 'event_check_incomplete', detail: `${byNumber.size}/${articles.length} articles judged` }
  }
  const k = Number(raw.sameEventAs)
  return {
    ok: true,
    verdicts: articles.map((a, i) => ({ url: a.url, onTopic: false, reportsEvent: false, ...byNumber.get(i + 1) })),
    sameEventAs: Number.isInteger(k) && k >= 1 && k <= near.length ? near[k - 1] : null,
    reason: String(raw.reason ?? '').trim(),
  }
}

/**
 * The per-event check between the evidence search and the Oracul (daatan#2229), one call per
 * event: which articles are about this event's subject, whether any already reports the event,
 * and whether an existing forecast already asks about it. Similarity measures topic, not event
 * identity, so none of the three is a threshold.
 */
export async function checkRetroEvent(input: EventCheckInput): Promise<EventCheck> {
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS)
  try {
    const result = await llmService.generateContent({
      ...forStage('retro_event_check'),
      prompt: await buildEventCheckPrompt(input),
      schema: retroEventCheckSchema,
      temperature: 0,
      signal,
      googleTimeoutMs: CHECK_GOOGLE_TIMEOUT_MS,
    })
    const checked = validateEventCheck(JSON.parse(result.text) as Record<string, unknown>, input.articles, input.near)
    return checked.ok && result.fallbackProvider ? { ...checked, modelNote: `answered by ${result.fallbackProvider}` } : checked
  } catch (err) {
    log.warn({ err }, 'retro event check failed')
    const detail = signal.aborted ? `timeout after ${CHECK_TIMEOUT_MS / 1000} s` : String((err as Error)?.message ?? err).slice(0, 200)
    return { ok: false, reason: 'event_check_failed', detail }
  }
}
