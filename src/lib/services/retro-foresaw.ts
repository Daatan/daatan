import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { canonicalOutlet } from '@/lib/services/sourceLeaderboard'

/**
 * Read side of the "Who foresaw X?" pages (daatan#2217 PR 3). Retro simulations stay
 * `isPublic=false`; this is the only public door onto them, so the visibility gate lives in the
 * query: an approved (resolved) retro simulation that has generator evidence. Pending and
 * rejected (VOID) drafts, and every non-retro forecast, never match.
 */
const SHOWN_STATUSES = ['RESOLVED_CORRECT', 'RESOLVED_WRONG'] as const

/**
 * A source "called" the event when its stance toward the claim is at least this far on the side
 * the outcome took, and "said the opposite" at this far the other way. Inclusive: many stored
 * stances sit exactly on ±0.3. Mark, 2026-11-18.
 */
export const FORESAW_STANCE = 0.3

export type ForesawSide = 'called' | 'against' | 'neutral'
export type RetroOutcome = 'correct' | 'wrong'

export function classifyStance(stance: number, outcome: RetroOutcome): ForesawSide {
  const toward = outcome === 'correct' ? stance : -stance
  if (toward >= FORESAW_STANCE) return 'called'
  if (toward <= -FORESAW_STANCE) return 'against'
  return 'neutral'
}

export interface ForesawArticle {
  url: string
  title: string | null
  outlet: string | null
  /** YYYY-MM-DD; every article is dated before the event's as-of date. */
  publishedDate: string | null
  stance: number
  side: ForesawSide
  /**
   * This article's share of the Oracul's pooling weight, 0..1. Null on rows generated before the
   * factors were stored (2026-11-18). Approximate: cluster down-weighting and the per-source
   * share cap, when the Oracul has them on, are not in the stored factors.
   */
  weightShare: number | null
}

export interface ForesawReport {
  url: string
  outlet: string | null
  publishedDate: string | null
}

export interface ForesawEventSummary {
  slug: string
  eventText: string
  /** YYYY-MM-DD */
  eventDate: string
  /** YYYY-MM-DD: the simulated forecast date, a week before the event. */
  asOf: string
  outcome: RetroOutcome
  /** 0..1 */
  oraculProbability: number | null
  called: number
  against: number
  total: number
}

export interface ForesawEvent extends ForesawEventSummary {
  claimText: string
  eventUrl: string | null
  /** Newest first. */
  articles: ForesawArticle[]
  reports: ForesawReport[]
  hasWeights: boolean
}

const num = z.number().nullish().catch(null)
const str = z.string().nullish().catch(null)

// Tolerant: the stored JSON is the generator's, but rows from before a field existed lack it.
const evidenceSchema = z.object({
  sent: z
    .array(z.object({ url: z.string(), title: str, source: str, publishedAt: str }))
    .catch([]),
  oracul: z.object({
    sources: z.array(
      z.object({
        url: z.string(),
        source: str,
        stance: z.number(),
        publishedDate: str,
        credibilityWeight: num,
        evidenceWeight: num,
        recencyWeight: num,
        relevanceScore: num,
      }),
    ),
  }),
  reports: z
    .array(z.object({ url: z.string(), source: str, publishedDate: str }))
    .catch([]),
})

type ParsedSource = z.infer<typeof evidenceSchema>['oracul']['sources'][number]

/**
 * The Oracul's pooling weight from its stored factors: credibility × evidence × recency ×
 * relevance band. The band table in retro `aggregation.relevance_weight` is the square of the
 * score, so squaring here matches it.
 */
