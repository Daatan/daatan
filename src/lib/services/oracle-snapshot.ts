import type { OracleClaimDetail, OracleProvenanceModels, OracleSource } from '@/lib/services/oracle'
import type { SearchResult } from '@/lib/services/oracleSearch'
import type { ContributingSource } from '@/lib/services/forecast-sources'
import type { EvidencePoolArticle } from '@prisma/client'

/**
 * A published probability never touches a literal 0 or 100 — our evidence is
 * *reporting*, not observation, so even a pinned outcome keeps a reporting-error
 * margin (system-model §6.2).
 *
 * Deliberately wider than the clock path's `[PIN_LOW, PIN_HIGH]` = [3, 97]
 * (`temporal-clock.ts`): that is the settlement *pin value* convention, and
 * imposing it here would compress honestly-wide intervals — a forecast that
 * means 2–98 should be allowed to say so. The only rule this bound encodes is
 * the one §6.2 states: not 0, not 100.
 */
export const PUBLISH_PERCENT_MIN = 1
export const PUBLISH_PERCENT_MAX = 99

/**
 * A probability move below this many points, against the current evidence
 * anchor, carries no new information — used both by the requote cron
 * (temporal-clock.ts, to skip a near-noise clock write) and by
 * `recordEstimate` (context.ts, F17/daatan#1236, to decide whether a write
 * is material enough to become the glide clock's next anchor). One shared
 * constant so the two thresholds can't drift apart; lives here rather than
 * in either service to avoid a context.ts <-> temporal-clock.ts import cycle
 * (temporal-clock.ts already imports from context.ts).
 */
export const MATERIAL_CHANGE_PTS = 1

/**
 * Map an aggregated Oracle stance/CI bound in [-1, 1] to a probability percent
 * in [PUBLISH_PERCENT_MIN, PUBLISH_PERCENT_MAX]. Shared by every call site that
 * builds a `ContextSnapshot.oracleSnapshot`
 * (news-indexer push, user-triggered analyze, backfill) so `mean`/`ciLow`/`ciHigh`
 * always land on the same scale inside that JSON blob — a prior split where only
 * ciLow/ciHigh went through this conversion and `mean` was stored raw made the
 * snapshot look self-contradictory (e.g. mean=0.60 next to ciLow=54/ciHigh=99).
 *
 * The bound lives here rather than at each writer because this function IS the
 * single publish point for the percent scale (daatan#1266). Before it did, the
 * clock path clamped and the evidence path did not, so an interval endpoint at
 * stance ±0.99 → 99.5 → `Math.round` → **100** went out as a literal certainty:
 * 1,699 snapshots on record, 1,509 of them settled, and 29% of everything
 * written in the 48h before this shipped. The `mean` was never the problem —
 * the Oracle's per-vote clamp already held it inside [1, 99].
 */
export function stanceToPercent(v: number): number {
  const percent = Math.round(((v + 1) / 2) * 100)
  return Math.min(PUBLISH_PERCENT_MAX, Math.max(PUBLISH_PERCENT_MIN, percent))
}

/**
 * Inverse of {@link stanceToPercent}, for the one lane that has to travel back:
 * retro's settlement-pin ledger takes `mean`/`ci_low`/`ci_high` in stance space
 * (`SettlementSnapshotInput`, `ge=-1.0 le=1.0`), and the only pinned value we
 * persist is the already-converted percent inside `oracleSnapshot`.
 *
 * Lossy at the edges by construction: the forward map rounds and clamps to
 * [PUBLISH_PERCENT_MIN, PUBLISH_PERCENT_MAX], so a stance past ±0.98 comes back
 * as ±0.98 and everything carries ±0.01 of rounding. The sign survives exactly,
 * which is what the ledger keys its contradiction check on.
 */
export function percentToStance(v: number): number {
  return v / 50 - 1
}

/** Scale a stance-space standard deviation onto the same percent scale as {@link stanceToPercent}
 *  (that map's slope is 50, so a spread scales by 50 with no offset). */
export function stanceStdToPercent(v: number): number {
  return Math.round(v * 50)
}

