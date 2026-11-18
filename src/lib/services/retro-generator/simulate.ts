import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { embedText, storeForecastEmbedding } from '@/lib/services/embedding'
import { searchNewsBefore, type NewsBeforeArticle } from '@/lib/services/news-indexer'
import { getOraculForecast, type ArticleInput, type OracleForecastResponse } from '@/lib/services/oracle'
import { slugify, generateUniqueSlug } from '@/lib/utils/slugify'
import { SAME_EVENT_MIN_SCORE } from './cluster'
import { parsePublished, retroTimeline, fillDeadline, type RetroTimeline } from './timeline'
import type { PoolReport } from './types'

const log = createLogger('retro-simulate')

/**
 * The article gate, applied twice: to what the search found before T0, and to what the Oracul
 * actually used. Mark set two on 2026-11-16 (daatan#2217 Q4) and three on 2026-11-18
 * (daatan#2229). Across the three prod runs of 2026-11-17/18, the off-topic chip-rule event
 * passed twice, each time with `articles_used` = 2, and every on-topic, non-duplicate event had
 * at least 3. A find below three can't reach three used, so the same bar on the search only saves
 * the Oracul call. The other off-topic event that got through (4 and 6 used) is not caught.
 */
export const MIN_PRE_T0_ARTICLES = 3
/** What Oracul is sent. Its per-article stage runs in parallel, so this bounds cost, not time. */
export const MAX_EVIDENCE_ARTICLES = 15
/**
 * news-indexer similarity floor (Titan v2, 1024 d). Its own `/search` default (0.25) is a
 * recall bar for a min-hits gate; here the set is also what the page will show as "who wrote
 * about it", so it has to be on topic. Hand-read on prod, 2026-11-18, with the full claim as
 * the query: at 0.55 6 of 10 events found nothing; articles stayed on topic down to about
 * 0.40; below it, one event's whole set was off-topic (best 0.386). Recheck it with the
 * deadline-free query; the workflow's `min_similarity` input overrides it per run.
 */
export const DEFAULT_MIN_SIMILARITY = 0.4
/** Inside nginx's 120 s `/api` read timeout with the dedupe and search in front of it. */
const ORACUL_TIMEOUT_MS = 95_000

const RETRO_BOT_USERNAME = 'retro_sim'
const RETRO_BOT_EMAIL = `${RETRO_BOT_USERNAME}@daatan.internal`

/**
 * The search query: the claim without its deadline clause. "by November 30, 2026" only dilutes
 * the similarity to coverage written before the event. Not the judge's event summary: that is
 * hindsight text and ranks articles that already report the event highest.
 */
export function evidenceQuery(claimTemplate: string): string {
  const q = claimTemplate
    .replace(/\s*\b(?:by|before|until|no later than|on or before)\s+\{DEADLINE\}/gi, '')
    .replace(/\{DEADLINE\}/g, '')
    .replace(/^[\s,;:]+|[\s,;:]+(?=[.!?]?$)/g, '')
    .trim()
  return q || claimTemplate.replace(/\{DEADLINE\}/g, '').trim()
}

export interface SimulateInput {
  reports: PoolReport[]
  event: { summary: string; date: string; url: string; reason?: string }
  claimTemplate: string
  rulesTemplate: string
  dryRun: boolean
  minSimilarity?: number
  dupThreshold?: number
  now?: Date
}

type EvidenceSearch = {
  q: string
  before: string
  after: string
  indexedBefore: string
  minSimilarity: number
  limit: number
}

type SentArticle = {
  url: string
  title: string
  source: string | null
  publishedAt: string
  similarity: number
  hadText: boolean
}

export type SimulateResult =
  | {
      status: 'created' | 'dry_run'
      predictionId: string | null
      claimText: string
      asOf: string
      cutoffAt: string
      deadline: string
      probability: number
      articlesUsed: number
      articles: SentArticle[]
      stances: Array<{ url: string; source: string; stance: number }>
    }
  | { status: 'skipped'; reason: string; claimText?: string; detail?: unknown }

/**
 * The retro rows' author: an `isBot` user with no `BotConfig`, so the bot runner never picks
 * it up (same pattern as `getOrCreateOracle2SystemUser`). Created on first use.
 */
export async function getOrCreateRetroBotUser(): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: RETRO_BOT_EMAIL }, select: { id: true } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      email: RETRO_BOT_EMAIL,
      name: 'Retro simulation',
      username: RETRO_BOT_USERNAME,
      slug: RETRO_BOT_USERNAME,
      isBot: true,
      emailNotifications: false,
      isPublic: false,
    },
    select: { id: true },
  })
}

interface DuplicateRow {
  id: string
  claimText: string
  status: string
  retro: boolean
  score: number
}