function poolingWeight(s: ParsedSource): number | null {
  const { credibilityWeight: c, evidenceWeight: e, recencyWeight: r, relevanceScore: rel } = s
  if (c == null || e == null || r == null || rel == null) return null
  return c * e * r * rel * rel
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const dayOf = (value: string | null | undefined) => (value ? value.slice(0, 10) : null)

type Row = {
  eventText: string | null
  eventDate: Date | null
  eventUrl: string | null
  asOf: Date
  outcome: string
  oraculProbability: number | null
  evidence: Prisma.JsonValue
  prediction: { slug: string | null; claimText: string }
}

function toEvent(row: Row): ForesawEvent | null {
  const parsed = evidenceSchema.safeParse(row.evidence)
  if (!parsed.success || !row.eventText || !row.eventDate || !row.prediction.slug) return null
  const outcome: RetroOutcome = row.outcome === 'wrong' ? 'wrong' : 'correct'
  const { sent, oracul, reports } = parsed.data
  const sentByUrl = new Map(sent.map((a) => [a.url, a]))

  const weights = oracul.sources.map(poolingWeight)
  const hasWeights = weights.length > 0 && weights.every((w) => w != null)
  const totalWeight = hasWeights ? weights.reduce<number>((sum, w) => sum + (w ?? 0), 0) : 0

  const articles: ForesawArticle[] = oracul.sources
    .map((s, i) => {
      const meta = sentByUrl.get(s.url)
      return {
        url: s.url,
        title: meta?.title ?? null,
        outlet: s.source ?? meta?.source ?? null,
        publishedDate: dayOf(s.publishedDate) ?? dayOf(meta?.publishedAt),
        stance: s.stance,
        side: classifyStance(s.stance, outcome),
        weightShare: hasWeights && totalWeight > 0 ? (weights[i] ?? 0) / totalWeight : null,
      }
    })
    .sort((a, b) => (b.publishedDate ?? '').localeCompare(a.publishedDate ?? ''))

  return {
    slug: row.prediction.slug,
    claimText: row.prediction.claimText,
    eventText: row.eventText,
    eventDate: isoDate(row.eventDate),
    eventUrl: row.eventUrl,
    asOf: isoDate(row.asOf),
    outcome,
    oraculProbability: row.oraculProbability,
    called: articles.filter((a) => a.side === 'called').length,
    against: articles.filter((a) => a.side === 'against').length,
    total: articles.length,
    articles,
    reports: reports.map((r) => ({ url: r.url, outlet: r.source ?? null, publishedDate: dayOf(r.publishedDate) })),
    hasWeights,
  }
}

const SHOWN_WHERE = {
  evidence: { not: Prisma.DbNull },
  eventText: { not: null },
  eventDate: { not: null },
  prediction: { status: { in: [...SHOWN_STATUSES] }, slug: { not: null } },
} satisfies Prisma.RetroSimulationWhereInput

const SELECT = {
  eventText: true,
  eventDate: true,
  eventUrl: true,
  asOf: true,
  outcome: true,
  oraculProbability: true,
  evidence: true,
  prediction: { select: { slug: true, claimText: true } },
} satisfies Prisma.RetroSimulationSelect

async function shownEvents(): Promise<ForesawEvent[]> {
  const rows = await prisma.retroSimulation.findMany({
    where: SHOWN_WHERE,
    select: SELECT,
    orderBy: { eventDate: 'desc' },
  })
  return rows.flatMap((row) => toEvent(row) ?? [])
}

/** Every shown event, newest event first. */
export async function listForesawEvents(): Promise<ForesawEventSummary[]> {
  return (await shownEvents()).map(({ slug, eventText, eventDate, asOf, outcome, oraculProbability, called, against, total }) => ({
    slug, eventText, eventDate, asOf, outcome, oraculProbability, called, against, total,
  }))
}

/**
 * The retro source board's sample floor (daatan#2217 PR 4, Mark 2026-11-22): an outlet is ranked
 * only once it wrote about this many shown events. Below it, "called 1 of 1" reads as a 100%
 * record; those outlets are counted, not listed. Revisit at ~20 events.
 */
export const BOARD_MIN_EVENTS = 2

export interface ForesawSourceEvent {
  slug: string
  eventText: string
  side: ForesawSide
}

export interface ForesawSourceRow {
  outlet: string
  /** Events it called before T0: an article on the outcome's side and none against it. */
  called: number
  /** Events it said would not happen: the mirror of `called`. */
  against: number
  /** Shown events with at least one of its articles in the Oracul's pre-T0 set. */
  total: number
  /** Newest event first. */
  events: ForesawSourceEvent[]
}

export interface ForesawSourceBoard {
  eventCount: number
  rows: ForesawSourceRow[]
  /** Outlets below BOARD_MIN_EVENTS. */
  hiddenOutlets: number
}

/**
 * One outlet's verdict on one event from all its articles in the set: it called the event when
 * at least one article did and none said the opposite, and the mirror for against. Both sides at
 * once, or neither, is neutral.
 */
export function outletSide(sides: ForesawSide[]): ForesawSide {
  const called = sides.includes('called')
  const against = sides.includes('against')
  if (called && !against) return 'called'
  if (against && !called) return 'against'
  return 'neutral'
}

/**
 * The retro-only source board (daatan#2217 PR 4, Q1/Q7). Built from the same shown events and the
 * same per-article sides as the event pages, so the two never disagree. No Brier: every shown
 * outcome is what happened, so accuracy would rank outlets by how often they say "it will".
 * Sorted by events called, then the called share, then events written about.
 */
export async function getForesawSourceBoard(): Promise<ForesawSourceBoard> {
  const events = await shownEvents()
  const byOutlet = new Map<string, Map<string, { event: ForesawEvent; sides: ForesawSide[] }>>()
  for (const event of events) {
    for (const article of event.articles) {
      const outlet = canonicalOutlet(article.outlet?.trim() || null)
      if (!outlet) continue
      const perEvent = byOutlet.get(outlet) ?? new Map()
      byOutlet.set(outlet, perEvent)
      const entry = perEvent.get(event.slug) ?? { event, sides: [] }
      entry.sides.push(article.side)
      perEvent.set(event.slug, entry)
    }
  }

  const all: ForesawSourceRow[] = [...byOutlet].map(([outlet, perEvent]) => {
    const list = [...perEvent.values()]
      .sort((a, b) => b.event.eventDate.localeCompare(a.event.eventDate))
      .map(({ event, sides }) => ({ slug: event.slug, eventText: event.eventText, side: outletSide(sides) }))
    return {
      outlet,
      called: list.filter((e) => e.side === 'called').length,
      against: list.filter((e) => e.side === 'against').length,
      total: list.length,
      events: list,
    }
  })
  const rows = all
    .filter((r) => r.total >= BOARD_MIN_EVENTS)
    .sort((a, b) => b.called - a.called || b.called / b.total - a.called / a.total || b.total - a.total || a.outlet.localeCompare(b.outlet))
  return { eventCount: events.length, rows, hiddenOutlets: all.length - rows.length }
}

export async function getForesawEvent(slug: string): Promise<ForesawEvent | null> {
  const row = await prisma.retroSimulation.findFirst({
    where: { ...SHOWN_WHERE, prediction: { ...SHOWN_WHERE.prediction, slug } },
    select: SELECT,
  })
  return row ? toEvent(row) : null
}