/**
 * One Oracle-analysed source as persisted in `ContextSnapshot.oracleSnapshot.sources`.
 * The Oracle returns stance/certainty/credibility/claims but no title/date/author;
 * those are joined on at capture time — title/date from the input articles, author
 * from news-indexer (which the Oracle response omits).
 */
export type EnrichedOracleSource = {
  sourceId: string
  sourceName: string | null
  url: string
  stance: number | null
  certainty: number | null
  credibilityWeight: number | null
  claims: string[]
  title: string | null
  publishedAt: string | null
  author: string | null
  // Resolved cross-platform person identity (news-indexer). Persisted on the evidence-pool row so
  // elections can attribute a source to a tracked commentator by id/name (Phase 2). Null when the
  // by-url lookup resolved to no identity; undefined when the lookup has no entry for this URL at
  // all (F11, daatan#1237) — the latter must NOT overwrite a previously-resolved identity.
  personId?: string | null
  personName?: string | null
  // Resolved outlet identity (news-indexer, exact match against outlet.name). Same provenance
  // and null/undefined distinction as personId/personName above.
  outletId?: string | null
  outletName?: string | null
  // Below: mirrors OracleSource's optionality (oracle.ts). Undefined means the Oracle response
  // omitted the key — no opinion this run, must NOT overwrite a previously-stored value (F11,
  // daatan#1237). Null means the response explicitly carried a null — a real signal (e.g.
  // "unclassified", "author reported facts only") that DOES overwrite.
  settled?: boolean | null
  // The settlement anchor date (retro #291) — persisted next to `settled` so
  // pool recomputes can re-validate the vote. Strict YYYY-MM-DD from retro.
  settlementEventDate?: string | null
  quantitativeEstimate?: number | null
  evidenceWeight?: number | null
  relevanceScore?: number | null
  // The per-article relevance bar in force for the run that produced this source
  // (retro#393/#394) — same value across every source in a batch, since it's a
  // property of the /forecast call, not the article. Persisted on the pool row;
  // nothing reads it yet (shadow, like authorLean/factSignal).
  relevanceBar?: number | null
  // Which model/prompt produced this source's stance/certainty (daatan#1604/retro#627) —
  // same value across every source in a batch, since it's a property of the /forecast
  // call, not the article. Persisted on the pool row; nothing reads it yet (shadow, like
  // relevanceBar/authorLean).
  extractorModel?: string | null
  extractorPromptVersion?: string | null
  extractorPromptHash?: string | null
  gatekeeperModel?: string | null
  gatekeeperPromptVersion?: string | null
  gatekeeperPromptHash?: string | null
  evidenceClass?: 'reported_fact' | 'cited_probability' | 'cited_share' | 'reporting' | 'opinion' | null
  // The byline author's OWN directional forecast of the event (retro #308/#309), for the
  // author-scoring lane — deliberately NOT part of the estimate. Null when the author only
  // reported facts. Persisted on the pool row; nothing in aggregation reads it (shadow).
  authorLean?: number | null
  authorLeanCertainty?: number | null
  // What THIS ARTICLE reports that most OTHERS expect for the event (retro#686) — the same shape
  // of judgement about the same article as `authorLean`, which is what the byline itself thinks.
  // Consumer is Phase 3 S2's shared-information detector: the GAP between a source's stated
  // consensus and the pool is the shared component (Palley & Satopää 2023). Persisted on the pool
  // row; nothing in aggregation reads it (shadow).
  consensusView?: 'expects_yes' | 'expects_no' | 'divided' | null
  // The FACT-lane counterpart of `stance` + its qualifying facets (retro #313) — a DIAGNOSTIC
  // lane, deliberately not part of the estimate and not a pricing lane in waiting: the cutover
  // framing was retired by decision (retro#533, `Daatan/docs/decisions.md`). It earns its keep
  // on retro's side (extraction-time stance caps, recomputed there) and here as the audit
  // surface behind a pool row. `factSignal` is what the
  // reported facts alone imply [-1,1]; `eventActors`/`eventTarget` name the dominant fact's
  // dyad, `isOccurrence` marks event-itself vs precursor, `verified` marks reported vs claimed.
  // All null on pure opinion. Persisted on the pool row; nothing in aggregation reads them (shadow).
  factSignal?: number | null
  eventActors?: string | null
  eventTarget?: string | null
  isOccurrence?: boolean | null
  verified?: boolean | null
  // Whether the dominant fact ANNOUNCES the event, DENIES it, or is NEITHER
  // (retro#354 D2a) — input to a possible future magnitude check (retro#483). Null when
  // `factSignal` is. Persisted on the pool row; nothing in aggregation reads it (shadow).
  facet?: 'announcement' | 'denial' | 'neither' | null
  // The per-claim layer behind every scalar above (F1/F15, daatan#1235 + retro#364) —
  // each claim's own stance/certainty/class/fact_signal/facets, as retro's fusion
  // consumed them. This is where the inputs to those reductions used to die. Null on
  // rows extracted before it existed (no backfill — the data is gone, not derivable).
  // Persisted verbatim; nothing in aggregation reads it and it is never sent back to
  // `/pool/aggregate` (shadow, like authorLean/factSignal).
  claimsDetail?: OracleClaimDetail[] | null
  // Whether this source's stance is byte-identical to its reading in the immediately-prior
  // evidence snapshot for this prediction — i.e. it was swept into this snapshot by a pool
  // recompute triggered by a DIFFERENT source's new article, not itself re-evaluated. Always
  // false on a single-run enrichment (every listed source WAS just scored). Lets downstream
  // history readers (elections' chart) skip a "new" data point for a source whose value didn't
  // actually move (daatan#1166).
  carriedForward: boolean
}