/**
 * A retro draft is only worth making for an event no forecast already covers, and only once.
 * Matches every forecast in every status — a resolved one asked it already, a rejected retro
 * row was already looked at — at {@link SAME_EVENT_MIN_SCORE}, not the create form's 0.87 warning
 * bar: a retro event sits next to the live forecasts its articles were matched to by construction.
 */
async function findDuplicate(vector: number[], threshold: number, eventUrl: string): Promise<DuplicateRow | null> {
  const sameUrl = await prisma.retroSimulation.findFirst({ where: { eventUrl }, select: { predictionId: true } })
  if (sameUrl) return { id: sameUrl.predictionId, claimText: '', status: 'retro_same_event_url', retro: true, score: 1 }
  const v = Prisma.raw(`'[${vector.join(',')}]'::vector`)
  const rows = await prisma.$queryRaw<DuplicateRow[]>(Prisma.sql`
    SELECT p.id, p."claimText", p.status::text AS status,
           EXISTS (SELECT 1 FROM retro_simulations r WHERE r.prediction_id = p.id) AS retro,
           (1 - (p.embedding <=> ${v}))::float AS score
    FROM predictions p
    WHERE p.embedding IS NOT NULL AND (1 - (p.embedding <=> ${v})) >= ${threshold}
    ORDER BY p.embedding <=> ${v}
    LIMIT 1
  `)
  return rows[0] ?? null
}

function toArticleInput(a: NewsBeforeArticle): ArticleInput {
  // Always send a body: without one Oracul fetches the URL live, and today's page may carry
  // updates written after T0. Title + snippet is what it would otherwise have judged on.
  const text = a.text?.trim() || [a.title, a.snippet].filter(Boolean).join('\n\n')
  return {
    url: a.url,
    title: a.title,
    snippet: a.snippet ?? '',
    source: a.source ?? undefined,
    publishedDate: a.published_at,
    text,
    ...(a.language ? { language: a.language } : {}),
  }
}

function frozenEvidence(
  input: SimulateInput,
  timeline: RetroTimeline,
  search: EvidenceSearch,
  sent: SentArticle[],
  forecast: OracleForecastResponse,
  logId: string | null,
): Prisma.InputJsonValue {
  return {
    search,
    sent,
    oracul: {
      mean: forecast.mean,
      articlesUsed: forecast.articles_used,
      logId,
      sources: forecast.sources.map((s) => ({
        url: s.url,
        source: s.source_name,
        stance: s.stance,
        certainty: s.certainty,
        evidenceClass: s.evidence_class ?? null,
        settled: s.settled ?? null,
        claims: s.claims.slice(0, 3).map((c) => c.slice(0, 300)),
      })),
    },
    reports: input.reports.map((r) => ({ url: r.url, source: r.source, publishedDate: r.publishedDate, claim: r.claim })),
    judge: { reason: input.event.reason ?? null, claimTemplate: input.claimTemplate, rulesTemplate: input.rulesTemplate },
    timeline: { eventDate: timeline.eventDate.toISOString(), evidenceAfter: timeline.evidenceAfter.toISOString(), earlyReports: timeline.earlyReports },
  }
}

/**
 * Stage 2 of the retro generator (daatan#2217), one event per call: dedupe, collect the
 * articles published before T0 from the whole news index, ask Oracul what it would have said
 * as of T0 from exactly those, and — unless `dryRun` — save a private PENDING_APPROVAL draft
 * with that answer frozen on its `RetroSimulation` row. Approving the draft resolves it (PR 1);
 * nothing here publishes, stakes, notifies or reaches the calibration record.
 *
 * The timeline is recomputed from `event.date` and the reports rather than taken from the
 * caller, so the "published before T0" bound cannot be widened by a hand-edited request.
 */
