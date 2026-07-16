import { CURATED_ELECTION_AUTHORS, matchCuratedAuthor, type CuratedAuthor } from './authors'

/** Stance side, mirroring the ±0.15 convention in components/forecasts/ContributingSources.tsx. */
export type StanceSide = 'yes' | 'no' | 'neutral'

export function stanceSide(stance: number | null): StanceSide {
  if (stance == null) return 'neutral'
  if (stance > 0.15) return 'yes'
  if (stance < -0.15) return 'no'
  return 'neutral'
}

/** One Oracle source as consumed here — a structural subset of EnrichedOracleSource. */
export type ElectionSourceInput = {
  author: string | null
  sourceName: string | null
  url: string
  stance: number | null
  certainty: number | null
  claims: string[]
  title: string | null
  /** news-indexer's resolved identity, when known — matchCuratedAuthor's fast path. */
  personId?: string | null
}

/** One election-tagged forecast + the sources the Oracle used on it (its latest evidence snapshot). */
export type ElectionEventInput = {
  id: string
  slug: string | null
  claimText: string
  resolveByISO: string
  status: string
  /** 0–100, or null when the Oracle abstained / no snapshot. */
  probabilityYes: number | null
  sources: ElectionSourceInput[]
}

export type ElectionEvent = Omit<ElectionEventInput, 'sources'>

/** A single author×event cell. Absent from the row's `cells` map = no coverage. */
export type ElectionCell = {
  side: StanceSide
  stance: number | null
  certainty: number | null
  claim: string | null
  title: string | null
  url: string
}

export type ElectionAuthorRow = {
  key: string
  name: string
  nameHe: string
  handle?: string
  lang: CuratedAuthor['lang']
  /** eventId -> cell. Only events this author covered are present. */
  cells: Record<string, ElectionCell>
  /** How many events this author covered (for sorting / display). */
  coverage: number
}

export type ElectionMatrix = {
  events: ElectionEvent[]
  authors: ElectionAuthorRow[]
}

/** Aggregate several matching sources (multiple articles by one author on one event) into one cell. */
function collapseCell(sources: ElectionSourceInput[]): ElectionCell {
  const stances = sources.map((s) => s.stance).filter((s): s is number => s != null)
  const stance = stances.length ? stances.reduce((a, b) => a + b, 0) / stances.length : null
  const certainties = sources.map((s) => s.certainty).filter((c): c is number => c != null)
  const certainty = certainties.length ? Math.max(...certainties) : null
  const withClaim = sources.find((s) => s.claims.length > 0)
  const primary = withClaim ?? sources[0]
  return {
    side: stanceSide(stance),
    stance,
    certainty,
    claim: withClaim?.claims[0] ?? null,
    title: primary.title,
    url: primary.url,
  }
}

/**
 * Build the top table: curated authors as rows (fixed order), election forecasts as
 * columns, and a cell wherever a curated author has an Oracle source on that event.
 * Pure — the caller supplies the already-loaded events + parsed sources.
 */
export function buildElectionMatrix(
  eventInputs: ElectionEventInput[],
  authors: CuratedAuthor[] = CURATED_ELECTION_AUTHORS,
): ElectionMatrix {
  const events: ElectionEvent[] = eventInputs.map(({ sources: _sources, ...e }) => e)

  const rows: ElectionAuthorRow[] = authors.map((a) => ({
    key: a.key,
    name: a.name,
    nameHe: a.nameHe,
    handle: a.handle,
    lang: a.lang,
    cells: {},
    coverage: 0,
  }))
  const rowByKey = new Map(rows.map((r) => [r.key, r]))

  for (const event of eventInputs) {
    // Group this event's sources by the curated author they resolve to.
    const byAuthor = new Map<string, ElectionSourceInput[]>()
    for (const source of event.sources) {
      const key = matchCuratedAuthor(source, authors)
      if (!key) continue
      const list = byAuthor.get(key)
      if (list) list.push(source)
      else byAuthor.set(key, [source])
    }
    for (const [key, sources] of byAuthor) {
      const row = rowByKey.get(key)
      if (!row) continue
      row.cells[event.id] = collapseCell(sources)
      row.coverage += 1
    }
  }

  return { events, authors: rows }
}