/**
 * Enrich the Oracle's per-source output with title + publishedDate (joined from the
 * input articles by URL, in-memory) and author (from the news-indexer by-URL lookup).
 * Pure — no I/O. Shared by the analyze route and the backfill script.
 */
export function enrichOracleSources(
  sources: OracleSource[],
  searchResults: SearchResult[],
  authorByUrl: Map<string, string | null>,
  identityByUrl: Map<
    string,
    {
      personId?: string | null
      personName?: string | null
      outletId?: string | null
      outletName?: string | null
    }
  > = new Map(),
  // The response-level `relevance_bar` (retro#393/#394) — the same bar applied
  // to every source in this batch. Passed separately since it lives on
  // OracleForecastResponse, not per-OracleSource.
  relevanceBar: number | null = null,
  // The response-level `provenance.models` (daatan#1604/retro#627) — same reasoning as
  // relevanceBar: one value for the whole /forecast call, stamped onto every source.
  provenanceModels: OracleProvenanceModels | null = null,
): EnrichedOracleSource[] {
  const articleByUrl = new Map(searchResults.map((r) => [r.url, r]))
  return sources.map((s) => {
    const article = articleByUrl.get(s.url)
    const identity = identityByUrl.get(s.url)
    return {
      sourceId: s.source_id,
      sourceName: s.source_name,
      url: s.url,
      stance: s.stance,
      certainty: s.certainty,
      credibilityWeight: s.credibility_weight,
      claims: s.claims,
      title: article?.title ?? null,
      publishedAt: article?.publishedDate ?? null,
      author: authorByUrl.get(s.url) ?? null,
      // `identity` undefined = no lookup entry for this URL this run (F11: stays undefined,
      // preserves a prior value). `identity` present with a null field = resolved, no identity
      // (a real signal: still written).
      personId: identity?.personId,
      personName: identity?.personName,
      outletId: identity?.outletId,
      outletName: identity?.outletName,
      settled: s.settled,
      settlementEventDate: s.settlement_event_date,
      quantitativeEstimate: s.quantitative_estimate,
      evidenceWeight: s.evidence_weight,
      relevanceScore: s.relevance_score,
      relevanceBar,
      extractorModel: provenanceModels?.extractor,
      extractorPromptVersion: provenanceModels?.extractor_prompt_version,
      extractorPromptHash: provenanceModels?.extractor_prompt_hash,
      gatekeeperModel: provenanceModels?.gatekeeper,
      gatekeeperPromptVersion: provenanceModels?.gatekeeper_prompt_version,
      gatekeeperPromptHash: provenanceModels?.gatekeeper_prompt_hash,
      evidenceClass: s.evidence_class,
      authorLean: s.author_lean,
      authorLeanCertainty: s.author_lean_certainty,
      consensusView: s.consensus_view,
      factSignal: s.fact_signal,
      eventActors: s.event_actors,
      eventTarget: s.event_target,
      isOccurrence: s.is_occurrence,
      verified: s.verified,
      facet: s.facet,
      claimsDetail: s.claims_detail,
      carriedForward: false,
    }
  })
}

