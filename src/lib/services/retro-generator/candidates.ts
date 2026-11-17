import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { embedTexts } from '@/lib/services/embedding'
import { averageLinkage, eventText, SAME_EVENT_MIN_SCORE } from './cluster'
import { judgeCluster, MAX_JUDGE_REPORTS, type JudgeResult } from './judge'
import { EARLY_REPORT_TOLERANCE_DAYS, parseDay, parsePublished, retroTimeline } from './timeline'
import type { PoolReport } from './types'

const log = createLogger('retro-candidates')

export const CANDIDATE_DEFAULTS = { days: 7, threshold: 0.88, minSources: 2, maxClusters: 40 } as const
const JUDGE_CONCURRENCY = 8
/** A cluster whose articles are mostly already behind a retro row is the same event again. */
const KNOWN_URL_SHARE = 0.5

export interface CandidateOptions {
  days: number
  threshold: number
  minSources: number
  maxClusters: number
  now?: Date
}

/** A judged, dated event ready for `simulateRetroEvent`. */
export interface RetroCandidate {
  sources: number
  reports: PoolReport[]
  event: { summary: string; date: string; url: string; reason: string }
  claimTemplate: string
  rulesTemplate: string
  /** Preview only — `simulateRetroEvent` recomputes these from `event.date` and `reports`. */
  preview: { claimText: string; asOf: string; cutoffAt: string; deadline: string; earlyReports: number }
  /** Other clusters' candidates judged to be this same event, folded in here. */
  merged: Array<{ claimText: string; sources: number }>
}

export interface CandidatesResult {
  claims: number
  reports: number
  clusters: number
  multiSource: number
  known: number
  judged: number
  /** Candidates folded into another one as the same event. */
  merged: number
  candidates: RetroCandidate[]
  skipped: Array<{ reason: string; sources: number; sample: string; detail?: string }>
  timingsMs: Record<string, number>
}

interface PoolClaimRow {
  url: string
  source: string | null
  published_date: string | null
  claim: string
  quote: string | null
}

/**
 * Reported facts from the last `days` of the evidence pool: claims an article stated as having
 * happened (`reported_fact`, `report_kind = change`, verified, unconditional) that are NOT the
 * occurrence of the forecast they were matched to — i.e. events no forecast asked about. Same
 * filter as the 2026-11-16 simulation the clustering threshold was calibrated on.
 */
export async function loadPoolReports(days: number): Promise<{ claims: number; reports: PoolReport[] }> {
  const rows = await prisma.$queryRaw<PoolClaimRow[]>(Prisma.sql`
    SELECT e.url, e.source, e.published_date, x.cl->>'claim' AS claim, left(x.cl->>'quote', 300) AS quote
    FROM (
      SELECT url, source, published_date, claims_detail
      FROM evidence_pool_articles
      WHERE superseded_at IS NULL
        AND added_at > now() - make_interval(days => ${days}::int)
        AND jsonb_typeof(claims_detail) = 'array'
    ) e
    CROSS JOIN LATERAL jsonb_array_elements(e.claims_detail) AS x(cl)
    WHERE x.cl->>'evidence_class' = 'reported_fact'
      AND x.cl->>'is_occurrence' = 'false'
      AND x.cl->>'report_kind' = 'change'
      AND x.cl->>'verified' = 'true'
      AND coalesce(x.cl->>'is_conditional', '') <> 'true'
      AND coalesce(x.cl->>'claim', '') <> ''
  `)
  // One article matched to several forecasts repeats a claim; keep one per (article, event).
  const seen = new Set<string>()
  const reports: PoolReport[] = []
  for (const r of rows) {
    const key = `${r.url}\u0000${eventText(r.claim)}`
    if (seen.has(key)) continue
    seen.add(key)
    reports.push({ url: r.url, source: r.source, publishedDate: r.published_date, claim: r.claim, quote: r.quote })
  }
  return { claims: rows.length, reports }
}

export function outletOf(r: PoolReport): string {
  if (r.source) return r.source.toLowerCase()
  try {
    return new URL(r.url).hostname.replace(/^www\./, '')
  } catch {
    return r.url
  }
}

/** Group reports into candidate events: embed the event part of each claim, average-linkage at `threshold`. */
export async function clusterReports(reports: PoolReport[], threshold: number): Promise<PoolReport[][]> {
  const texts = [...new Set(reports.map((r) => eventText(r.claim)))]
  const vectors = await embedTexts(texts)
  const byText = new Map<string, number[]>()
  texts.forEach((t, i) => {
    const v = vectors[i]
    if (v) byText.set(t, v)
  })
  const embedded = reports.flatMap((r) => {
    const v = byText.get(eventText(r.claim))
    return v ? [{ r, v }] : []
  })
  if (embedded.length < reports.length) log.warn({ missing: reports.length - embedded.length }, 'some pool claims could not be embedded')
  return averageLinkage(embedded.map((e) => e.v), threshold).map((members) => members.map((i) => embedded[i].r))
}

/**
 * The reports a candidate carries into `simulateRetroEvent` (at most {@link MAX_JUDGE_REPORTS}):
 * one per article, those dated from the cutoff tolerance on first, earliest first, so the
 * slots go to reports of the event rather than to the precursors and misdated pages that
 * cannot move its timeline; then always the report the judge named.
 */