export async function simulateRetroEvent(input: SimulateInput): Promise<SimulateResult> {
  const now = input.now ?? new Date()
  const dates = input.reports.map((r) => parsePublished(r.publishedDate)).filter((d): d is Date => d !== null)
  const t = retroTimeline(input.event.date, dates, now)
  if (!t.ok) return { status: 'skipped', reason: t.reason }
  const timeline = t.timeline
  if (!input.claimTemplate.includes('{DEADLINE}')) return { status: 'skipped', reason: 'judge_no_deadline_token' }
  const claimText = fillDeadline(input.claimTemplate, timeline.deadline)
  const resolutionRules = fillDeadline(input.rulesTemplate, timeline.deadline)

  const vector = await embedText(claimText)
  if (!vector) return { status: 'skipped', reason: 'embed_failed', claimText }
  const dup = await findDuplicate(vector, input.dupThreshold ?? SAME_EVENT_MIN_SCORE, input.event.url)
  if (dup) return { status: 'skipped', reason: dup.retro ? 'duplicate_retro' : 'duplicate_forecast', claimText, detail: dup }

  const minSimilarity = input.minSimilarity ?? DEFAULT_MIN_SIMILARITY
  const search: EvidenceSearch = {
    q: evidenceQuery(input.claimTemplate),
    before: timeline.asOf.toISOString(),
    after: timeline.evidenceAfter.toISOString(),
    indexedBefore: timeline.cutoffAt.toISOString(),
    minSimilarity,
    limit: MAX_EVIDENCE_ARTICLES,
  }
  let found: NewsBeforeArticle[]
  try {
    found = await searchNewsBefore({
      q: search.q,
      before: timeline.asOf,
      after: timeline.evidenceAfter,
      indexedBefore: timeline.cutoffAt,
      limit: MAX_EVIDENCE_ARTICLES,
      minSimilarity,
      includeText: true,
    })
  } catch (err) {
    log.warn({ err }, 'retro evidence search failed')
    return { status: 'skipped', reason: 'search_failed', claimText, detail: String(err) }
  }
  // The endpoint already bounds this; re-check, it is the one invariant the whole feature rests on.
  const evidence = found.filter((a) => new Date(a.published_at).getTime() < timeline.asOf.getTime())
  if (evidence.length < MIN_PRE_T0_ARTICLES) {
    return { status: 'skipped', reason: 'thin_evidence', claimText, detail: { found: evidence.length, search } }
  }
  const sent: SentArticle[] = evidence.map((a) => ({
    url: a.url,
    title: a.title,
    source: a.source,
    publishedAt: a.published_at,
    similarity: a.similarity,
    hadText: Boolean(a.text?.trim()),
  }))

  const { forecast, logId, failureClass } = await getOraculForecast(
    claimText,
    {
      articles: evidence.map(toArticleInput),
      asOf: timeline.asOf,
      claimCreatedAt: timeline.asOf,
      claimDeadline: timeline.deadline,
      claimDirection: 'ARRIVAL',
      resolutionRules,
      timeoutMs: ORACUL_TIMEOUT_MS,
    },
    { source: 'retro-simulation' },
  )
  if (!forecast) return { status: 'skipped', reason: failureClass ?? 'oracul_failed', claimText, detail: { sent: sent.length } }
  if (forecast.articles_used < MIN_PRE_T0_ARTICLES) {
    return { status: 'skipped', reason: 'oracul_thin', claimText, detail: { articlesUsed: forecast.articles_used, sent: sent.length } }
  }

  const probability = (forecast.mean + 1) / 2
  const result = {
    claimText,
    asOf: timeline.asOf.toISOString(),
    cutoffAt: timeline.cutoffAt.toISOString(),
    deadline: timeline.deadline.toISOString(),
    probability,
    articlesUsed: forecast.articles_used,
    articles: sent,
    stances: forecast.sources.map((s) => ({ url: s.url, source: s.source_name, stance: s.stance })),
  }
  if (input.dryRun) return { status: 'dry_run', predictionId: null, ...result }

  const author = await getOrCreateRetroBotUser()
  const baseSlug = slugify(claimText)
  const existingSlugs = await prisma.prediction
    .findMany({ where: { slug: { startsWith: baseSlug } }, select: { slug: true } })
    .then((rows) => rows.map((r) => r.slug).filter((s): s is string => s !== null))

  // Straight to the table, not through the create service: that path's hooks (estimate,
  // translation, moderation, Telegram, IndexNow) are exactly what a retro draft must not reach.
  const prediction = await prisma.$transaction(async (tx) => {
    const p = await tx.prediction.create({
      data: {
        authorId: author.id,
        claimText,
        slug: generateUniqueSlug(baseSlug, existingSlugs),
        outcomeType: 'BINARY',
        outcomePayload: { type: 'BINARY' },
        resolutionRules,
        resolveByDatetime: timeline.deadline,
        claimDeadline: timeline.deadline,
        claimDirection: 'ARRIVAL',
        source: 'retro_simulation',
        status: 'PENDING_APPROVAL',
        isPublic: false,
        shareToken: crypto.randomBytes(8).toString('hex'),
      },
      select: { id: true },
    })
    await tx.retroSimulation.create({
      data: {
        predictionId: p.id,
        asOf: timeline.asOf,
        cutoffAt: timeline.cutoffAt,
        outcome: 'correct',
        eventText: input.event.summary,
        eventDate: timeline.eventDate,
        eventUrl: input.event.url,
        oraculProbability: probability,
        articlesUsed: forecast.articles_used,
        evidence: frozenEvidence(input, timeline, search, sent, forecast, logId),
      },
    })
    return p
  })
  // Outside the transaction: the vector is what the next run's dedupe matches against, and a
  // failed write here only weakens that, it does not invalidate the draft.
  await storeForecastEmbedding(prediction.id, vector).catch((err) => log.warn({ err, predictionId: prediction.id }, 'retro draft embedding not stored'))

  log.info({ predictionId: prediction.id, probability, articlesUsed: forecast.articles_used, asOf: result.asOf }, 'retro draft created')
  return { status: 'created', predictionId: prediction.id, ...result }
}