type EvidenceClass = NonNullable<EnrichedOracleSource['evidenceClass']>
const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  'reported_fact',
  'cited_probability',
  'cited_share',
  'reporting',
  'opinion',
]
function isEvidenceClass(v: unknown): v is EvidenceClass {
  return typeof v === 'string' && (EVIDENCE_CLASSES as readonly string[]).includes(v)
}

type Facet = NonNullable<EnrichedOracleSource['facet']>
const FACETS: readonly Facet[] = ['announcement', 'denial', 'neither']
function isFacet(v: unknown): v is Facet {
  return typeof v === 'string' && (FACETS as readonly string[]).includes(v)
}

type ConsensusView = NonNullable<EnrichedOracleSource['consensusView']>
const CONSENSUS_VIEWS: readonly ConsensusView[] = ['expects_yes', 'expects_no', 'divided']
function isConsensusView(v: unknown): v is ConsensusView {
  return typeof v === 'string' && (CONSENSUS_VIEWS as readonly string[]).includes(v)
}

/**
 * Narrow the `claims_detail` Json column back to `OracleClaimDetail[]`.
 *
 * Defensive in the same spirit as the `claims` narrowing above: this is an
 * untyped Json column written by an external service, so a malformed or
 * legacy value degrades to null rather than propagating a bad shape into a
 * snapshot. Only the three fields every claim must have — a `claim` string
 * and numeric `stance`/`certainty` — are checked; the rest are optional on
 * the wire and a future retro version may add more, which must not
 * invalidate the row.
 *
 * `certainty` is checked because it is non-optional on `OracleClaimDetail`
 * (so omitting the check made this cast a lie) and because retro's own
 * `ClaimDetail` requires it: `recomputeFromPool` feeds this narrowing's
 * output straight back to `/pool/aggregate`, where one claim missing it 422s
 * the WHOLE request. That would drop the estimate to the single-run
 * fallback, which is a far worse failure than dropping one row's per-claim
 * layer — so the stricter bar belongs here, on the shared read path.
 */
export function toClaimsDetail(v: unknown): OracleClaimDetail[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const ok = v.every(
    (c): c is OracleClaimDetail =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as { claim?: unknown }).claim === 'string' &&
      typeof (c as { stance?: unknown }).stance === 'number' &&
      typeof (c as { certainty?: unknown }).certainty === 'number',
  )
  return ok ? (v as OracleClaimDetail[]) : null
}

/**
 * Map one persisted evidence-pool row to the `EnrichedOracleSource` shape stored in
 * `ContextSnapshot.oracleSnapshot.sources`. Used when the news-indexer estimate is the
 * whole-pool aggregate (the default since v1.60.0): the snapshot must then list the pooled
 * articles the number actually averages, not just the one article that fired the push.
 *
 * The pool row carries every extracted signal already (it's `EnrichedOracleSource`-shaped by
 * design — see the schema), with two exceptions the caller supplies: `author` — the snapshot
 * paths re-look it up from news-indexer by URL for freshness, while pool-only readers pass
 * `row.author` (stored since Phase 2.1) — and `sourceId`, for which the pool row's own id is a
 * stable unique key (it's only ever used as a display key). `claims` is a Json column, so it's
 * defensively narrowed to string[]. `carriedForward` defaults false for callers (e.g. the
 * election matrix) that don't diff against a prior snapshot; `resolvePooledEstimate` passes
 * the real comparison.
 */