export function candidateReports(reports: PoolReport[], eventDay: string, eventUrl: string): PoolReport[] {
  const byUrl = new Map<string, PoolReport>()
  for (const r of reports) if (!byUrl.has(r.url)) byUrl.set(r.url, r)
  const floor = (parseDay(eventDay)?.getTime() ?? 0) - EARLY_REPORT_TOLERANCE_DAYS * 86_400_000
  const time = (r: PoolReport) => parsePublished(r.publishedDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
  const rank = (r: PoolReport) => (time(r) >= floor ? 0 : 1)
  const ordered = [...byUrl.values()].sort((a, b) => rank(a) - rank(b) || time(a) - time(b))
  const out = ordered.slice(0, MAX_JUDGE_REPORTS)
  const named = byUrl.get(eventUrl)
  if (named && !out.includes(named)) out[out.length - 1] = named
  return out
}

export interface JudgedCluster {
  reports: PoolReport[]
  sources: number
  judged: Extract<JudgeResult, { ok: true }>
}

/**
 * Fold judged clusters that are the same event into one candidate. Clustering at 0.88 on claim
 * wording splits a big story — on 2026-11-16's pool, "Herzog tasked Eisenkot" came out of 8
 * clusters — and a dry run writes nothing, so the DB dedupe in `simulateRetroEvent` would never
 * see the siblings. Groups the judged claims at {@link SAME_EVENT_MIN_SCORE}; the member with
 * the most outlets speaks for the group and the reports are pooled. A claim without a vector
 * stays on its own. `items` arrive largest first, so the first member of a group is its lead.
 */
export function mergeSameEvent(items: JudgedCluster[], vectors: Array<number[] | null>, now: Date): RetroCandidate[] {
  const withVector = items.flatMap((item, i) => (vectors[i] ? [i] : []))
  const groups = [
    ...averageLinkage(withVector.map((i) => vectors[i] as number[]), SAME_EVENT_MIN_SCORE).map((g) => g.map((k) => withVector[k])),
    ...items.flatMap((_, i) => (vectors[i] ? [] : [[i]])),
  ].map((g) => g.sort((a, b) => a - b))
  groups.sort((a, b) => a[0] - b[0])

  return groups.flatMap((g) => {
    const lead = items[g[0]]
    const { event } = lead.judged
    const reports = candidateReports(g.flatMap((i) => items[i].reports), event.date, event.url)
    const dates = reports.map((r) => parsePublished(r.publishedDate)).filter((d): d is Date => d !== null)
    const t = retroTimeline(event.date, dates, now)
    if (!t.ok) {
      log.warn({ reason: t.reason, claim: lead.judged.claimText }, 'merged candidate lost its timeline')
      return []
    }
    return [{
      sources: new Set(g.flatMap((i) => items[i].reports.map(outletOf))).size,
      reports,
      event: { summary: event.summary, date: event.date, url: event.url, reason: event.reason },
      claimTemplate: event.claimTemplate,
      rulesTemplate: event.rulesTemplate,
      preview: {
        claimText: lead.judged.claimText,
        asOf: t.timeline.asOf.toISOString(),
        cutoffAt: t.timeline.cutoffAt.toISOString(),
        deadline: t.timeline.deadline.toISOString(),
        earlyReports: t.timeline.earlyReports,
      },
      merged: g.slice(1).map((i) => ({ claimText: items[i].judged.claimText, sources: items[i].sources })),
    }]
  })
}

/** Article URLs already behind a retro simulation, in any status (a rejected one stays known). */
async function knownRetroUrls(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ url: string }>>(Prisma.sql`
    SELECT DISTINCT r->>'url' AS url
    FROM retro_simulations s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s.evidence->'reports') = 'array' THEN s.evidence->'reports' ELSE '[]'::jsonb END
    ) AS r
    WHERE r->>'url' IS NOT NULL
  `)
  return new Set(rows.map((r) => r.url))
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * Stage 1 of the retro generator (daatan#2217): this week's candidate events. Clusters the
 * pool's reported facts, keeps clusters reported by at least `minSources` outlets, drops the
 * ones a retro row already covers, and asks the judge whether each is one dated past event and
 * what forecast it would have settled. Writes nothing; `simulateRetroEvent` takes it from here,
 * one event per request.
 */
export async function findRetroCandidates(opts: CandidateOptions): Promise<CandidatesResult> {
  const now = opts.now ?? new Date()
  const timingsMs: Record<string, number> = {}
  let t = Date.now()
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

  const known = await knownRetroUrls()
  const fresh = multi.filter((c) => {
    const urls = new Set(c.reports.map((r) => r.url))
    const seen = [...urls].filter((u) => known.has(u)).length
    return seen / urls.size < KNOWN_URL_SHARE
  })
  const toJudge = fresh.slice(0, opts.maxClusters)

  const judged = await mapConcurrent(toJudge, JUDGE_CONCURRENCY, (c) => judgeCluster(c.reports, now))
  lap('judge')

  const ok: JudgedCluster[] = []
  const skipped: CandidatesResult['skipped'] = []
  judged.forEach((j, i) => {
    const c = toJudge[i]
    if (j.ok) ok.push({ ...c, judged: j })
    else skipped.push({ reason: j.reason, sources: c.sources, sample: eventText(c.reports[0].claim).slice(0, 160), detail: j.detail?.slice(0, 200) })
  })
  const vectors = ok.length > 1 ? await embedTexts(ok.map((o) => o.judged.claimText)) : ok.map(() => null)
  const candidates = mergeSameEvent(ok, vectors, now)
  const merged = candidates.reduce((n, c) => n + c.merged.length, 0)
  lap('merge')

  log.info(
    { claims, reports: reports.length, clusters: clusters.length, multiSource: multi.length, known: multi.length - fresh.length, judged: toJudge.length, merged, candidates: candidates.length, timingsMs },
    'retro candidates',
  )
  return {
    claims,
    reports: reports.length,
    clusters: clusters.length,
    multiSource: multi.length,
    known: multi.length - fresh.length,
    judged: toJudge.length,
    merged,
    candidates,
    skipped,
    timingsMs,
  }
}
