import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { llmService } from '@/lib/llm'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { topicSuggestSchema } from '@/lib/llm/schemas'
import { forStage } from '@/lib/llm/stageModels'
import { getDefaultHorizon } from '@/lib/llm/expressPrediction'
import { embedTexts } from '@/lib/services/embedding'
import { clusterReports, loadPoolReports, outletOf } from '@/lib/services/retro-generator/candidates'
import { eventText } from '@/lib/services/retro-generator/cluster'
import { findNearForecasts, NEAR_FORECAST_MIN_SCORE } from '@/lib/services/retro-generator/check'
import { formatDeadline, parsePublished } from '@/lib/services/retro-generator/timeline'
import type { PoolReport } from '@/lib/services/retro-generator/types'

const log = createLogger('topic-suggestions')

/**
 * Forward questions from this week's topics (daatan#2308). The retro generator's candidates
 * step already finds what the news is talking about: the evidence pool's reported facts,
 * clustered and ranked by outlets. That step looks back ("X happened"); this one asks what is
 * still open ("will X happen next?"). Same pool, same clustering, then ONE model call that sees
 * every multi-source cluster together, because a big story arrives split into many clusters
 * (the Israeli coalition was 17 of the 47 in the week to 2026-11-24) and only a reader of all
 * of them can fold it. Writes nothing.
 */
export const SUGGEST_DEFAULTS = { days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 } as const

/** Reports shown per group, newest first: what happens next turns on the latest development. */
export const REPORTS_PER_GROUP = 4
const MAX_REPORT_CHARS = 280
/** Open forecasts shown to the model as "already asked". */
export const MAX_OPEN_FORECASTS = 150
export const MAX_QUESTIONS_PER_STORY = 3
export const MAX_SUGGESTIONS = 12
/** A question must stay open at least this long, or nobody gets to forecast it. */
export const MIN_HORIZON_DAYS = 7
/** A step on the way usually lands within months: its default deadline is the end of the month this many days out. */
export const STEP_HORIZON_DAYS = 90
const MAX_HORIZON_DAYS = 5 * 366
/**
 * At or above this cosine a suggestion repeats a forecast's wording (rewordings of one claim
 * scored 0.97–1.00 on 2026-11-17, see SAME_EVENT_MIN_SCORE): a backstop to the model's own
 * `coveredBy`, which is the real dedupe.
 */
export const DUPLICATE_MIN_SCORE = 0.95
/**
 * Wording for a non-event: something stopping, lasting, not happening, or a streak. Such a claim
 * comes true by default, cannot be confirmed, or is a statistic. The prompt forbids it, yet
 * gemini-2.5-flash still wrote "Iran will cease all attacks on Bahrain" and, when that word was
 * gated, "Iran will not attack Bahrain for 30 consecutive days" (#2308). Repeats ("another",
 * "again") are a real forecast form (#2094), so only the prompt steers those; "stay" is left out
 * because a court grants one.
 */
