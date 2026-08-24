/**
 * Compare EvidencePoolArticle stance/certainty outcomes across extractor/gatekeeper
 * prompt versions (daatan#1606) — the consumer half of the provenance columns shipped
 * in daatan#1604/PR#1605 (extractorModel/extractorPromptVersion/extractorPromptHash,
 * gatekeeperModel/gatekeeperPromptVersion/gatekeeperPromptHash), backfilled to the
 * "pre-v1" sentinel via PR#1614.
 *
 * Prints a markdown report to stdout: per-version aggregate stats ("what changed, how
 * much"), plus a re-extraction-candidates section (which live rows are still on an
 * older version than the one currently being produced). The "Why"/"Conclusions"/
 * "Action items" narrative sections are left as placeholders — this script computes
 * data, it doesn't interpret it.
 *
 * Usage:
 *   npx tsx scripts/compare-extraction-provenance.ts
 *   npx tsx scripts/compare-extraction-provenance.ts --component=extractor
 *   npx tsx scripts/compare-extraction-provenance.ts --since=2026-08-01 --forecast-id=abc123
 *
 * Requires DATABASE_URL (local .env, or an SSM tunnel / override pointed at
 * staging/prod for real data — this is a read-only query).
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

export type ComponentName = 'extractor' | 'gatekeeper'
const ALL_COMPONENTS: ComponentName[] = ['extractor', 'gatekeeper']
const SENTINEL_VERSION = 'pre-v1'

const COMPONENT_FIELDS: Record<
  ComponentName,
  { model: 'extractorModel' | 'gatekeeperModel'; version: 'extractorPromptVersion' | 'gatekeeperPromptVersion' }
> = {
  extractor: { model: 'extractorModel', version: 'extractorPromptVersion' },
  gatekeeper: { model: 'gatekeeperModel', version: 'gatekeeperPromptVersion' },
}

export interface Flags {
  component?: ComponentName
  since?: string
  forecastId?: string
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {}
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=')
    if (key === 'component') {
      if (value !== 'extractor' && value !== 'gatekeeper') {
        throw new Error(`--component must be "extractor" or "gatekeeper", got "${value}"`)
      }
      flags.component = value
    } else if (key === 'since') {
      if (!value || Number.isNaN(Date.parse(value))) {
        throw new Error(`--since must be a parseable date, got "${value}"`)
      }
      flags.since = value
    } else if (key === 'forecast-id') {
      flags.forecastId = value
    } else if (key) {
      throw new Error(`unknown flag --${key}`)
    }
  }
  return flags
}

export interface Row {
  predictionId: string
  version: string
  stance: number | null
  certainty: number | null
  evidenceClass: string | null
  addedAt: Date
  supersededAt: Date | null
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function stddev(values: number[]): number | null {
  if (values.length < 2) return null
  const m = mean(values) as number
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function fmt(n: number | null, digits = 3): string {
  return n === null ? '—' : n.toFixed(digits)
}

export interface VersionStats {
  version: string
  n: number
  meanStance: number | null
  stddevStance: number | null
  meanCertainty: number | null
  stddevCertainty: number | null
  evidenceClassCounts: Record<string, number>
  firstSeen: Date
  lastSeen: Date
}

export function computeVersionStats(rows: Row[]): VersionStats[] {
  const byVersion = new Map<string, Row[]>()
  for (const row of rows) {
    const bucket = byVersion.get(row.version) ?? []
    bucket.push(row)
    byVersion.set(row.version, bucket)
  }

  const stats: VersionStats[] = []
  for (const [version, versionRows] of byVersion) {
    const stances = versionRows.map((r) => r.stance).filter((v): v is number => v !== null)
    const certainties = versionRows.map((r) => r.certainty).filter((v): v is number => v !== null)
    const evidenceClassCounts: Record<string, number> = {}
    for (const row of versionRows) {
      const cls = row.evidenceClass ?? 'unclassified'
      evidenceClassCounts[cls] = (evidenceClassCounts[cls] ?? 0) + 1
    }
    const addedTimes = versionRows.map((r) => r.addedAt.getTime())
    stats.push({
      version,
      n: versionRows.length,
      meanStance: mean(stances),
      stddevStance: stddev(stances),
      meanCertainty: mean(certainties),
      stddevCertainty: stddev(certainties),
      evidenceClassCounts,
      firstSeen: new Date(Math.min(...addedTimes)),
      lastSeen: new Date(Math.max(...addedTimes)),
    })
  }

  // Chronological order (by first-seen) — hand-bumped version labels ("v1", "v2", ...
  // or the "pre-v1" sentinel) aren't a reliable sort key on their own.
  stats.sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime())
  return stats
}

export function renderStatsTable(stats: VersionStats[]): string {
  const header = '| Version | n | Mean stance | Stddev stance | Mean certainty | Stddev certainty | First seen | Last seen |\n' +
    '|---|---|---|---|---|---|---|---|\n'
  const rows = stats
    .map(
      (s) =>
        `| ${s.version} | ${s.n} | ${fmt(s.meanStance)} | ${fmt(s.stddevStance)} | ${fmt(s.meanCertainty)} | ${fmt(s.stddevCertainty)} | ${s.firstSeen.toISOString().slice(0, 10)} | ${s.lastSeen.toISOString().slice(0, 10)} |`
    )
    .join('\n')
  return header + rows
}

export function renderWhatChanged(stats: VersionStats[]): string {
  if (stats.length < 2) {
    const only = stats[0]
    return only
      ? `Not enough version diversity yet to compare — only \`${only.version}\` present (${only.n} rows).`
      : 'No COMPLETE rows found for this component under the current filters.'
  }
  const lines: string[] = []
  for (let i = 1; i < stats.length; i++) {
    const prev = stats[i - 1]
    const curr = stats[i]
    const stanceDelta =
      prev.meanStance !== null && curr.meanStance !== null ? curr.meanStance - prev.meanStance : null
    const certaintyDelta =
      prev.meanCertainty !== null && curr.meanCertainty !== null
        ? curr.meanCertainty - prev.meanCertainty
        : null
    lines.push(
      `- \`${prev.version}\` → \`${curr.version}\`: mean stance ${fmt(prev.meanStance)} → ${fmt(curr.meanStance)} (Δ ${stanceDelta === null ? '—' : (stanceDelta >= 0 ? '+' : '') + stanceDelta.toFixed(3)}), ` +
        `mean certainty ${fmt(prev.meanCertainty)} → ${fmt(curr.meanCertainty)} (Δ ${certaintyDelta === null ? '—' : (certaintyDelta >= 0 ? '+' : '') + certaintyDelta.toFixed(3)}), n ${prev.n} → ${curr.n}`
    )
  }
  return lines.join('\n')
}

export interface ReExtractionCandidate {
  predictionId: string
  claimText: string
  version: string
  count: number
}

export function findReExtractionCandidates(currentRows: Row[], claimTextById: Map<string, string>): {
  latestVersion: string | null
  candidates: ReExtractionCandidate[]
} {
  if (currentRows.length === 0) return { latestVersion: null, candidates: [] }

  // "Latest" = the version currently being produced by fresh extractions, i.e. the
  // version with the most recent addedAt among live (non-superseded) rows — not a
  // parse of the hand-bumped label, which isn't guaranteed sortable.
  let latest = currentRows[0]
  for (const row of currentRows) {
    if (row.addedAt.getTime() > latest.addedAt.getTime()) latest = row
  }
  const latestVersion = latest.version

  const grouped = new Map<string, { predictionId: string; version: string; count: number }>()
  for (const row of currentRows) {
    if (row.version === latestVersion || row.version === SENTINEL_VERSION) continue
    const key = `${row.predictionId}::${row.version}`
    const existing = grouped.get(key)
    if (existing) existing.count++
    else grouped.set(key, { predictionId: row.predictionId, version: row.version, count: 1 })
  }

  const candidates: ReExtractionCandidate[] = Array.from(grouped.values())
    .map((g) => ({ ...g, claimText: claimTextById.get(g.predictionId) ?? '(unknown forecast)' }))
    .sort((a, b) => b.count - a.count)

  return { latestVersion, candidates }
}

export function renderCandidates(latestVersion: string | null, candidates: ReExtractionCandidate[]): string {
  if (latestVersion === null) return 'No current (non-superseded) COMPLETE rows found.'
  if (candidates.length === 0) {
    return `All current rows already on the latest observed version (\`${latestVersion}\`) or the \`${SENTINEL_VERSION}\` sentinel (predates provenance capture — not a re-extraction candidate).`
  }
  const CAP = 50
  const shown = candidates.slice(0, CAP)
  const header = `Rows not yet re-extracted under the latest observed version (\`${latestVersion}\`), excluding the \`${SENTINEL_VERSION}\` sentinel:\n\n` +
    '| Forecast | Prediction ID | Stuck on version | Rows |\n|---|---|---|---|\n'
  const body = shown
    .map((c) => `| ${c.claimText.replace(/\|/g, '\\|')} | ${c.predictionId} | ${c.version} | ${c.count} |`)
    .join('\n')
  const truncationNote =
    candidates.length > CAP ? `\n\n_...and ${candidates.length - CAP} more forecasts not shown (capped at ${CAP})._` : ''
  return header + body + truncationNote
}

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const components = flags.component ? [flags.component] : ALL_COMPONENTS

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient<Prisma.PrismaClientOptions>({ adapter } as any)

  const reportSections: string[] = []
  reportSections.push(`# Extraction provenance comparison\n\nGenerated ${new Date().toISOString()}`)

  const filterLines: string[] = []
  if (flags.component) filterLines.push(`- component: \`${flags.component}\``)
  if (flags.since) filterLines.push(`- since: \`${flags.since}\``)
  if (flags.forecastId) filterLines.push(`- forecast id: \`${flags.forecastId}\``)
  reportSections.push(filterLines.length ? `## Filters applied\n\n${filterLines.join('\n')}` : '## Filters applied\n\nNone — all COMPLETE rows.')

  for (const component of components) {
    const fields = COMPONENT_FIELDS[component]

    const where: Prisma.EvidencePoolArticleWhereInput = {
      status: 'COMPLETE',
      ...(flags.forecastId ? { predictionId: flags.forecastId } : {}),
      ...(flags.since ? { addedAt: { gte: new Date(flags.since) } } : {}),
    }

    const rawRows = await prisma.evidencePoolArticle.findMany({
      where,
      select: {
        predictionId: true,
        stance: true,
        certainty: true,
        evidenceClass: true,
        addedAt: true,
        supersededAt: true,
        [fields.version]: true,
      },
    })

    const rows: Row[] = rawRows.map((r: any) => ({
      predictionId: r.predictionId,
      version: r[fields.version] ?? 'unknown',
      stance: r.stance,
      certainty: r.certainty,
      evidenceClass: r.evidenceClass,
      addedAt: r.addedAt,
      supersededAt: r.supersededAt,
    }))

    const stats = computeVersionStats(rows)
    const currentRows = rows.filter((r) => r.supersededAt === null)

    const predictionIds = [...new Set(currentRows.map((r) => r.predictionId))]
    const predictions = predictionIds.length
      ? await prisma.prediction.findMany({
          where: { id: { in: predictionIds } },
          select: { id: true, claimText: true },
        })
      : []
    const claimTextById = new Map(predictions.map((p) => [p.id, p.claimText]))

    const { latestVersion, candidates } = findReExtractionCandidates(currentRows, claimTextById)

    reportSections.push(
      `## ${component[0].toUpperCase()}${component.slice(1)}\n\n` +
        `${renderStatsTable(stats)}\n\n` +
        `### What changed\n\n${renderWhatChanged(stats)}\n\n` +
        `### Why\n\n_TODO: fill in after reviewing the stats above._\n\n` +
        `### Conclusions\n\n_TODO: fill in after reviewing the stats above._\n\n` +
        `### Action items — re-extraction candidates\n\n${renderCandidates(latestVersion, candidates)}`
    )
  }

  console.log(reportSections.join('\n\n'))

  await prisma.$disconnect()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
