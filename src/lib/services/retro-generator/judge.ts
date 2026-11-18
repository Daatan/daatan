import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { llmService } from '@/lib/llm'
import { retroEventJudgeSchema } from '@/lib/llm/schemas'
import { forStage } from '@/lib/llm/stageModels'
import { createLogger } from '@/lib/logger'
import { parsePublished, retroTimeline, fillDeadline, type RetroTimeline } from './timeline'
import type { PoolReport } from './types'

const log = createLogger('retro-event-judge')

export const JUDGE_KINDS = ['event', 'trend', 'not_yet', 'mixed', 'other'] as const
export type JudgeKind = (typeof JUDGE_KINDS)[number]

/** Reports shown to the judge per cluster: one per article, earliest first. */
export const MAX_JUDGE_REPORTS = 20
const MAX_REPORT_CHARS = 400

export interface JudgedEvent {
  kind: 'event'
  reason: string
  summary: string
  /** YYYY-MM-DD */
  date: string
  url: string
  /** With the literal {DEADLINE} token, filled from the timeline. */
  claimTemplate: string
  rulesTemplate: string
}

export type JudgeResult =
  | { ok: true; event: JudgedEvent; timeline: RetroTimeline; claimText: string; resolutionRules: string; modelNote?: string }
  | { ok: false; reason: string; kind?: JudgeKind; detail?: string }

/** One report per article, earliest first, so the judge's numbering is stable and short. */
export function judgeReports(reports: PoolReport[]): PoolReport[] {
  const byUrl = new Map<string, PoolReport>()
  for (const r of reports) if (!byUrl.has(r.url)) byUrl.set(r.url, r)
  const time = (r: PoolReport) => parsePublished(r.publishedDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
  return [...byUrl.values()].sort((a, b) => time(a) - time(b)).slice(0, MAX_JUDGE_REPORTS)
}

function reportLine(r: PoolReport, i: number): string {
  const day = parsePublished(r.publishedDate)?.toISOString().slice(0, 10) ?? 'undated'
  const quote = r.quote ? ` | quote: "${r.quote}"` : ''
  return `[${i + 1}] ${day} · ${r.source ?? 'unknown outlet'} — ${r.claim}${quote}`.slice(0, MAX_REPORT_CHARS)
}

/**
 * Validate a judge answer against the reports it saw and derive the timeline. Pure, so the
 * gate is testable without a model: anything but a dated, single, past event is skipped.
 */
export function validateJudgement(
  raw: Record<string, unknown>,
  reports: PoolReport[],
  now: Date,
): JudgeResult {
  const kind = JUDGE_KINDS.find((k) => k === raw.kind)
  if (!kind) return { ok: false, reason: 'judge_bad_kind', detail: String(raw.kind) }
  const reason = String(raw.reason ?? '').trim()
  if (kind !== 'event') return { ok: false, reason: `not_event:${kind}`, kind, detail: reason }

  const index = Number(raw.eventIndex)
  if (!Number.isInteger(index) || index < 1 || index > reports.length) {
    return { ok: false, reason: 'judge_bad_index', kind, detail: String(raw.eventIndex) }
  }
  const claimTemplate = String(raw.claim ?? '').trim()
  const rulesTemplate = String(raw.resolutionRules ?? '').trim()
  const summary = String(raw.eventSummary ?? '').trim()
  if (!claimTemplate.includes('{DEADLINE}')) return { ok: false, reason: 'judge_no_deadline_token', kind, detail: claimTemplate }
  if (!rulesTemplate || !summary) return { ok: false, reason: 'judge_incomplete', kind }

  const dates = reports.map((r) => parsePublished(r.publishedDate)).filter((d): d is Date => d !== null)
  const date = String(raw.eventDate ?? '').trim()
  const t = retroTimeline(date, dates, now)
  if (!t.ok) return { ok: false, reason: t.reason, kind, detail: date }

  const claimText = fillDeadline(claimTemplate, t.timeline.deadline)
  if (claimText.length > 499) return { ok: false, reason: 'claim_too_long', kind }
  return {
    ok: true,
    event: { kind, reason, summary, date, url: reports[index - 1].url, claimTemplate, rulesTemplate },
    timeline: t.timeline,
    claimText,
    resolutionRules: fillDeadline(rulesTemplate, t.timeline.deadline),
  }
}

/** The judge prompt for reports already passed through {@link judgeReports}. */
export async function buildJudgePrompt(reports: PoolReport[], now: Date): Promise<string> {
  return fillPrompt(await getPromptTemplate('retro-event-judge'), {
    today: now.toISOString().slice(0, 10),
    reports: reports.map(reportLine).join('\n'),
  })
}

/** Ask the judge whether one cluster is a single past event, and what the forecast would have been. */
export async function judgeCluster(clusterReports: PoolReport[], now: Date = new Date()): Promise<JudgeResult> {
  const reports = judgeReports(clusterReports)
  try {
    const result = await llmService.generateContent({
      ...forStage('retro_event_judge'),
      prompt: await buildJudgePrompt(reports, now),
      schema: retroEventJudgeSchema,
      temperature: 0,
    })
    const judged = validateJudgement(JSON.parse(result.text) as Record<string, unknown>, reports, now)
    return judged.ok && result.fallbackProvider ? { ...judged, modelNote: `answered by ${result.fallbackProvider}` } : judged
  } catch (err) {
    log.warn({ err }, 'retro event judge failed')
    return { ok: false, reason: 'judge_error' }
  }
}