export const NON_EVENT_WORDING = /\b(?:ceases?|remains?|continues?|expires?|consecutive|will not|won't)\b/i
/**
 * The whole run, measured from the route's start, stops the model call here: the workflow's
 * curl gives up at 118 s, and a Vertex timeout (60 s) followed by the Oracul fallback (up to
 * 55 s) would pass that after ~20 s of loading and clustering.
 */
export const RUN_BUDGET_MS = 100_000
const DAY_MS = 86_400_000

export interface SuggestOptions {
  days: number
  threshold: number
  minSources: number
  maxClusters: number
  now?: Date
}

export interface OpenForecast {
  id: string
  claimText: string
  resolveByDatetime: Date
}

export interface SuggestionGroup {
  sources: number
  reports: PoolReport[]
}

export interface TopicSuggestion {
  story: string
  claimText: string
  resolutionRules: string
  /** ISO, end of the deadline day in UTC. */
  resolveByDatetime: string
  reason: string
  /** Distinct outlets across the story's groups. */
  sources: number
  /** Article URLs behind the story, newest first, for the admin to read. */
  urls: string[]
  /** The closest existing forecast at or above NEAR_FORECAST_MIN_SCORE, for the admin to compare. */
  nearest?: { id: string; claimText: string; status: string; score: number }
}

export interface SuggestStory {
  title: string
  groups: number[]
  sources: number
}

export interface SuggestSkip {
  reason: string
  story: string
  claim?: string
  detail?: string
}

export interface SuggestResult {
  claims: number
  reports: number
  clusters: number
  multiSource: number
  sent: number
  openForecasts: number
  stories: SuggestStory[]
  suggestions: TopicSuggestion[]
  skipped: SuggestSkip[]
  modelNote?: string
  timingsMs: Record<string, number>
}

/** One report per article, newest first. */
export function groupReports(reports: PoolReport[]): PoolReport[] {
  const byUrl = new Map<string, PoolReport>()
  for (const r of reports) if (!byUrl.has(r.url)) byUrl.set(r.url, r)
  const time = (r: PoolReport) => parsePublished(r.publishedDate)?.getTime() ?? 0
  return [...byUrl.values()].sort((a, b) => time(b) - time(a))
}

function reportLine(r: PoolReport): string {
  const day = parsePublished(r.publishedDate)?.toISOString().slice(0, 10) ?? 'undated'
  return `  - ${day} · ${r.source ?? 'unknown outlet'} — ${r.claim}`.slice(0, MAX_REPORT_CHARS)
}

function groupBlock(g: SuggestionGroup, i: number): string {
  const lines = groupReports(g.reports).slice(0, REPORTS_PER_GROUP).map(reportLine)
  return [`[${i + 1}] ${g.sources} outlets`, ...lines].join('\n')
}

function forecastLine(f: OpenForecast, i: number): string {
  return `[${i + 1}] (resolves by ${f.resolveByDatetime.toISOString().slice(0, 10)}) ${f.claimText}`
}

export function deadlineBounds(now: Date): { min: Date; max: Date; fallback: Date; step: Date } {
  const out = new Date(now.getTime() + STEP_HORIZON_DAYS * DAY_MS)
  return {
    min: new Date(now.getTime() + MIN_HORIZON_DAYS * DAY_MS),
    max: new Date(now.getTime() + MAX_HORIZON_DAYS * DAY_MS),
    fallback: new Date(getDefaultHorizon(now).iso),
    step: new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0, 23, 59, 59)),
  }
}

export async function buildSuggestPrompt(groups: SuggestionGroup[], forecasts: OpenForecast[], now: Date): Promise<string> {
  return renderSuggestPrompt(await getPromptTemplate('topic-suggest'), groups, forecasts, now)
}

/** Fill a topic-suggest template; separate so scripts/replay-topic-suggest.ts can try a draft. */
export function renderSuggestPrompt(template: string, groups: SuggestionGroup[], forecasts: OpenForecast[], now: Date): string {
  const { min, fallback, step } = deadlineBounds(now)
  return fillPrompt(template, {
    today: now.toISOString().slice(0, 10),
    defaultDeadline: fallback.toISOString().slice(0, 10),
    stepDeadline: step.toISOString().slice(0, 10),
    minDeadline: min.toISOString().slice(0, 10),
    groups: groups.map(groupBlock).join('\n'),
    forecasts: forecasts.length ? forecasts.map(forecastLine).join('\n') : '(none)',
  })
}

/** End of a YYYY-MM-DD day in UTC, or null. */
function parseDeadline(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T23:59:59Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : d
}

export interface ValidatedAnswer {
  stories: SuggestStory[]
  suggestions: TopicSuggestion[]
  skipped: SuggestSkip[]
}

/**
 * Check the model's answer against what it was shown. Pure, so the gate is testable without a
 * model: every question needs the {DEADLINE} token, a real deadline inside the horizon, rules
 * and no non-event wording; one the model marks as covered is reported, not suggested; a group
 * counts for one story only; caps per story and per run.
 */