export type PoolArticleSnapshotRow = Pick<
  EvidencePoolArticle,
  | 'id'
  | 'source'
  | 'url'
  | 'stance'
  | 'certainty'
  | 'credibilityWeight'
  | 'claims'
  | 'title'
  | 'publishedDate'
  | 'personId'
  | 'personName'
  | 'outletId'
  | 'outletName'
  | 'settled'
  | 'settlementEventDate'
  | 'quantitativeEstimate'
  | 'evidenceWeight'
  | 'relevanceScore'
  | 'relevanceBar'
  | 'extractorModel'
  | 'extractorPromptVersion'
  | 'extractorPromptHash'
  | 'gatekeeperModel'
  | 'gatekeeperPromptVersion'
  | 'gatekeeperPromptHash'
  | 'evidenceClass'
  | 'authorLean'
  | 'authorLeanCertainty'
  | 'consensusView'
  | 'factSignal'
  | 'eventActors'
  | 'eventTarget'
  | 'isOccurrence'
  | 'verified'
  | 'facet'
  | 'claimsDetail'
>

export function poolArticleToEnrichedSource(
  row: PoolArticleSnapshotRow,
  author: string | null,
  carriedForward = false,
): EnrichedOracleSource {
  return {
    sourceId: row.id,
    sourceName: row.source,
    url: row.url,
    stance: row.stance,
    certainty: row.certainty,
    credibilityWeight: row.credibilityWeight,
    claims: Array.isArray(row.claims) ? row.claims.filter((c): c is string => typeof c === 'string') : [],
    title: row.title,
    publishedAt: row.publishedDate,
    author,
    personId: row.personId,
    personName: row.personName,
    outletId: row.outletId,
    outletName: row.outletName,
    settled: row.settled,
    settlementEventDate: row.settlementEventDate,
    quantitativeEstimate: row.quantitativeEstimate,
    evidenceWeight: row.evidenceWeight,
    relevanceScore: row.relevanceScore,
    relevanceBar: row.relevanceBar,
    extractorModel: row.extractorModel,
    extractorPromptVersion: row.extractorPromptVersion,
    extractorPromptHash: row.extractorPromptHash,
    gatekeeperModel: row.gatekeeperModel,
    gatekeeperPromptVersion: row.gatekeeperPromptVersion,
    gatekeeperPromptHash: row.gatekeeperPromptHash,
    evidenceClass: isEvidenceClass(row.evidenceClass) ? row.evidenceClass : null,
    authorLean: row.authorLean,
    authorLeanCertainty: row.authorLeanCertainty,
    consensusView: isConsensusView(row.consensusView) ? row.consensusView : null,
    factSignal: row.factSignal,
    eventActors: row.eventActors,
    eventTarget: row.eventTarget,
    isOccurrence: row.isOccurrence,
    verified: row.verified,
    facet: isFacet(row.facet) ? row.facet : null,
    claimsDetail: toClaimsDetail(row.claimsDetail),
    carriedForward,
  }
}

/** Narrow an untyped value to a finite number, else null. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Narrow an untyped value to a non-empty string, else null. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Read `ContextSnapshot.oracleSnapshot` (untyped Json) and map its `sources` array
 * to `ContributingSource[]` tagged `origin: 'oracle'`. Defensive: any non-array,
 * missing-url, or malformed entry is skipped — never trust the blob's shape.
 */
export function oracleSnapshotToContributingSources(oracleSnapshot: unknown): ContributingSource[] {
  if (!oracleSnapshot || typeof oracleSnapshot !== 'object') return []
  const raw = (oracleSnapshot as { sources?: unknown }).sources
  if (!Array.isArray(raw)) return []

  const out: ContributingSource[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const url = str(e.url)
    if (!url) continue
    const claims = Array.isArray(e.claims) ? e.claims.filter((c): c is string => typeof c === 'string') : []
    out.push({
      url,
      title: str(e.title),
      source: str(e.sourceName),
      author: str(e.author),
      publishedAt: str(e.publishedAt),
      similarity: null,
      stance: num(e.stance),
      certainty: num(e.certainty),
      claim: claims[0] ?? null,
      oracleProbability: null,
      outcome: null,
      origin: 'oracle',
      outletName: null,
      personName: null,
      settled: typeof e.settled === 'boolean' ? e.settled : null,
    })
  }
  return out
}