export function validateSuggestions(
  raw: Record<string, unknown>,
  groups: SuggestionGroup[],
  forecasts: OpenForecast[],
  now: Date,
): ValidatedAnswer {
  const { min, max } = deadlineBounds(now)
  const stories: SuggestStory[] = []
  const suggestions: TopicSuggestion[] = []
  const skipped: SuggestSkip[] = []
  const used = new Set<number>()
  const rawStories = Array.isArray(raw.stories) ? raw.stories : []

  for (const s of rawStories as Array<Record<string, unknown>>) {
    const title = String(s?.title ?? '').trim() || 'untitled'
    const numbers = (Array.isArray(s?.groups) ? s.groups : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= groups.length && !used.has(n))
    const mine = [...new Set(numbers)]
    if (mine.length === 0) {
      skipped.push({ reason: 'story_no_groups', story: title })
      continue
    }
    mine.forEach((n) => used.add(n))
    const storyReports = mine.flatMap((n) => groups[n - 1].reports)
    const sources = new Set(storyReports.map(outletOf)).size
    stories.push({ title, groups: mine, sources })
    const urls = groupReports(storyReports).map((r) => r.url)

    const questions = (Array.isArray(s.questions) ? s.questions : []) as Array<Record<string, unknown>>
    let kept = 0
    for (const q of questions) {
      const claimTemplate = String(q?.claim ?? '').trim()
      const covered = Number(q?.coveredBy)
      if (Number.isInteger(covered) && covered >= 1 && covered <= forecasts.length) {
        const f = forecasts[covered - 1]
        skipped.push({ reason: 'covered_by_forecast', story: title, claim: claimTemplate || undefined, detail: `${f.id}: ${f.claimText.slice(0, 160)}` })
        continue
      }
      const skip = (reason: string, detail?: string) => skipped.push({ reason, story: title, claim: claimTemplate || undefined, detail })
      const nonEvent = claimTemplate.match(NON_EVENT_WORDING)
      if (nonEvent) { skip('non_event_wording', nonEvent[0]); continue }
      if (!claimTemplate.includes('{DEADLINE}')) { skip('no_deadline_token'); continue }
      const deadline = parseDeadline(String(q?.deadline ?? '').trim())
      if (!deadline) { skip('bad_deadline', String(q?.deadline ?? '')); continue }
      if (deadline < min || deadline > max) { skip('deadline_out_of_range', deadline.toISOString().slice(0, 10)); continue }
      const rules = String(q?.resolutionRules ?? '').trim()
      if (!rules) { skip('no_rules'); continue }
      const claimText = claimTemplate.replace(/\{DEADLINE\}/g, formatDeadline(deadline))
      if (claimText.length > 499) { skip('claim_too_long'); continue }
      if (kept >= MAX_QUESTIONS_PER_STORY) { skip('story_cap'); continue }
      if (suggestions.length >= MAX_SUGGESTIONS) { skip('run_cap'); continue }
      kept++
      suggestions.push({
        story: title,
        claimText,
        resolutionRules: rules.replace(/\{DEADLINE\}/g, formatDeadline(deadline)),
        resolveByDatetime: deadline.toISOString(),
        reason: String(q?.reason ?? '').trim(),
        sources,
        urls: urls.slice(0, 8),
      })
    }
  }
  return { stories, suggestions, skipped }
}

/**
 * Open forecasts that this week's articles are matched to: the questions Daatan already asks
 * about these stories. Retro rows are past events, not open questions, so they are left out.
 */
export async function loadOpenForecasts(urls: string[]): Promise<OpenForecast[]> {
  if (urls.length === 0) return []
  return prisma.$queryRaw<OpenForecast[]>(Prisma.sql`
    SELECT DISTINCT p.id, p."claimText", p."resolveByDatetime"
    FROM evidence_pool_articles e
    JOIN predictions p ON p.id = e."predictionId"
    WHERE e.url IN (${Prisma.join(urls)})
      AND e.superseded_at IS NULL
      AND p.status::text IN ('ACTIVE', 'PENDING', 'PENDING_APPROVAL')
      AND NOT EXISTS (SELECT 1 FROM retro_simulations r WHERE r.prediction_id = p.id)
    ORDER BY p."resolveByDatetime", p.id
    LIMIT ${MAX_OPEN_FORECASTS}
  `)
}

/**
 * Stage 1 of daatan#2308: this week's stories and the open questions they raise, ready for an
 * admin to read. Clusters the pool like the retro candidates step, keeps clusters reported by at
 * least `minSources` outlets, and asks the model once over all of them. Writes nothing.
 */
export async function findTopicSuggestions(opts: SuggestOptions): Promise<SuggestResult> {
  const now = opts.now ?? new Date()
  const started = Date.now()
  const timingsMs: Record<string, number> = {}
  let t = started
  const lap = (name: string) => {
    timingsMs[name] = Date.now() - t
    t = Date.now()
  }

  const { claims, reports } = await loadPoolReports(opts.days)
  lap('load')
  const clusters = await clusterReports(reports, opts.threshold)
  lap('cluster')
  const multi = clusters
    .map((c) => ({ reports: c, sources: new Set(c.map(outletOf)).size }))
    .filter((c) => c.sources >= opts.minSources)
    .sort((a, b) => b.sources - a.sources || b.reports.length - a.reports.length)
  const groups = multi.slice(0, opts.maxClusters)
  const base = { claims, reports: reports.length, clusters: clusters.length, multiSource: multi.length, sent: groups.length }
  if (groups.length === 0) {
    return { ...base, openForecasts: 0, stories: [], suggestions: [], skipped: [], timingsMs }
  }

  const forecasts = await loadOpenForecasts([...new Set(groups.flatMap((g) => g.reports.map((r) => r.url)))])
  lap('forecasts')

  let answer: ValidatedAnswer
  let modelNote: string | undefined
  const signal = AbortSignal.timeout(Math.max(RUN_BUDGET_MS - (Date.now() - started), 1))
  try {
    const result = await llmService.generateContent({
      ...forStage('topic_suggest'),
      prompt: await buildSuggestPrompt(groups, forecasts, now),
      schema: topicSuggestSchema,
      signal,
    })
    answer = validateSuggestions(JSON.parse(result.text) as Record<string, unknown>, groups, forecasts, now)
    if (result.fallbackProvider) modelNote = `answered by ${result.fallbackProvider}`
  } catch (err) {
    const detail = signal.aborted ? `timeout at ${RUN_BUDGET_MS / 1000} s into the run` : String((err as Error)?.message ?? err).slice(0, 200)
    log.warn({ err, detail }, 'topic suggest call failed')
    lap('suggest')
    return { ...base, openForecasts: forecasts.length, stories: [], suggestions: [], skipped: [{ reason: 'suggest_error', story: '', detail }], timingsMs }
  }
  lap('suggest')

  // Backstop to `coveredBy`: a near-copy of an existing forecast's wording, in any status.
  const vectors = answer.suggestions.length ? await embedTexts(answer.suggestions.map((s) => eventText(s.claimText))) : []
  const suggestions: TopicSuggestion[] = []
  for (const [i, s] of answer.suggestions.entries()) {
    const v = vectors[i]
    const near = v ? (await findNearForecasts(v, NEAR_FORECAST_MIN_SCORE, 1))[0] : undefined
    if (near && near.score >= DUPLICATE_MIN_SCORE) {
      answer.skipped.push({ reason: 'near_duplicate', story: s.story, claim: s.claimText, detail: `${near.id} (${near.score.toFixed(3)}): ${near.claimText.slice(0, 160)}` })
      continue
    }
    suggestions.push(near ? { ...s, nearest: { id: near.id, claimText: near.claimText, status: near.status, score: Number(near.score.toFixed(3)) } } : s)
  }
  lap('dedupe')

  log.info(
    { ...base, openForecasts: forecasts.length, stories: answer.stories.length, suggestions: suggestions.length, skipped: answer.skipped.length, modelNote, timingsMs },
    'topic suggestions',
  )
  return { ...base, openForecasts: forecasts.length, stories: answer.stories, suggestions, skipped: answer.skipped, modelNote, timingsMs }
}
